import { join, resolve, sep } from "path";

import type { DocumentRepository, NoteRepository, PasswordVault, SessionStore, VectorIndex } from "../../domain/ports";
import type { IndexPdf } from "../../application/indexPdf";
import type { IndexImage } from "../../application/indexImage";
import type { IndexNote } from "../../application/indexNote";
import type { UpdateNote } from "../../application/updateNote";
import type { AskQuestion } from "../../application/askQuestion";
import type { DeleteDocument } from "../../application/deleteDocument";
import type { DeleteNote } from "../../application/deleteNote";
import { isImageBuffer } from "../../domain/fileType";
import { normalizeTags } from "../../domain/tags";

interface WebServerOptions {
  port: number;
  host: string;
  repo: DocumentRepository;
  notes: NoteRepository;
  indexPdf: IndexPdf;
  indexImage: IndexImage;
  indexNote: IndexNote;
  updateNote: UpdateNote;
  deleteDocument: DeleteDocument;
  deleteNote: DeleteNote;
  vectorIndex: VectorIndex;
  vault: PasswordVault;
  askQuestion: AskQuestion | null;
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

// Parses an arbitrary JSON object body. Returns null on malformed input.
async function readJsonBody(req: Request): Promise<Record<string, unknown> | null> {
  try {
    const body = (await req.json()) as unknown;
    if (!body || typeof body !== "object") return null;
    return body as Record<string, unknown>;
  } catch {
    return null;
  }
}

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
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

      // Create a free-form note (chunked + embedded for RAG, like Telegram).
      if (method === "POST" && url.pathname === "/api/notes") {
        const userId = authUser();
        if (userId === null) return new Response("Unauthorized", { status: 401 });
        const body = await readJsonBody(req);
        const text = body && typeof body.text === "string" ? body.text.trim() : "";
        if (!text) return jsonResponse({ ok: false, error: "Texto vacío" }, 400);
        const title = body && typeof body.title === "string" ? body.title.trim() : undefined;
        try {
          const result = await options.indexNote.run({ text, userId, title });
          const note = options.notes.get(result.noteId, userId);
          return jsonResponse({ ok: true, note }, 201);
        } catch (err) {
          console.error("Note create error:", err);
          return jsonResponse({ ok: false, error: String(err) }, 500);
        }
      }

      // Edit a note's body/title (re-indexes its vectors).
      if (
        method === "PUT" &&
        url.pathname.startsWith("/api/notes/") &&
        !url.pathname.endsWith("/tags")
      ) {
        const userId = authUser();
        if (userId === null) return new Response("Unauthorized", { status: 401 });
        const id = url.pathname.slice("/api/notes/".length);
        const body = await readJsonBody(req);
        const text = body && typeof body.text === "string" ? body.text.trim() : "";
        if (!text) return jsonResponse({ ok: false, error: "Texto vacío" }, 400);
        const title = body && typeof body.title === "string" ? body.title.trim() : undefined;
        try {
          const result = await options.updateNote.run({ id, userId, text, title });
          if (!result.ok) return new Response("Not found", { status: 404 });
          const note = options.notes.get(id, userId);
          return jsonResponse({ ok: true, note });
        } catch (err) {
          console.error("Note update error:", err);
          return jsonResponse({ ok: false, error: String(err) }, 500);
        }
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

      // --- Chat (agentic RAG) ---
      if (method === "POST" && url.pathname === "/api/chat") {
        const userId = authUser();
        if (userId === null) return new Response("Unauthorized", { status: 401 });
        if (!options.askQuestion) {
          return jsonResponse(
            { ok: false, error: "El chat no está disponible (falta DEEPSEEK_API_KEY)." },
            503,
          );
        }
        const body = await readJsonBody(req);
        const question = body && typeof body.question === "string" ? body.question.trim() : "";
        if (!question) return jsonResponse({ ok: false, error: "Pregunta vacía" }, 400);
        try {
          const result = await options.askQuestion.run(question, userId);
          const documents = result.documents.map((d) => ({ id: d.id, name: d.originalName }));
          return jsonResponse({ ok: true, answer: result.answer, documents });
        } catch (err) {
          console.error("Chat error:", err);
          return jsonResponse({ ok: false, error: String(err) }, 500);
        }
      }

      // --- Passwords (PDF unlock vault; shared, not per-user) ---
      if (method === "GET" && url.pathname === "/api/passwords") {
        const userId = authUser();
        if (userId === null) return new Response("Unauthorized", { status: 401 });
        return jsonResponse(options.vault.list());
      }

      if (method === "POST" && url.pathname === "/api/passwords") {
        const userId = authUser();
        if (userId === null) return new Response("Unauthorized", { status: 401 });
        const body = await readJsonBody(req);
        const password = body && typeof body.password === "string" ? body.password : "";
        if (!password.trim()) return jsonResponse({ ok: false, error: "Contraseña vacía" }, 400);
        options.vault.add(password);
        return jsonResponse({ ok: true, passwords: options.vault.list() }, 201);
      }

      if (method === "DELETE" && url.pathname.startsWith("/api/passwords/")) {
        const userId = authUser();
        if (userId === null) return new Response("Unauthorized", { status: 401 });
        const id = Number(url.pathname.slice("/api/passwords/".length));
        if (!Number.isFinite(id)) return new Response("Bad request", { status: 400 });
        const removed = options.vault.remove(id);
        if (!removed) return new Response("Not found", { status: 404 });
        return jsonResponse({ ok: true });
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
