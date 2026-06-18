import { existsSync, mkdirSync } from "fs";
import { join } from "path";

import { Config } from "./infrastructure/config";
import { SqliteDocumentRepository } from "./infrastructure/persistence/sqliteDocumentRepository";
import { SqlitePasswordVault } from "./infrastructure/persistence/sqlitePasswordVault";
import { UnpdfTextExtractor } from "./infrastructure/pdf/unpdfTextExtractor";
import { TransformersEmbedder } from "./infrastructure/embedding/transformersEmbedder";
import { QdrantVectorIndex } from "./infrastructure/vector/qdrantVectorIndex";
import { RecursiveChunker } from "./infrastructure/text/recursiveChunker";
import { DeepseekLlm } from "./infrastructure/llm/deepseekLlm";
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
const chunker = new RecursiveChunker();

const modelsDir = join(cfg.dataDir, "models");
if (!existsSync(modelsDir)) mkdirSync(modelsDir, { recursive: true });
const embedder = new TransformersEmbedder(cfg.embeddingModel, modelsDir);

const vectorIndex = new QdrantVectorIndex(cfg.qdrantUrl);

// --- Use cases (application) ---
const indexPdf = new IndexPdf(extractor, chunker, embedder, vectorIndex, vault);
const deleteDocument = new DeleteDocument(repo, vectorIndex);

let askQuestion: AskQuestion | null = null;
if (cfg.deepseekApiKey) {
  const llm = new DeepseekLlm(cfg);
  askQuestion = new AskQuestion(embedder, vectorIndex, llm);
}

// --- Driver adapters ---
const bot = new BotApp(cfg, repo, indexPdf, askQuestion, vault);

process.on("SIGINT", async () => {
  await bot.stop();
  process.exit(0);
});

process.on("SIGTERM", async () => {
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

const webPort = process.env.WEB_PORT ?? "3000";
startWebServer({
  port: parseInt(webPort, 10),
  host: process.env.WEB_HOST ?? "0.0.0.0",
  password: process.env.WEB_PASSWORD,
  repo,
  indexPdf,
  deleteDocument,
});
