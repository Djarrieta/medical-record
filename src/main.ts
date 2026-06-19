import { existsSync, mkdirSync } from "fs";
import { join } from "path";

import { Config } from "./infrastructure/config";
import { SqliteDocumentRepository } from "./infrastructure/persistence/sqliteDocumentRepository";
import { SqlitePasswordVault } from "./infrastructure/persistence/sqlitePasswordVault";
import { UnpdfTextExtractor } from "./infrastructure/pdf/unpdfTextExtractor";
import { TesseractOcr } from "./infrastructure/ocr/tesseractOcr";
import { TransformersEmbedder } from "./infrastructure/embedding/transformersEmbedder";
import { QdrantVectorIndex } from "./infrastructure/vector/qdrantVectorIndex";
import { RecursiveChunker } from "./infrastructure/text/recursiveChunker";
import { DeepseekLlm } from "./infrastructure/llm/deepseekLlm";
import { InMemorySessionStore } from "./infrastructure/session/sessionStore";
import { BotApp } from "./infrastructure/telegram/botApp";
import { startWebServer } from "./infrastructure/web/webServer";

import { IndexPdf } from "./application/indexPdf";
import { AskQuestion } from "./application/askQuestion";
import { DeleteDocument } from "./application/deleteDocument";

// Composition root: the only place that knows concrete adapters.
// It wires infrastructure into the application use cases and starts the drivers.
const config = new Config();
const cfg = config.botConfig;

// --- Adapters (infrastructure) ---
const repo = new SqliteDocumentRepository(cfg.dataDir);
const vault = new SqlitePasswordVault(cfg.dataDir);
const extractor = new UnpdfTextExtractor();
const ocr = new TesseractOcr();
const chunker = new RecursiveChunker();
const sessions = new InMemorySessionStore(cfg.sessionTtlMs, cfg.sessionWarningGraceMs);

const modelsDir = join(cfg.dataDir, "models");
if (!existsSync(modelsDir)) mkdirSync(modelsDir, { recursive: true });
const embedder = new TransformersEmbedder(cfg.embeddingModel, modelsDir);

const vectorIndex = new QdrantVectorIndex(cfg.qdrantUrl);

// --- Use cases (application) ---
const indexPdf = new IndexPdf(extractor, chunker, embedder, vectorIndex, vault, repo, ocr);
const deleteDocument = new DeleteDocument(repo, vectorIndex);

let askQuestion: AskQuestion | null = null;
if (cfg.deepseekApiKey) {
  const llm = new DeepseekLlm(cfg);
  askQuestion = new AskQuestion(embedder, vectorIndex, llm, repo, sessions);
}

// --- Driver adapters ---
const bot = new BotApp(cfg, repo, indexPdf, askQuestion, vault, sessions);

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

process.on("SIGINT", async () => {
  clearInterval(sweep);
  await bot.stop();
  process.exit(0);
});

process.on("SIGTERM", async () => {
  clearInterval(sweep);
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
  deleteDocument,
  sessions,
});
