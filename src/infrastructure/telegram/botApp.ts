import { Bot, Keyboard } from "grammy";

import type { BotConfig } from "../config";
import type { PendingPassword } from "../../domain/types";
import type { DocumentRepository, PasswordVault } from "../../domain/ports";
import type { IndexPdf } from "../../application/indexPdf";
import type { AskQuestion } from "../../application/askQuestion";

export class BotApp {
  private bot: Bot;
  private config: BotConfig;
  private repo: DocumentRepository;
  private indexPdf: IndexPdf;
  private askQuestion: AskQuestion | null;
  private vault: PasswordVault;
  private pendingPasswords: Map<number, PendingPassword>;
  private pendingPasswordAdd: Set<number>;
  private webUrl: string;

  constructor(
    config: BotConfig,
    repo: DocumentRepository,
    indexPdf: IndexPdf,
    askQuestion: AskQuestion | null,
    vault: PasswordVault,
  ) {
    this.config = config;
    this.repo = repo;
    this.indexPdf = indexPdf;
    this.askQuestion = askQuestion;
    this.vault = vault;
    this.pendingPasswords = new Map();
    this.pendingPasswordAdd = new Set();
    this.webUrl = config.webUrl;
    this.bot = new Bot(config.botToken);
    this.registerMiddlewares();
    this.registerHandlers();
  }

  private registerMiddlewares(): void {
    this.bot.use(async (ctx, next) => {
      const userId = ctx.from?.id;
      if (userId === undefined || !this.config.allowedUserIds.includes(userId)) {
        await ctx.reply("⛔ No autorizado");
        return;
      }
      await next();
    });

    this.bot.catch((err) => {
      console.error("Bot error:", err);
    });
  }

  private registerHandlers(): void {
    this.bot.command("start", (ctx) => {
      const keyboard = new Keyboard()
        .text("Upload")
        .text("List")
        .text("Password")
        .resized();
      return ctx.reply(
        "👋 Bienvenido a Medicar Records 2\n\n" +
          "Envíame un PDF, una foto, o simplemente haz una pregunta.",
        { reply_markup: keyboard },
      );
    });

    this.bot.on(":document", async (ctx) => {
      try {
        const doc = ctx.message!.document!;
        const file = await ctx.getFile();
        const url = `https://api.telegram.org/file/bot${this.config.botToken}/${file.file_path}`;
        const res = await fetch(url);
        const buffer = Buffer.from(await res.arrayBuffer());

        const mimeType = doc.mime_type ?? "application/octet-stream";
        const fileName = doc.file_name ?? "unknown";
        const record = await this.repo.save(ctx.from!.id, fileName, mimeType, buffer);

        if (mimeType !== "application/pdf") {
          await ctx.reply(`✅ Archivo guardado: ${fileName}`);
          return;
        }

        await ctx.reply(`✅ Guardado: ${fileName}\n⏳ Procesando...`);
        const { indexed, reason } = await this.indexPdf.run({
          buffer,
          fileId: record.id,
          fileName,
        });

        if (indexed) {
          await ctx.reply(`📄 PDF analizado: indexado`);
          return;
        }

        if (reason === "empty") {
          await ctx.reply(
            `⚠️ Guardado: ${fileName}\nNo se pudo indexar: el PDF no tiene texto extraíble (parece escaneado o solo imágenes).`,
          );
          return;
        }

        this.pendingPasswords.set(ctx.from!.id, { recordId: record.id, fileName });
        await ctx.reply(`🔒 PDF protegido: ${fileName}\nEscribe la contraseña:`);
      } catch (error) {
        await ctx.reply("❌ Error al guardar el archivo");
        console.error("File save error:", error);
      }
    });

    this.bot.on(":photo", async (ctx) => {
      try {
        const photos = ctx.message!.photo!;
        const largest = photos[photos.length - 1];
        const file = await ctx.getFile();
        const url = `https://api.telegram.org/file/bot${this.config.botToken}/${file.file_path}`;
        const res = await fetch(url);
        const buffer = Buffer.from(await res.arrayBuffer());

        await this.repo.save(
          ctx.from!.id,
          `photo_${largest.file_unique_id}.jpg`,
          "image/jpeg",
          buffer,
        );

        await ctx.reply("✅ Foto guardada");
      } catch (error) {
        await ctx.reply("❌ Error al guardar la foto");
        console.error("Photo save error:", error);
      }
    });

    this.bot.on(":text", async (ctx) => {
      const text = ctx.message?.text;
      if (!text || text.startsWith("/")) return;

      if (text === "Upload") {
        await ctx.reply(`🌐 Sube archivos desde la web:\n${this.webUrl}`);
        return;
      }

      if (text === "List") {
        const files = this.repo.list();
        if (files.length === 0) {
          await ctx.reply("📂 No hay archivos guardados.");
          return;
        }
        const lines = files.map((f, i) => `${i + 1}. <code>${f.id}</code> — ${f.originalName}`).join("\n");
        await ctx.reply(`📂 Archivos guardados:\n\n${lines}`, { parse_mode: "HTML" });
        return;
      }

      if (text === "Password") {
        this.pendingPasswordAdd.add(ctx.from!.id);
        await ctx.reply("🔑 Escribe la contraseña para PDFs que quieres guardar:");
        return;
      }

      if (this.pendingPasswordAdd.has(ctx.from!.id)) {
        this.pendingPasswordAdd.delete(ctx.from!.id);
        this.vault.add(text);
        await ctx.reply("✅ Contraseña guardada.");
        return;
      }

      const pending = this.pendingPasswords.get(ctx.from!.id);
      if (pending) {
        const record = this.repo.get(pending.recordId);
        if (!record) {
          this.pendingPasswords.delete(ctx.from!.id);
          await ctx.reply("❌ El archivo ya no existe.");
          return;
        }

        const fileBuffer = Buffer.from(await Bun.file(record.path).arrayBuffer());
        const { indexed, reason } = await this.indexPdf.run({
          buffer: fileBuffer,
          fileId: pending.recordId,
          fileName: pending.fileName,
          password: text,
        });
        if (indexed) {
          this.pendingPasswords.delete(ctx.from!.id);
          await ctx.reply("🔓 Desbloqueado. 📄 PDF analizado e indexado");
        } else if (reason === "empty") {
          this.pendingPasswords.delete(ctx.from!.id);
          await ctx.reply(
            "🔓 Desbloqueado, pero el PDF no tiene texto extraíble (parece escaneado). No se indexó.",
          );
        } else {
          await ctx.reply("❌ Contraseña incorrecta, intenta de nuevo:");
        }
        return;
      }

      if (!this.askQuestion) {
        await ctx.reply("❌ El sistema de análisis no está disponible.");
        return;
      }

      await ctx.reply("🔍 Analizando...");
      try {
        const answer = await this.askQuestion.run(text);
        await ctx.reply(answer);
      } catch (error) {
        await ctx.reply("❌ Error al procesar.");
        console.error("Error:", error);
      }
    });
  }

  async start(): Promise<void> {
    await this.bot.start({
      onStart: () => console.log("Bot started"),
    });
  }

  async stop(): Promise<void> {
    await this.bot.stop();
  }
}
