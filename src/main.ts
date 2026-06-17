import { existsSync, mkdirSync } from "fs";
import { join } from "path";

import { Config } from "./config";
import { FileStore } from "./fileStore";
import { BotApp } from "./bot";
import { LlmProvider } from "./llm";
import { PdfExtractor } from "./pdfExtractor";
import { EmbeddingProvider } from "./embedding";
import { QdrantStore } from "./vectorStore";
import { RagService } from "./rag";
import { PasswordStore } from "./passwordStore";

const config = new Config();
const fileStore = new FileStore(config.botConfig.dataDir);
const pdfExtractor = new PdfExtractor();
const passwordStore = new PasswordStore(config.botConfig.dataDir);

const modelsDir = join(config.botConfig.dataDir, "models");
if (!existsSync(modelsDir)) mkdirSync(modelsDir, { recursive: true });

const embedder = new EmbeddingProvider(config.botConfig.embeddingModel, modelsDir);

const qdrantStore = new QdrantStore(config.botConfig.qdrantUrl);

let ragService: RagService | null = null;
if (config.botConfig.deepseekApiKey) {
  const llm = LlmProvider.getInstance(config.botConfig);
  ragService = new RagService(llm, embedder, qdrantStore);
}

const bot = new BotApp(config.botConfig, fileStore, pdfExtractor, embedder, qdrantStore, ragService, passwordStore);

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
await qdrantStore.ensureCollection();
console.log("Qdrant collection ready.");

bot.start();
