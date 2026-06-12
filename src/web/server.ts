/**
 * LAN-only upload web server (plan §8). Bun.serve + Hono.
 *
 * Security:
 *  - Bind to the LAN only (WEB_HOST); never expose publicly. Transport is plain HTTP (MVP).
 *  - Every request is gated by a single-session, TTL-bound token that maps to a user_id.
 *  - Uploads accepted only for allowlisted users; per-file size capped by MAX_UPLOAD_MB.
 */

import { Hono } from "hono";
import { config } from "../config.ts";
import { createLogger } from "../util/logger.ts";
import { isAllowed } from "../bot/access.ts";
import { resolveUploadToken } from "./tokens.ts";
import { uploadPageHtml } from "./public/uploadPage.ts";
import { ingestFile } from "../ingestion/intake.ts";

const log = createLogger("web");

export function buildApp(): Hono {
  const app = new Hono();
  const maxBytes = config.limits.maxUploadMb * 1024 * 1024;

  app.get("/", (c) => c.text("Medical Record uploader. Use the /upload link from the bot.", 200));

  app.get("/healthz", (c) => c.json({ ok: true }));

  // Upload page (token-gated).
  app.get("/u/:token", (c) => {
    const token = c.req.param("token");
    const userId = resolveUploadToken(token);
    if (userId === null) {
      return c.html(
        "<h1>Enlace inválido o caducado</h1><p>Pide uno nuevo con /upload en Telegram.</p>",
        410,
      );
    }
    return c.html(uploadPageHtml(token));
  });

  // Upload endpoint (token-gated, allowlist-gated, size-capped).
  app.post("/api/upload/:token", async (c) => {
    const token = c.req.param("token");
    const userId = resolveUploadToken(token);
    if (userId === null) return c.json({ error: "Enlace inválido o caducado" }, 410);
    if (!isAllowed(userId)) return c.json({ error: "Usuario no autorizado" }, 403);

    let body: FormData;
    try {
      body = await c.req.formData();
    } catch {
      return c.json({ error: "Solicitud inválida" }, 400);
    }

    const file = body.get("file");
    if (!(file instanceof File)) return c.json({ error: "Falta el archivo" }, 400);
    if (file.size > maxBytes) {
      return c.json({ error: `El archivo supera ${config.limits.maxUploadMb} MB` }, 413);
    }

    const data = new Uint8Array(await file.arrayBuffer());
    const res = ingestFile({
      userId,
      filename: file.name || "documento",
      mime: file.type || "application/octet-stream",
      data,
      source: "web",
    });

    return c.json({ docId: res.docId, filename: res.filename, status: res.status });
  });

  return app;
}

export function startWebServer(): ReturnType<typeof Bun.serve> | null {
  if (!config.web.enabled) {
    log.info("Web UI disabled (WEB_UI_ENABLED=false)");
    return null;
  }
  const app = buildApp();
  const server = Bun.serve({
    fetch: app.fetch,
    hostname: config.web.host,
    port: config.web.port,
    maxRequestBodySize: (config.limits.maxUploadMb + 8) * 1024 * 1024,
  });
  log.info(`Web UI on http://${config.web.host}:${config.web.port} (LAN only)`);
  return server;
}
