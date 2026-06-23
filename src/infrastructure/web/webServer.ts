import { join, resolve, sep } from "path";

import type { DocumentRepository, NoteRepository, SessionStore, VectorIndex } from "../../domain/ports";
import type { IndexPdf } from "../../application/indexPdf";
import type { IndexImage } from "../../application/indexImage";
import type { DeleteDocument } from "../../application/deleteDocument";
import type { DeleteNote } from "../../application/deleteNote";
import { isImageBuffer } from "../util/fileType";
import { normalizeTags } from "../../domain/tags";

interface WebServerOptions {
  port: number;
  host: string;
  repo: DocumentRepository;
  notes: NoteRepository;
  indexPdf: IndexPdf;
  indexImage: IndexImage;
  deleteDocument: DeleteDocument;
  deleteNote: DeleteNote;
  vectorIndex: VectorIndex;
  sessions: SessionStore;
}

// The React SPA is built to web/dist (committed, never built on the server).
// The Bun server serves index.html for the per-user entry route and the hashed
// assets from the same folder.
const DIST_DIR = resolve(process.cwd(), "web", "dist");

// Reads and normalizes a `{ tags: string[] }` JSON body. Returns null on any
// malformed input so the caller can reply 400.
async function readTagsBody(req: Request): Promise<string[] | null> {
  try {
    const body = (await req.json()) as { tags?: unknown };
    if (!Array.isArray(body.tags)) return null;
    return normalizeTags(body.tags.map((t) => String(t)));
  } catch {
    return null;
  }
}

