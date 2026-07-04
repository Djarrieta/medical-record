import { existsSync, mkdirSync } from "fs";
import { join } from "path";

import { Config } from "./infrastructure/config";
import { openAppDatabase } from "./infrastructure/persistence/sqliteDatabase";
import { SqliteDocumentRepository } from "./infrastructure/persistence/sqliteDocumentRepository";
import { SqlitePasswordVault } from "./infrastructure/persistence/sqlitePasswordVault";
import { SqliteNoteRepository } from "./infrastructure/persistence/sqliteNoteRepository";
import { SqliteProcessedEmails } from "./infrastructure/persistence/sqliteProcessedEmails";
import { UnpdfTextExtractor } from "./infrastructure/pdf/unpdfTextExtractor";
import { TesseractOcr } from "./infrastructure/ocr/tesseractOcr";
import { TransformersEmbedder } from "./infrastructure/embedding/transformersEmbedder";
import { QdrantVectorIndex } from "./infrastructure/vector/qdrantVectorIndex";
import { RecursiveChunker } from "./infrastructure/text/recursiveChunker";
import { DeepseekLlm } from "./infrastructure/llm/deepseekLlm";
import { LlmTitler } from "./infrastructure/llm/llmTitler";
import { LlmTagger } from "./infrastructure/llm/llmTagger";
import { LlmEmailSummarizer } from "./infrastructure/llm/llmEmailSummarizer";
import { InMemorySessionStore } from "./infrastructure/session/sessionStore";
import { BotApp } from "./infrastructure/telegram/botApp";
import { startWebServer } from "./infrastructure/web/webServer";
import { createGoogleAuth } from "./infrastructure/google/googleAuth";
import { GmailApiSource } from "./infrastructure/email/gmailApiSource";
import { AdmZipExtractor } from "./infrastructure/archive/admZipExtractor";

import { IndexPdf } from "./application/indexPdf";
import { IndexImage } from "./application/indexImage";
import { IndexNote } from "./application/indexNote";
import { UpdateNote } from "./application/updateNote";
import { DeleteNote } from "./application/deleteNote";
import { AskQuestion } from "./application/askQuestion";
import { DeleteDocument } from "./application/deleteDocument";
import { IngestEmail } from "./application/ingestEmail";

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
const extractor = new UnpdfTextExtractor();
const ocr = new TesseractOcr();
const chunker = new RecursiveChunker();
const sessions = new InMemorySessionStore(cfg.sessionTtlMs, cfg.sessionWarningGraceMs);

const modelsDir = join(cfg.dataDir, "models");
if (!existsSync(modelsDir)) mkdirSync(modelsDir, { recursive: true });
const embedder = new TransformersEmbedder(cfg.embeddingModel, modelsDir);
console.log("Initializing embedding model...");
await embedder.initialize();
console.log("Embedding model ready.");

// The collection's vector size is derived from the model, so model and index
// can never drift (a mismatch would make every upsert fail with HTTP 400).
const vectorIndex = new QdrantVectorIndex(cfg.qdrantUrl, embedder.dimensions());

// Title generation is optional — only available when an LLM is configured.
const titler = cfg.deepseekApiKey ? new LlmTitler(cfg) : null;
// Tag generation is optional too, on the same LLM availability.
const tagger = cfg.deepseekApiKey ? new LlmTagger(cfg) : null;

// --- Use cases (application) ---
const indexPdf = new IndexPdf(extractor, chunker, embedder, vectorIndex, vault, repo, ocr, titler, tagger);
const indexImage = new IndexImage(ocr, chunker, embedder, vectorIndex, repo, titler, tagger);
const indexNote = new IndexNote(chunker, embedder, vectorIndex, notes, titler, tagger);
const updateNote = new UpdateNote(chunker, embedder, vectorIndex, notes);
const deleteNote = new DeleteNote(notes, vectorIndex);
const deleteDocument = new DeleteDocument(repo, vectorIndex);

let askQuestion: AskQuestion | null = null;
if (cfg.deepseekApiKey) {
  const llm = new DeepseekLlm(cfg);
  askQuestion = new AskQuestion(embedder, vectorIndex, llm, repo, sessions, notes);
}

// Email ingestion is optional — only wired when EMAIL_ENABLED and Gmail creds
// are present, mirroring how AskQuestion is optional.
let ingestEmail: IngestEmail | null = null;
if (cfg.emailEnabled) {
  const auth = createGoogleAuth(cfg);
  const source = new GmailApiSource(auth, cfg.emailQueryDays);
  const processed = new SqliteProcessedEmails(db);
  const emailToUserId = new Map(
    cfg.users
      .filter((u) => u.email)
      .map((u) => [u.email!.toLowerCase().trim(), u.id] as const),
  );
  // Optional LLM triage: only save clear, useful email bodies as notes.
  const summarizer = cfg.deepseekApiKey ? new LlmEmailSummarizer(cfg) : null;
  const archive = new AdmZipExtractor();
  ingestEmail = new IngestEmail(
    source,
    emailToUserId,
    processed,
    repo,
    indexNote,
    indexPdf,
    indexImage,
    archive,
    summarizer,
  );
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

// Email poller: self-rescheduling setTimeout (not setInterval) with an in-flight
// flag, so a slow cycle (Gmail fetch + OCR + LLM tagging) can never overlap the
// next run.
let pollTimer: ReturnType<typeof setTimeout> | null = null;
if (ingestEmail) {
  const job = ingestEmail;
  let polling = false;
  const schedule = () => {
    pollTimer = setTimeout(tick, cfg.emailPollMs);
  };
  const tick = async () => {
    if (polling) {
      schedule();
      return;
    }
    polling = true;
    try {
      const r = await job.run();
      if (r.emails > 0)
        console.log(
          `Email poll: ${r.emails} emails, ${r.pdfs} PDFs, ${r.images} images, ${r.others} others.`,
        );
    } catch (err) {
      console.error("Email poll failed:", err);
    } finally {
      polling = false;
      schedule();
    }
  };
  console.log(`Email ingestion enabled (every ${cfg.emailPollMs / 1000}s).`);
  schedule();
}

process.on("SIGINT", async () => {
  clearInterval(sweep);
  if (pollTimer) clearTimeout(pollTimer);
  await bot.stop();
  process.exit(0);
});

process.on("SIGTERM", async () => {
  clearInterval(sweep);
  if (pollTimer) clearTimeout(pollTimer);
  await bot.stop();
  process.exit(0);
});

console.log("Ensuring Qdrant collection...");
await vectorIndex.ensureCollection();
console.log("Qdrant collection ready.");

bot.start();

startWebServer({
  port: cfg.webPort,
  host: cfg.webHost,
  repo,
  notes,
  indexPdf,
  indexImage,
  indexNote,
  updateNote,
  deleteDocument,
  deleteNote,
  vectorIndex,
  vault,
  sessions,
});
