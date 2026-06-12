/**
 * Entrypoint: initialize storage, start the LAN upload server, and run the Telegram bot
 * with long-polling (plan §2, §10).
 */

import "dotenv/config";
import { Bot } from "grammy";
import { config } from "./config.ts";
import { createLogger } from "./util/logger.ts";
import { getDb } from "./storage/db.ts";
import { allowlistGuard } from "./bot/access.ts";
import { registerHandlers } from "./bot/handlers.ts";
import { startWebServer } from "./web/server.ts";
import { terminateOcr } from "./ingestion/ocr.ts";

const log = createLogger("main");

async function main(): Promise<void> {
  // Initialize the database (creates schema, loads sqlite-vec).
  getDb();

  // Start the LAN-only upload UI.
  const server = startWebServer();

  // Telegram bot (long-polling — no inbound port).
  const bot = new Bot(config.telegram.botToken);
  bot.use(allowlistGuard);
  registerHandlers(bot);

  bot.catch((err) => {
    log.error("Bot error", err.error instanceof Error ? err.error.message : err.error);
  });

  // Set the visible command menu.
  await bot.api.setMyCommands([
    { command: "start", description: "Iniciar y dar consentimiento" },
    { command: "help", description: "Cómo usar el bot" },
    { command: "upload", description: "Enlace para subir documentos (LAN)" },
    { command: "addnote", description: "Guardar una nota escrita" },
    { command: "list", description: "Listar tus documentos" },
    { command: "delete", description: "Borrar un documento" },
    { command: "reset", description: "Borrar todos tus datos" },
    { command: "passwords", description: "Ver contraseñas de PDF guardadas" },
    { command: "addpassword", description: "Añadir contraseña de PDF" },
    { command: "delpassword", description: "Borrar contraseña de PDF" },
    { command: "privacy", description: "Qué datos se guardan" },
  ]);

  const shutdown = async (signal: string) => {
    log.info(`Received ${signal}, shutting down…`);
    await bot.stop();
    server?.close();
    await terminateOcr();
    process.exit(0);
  };
  process.once("SIGINT", () => void shutdown("SIGINT"));
  process.once("SIGTERM", () => void shutdown("SIGTERM"));

  log.info("Starting bot (long-polling)…");
  await bot.start({
    onStart: (info) => log.info(`Bot @${info.username} is running`),
  });
}

main().catch((err) => {
  log.error("Fatal startup error", err instanceof Error ? err.message : err);
  process.exit(1);
});
