import { existsSync, mkdirSync } from "fs";
import { join } from "path";

import { Config } from "./infrastructure/config";
import { openAppDatabase, migrateLegacyDatabases } from "./infrastructure/persistence/sqliteDatabase";
import { SqliteDocumentRepository } from "./infrastructure/persistence/sqliteDocumentRepository";
import { SqlitePasswordVault } from "./infrastructure/persistence/sqlitePasswordVault";
import { SqliteNoteRepository } from "./infrastructure/persistence/sqliteNoteRepository";
import { SqliteSenderAllowlist } from "./infrastructure/persistence/sqliteSenderAllowlist";
import { SqliteProcessedMessages } from "./infrastructure/persistence/sqliteProcessedMessages";
import { UnpdfTextExtractor } from "./infrastructure/pdf/unpdfTextExtractor";
import { TesseractOcr } from "./infrastructure/ocr/tesseractOcr";
import { TransformersEmbedder } from "./infrastructure/embedding/transformersEmbedder";
import { QdrantVectorIndex } from "./infrastructure/vector/qdrantVectorIndex";
import { RecursiveChunker } from "./infrastructure/text/recursiveChunker";
import { DeepseekLlm } from "./infrastructure/llm/deepseekLlm";
import { LlmTitler } from "./infrastructure/llm/llmTitler";
import { InMemorySessionStore } from "./infrastructure/session/sessionStore";
import { OutlookGraphMailSource } from "./infrastructure/mail/outlookGraphMailSource";
import { BotApp } from "./infrastructure/telegram/botApp";
import { startWebServer } from "./infrastructure/web/webServer";

import { IndexPdf } from "./application/indexPdf";
import { IndexImage } from "./application/indexImage";
import { IndexNote } from "./application/indexNote";
import { DeleteNote } from "./application/deleteNote";
import { AskQuestion } from "./application/askQuestion";
import { DeleteDocument } from "./application/deleteDocument";
import { IngestMail } from "./application/ingestMail";

// Composition root: the only place that knows concrete adapters.
// It wires infrastructure into the application use cases and starts the drivers.
const config = new Config();
const cfg = config.botConfig;

// --- Adapters (infrastructure) ---
// Single SQLite database shared by every relational adapter; Qdrant stays
// dedicated to vectors.
const db = openAppDatabase(cfg.dataDir);
const repo = new SqliteDocumentRepository(db, cfg.dataDir);
const vault = new SqlitePasswordVault(db);
const notes = new SqliteNoteRepository(db);
const senders = new SqliteSenderAllowlist(db);
const processedMessages = new SqliteProcessedMessages(db);
// One-time import of legacy metadata.db / passwords.db into app.db (no-op once
// migrated). Runs after the tables above are created.
migrateLegacyDatabases(db, cfg.dataDir);
const extractor = new UnpdfTextExtractor();
const ocr = new TesseractOcr();
const chunker = new RecursiveChunker();
const sessions = new InMemorySessionStore(cfg.sessionTtlMs, cfg.sessionWarningGraceMs);

const modelsDir = join(cfg.dataDir, "models");
if (!existsSync(modelsDir)) mkdirSync(modelsDir, { recursive: true });
const embedder = new TransformersEmbedder(cfg.embeddingModel, modelsDir);

const vectorIndex = new QdrantVectorIndex(cfg.qdrantUrl);

// Title generation is optional — only available when an LLM is configured.
const titler = cfg.deepseekApiKey ? new LlmTitler(cfg) : null;

// --- Use cases (application) ---
const indexPdf = new IndexPdf(extractor, chunker, embedder, vectorIndex, vault, repo, ocr, titler);
const indexImage = new IndexImage(ocr, chunker, embedder, vectorIndex, repo, titler);
const indexNote = new IndexNote(chunker, embedder, vectorIndex, notes, titler);
const deleteNote = new DeleteNote(notes, vectorIndex);
const deleteDocument = new DeleteDocument(repo, vectorIndex);

let askQuestion: AskQuestion | null = null;
if (cfg.deepseekApiKey) {
  const llm = new DeepseekLlm(cfg);
  askQuestion = new AskQuestion(embedder, vectorIndex, llm, repo, sessions);
}

// --- Driver adapters ---
const bot = new BotApp(
  cfg,
  repo,
  indexPdf,
  indexImage,
  indexNote,
  deleteNote,
  notes,
  senders,
  askQuestion,
  vault,
  sessions,
);

const WARNING_MESSAGE =
  "⏳ Tu sesión está por cerrarse por inactividad. Escribe algo para mantenerla activa; " +
  "de lo contrario se borrará esta conversación (y el enlace de carga dejará de funcionar).";
const CLOSE_MESSAGE =
  "🔒 Sesión cerrada por inactividad: se borró esta conversación. " +
  "El enlace de carga, si lo tenías abierto, también venció.";

// Session sweep: warn before expiry, then close. Runs on an interval.
const sweep = setInterval(() => {
  const now = Date.now();
  for (const s of sessions.dueForClose(now)) {
    sessions.close(s.userId);
    void bot.notify(s.userId, CLOSE_MESSAGE);
  }
  for (const s of sessions.dueForWarning(now)) {
    sessions.markWarned(s.userId);
    void bot.notify(s.userId, WARNING_MESSAGE);
  }
}, cfg.sessionSweepMs);

// Mail ingestion poll (optional): only runs when a Graph client id is set, the
// same way RAG only runs with a DeepSeek key. Pulls attachments/bodies from
// allowed senders and indexes them. Auth via `bun run auth:mail` (one-time).
let mailPoll: ReturnType<typeof setInterval> | null = null;
if (cfg.graphClientId) {
  const mailSource = new OutlookGraphMailSource({
    clientId: cfg.graphClientId,
    authority: cfg.graphAuthority,
    tokenPath: cfg.graphTokenPath,
    allowlist: senders,
  });
  const ingestMail = new IngestMail(
    mailSource,
    processedMessages,
    indexPdf,
    indexImage,
    indexNote,
    repo,
    cfg.mailUserId,
  );
  let ingesting = false;
  const runIngest = async () => {
    if (ingesting) return;
    ingesting = true;
    try {
      const res = await ingestMail.run();
      if (res.messagesProcessed > 0) {
        console.log(
          `Mail ingest: ${res.messagesProcessed} msg(s), ` +
            `${res.documentsIndexed} doc(s), ${res.notesCreated} note(s)`,
        );
      }
    } catch (err) {
      console.error("Mail ingest failed:", err);
    } finally {
      ingesting = false;
    }
  };
  mailPoll = setInterval(() => void runIngest(), cfg.mailPollMs);
  void runIngest();
  console.log(`Mail ingestion enabled (poll every ${cfg.mailPollMs / 1000}s).`);
}

process.on("SIGINT", async () => {
  clearInterval(sweep);
  if (mailPoll) clearInterval(mailPoll);
  await bot.stop();
  process.exit(0);
});

process.on("SIGTERM", async () => {
  clearInterval(sweep);
  if (mailPoll) clearInterval(mailPoll);
  await bot.stop();
  process.exit(0);
});

console.log("Initializing embedding model...");
await embedder.initialize();
console.log("Embedding model ready.");

console.log("Ensuring Qdrant collection...");
await vectorIndex.ensureCollection();
console.log("Qdrant collection ready.");

bot.start();

startWebServer({
  port: cfg.webPort,
  host: cfg.webHost,
  repo,
  indexPdf,
  indexImage,
  deleteDocument,
  sessions,
});