// Serves the SPA shell (index.html) for the per-user entry route.
async function serveIndex(): Promise<Response> {
  const file = Bun.file(join(DIST_DIR, "index.html"));
  if (!(await file.exists())) {
    return new Response(
      "Web build missing. Run `bun run build:web` to generate web/dist.",
      { status: 500 },
    );
  }
  return new Response(file, {
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}

// Serves a static asset from web/dist, guarding against path traversal. Returns
// null when the path escapes the dist root or the file does not exist.
async function tryServeStatic(pathname: string): Promise<Response | null> {
  let rel = decodeURIComponent(pathname);
  if (rel.endsWith("/")) rel += "index.html";
  const full = resolve(DIST_DIR, "." + (rel.startsWith("/") ? rel : "/" + rel));
  if (full !== DIST_DIR && !full.startsWith(DIST_DIR + sep)) return null;
  const file = Bun.file(full);
  if (!(await file.exists())) return null;
  return new Response(file);
}

export function startWebServer(options: WebServerOptions): void {
  Bun.serve({
    port: options.port,
    hostname: options.host,
    async fetch(req) {
      const url = new URL(req.url);
      const method = req.method;

      // The only HTML entry point is /u/<userId>. The front-end reads the token
      // from the query and the API calls are what actually enforce auth.
      if (method === "GET" && /^\/u\/\d+\/?$/.test(url.pathname)) {
        return serveIndex();
      }

      // Resolve the authenticated user for any API request from the query params
      // (userId + token). Returns null and the caller replies 401.
      const authUser = (): number | null => {
        const userIdRaw = url.searchParams.get("userId");
        const token = url.searchParams.get("token");
        if (!userIdRaw || !token) return null;
        const userId = Number(userIdRaw);
        if (!Number.isFinite(userId)) return null;
        const session = options.sessions.getByToken(userId, token);
        if (!session) return null;
        options.sessions.touch(userId);
        return userId;
      };

      if (method === "GET" && url.pathname === "/api/files") {
        const userId = authUser();
        if (userId === null) return new Response("Unauthorized", { status: 401 });
        const files = options.repo.list(userId);
        return new Response(JSON.stringify(files), {
          headers: { "Content-Type": "application/json" },
        });
      }

      // Replace a file's tags (source of truth in SQLite, mirrored to Qdrant).
      if (
        method === "PATCH" &&
        url.pathname.startsWith("/api/files/") &&
        url.pathname.endsWith("/tags")
      ) {
        const userId = authUser();
        if (userId === null) return new Response("Unauthorized", { status: 401 });
        const id = url.pathname.slice(
          "/api/files/".length,
          url.pathname.length - "/tags".length,
        );
        const record = options.repo.get(id, userId);
        if (!record) return new Response("Not found", { status: 404 });

        const tags = await readTagsBody(req);
        if (tags === null) {
          return new Response(JSON.stringify({ ok: false, error: "Invalid tags" }), {
            status: 400,
            headers: { "Content-Type": "application/json" },
          });
        }
        options.repo.setTags(id, tags);
        await options.vectorIndex.setTags(id, tags, userId).catch(() => {});
        return new Response(JSON.stringify({ ok: true, tags }), {
          headers: { "Content-Type": "application/json" },
        });
      }

      // --- Notes ---
      if (method === "GET" && url.pathname === "/api/notes") {
        const userId = authUser();
        if (userId === null) return new Response("Unauthorized", { status: 401 });
        const notes = options.notes.list(userId);
        return new Response(JSON.stringify(notes), {
          headers: { "Content-Type": "application/json" },
        });
      }

      if (
        method === "PATCH" &&
        url.pathname.startsWith("/api/notes/") &&
        url.pathname.endsWith("/tags")
      ) {
        const userId = authUser();
        if (userId === null) return new Response("Unauthorized", { status: 401 });
        const id = url.pathname.slice(
          "/api/notes/".length,
          url.pathname.length - "/tags".length,
        );
        const note = options.notes.get(id, userId);
        if (!note) return new Response("Not found", { status: 404 });

        const tags = await readTagsBody(req);
        if (tags === null) {
          return new Response(JSON.stringify({ ok: false, error: "Invalid tags" }), {
            status: 400,
            headers: { "Content-Type": "application/json" },
          });
        }
        options.notes.setTags(id, tags);
        await options.vectorIndex.setTags(id, tags, userId).catch(() => {});
        return new Response(JSON.stringify({ ok: true, tags }), {
          headers: { "Content-Type": "application/json" },
        });
      }

      if (method === "DELETE" && url.pathname.startsWith("/api/notes/")) {
        const userId = authUser();
        if (userId === null) return new Response("Unauthorized", { status: 401 });
        const id = url.pathname.slice("/api/notes/".length);
        const deleted = await options.deleteNote.run(id, userId);
        if (!deleted) return new Response("Not found", { status: 404 });
        return new Response(JSON.stringify({ ok: true }), {
          headers: { "Content-Type": "application/json" },
        });
      }

      if (
        method === "GET" &&
        url.pathname.startsWith("/api/files/") &&
        url.pathname.endsWith("/raw")
      ) {
        const userId = authUser();
        if (userId === null) return new Response("Unauthorized", { status: 401 });
        const id = url.pathname.slice(
          "/api/files/".length,
          url.pathname.length - "/raw".length,
        );
        const record = options.repo.get(id, userId);
        if (!record) return new Response("Not found", { status: 404 });

        const file = Bun.file(record.path);
        if (!(await file.exists())) {
          return new Response("Not found", { status: 404 });
        }

        const disposition = url.searchParams.get("download") === "1" ? "attachment" : "inline";
        const safeName = encodeURIComponent(record.originalName);
        return new Response(file, {
          headers: {
            "Content-Type": record.mimeType || "application/octet-stream",
            "Content-Disposition": `${disposition}; filename*=UTF-8''${safeName}`,
          },
        });
      }

      if (method === "DELETE" && url.pathname.startsWith("/api/files/")) {
        const userId = authUser();
        if (userId === null) return new Response("Unauthorized", { status: 401 });
        const id = url.pathname.slice("/api/files/".length);
        const deleted = await options.deleteDocument.run(id, userId);
        if (!deleted) return new Response("Not found", { status: 404 });

        return new Response(JSON.stringify({ ok: true }), {
          headers: { "Content-Type": "application/json" },
        });
      }

      if (method === "POST" && url.pathname === "/upload") {
        const userId = authUser();
        if (userId === null) return new Response("Unauthorized", { status: 401 });

        const originalName = req.headers.get("x-file-name");
        if (!originalName) {
          return new Response(JSON.stringify({ ok: false, error: "Missing X-File-Name header" }), {
            status: 400,
            headers: { "Content-Type": "application/json" },
          });
        }

        const mimeType = req.headers.get("content-type") || "application/octet-stream";
        const stream = req.body;

        if (!stream) {
          return new Response(JSON.stringify({ ok: false, error: "Empty body" }), {
            status: 400,
            headers: { "Content-Type": "application/json" },
          });
        }

        try {
          const decodedName = decodeURIComponent(originalName);
          console.log(`Upload received: ${decodedName} (${mimeType})`);

          // Buffer the body up front so we can hash it for duplicate detection.
          const buffer = Buffer.from(await new Response(stream).arrayBuffer());

          const existing = options.repo.findByContent(buffer, userId);
          if (existing) {
            return new Response(
              JSON.stringify({ ok: true, duplicate: true, indexed: existing.indexed, file: existing }),
              { status: 200, headers: { "Content-Type": "application/json" } },
            );
          }

          const record = await options.repo.save(userId, decodedName, mimeType, buffer);

          let indexed = false;
          let reason: string | undefined;
          if (record.mimeType === "application/pdf") {
            const result = await options.indexPdf.run({
              buffer,
              fileId: record.id,
              fileName: record.originalName,
              userId,
            });
            indexed = result.indexed;
            reason = result.reason;

            // Passwords are managed only from Telegram. A locked PDF can't be
            // indexed here, so we don't keep it — the user registers the
            // password in the bot and re-uploads.
            if (reason === "locked") {
              await options.deleteDocument.run(record.id, userId);
              return new Response(JSON.stringify({ ok: true, indexed: false, reason }), {
                status: 200,
                headers: { "Content-Type": "application/json" },
              });
            }
          } else if (record.mimeType.startsWith("image/") || isImageBuffer(buffer)) {
            const result = await options.indexImage.run({
              buffer,
              fileId: record.id,
              fileName: record.originalName,
              userId,
            });
            indexed = result.indexed;
            reason = result.reason;
          }

          return new Response(JSON.stringify({ ok: true, indexed, reason, file: record }), {
            status: 201,
            headers: { "Content-Type": "application/json" },
          });
        } catch (err) {
          console.error("Upload error:", err);
          return new Response(JSON.stringify({ ok: false, error: String(err) }), {
            status: 500,
            headers: { "Content-Type": "application/json" },
          });
        }
      }

      // Static SPA assets (JS/CSS/etc.) live under web/dist; everything that is
      // not an API route falls through to here.
      if (method === "GET") {
        const asset = await tryServeStatic(url.pathname);
        if (asset) return asset;
      }

      return new Response("Not found", { status: 404 });
    },
  });

  console.log(`Web server listening on http://${options.host}:${options.port}`);
}
