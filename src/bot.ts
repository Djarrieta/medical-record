import { Bot, InputFile } from "grammy";
import type { BotConfig } from "./types";
import type { FileStore } from "./fileStore";

export class BotApp {
  private bot: Bot;
  private config: BotConfig;
  private fileStore: FileStore;

  constructor(config: BotConfig, fileStore: FileStore) {
    this.config = config;
    this.fileStore = fileStore;
    this.bot = new Bot(config.botToken);
    this.registerMiddlewares();
    this.registerHandlers();
  }

  private registerMiddlewares(): void {
    this.bot.use(async (ctx, next) => {
      if (ctx.from?.id !== this.config.allowedUserId) {
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
    this.bot.command("start", (ctx) =>
      ctx.reply(
        "👋 Bienvenido a Medicar Records 2\n\n" +
          "Envíame un archivo o foto para guardarlo.\n\n" +
          "Comandos:\n" +
          "/list — Lista tus archivos guardados\n" +
          "/get <id> — Descarga un archivo\n" +
          "/delete <id> — Elimina un archivo\n" +
          "/note <texto> — Guarda una nota de texto",
      ),
    );

    this.bot.on(":document", async (ctx) => {
      try {
        const doc = ctx.message!.document!;
        const file = await ctx.getFile();
        const url = `https://api.telegram.org/file/bot${this.config.botToken}/${file.file_path}`;
        const res = await fetch(url);
        const buffer = Buffer.from(await res.arrayBuffer());

        const record = this.fileStore.save(
          ctx.from!.id,
          doc.file_name ?? "unknown",
          doc.mime_type ?? "application/octet-stream",
          buffer,
        );

        await ctx.reply(
          `✅ Guardado: ${doc.file_name}\nID: \`${record.id}\``,
          { parse_mode: "Markdown" },
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

        const record = this.fileStore.save(
          ctx.from!.id,
          `photo_${largest.file_unique_id}.jpg`,
          "image/jpeg",
          buffer,
        );

        await ctx.reply(
          `✅ Foto guardada\nID: \`${record.id}\``,
          { parse_mode: "Markdown" },
        );
      } catch (error) {
        await ctx.reply("❌ Error al guardar la foto");
        console.error("Photo save error:", error);
      }
    });

    this.bot.command("list", async (ctx) => {
      const files = this.fileStore.list();
      if (files.length === 0) {
        await ctx.reply("📂 No hay archivos guardados.");
        return;
      }

      const lines = files.map((f, i) =>
        `${i + 1}. \`${f.id}\` — ${f.originalName} (${formatSize(f.size)})`,
      );

      const chunks = chunkLines(lines, 40);
      for (const chunk of chunks) {
        await ctx.reply(`📂 Archivos guardados:\n\n${chunk}`, {
          parse_mode: "Markdown",
        });
      }
    });

    this.bot.command("get", async (ctx) => {
      const id = ctx.match?.trim();
      if (!id) {
        await ctx.reply("Usa: /get <id>");
        return;
      }

      const record = this.fileStore.get(id);
      if (!record) {
        await ctx.reply("❌ Archivo no encontrado.");
        return;
      }

      try {
        const buffer = await Bun.file(record.path).arrayBuffer();
        await ctx.replyWithDocument(
          new InputFile(Buffer.from(buffer), record.originalName),
        );
      } catch {
        await ctx.reply("❌ Error al leer el archivo del disco.");
      }
    });

    this.bot.command("delete", async (ctx) => {
      const id = ctx.match?.trim();
      if (!id) {
        await ctx.reply("Usa: /delete <id>");
        return;
      }

      const deleted = this.fileStore.delete(id);
      if (!deleted) {
        await ctx.reply("❌ Archivo no encontrado.");
        return;
      }

      await ctx.reply(`🗑️ Archivo \`${id}\` eliminado.`, {
        parse_mode: "Markdown",
      });
    });

    this.bot.command("note", async (ctx) => {
      const text = ctx.match?.trim();
      if (!text) {
        await ctx.reply("Usa: /note <texto>");
        return;
      }

      const buffer = Buffer.from(text, "utf-8");
      const record = this.fileStore.save(
        ctx.from!.id,
        `note_${recordId()}.txt`,
        "text/plain",
        buffer,
      );

      await ctx.reply(
        `📝 Nota guardada\nID: \`${record.id}\``,
        { parse_mode: "Markdown" },
      );
    });

    this.bot.on(":text", async (ctx) => {
      if (!ctx.message?.text.startsWith("/")) {
        await ctx.reply(
          "Envía un archivo, foto, o usa /help para ver comandos.",
        );
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

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function recordId(): string {
  return crypto.randomUUID().slice(0, 8);
}

function chunkLines(lines: string[], max: number): string[] {
  const chunks: string[] = [];
  for (let i = 0; i < lines.length; i += max) {
    chunks.push(lines.slice(i, i + max).join("\n"));
  }
  return chunks;
}
