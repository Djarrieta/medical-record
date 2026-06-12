/**
 * Telegram command & message handlers (plan §5).
 * Registered on the bot after the allowlist guard.
 */

import { Bot, type Context } from "grammy";
import { config } from "../config.ts";
import { createLogger } from "../util/logger.ts";
import { splitForTelegram } from "../util/telegram.ts";
import { allow } from "../util/rateLimit.ts";
import { consentKeyboard } from "./keyboards.ts";
import { userHasConsent } from "./access.ts";
import {
  audit,
  deleteDocument,
  ensureUser,
  listDocuments,
  resetUser,
  setConsent,
} from "../storage/db.ts";
import {
  addPassword,
  deletePassword,
  listPasswords,
  maskPassword,
} from "../storage/passwords.ts";
import { ingestFile, ingestNote } from "../ingestion/intake.ts";
import { downloadTelegramFile } from "../ingestion/downloader.ts";
import { createUploadToken } from "../web/tokens.ts";
import { answerQuestion } from "../rag/qa.ts";

const log = createLogger("handlers");

const TELEGRAM_DOWNLOAD_LIMIT = 20 * 1024 * 1024; // 20 MB Bot API limit

const HELP = `📋 *Cómo usar el bot*

Este bot solo consulta *tus propios documentos médicos*. No da consejo ni interpretación.

*Preguntar:* escribe tu pregunta y te respondo con base en tus documentos (con fuentes).
  Ej: "¿cómo ha cambiado mi colesterol?", "¿cuándo me hicieron el último análisis?"

*Subir documentos:*
  /upload — enlace temporal (solo LAN) para arrastrar PDF/imágenes grandes
  También puedes enviar un archivo pequeño (máx. 20 MB) directo aquí
  /addnote <texto> — guardar una nota escrita

*Gestionar:*
  /list — listar tus documentos
  /delete <id> — borrar un documento
  /reset — borrar TODOS tus datos

*Contraseñas de PDF:*
  /passwords — ver contraseñas guardadas (enmascaradas)
  /addpassword <clave> — añadir una contraseña para abrir PDFs cifrados
  /delpassword <id> — borrar una contraseña

  /privacy — qué datos se guardan`;

const PRIVACY = `🔒 *Privacidad*

- Solo usuarios autorizados pueden usar el bot.
- Tus documentos y datos están aislados por tu usuario; nunca se mezclan con otros.
- Los textos y vectores se guardan en el servidor personal; los embeddings se generan localmente.
- Para responder, se envían *solo los fragmentos mínimos* necesarios al modelo de IA (DeepSeek).
- Las contraseñas de PDF se tratan como secretos y no se registran.
- Puedes borrar datos cuando quieras: /delete <id> o /reset.
- El bot es solo informativo: *no es consejo médico*.`;

const WELCOME = `👋 *Bienvenido/a*

Soy un bot para consultar *tus propios documentos médicos*. Reporto lo que dicen tus
documentos (con fuentes) y *nunca* doy consejo, interpretación ni diagnóstico.

Antes de empezar necesito tu consentimiento para almacenar y procesar los documentos que subas.`;

async function reply(ctx: Context, text: string): Promise<void> {
  for (const part of splitForTelegram(text)) {
    await ctx.reply(part, { parse_mode: "Markdown" });
  }
}

/** Require consent before document/Q&A actions. */
async function ensureConsent(ctx: Context): Promise<boolean> {
  const userId = ctx.from!.id;
  ensureUser(userId);
  if (userHasConsent(userId)) return true;
  await ctx.reply(
    "Primero necesito tu consentimiento. Usa /start y pulsa «Acepto».",
  );
  return false;
}

