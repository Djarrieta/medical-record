import { Bot, Keyboard } from "grammy";
import { RecursiveCharacterTextSplitter } from "@langchain/textsplitters";
import type { BotConfig, PendingPassword } from "./types";
import type { FileStore } from "./fileStore";
import type { PdfExtractor } from "./pdfExtractor";
import type { EmbeddingProvider } from "./embedding";
import type { QdrantStore } from "./vectorStore";
import type { RagService } from "./rag";
import type { PasswordStore } from "./passwordStore";

export class BotApp {
  private bot: Bot;
  private config: BotConfig;
  private fileStore: FileStore;
  private pdfExtractor: PdfExtractor | null;
  private embedder: EmbeddingProvider | null;
  private qdrantStore: QdrantStore | null;
  private ragService: RagService | null;
  private passwordStore: PasswordStore | null;
  private pendingPasswords: Map<number, PendingPassword>;
  private pendingPasswordAdd: Set<number>;
  private webUrl: string;

  constructor(
    config: BotConfig,
    fileStore: FileStore,
    pdfExtractor: PdfExtractor | null = null,
    embedder: EmbeddingProvider | null = null,
    qdrantStore: QdrantStore | null = null,
    ragService: RagService | null = null,
    passwordStore: PasswordStore | null = null,
  ) {
    this.config = config;
    this.fileStore = fileStore;
    this.pdfExtractor = pdfExtractor;
    this.embedder = embedder;
    this.qdrantStore = qdrantStore;
    this.ragService = ragService;
    this.passwordStore = passwordStore;
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

  private async processPdf(
    buffer: Buffer,
    recordId: string,
    fileName: string,
    password?: string,
  ): Promise<void> {
    if (!this.pdfExtractor || !this.embedder || !this.qdrantStore) return;

    const text = await this.pdfExtractor.tryExtract(buffer, password);
    if (text === null) return;

    const splitter = new RecursiveCharacterTextSplitter({
      chunkSize: 1000,
      chunkOverlap: 200,
    });
    const chunks = await splitter.splitText(text);
    const vectors = await this.embedder.embed(chunks);
    await this.qdrantStore.index(chunks, vectors, recordId, fileName);
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
        const record = this.fileStore.save(
          ctx.from!.id,
          doc.file_name ?? "unknown",
          mimeType,
          buffer,
        );

        if (mimeType !== "application/pdf" || !this.pdfExtractor || !this.embedder || !this.qdrantStore) {
          await ctx.reply(`✅ Archivo guardado: ${doc.file_name}`);
          return;
        }

        const text = await this.pdfExtractor.tryExtract(buffer);
        if (text !== null) {
          await ctx.reply(
            `✅ Guardado: ${doc.file_name}\n⏳ Analizando e indexando...`,
          );
          await this.processPdf(buffer, record.id, doc.file_name ?? "unknown");
          await ctx.reply(`📄 PDF analizado: indexado`);
          return;
        }

        if (this.passwordStore) {
          const passwords = this.passwordStore.getAll();
          for (const pw of passwords) {
            const unlocked = await this.pdfExtractor.tryExtract(buffer, pw);
            if (unlocked !== null) {
              await ctx.reply(
                `✅ Guardado: ${doc.file_name}\n⏳ Analizando e indexando...`,
              );
              await this.processPdf(buffer, record.id, doc.file_name ?? "unknown", pw);
              await ctx.reply(`📄 PDF analizado: indexado`);
              return;
            }
          }
        }

        this.pendingPasswords.set(ctx.from!.id, { recordId: record.id, fileName: doc.file_name ?? "unknown" });
        await ctx.reply(
          `🔒 PDF protegido: ${doc.file_name}\nEscribe la contraseña:`,
        );
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

        this.fileStore.save(
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
        const files = this.fileStore.list();
        if (files.length === 0) {
          await ctx.reply("📂 No hay archivos guardados.");
          return;
        }
        const lines = files.map((f, i) => `${i + 1}. <code>${f.id}</code> — ${f.originalName}`).join("\n");
        await ctx.reply(`📂 Archivos guardados:\n\n${lines}`, { parse_mode: "HTML" });
        return;
      }

      if (text === "Password") {
        if (!this.passwordStore) {
          await ctx.reply("❌ El sistema de contraseñas no está disponible.");
          return;
        }
        this.pendingPasswordAdd.add(ctx.from!.id);
        await ctx.reply("🔑 Escribe la contraseña para PDFs que quieres guardar:");
        return;
      }

      if (this.pendingPasswordAdd.has(ctx.from!.id)) {
        this.pendingPasswordAdd.delete(ctx.from!.id);
        this.passwordStore?.add(text);
        await ctx.reply("✅ Contraseña guardada.");
        return;
      }

      const pending = this.pendingPasswords.get(ctx.from!.id);
      if (pending && this.pdfExtractor && this.embedder && this.qdrantStore) {
        const record = this.fileStore.get(pending.recordId);
        if (!record) {
          this.pendingPasswords.delete(ctx.from!.id);
          await ctx.reply("❌ El archivo ya no existe.");
          return;
        }

        const fileBuffer = Buffer.from(await Bun.file(record.path).arrayBuffer());
        const unlocked = await this.pdfExtractor.tryExtract(fileBuffer, text);
        if (unlocked !== null) {
          this.passwordStore?.add(text);
          this.pendingPasswords.delete(ctx.from!.id);
          await ctx.reply(`🔓 Desbloqueado. Indexando...`);
          await this.processPdf(fileBuffer, pending.recordId, pending.fileName, text);
          await ctx.reply(`📄 PDF analizado e indexado`);
        } else {
          await ctx.reply("❌ Contraseña incorrecta, intenta de nuevo:");
        }
        return;
      }

      if (!this.ragService) {
        await ctx.reply("❌ El sistema de análisis no está disponible.");
        return;
      }

      await ctx.reply("🔍 Analizando...");
      try {
        const answer = await this.ragService.answer(text);
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
