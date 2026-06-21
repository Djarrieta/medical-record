import { Bot, InputFile, Keyboard } from "grammy";

import type { BotConfig } from "../config";
import type { PendingPassword } from "../../domain/types";
import type { DocumentRepository, PasswordVault, SessionStore } from "../../domain/ports";
import type { IndexPdf } from "../../application/indexPdf";
import type { IndexImage } from "../../application/indexImage";
import type { AskQuestion } from "../../application/askQuestion";
import { isImageBuffer } from "../util/fileType";

// Escape text for Telegram's HTML parse mode (titles/names may contain <, >, &).
function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export class BotApp {
  private bot: Bot;
  private config: BotConfig;
  private repo: DocumentRepository;
  private indexPdf: IndexPdf;
  private indexImage: IndexImage;
  private askQuestion: AskQuestion | null;
  private vault: PasswordVault;
  private sessions: SessionStore;
  private pendingPasswords: Map<number, PendingPassword>;
  private pendingPasswordAdd: Set<number>;
  private webUrl: string;

  constructor(
    config: BotConfig,
    repo: DocumentRepository,
    indexPdf: IndexPdf,
    indexImage: IndexImage,
    askQuestion: AskQuestion | null,
    vault: PasswordVault,
    sessions: SessionStore,
  ) {
    this.config = config;
    this.repo = repo;
    this.indexPdf = indexPdf;
    this.indexImage = indexImage;
    this.askQuestion = askQuestion;
    this.vault = vault;
    this.sessions = sessions;
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
      // Any authorized interaction marks activity and auto-creates the session,
      // so conversation memory works even if the user never opens the web link.
      this.sessions.touch(userId);
      await next();
    });

    this.bot.catch((err) => {
      console.error("Bot error:", err);
    });
  }

  private registerHandlers(): void {
    this.bot.command("start", (ctx) => {
      const keyboard = new Keyboard()
        .text("Subir")
        .text("Archivos")
        .text("Contraseña")
        .text("Nuevo")
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

        const existing = this.repo.findByContent(buffer, ctx.from!.id);
        if (existing) {
          await ctx.reply(
            `♻️ Este archivo ya estaba guardado como: ${existing.originalName}\nNo se volvió a guardar ni indexar.`,
          );
          return;
        }

        const record = await this.repo.save(ctx.from!.id, fileName, mimeType, buffer);

        if (mimeType.startsWith("image/") || isImageBuffer(buffer)) {
          await ctx.reply(`✅ Guardado: ${fileName}\n⏳ Procesando...`);
          const { indexed, reason } = await this.indexImage.run({
            buffer,
            fileId: record.id,
            fileName,
            userId: ctx.from!.id,
          });
          if (indexed) {
            await ctx.reply(`🖼️ Imagen analizada: indexada`);
          } else if (reason === "empty") {
            await ctx.reply(
              `⚠️ Guardado: ${fileName}\nNo se pudo indexar: la imagen no tiene texto extraíble.`,
            );
          }
          return;
        }

        if (mimeType !== "application/pdf") {
          await ctx.reply(`✅ Archivo guardado: ${fileName}`);
          return;
        }

        await ctx.reply(`✅ Guardado: ${fileName}\n⏳ Procesando...`);
        const { indexed, reason } = await this.indexPdf.run({
          buffer,
          fileId: record.id,
          fileName,
          userId: ctx.from!.id,
        });

        if (indexed) {
          await ctx.reply(`📄 PDF analizado: indexado`);
          return;
        }

        if (reason === "empty") {
          await ctx.reply(
            `⚠️ Guardado: ${fileName}\nNo se pudo indexar: no tiene texto extraíble (parece escaneado o solo imágenes).`,
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

        const existing = this.repo.findByContent(buffer, ctx.from!.id);
        if (existing) {
          await ctx.reply(
            `♻️ Esta foto ya estaba guardada como: ${existing.originalName}\nNo se volvió a guardar ni indexar.`,
          );
          return;
        }

        const record = await this.repo.save(
          ctx.from!.id,
          `photo_${largest.file_unique_id}.jpg`,
          "image/jpeg",
          buffer,
        );

        await ctx.reply("✅ Foto guardada\n⏳ Procesando...");
        const { indexed, reason } = await this.indexImage.run({
          buffer,
          fileId: record.id,
          fileName: record.originalName,
          userId: ctx.from!.id,
        });
        if (indexed) {
          await ctx.reply("🖼️ Foto analizada: indexada");
        } else if (reason === "empty") {
          await ctx.reply("⚠️ Foto guardada, pero no tiene texto extraíble. No se indexó.");
        }
      } catch (error) {
        await ctx.reply("❌ Error al guardar la foto");
        console.error("Photo save error:", error);
      }
    });

    this.bot.on(":text", async (ctx) => {
      const text = ctx.message?.text;
      if (!text || text.startsWith("/")) return;

      if (text === "Subir") {
        const session = this.sessions.getOrCreate(ctx.from!.id);
        const link = `${this.webUrl}/u/${ctx.from!.id}?token=${session.token}`;
        await ctx.reply(
          `🌐 Sube archivos desde la web (enlace privado y temporal):\n${link}`,
        );
        return;
      }

      if (text === "Archivos") {
        const files = this.repo.list(ctx.from!.id);
        if (files.length === 0) {
          await ctx.reply("📂 No hay archivos guardados.");
          return;
        }
        const lines = files
          .map((f, i) => {
            const title = escapeHtml(f.title || f.originalName);
            const name = escapeHtml(f.originalName);
            return title === name
              ? `${i + 1}. ${title}`
              : `${i + 1}. <b>${title}</b>\n   <i>${name}</i>`;
          })
          .join("\n");
        await ctx.reply(`📂 Archivos guardados:\n\n${lines}`, { parse_mode: "HTML" });
        return;
      }

      if (text === "Contraseña") {
        this.pendingPasswordAdd.add(ctx.from!.id);
        await ctx.reply("🔑 Escribe la contraseña para PDFs que quieres guardar:");
        return;
      }

      if (text === "Nuevo") {
        this.sessions.close(ctx.from!.id);
        await ctx.reply("🆕 Nueva conversación iniciada. Se borró el historial anterior.");
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
        const record = this.repo.get(pending.recordId, ctx.from!.id);
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
          userId: ctx.from!.id,
          password: text,
        });
        if (indexed) {
          this.pendingPasswords.delete(ctx.from!.id);
          await ctx.reply("🔓 Desbloqueado. 📄 PDF analizado e indexado");
        } else if (reason === "empty") {
          this.pendingPasswords.delete(ctx.from!.id);
          await ctx.reply(
            "🔓 Desbloqueado, pero no tiene texto extraíble (parece escaneado). No se indexó.",
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
        const { answer, documents } = await this.askQuestion.run(text, ctx.from!.id);
        await ctx.reply(answer);
        for (const doc of documents) {
          await ctx.replyWithDocument(new InputFile(doc.path, doc.originalName));
        }
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

  // Send a message to a user out-of-band (used by the session sweep for
  // inactivity warnings and closes). In private chats chatId === userId.
  async notify(userId: number, text: string): Promise<void> {
    try {
      await this.bot.api.sendMessage(userId, text);
    } catch (err) {
      console.error("notify failed:", err);
    }
  }

  async stop(): Promise<void> {
    await this.bot.stop();
  }
}