export function registerHandlers(bot: Bot): void {
  /* ------------------------------- /start ------------------------------- */
  bot.command("start", async (ctx) => {
    ensureUser(ctx.from!.id);
    await ctx.reply(WELCOME, { parse_mode: "Markdown", reply_markup: consentKeyboard });
  });

  bot.command("help", (ctx) => reply(ctx, HELP));
  bot.command("privacy", (ctx) => reply(ctx, PRIVACY));

  /* ---------------------------- consent flow ---------------------------- */
  bot.callbackQuery("consent:accept", async (ctx) => {
    setConsent(ctx.from.id);
    await ctx.answerCallbackQuery({ text: "¡Gracias!" });
    await ctx.editMessageText(
      "✅ Consentimiento registrado. Ya puedes subir documentos (/upload) y hacer preguntas.\nEscribe /help para ver todo.",
    );
  });

  bot.callbackQuery("consent:decline", async (ctx) => {
    await ctx.answerCallbackQuery({ text: "Entendido." });
    await ctx.editMessageText(
      "❌ Sin consentimiento no puedo almacenar ni procesar documentos. Usa /start cuando quieras aceptar.",
    );
  });

  /* ------------------------------- /upload ------------------------------ */
  bot.command("upload", async (ctx) => {
    if (!(await ensureConsent(ctx))) return;
    if (!config.web.enabled) {
      await ctx.reply("La interfaz de subida web está desactivada en este servidor.");
      return;
    }
    const { url, ttlMin } = createUploadToken(ctx.from!.id);
    await reply(
      ctx,
      `📤 Abre este enlace en la *misma red local* y arrastra tus archivos:\n\n${url}\n\n` +
        `El enlace caduca en ${ttlMin} minutos y es solo para ti.`,
    );
  });

  /* ------------------------------ /addnote ------------------------------ */
  bot.command("addnote", async (ctx) => {
    if (!(await ensureConsent(ctx))) return;
    const text = (ctx.match ?? "").toString().trim();
    if (!text) {
      await ctx.reply("Uso: /addnote <texto de la nota>");
      return;
    }
    const res = ingestNote(ctx.from!.id, text);
    await ctx.reply(
      res.status === "duplicate"
        ? "Esa nota ya estaba guardada."
        : "📝 Nota guardada e indexándose.",
    );
  });

  /* ------------------------------- /list -------------------------------- */
  bot.command("list", async (ctx) => {
    if (!(await ensureConsent(ctx))) return;
    const docs = listDocuments(ctx.from!.id);
    if (docs.length === 0) {
      await ctx.reply("No tienes documentos todavía. Usa /upload para añadir.");
      return;
    }
    const statusEmoji: Record<string, string> = {
      pending: "⏳",
      processing: "⚙️",
      ready: "✅",
      failed: "❌",
    };
    const lines = docs.map(
      (d) =>
        `${statusEmoji[d.status] ?? "•"} *${d.filename}* — ${d.pages || "?"} pág.\n   \`${d.doc_id}\`` +
        (d.status === "failed" && d.error ? `\n   ⚠️ ${d.error}` : ""),
    );
    await reply(ctx, `📚 *Tus documentos:*\n\n${lines.join("\n\n")}`);
  });

  /* ------------------------------ /delete ------------------------------- */
  bot.command("delete", async (ctx) => {
    if (!(await ensureConsent(ctx))) return;
    const id = (ctx.match ?? "").toString().trim();
    if (!id) {
      await ctx.reply("Uso: /delete <id> (mira los ids con /list)");
      return;
    }
    const ok = deleteDocument(ctx.from!.id, id);
    await ctx.reply(ok ? "🗑️ Documento borrado." : "No encontré ese documento.");
  });

  /* ------------------------------- /reset ------------------------------- */
  bot.command("reset", async (ctx) => {
    if (!(await ensureConsent(ctx))) return;
    resetUser(ctx.from!.id);
    await ctx.reply("🧹 Todos tus datos han sido borrados.");
  });

  /* ----------------------------- passwords ------------------------------ */
  bot.command("passwords", async (ctx) => {
    if (!(await ensureConsent(ctx))) return;
    const rows = listPasswords(ctx.from!.id);
    if (rows.length === 0) {
      await ctx.reply("No tienes contraseñas guardadas. Añade con /addpassword <clave>.");
      return;
    }
    const lines = rows.map((r) => `\`${r.id}\` — ${maskPassword(r.password)}`);
    await reply(ctx, `🔑 *Contraseñas guardadas:*\n${lines.join("\n")}`);
  });

  bot.command("addpassword", async (ctx) => {
    if (!(await ensureConsent(ctx))) return;
    const pwd = (ctx.match ?? "").toString().trim();
    // Delete the message containing the secret as soon as possible.
    try {
      await ctx.deleteMessage();
    } catch {
      /* ignore: may lack delete permission */
    }
    if (!pwd) {
      await ctx.reply("Uso: /addpassword <clave>");
      return;
    }
    const added = addPassword(ctx.from!.id, pwd);
    await ctx.reply(
      added
        ? "🔐 Contraseña guardada (y tu mensaje fue borrado por seguridad)."
        : "Esa contraseña ya estaba guardada.",
    );
  });

  bot.command("delpassword", async (ctx) => {
    if (!(await ensureConsent(ctx))) return;
    const id = Number.parseInt((ctx.match ?? "").toString().trim(), 10);
    if (!Number.isFinite(id)) {
      await ctx.reply("Uso: /delpassword <id> (mira los ids con /passwords)");
      return;
    }
    const ok = deletePassword(ctx.from!.id, id);
    await ctx.reply(ok ? "🗑️ Contraseña borrada." : "No encontré esa contraseña.");
  });

  /* --------------------------- file uploads ----------------------------- */
  bot.on(["message:document", "message:photo"], async (ctx) => {
    if (!(await ensureConsent(ctx))) return;

    const doc = ctx.message?.document;
    const photo = ctx.message?.photo?.at(-1);
    const fileSize = doc?.file_size ?? photo?.file_size ?? 0;

    if (fileSize > TELEGRAM_DOWNLOAD_LIMIT) {
      await ctx.reply(
        "Ese archivo supera el límite de 20 MB de Telegram. Usa /upload para subirlo por la web.",
      );
      return;
    }

    try {
      const file = await ctx.getFile();
      if (!file.file_path) throw new Error("sin file_path");
      const data = await downloadTelegramFile(file.file_path);
      const filename =
        doc?.file_name ?? `imagen-${Date.now()}.jpg`;
      const mime = doc?.mime_type ?? (photo ? "image/jpeg" : "application/octet-stream");

      const res = ingestFile({
        userId: ctx.from!.id,
        filename,
        mime,
        data,
        source: "telegram",
      });
      await ctx.reply(
        res.status === "duplicate"
          ? "Ese archivo ya estaba subido."
          : `📥 Recibido *${filename}*. Procesando…`,
        { parse_mode: "Markdown" },
      );
    } catch (err) {
      log.error("Telegram file ingest failed", (err as Error).message);
      await ctx.reply("No pude procesar el archivo. Intenta de nuevo o usa /upload.");
    }
  });

  /* ------------------------- text = question ---------------------------- */
  bot.on("message:text", async (ctx) => {
    const text = ctx.message.text.trim();
    if (text.startsWith("/")) return; // unknown command
    if (!(await ensureConsent(ctx))) return;

    if (!allow(ctx.from!.id, config.limits.qaPerHour)) {
      await ctx.reply("Has alcanzado el límite de preguntas por hora. Inténtalo más tarde.");
      return;
    }

    await ctx.replyWithChatAction("typing");
    audit(ctx.from!.id, "question_asked");
    try {
      const { answer } = await answerQuestion(ctx.from!.id, text);
      await reply(ctx, answer);
    } catch (err) {
      log.error("Q&A failed", (err as Error).message);
      await ctx.reply("Ocurrió un error al responder. Inténtalo de nuevo en unos minutos.");
    }
  });

  log.info("Handlers registered");
}
