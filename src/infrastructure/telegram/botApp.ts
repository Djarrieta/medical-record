import { Bot, InlineKeyboard, InputFile, Keyboard } from "grammy";
import type { Context } from "grammy";

import type { BotConfig } from "../config";
import type { PendingPassword } from "../../domain/types";
import type {
  DocumentRepository,
  NoteRepository,
  PasswordVault,
  SenderAllowlist,
  SessionStore,
} from "../../domain/ports";
import type { IndexPdf } from "../../application/indexPdf";
import type { IndexImage } from "../../application/indexImage";
import type { IndexNote } from "../../application/indexNote";
import type { DeleteNote } from "../../application/deleteNote";
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
  private indexNote: IndexNote;
  private deleteNote: DeleteNote;
  private notes: NoteRepository;
  private senders: SenderAllowlist;
  private askQuestion: AskQuestion | null;
  private vault: PasswordVault;
  private sessions: SessionStore;
  private pendingPasswords: Map<number, PendingPassword>;
  private pendingPasswordAdd: Set<number>;
  private pendingNote: Set<number>;
  private pendingSenderAdd: Set<number>;
  private pendingSenderRemove: Set<number>;
  private webUrl: string;

  constructor(
    config: BotConfig,
    repo: DocumentRepository,
    indexPdf: IndexPdf,
    indexImage: IndexImage,
    indexNote: IndexNote,
    deleteNote: DeleteNote,
    notes: NoteRepository,
    senders: SenderAllowlist,
    askQuestion: AskQuestion | null,
    vault: PasswordVault,
    sessions: SessionStore,
  ) {
    this.config = config;
    this.repo = repo;
    this.indexPdf = indexPdf;
    this.indexImage = indexImage;
    this.indexNote = indexNote;
    this.deleteNote = deleteNote;
    this.notes = notes;
    this.senders = senders;
    this.askQuestion = askQuestion;
    this.vault = vault;
    this.sessions = sessions;
    this.pendingPasswords = new Map();
    this.pendingPasswordAdd = new Set();
    this.pendingNote = new Set();
    this.pendingSenderAdd = new Set();
    this.pendingSenderRemove = new Set();
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

  // Clear any pending single-shot text-input states for a user. Prevents a
  // stale intent (e.g. an earlier "Nota" press that was never followed up) from
  // hijacking a later, unrelated message.
  private clearPending(userId: number): void {
    this.pendingPasswordAdd.delete(userId);
    this.pendingNote.delete(userId);
    this.pendingSenderAdd.delete(userId);
    this.pendingSenderRemove.delete(userId);
    this.pendingPasswords.delete(userId);
  }

  private registerHandlers(): void {
    this.bot.command("start", (ctx) => {
      this.clearPending(ctx.from!.id);
      const keyboard = new Keyboard()
        .text("Archivos")
        .text("Contraseña")
        .row()
        .text("Notas")
        .text("Correos")
        .text("Reiniciar")
        .resized();
      return ctx.reply(
        "👋 Bienvenido a Medicar Records 2\n\n" +
          "Envíame un PDF, una foto, o simplemente haz una pregunta.",
        { reply_markup: keyboard },
      );
    });

    this.bot.on("callback_query:data", async (ctx) => {
      const userId = ctx.from!.id;
      const data = ctx.callbackQuery.data;

      if (data.startsWith("delnote:")) {
        const noteId = data.slice("delnote:".length);
        const ok = await this.deleteNote.run(noteId, userId);
        await ctx.answerCallbackQuery(ok ? "Nota eliminada" : "La nota ya no existe");
        if (ok) await ctx.editMessageReplyMarkup();
        return;
      }

      if (data === "files:upload") {
        const session = this.sessions.getOrCreate(userId);
        const link = `${this.webUrl}/u/${userId}?token=${session.token}`;
        await ctx.answerCallbackQuery();
        await ctx.reply(
          `🌐 Sube archivos desde la web (enlace privado y temporal):\n${link}`,
        );
        return;
      }

      if (data === "files:list") {
        await ctx.answerCallbackQuery();
        await this.replyFilesList(ctx);
        return;
      }

      if (data === "note:add") {
        this.pendingNote.add(userId);
        await ctx.answerCallbackQuery();
        await ctx.reply("📝 Escribe la nota que quieres guardar:");
        return;
      }

      if (data === "note:list") {
        await ctx.answerCallbackQuery();
        await this.replyNotesList(ctx);
        return;
      }

      if (data === "sender:add") {
        this.pendingSenderRemove.delete(userId);
        this.pendingSenderAdd.add(userId);
        await ctx.answerCallbackQuery();
        await ctx.reply(
          "✉️ Escribe la dirección o dominio a permitir (ej. `@sura.com` o `alguien@correo.com`):",
        );
        return;
      }

      if (data === "sender:remove") {
        this.pendingSenderAdd.delete(userId);
        this.pendingSenderRemove.add(userId);
        await ctx.answerCallbackQuery();
        await ctx.reply("🗑️ Escribe la dirección o dominio a quitar:");
        return;
      }

      if (data === "sender:list") {
        await ctx.answerCallbackQuery();
        await this.replySenderList(ctx);
        return;
      }

      await ctx.answerCallbackQuery();
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

      // Pressing a menu button is an explicit new action, so any earlier
      // pending input intent (e.g. a forgotten "Nota" prompt) is cancelled.
      // This prevents a stale state from silently saving the next message as a
      // note, password, etc.
      const MENU_LABELS = ["Archivos", "Contraseña", "Notas", "Correos", "Reiniciar"];
      if (MENU_LABELS.includes(text)) {
        this.clearPending(ctx.from!.id);
      }

      if (text === "Archivos") {
        const keyboard = new InlineKeyboard()
          .text("Subir", "files:upload")
          .text("Listar", "files:list");
        await ctx.reply("📂 Archivos:", { reply_markup: keyboard });
        return;
      }

      if (text === "Contraseña") {
        this.pendingPasswordAdd.add(ctx.from!.id);
        await ctx.reply("🔑 Escribe la contraseña para PDFs que quieres guardar:");
        return;
      }

      if (text === "Reiniciar") {
        this.sessions.close(ctx.from!.id);
        await ctx.reply("🆕 Nueva conversación iniciada. Se borró el historial anterior.");
        return;
      }

      if (text === "Notas") {
        const keyboard = new InlineKeyboard()
          .text("Agregar", "note:add")
          .text("Listar", "note:list");
        await ctx.reply("📝 Notas:", { reply_markup: keyboard });
        return;
      }

      if (text === "Correos") {
        const keyboard = new InlineKeyboard()
          .text("Agregar", "sender:add")
          .text("Quitar", "sender:remove")
          .text("Listar", "sender:list");
        await ctx.reply("✉️ Remitentes permitidos para ingesta de correo:", {
          reply_markup: keyboard,
        });
        return;
      }

      if (this.pendingPasswordAdd.has(ctx.from!.id)) {
        this.pendingPasswordAdd.delete(ctx.from!.id);
        this.vault.add(text);
        await ctx.reply("✅ Contraseña guardada.");
        return;
      }

      if (this.pendingNote.has(ctx.from!.id)) {
        this.pendingNote.delete(ctx.from!.id);
        try {
          const { title } = await this.indexNote.run({ text, userId: ctx.from!.id });
          await ctx.reply(`📝 Nota guardada: ${title}`);
        } catch (error) {
          await ctx.reply("❌ Error al guardar la nota.");
          console.error("IndexNote error:", error);
        }
        return;
      }

      if (this.pendingSenderAdd.has(ctx.from!.id)) {
        this.pendingSenderAdd.delete(ctx.from!.id);
        this.senders.add(text);
        await ctx.reply(`✅ Remitente agregado: ${text.trim().toLowerCase()}`);
        return;
      }

      if (this.pendingSenderRemove.has(ctx.from!.id)) {
        this.pendingSenderRemove.delete(ctx.from!.id);
        this.senders.remove(text);
        await ctx.reply(`🗑️ Remitente quitado: ${text.trim().toLowerCase()}`);
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

  // List the user's saved files as plain text (titles + original names).
  private async replyFilesList(ctx: Context): Promise<void> {
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
  }

  // List the user's notes, each with an inline button to delete it.
  private async replyNotesList(ctx: Context): Promise<void> {
    const userId = ctx.from!.id;
    const notes = this.notes.list(userId);
    if (notes.length === 0) {
      await ctx.reply("📝 No hay notas guardadas.");
      return;
    }
    const keyboard = new InlineKeyboard();
    const lines = notes.map((n, i) => {
      keyboard.text(`🗑️ ${i + 1}`, `delnote:${n.id}`).row();
      return `${i + 1}. <b>${escapeHtml(n.title)}</b>`;
    });
    await ctx.reply(`📝 Notas guardadas:\n\n${lines.join("\n")}`, {
      parse_mode: "HTML",
      reply_markup: keyboard,
    });
  }

  // Show the current sender allowlist as plain text.
  private async replySenderList(ctx: Context): Promise<void> {
    const entries = this.senders.list();
    if (entries.length === 0) {
      await ctx.reply("✉️ No hay remitentes permitidos.");
      return;
    }
    const lines = entries.map((e, i) => `${i + 1}. ${e}`).join("\n");
    await ctx.reply(`✉️ Remitentes permitidos:\n\n${lines}`);
  }

  async start(): Promise<void> {
    // Register the only real slash command so Telegram's "/" menu shows just
    // /start. This overwrites any stale commands previously set via BotFather.
    await this.bot.api.setMyCommands([
      { command: "start", description: "Mostrar el menú principal" },
    ]);
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
