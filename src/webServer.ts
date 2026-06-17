import { RecursiveCharacterTextSplitter } from "@langchain/textsplitters";

import type { FileStore } from "./fileStore";
import type { PdfExtractor } from "./pdfExtractor";
import type { EmbeddingProvider } from "./embedding";
import type { QdrantStore } from "./vectorStore";
import type { PasswordStore } from "./passwordStore";

interface WebServerOptions {
  port: number;
  host: string;
  password?: string;
  fileStore: FileStore;
  pdfExtractor: PdfExtractor | null;
  embedder: EmbeddingProvider | null;
  qdrantStore: QdrantStore | null;
  passwordStore: PasswordStore | null;
}

function htmlPage(passwordRequired: boolean): string {
  return `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Medicar Records — Upload</title>
<style>
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    background: #f0f2f5; color: #1a1a2e; min-height: 100vh;
    display: flex; flex-direction: column; align-items: center;
    padding: 2rem 1rem;
  }
  h1 { font-size: 1.5rem; margin-bottom: 1.5rem; color: #16213e; }
  .container { max-width: 640px; width: 100%; }
  #dropZone {
    border: 3px dashed #c5cae9; border-radius: 16px; padding: 3rem 2rem;
    text-align: center; background: #fff; cursor: pointer;
    transition: all .2s; margin-bottom: 1rem;
  }
  #dropZone.dragover { border-color: #3f51b5; background: #e8eaf6; }
  #dropZone p { color: #757575; font-size: 1.1rem; }
  #dropZone .icon { font-size: 3rem; margin-bottom: .5rem; }
  .controls { display: flex; gap: 1rem; align-items: center; margin-bottom: 1rem; flex-wrap: wrap; }
  .controls label { display: flex; align-items: center; gap: .4rem; cursor: pointer; font-size: .9rem; }
  .controls input[type="checkbox"] { width: 1rem; height: 1rem; cursor: pointer; display: none; }
  #passwordInput {
    flex: 1; min-width: 140px; padding: .5rem .75rem; border: 1px solid #ccc;
    border-radius: 8px; font-size: .9rem;
  }
  .file-list { list-style: none; }
  .file-item {
    display: flex; align-items: center; justify-content: space-between;
    padding: .75rem 1rem; background: #fff; border-radius: 10px;
    margin-bottom: .5rem; box-shadow: 0 1px 3px rgba(0,0,0,.08);
    gap: .75rem;
  }
  .file-info { flex: 1; min-width: 0; }
  .file-name { font-weight: 500; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .file-size { font-size: .8rem; color: #757575; }
  .file-status { font-size: .85rem; white-space: nowrap; min-width: 100px; text-align: right; }
  .status-queued { color: #757575; }
  .status-uploading { color: #ff9800; }
  .status-processing { color: #2196f3; }
  .status-done { color: #4caf50; }
  .status-error { color: #e53935; }
  .summary { margin-top: 1rem; padding: 1rem; background: #e8f5e9; border-radius: 10px; display: none; }
  .summary.has-errors { background: #ffebee; }
  .btn-upload {
    display: none; width: 100%; padding: .9rem; background: #3f51b5; color: #fff;
    border: none; border-radius: 10px; font-size: 1rem; cursor: pointer;
    margin-bottom: 1rem; transition: background .2s;
  }
  .btn-upload:hover { background: #303f9f; }
  .btn-upload:disabled { background: #9fa8da; cursor: not-allowed; }

  .file-list-header {
    display: flex; justify-content: space-between; align-items: center;
    margin-bottom: .75rem; margin-top: 1rem;
  }
  .file-list-header h2 { font-size: 1.1rem; color: #16213e; }
  .refresh-btn {
    background: none; border: 1px solid #ccc; border-radius: 8px;
    padding: .3rem .7rem; cursor: pointer; font-size: .85rem; transition: background .2s;
  }
  .refresh-btn:hover { background: #e0e0e0; }
  .delete-btn {
    background: none; border: 1px solid #e53935; color: #e53935; border-radius: 6px;
    padding: .2rem .5rem; cursor: pointer; font-size: .75rem; transition: background .2s;
  }
  .delete-btn:hover { background: #ffebee; }
</style>
</head>
<body>
<div class="container">
  <h1>📁 Medicar Records</h1>

  ${passwordRequired ? `<div class="controls"><input id="passwordInput" type="password" placeholder="Contraseña"></div>` : ""}

  <div id="dropZone">
    <div class="icon">📄</div>
    <p>Arrastra archivos o carpetas aquí</p>
    <p style="font-size:.85rem;margin-top:.3rem">o haz clic para seleccionar</p>
  </div>
  <input id="fileInput" type="file" multiple style="display:none">

  <button id="uploadBtn" class="btn-upload">Subir archivos</button>

  <ul id="fileList" class="file-list"></ul>

  <div id="summary" class="summary"></div>

  <div class="file-list-header">
    <h2>Archivos guardados</h2>
    <button id="refreshBtn" class="refresh-btn">↻</button>
  </div>
  <ul id="savedFiles" class="file-list"></ul>
</div>

<script>
const DROP_ZONE = document.getElementById("dropZone");
const FILE_INPUT = document.getElementById("fileInput");
const UPLOAD_BTN = document.getElementById("uploadBtn");
const FILE_LIST = document.getElementById("fileList");
const SUMMARY = document.getElementById("summary");
const SAVED_FILES = document.getElementById("savedFiles");
const REFRESH_BTN = document.getElementById("refreshBtn");
const PASSWORD_INPUT = document.getElementById("passwordInput");
const PASSWORD_REQUIRED = ${passwordRequired};

let queue = [];
let uploading = false;

function getPassword() { return PASSWORD_INPUT ? PASSWORD_INPUT.value : ""; }

DROP_ZONE.addEventListener("click", () => FILE_INPUT.click());

DROP_ZONE.addEventListener("dragover", (e) => { e.preventDefault(); DROP_ZONE.classList.add("dragover"); });
DROP_ZONE.addEventListener("dragleave", () => DROP_ZONE.classList.remove("dragover"));
DROP_ZONE.addEventListener("drop", (e) => {
  e.preventDefault();
  DROP_ZONE.classList.remove("dragover");
  addFiles(Array.from(e.dataTransfer.files));
});

FILE_INPUT.addEventListener("change", () => {
  if (FILE_INPUT.files) addFiles(Array.from(FILE_INPUT.files));
  FILE_INPUT.value = "";
});

function addFiles(files) {
  for (const f of files) {
    if (queue.some(q => q.name === f.name && q.size === f.size)) continue;
    queue.push({ file: f, name: f.name, size: f.size, status: "queued" });
  }
  renderQueue();
  UPLOAD_BTN.style.display = queue.length ? "block" : "none";
}

function formatSize(bytes) {
  if (bytes < 1024) return bytes + " B";
  if (bytes < 1048576) return (bytes / 1024).toFixed(1) + " KB";
  return (bytes / 1048576).toFixed(1) + " MB";
}

function statusHtml(s) {
  const map = { queued: "⏳ Pendiente", uploading: "⏳ Subiendo...", processing: "⚙️ Procesando...", done: "✅ Completado", error: "❌ Error" };
  return map[s] || s;
}

function renderQueue() {
  FILE_LIST.innerHTML = queue.map((f) =>
    '<li class="file-item"><div class="file-info"><div class="file-name">' + esc(f.name) +
    '</div><div class="file-size">' + formatSize(f.size) +
    '</div></div><div class="file-status status-' + f.status + '">' + statusHtml(f.status) + '</div></li>'
  ).join("");
}

function esc(s) { const d = document.createElement("div"); d.textContent = s; return d.innerHTML; }

UPLOAD_BTN.addEventListener("click", async () => {
  if (uploading) return;
  uploading = true;
  UPLOAD_BTN.disabled = true;
  SUMMARY.style.display = "none";
  let ok = 0, err = 0;

  for (const item of queue) {
    if (item.status === "done" || item.status === "error") continue;
    item.status = "uploading";
    renderQueue();

    try {
      const headers = { "X-File-Name": encodeURIComponent(item.name), "Content-Type": item.file.type || "application/octet-stream" };
      if (PASSWORD_REQUIRED) headers["X-Password"] = getPassword();

      const res = await fetch("/upload", { method: "POST", headers, body: item.file });
      item.status = res.ok ? "done" : "error";
      if (res.ok) ok++; else err++;
    } catch {
      item.status = "error";
      err++;
    }
    renderQueue();
  }

  SUMMARY.style.display = "block";
  const total = queue.length;
  if (err === 0) {
    SUMMARY.className = "summary";
    SUMMARY.textContent = "✅ " + total + " archivo" + (total !== 1 ? "s" : "") + " subido" + (total !== 1 ? "s" : "") + " correctamente.";
  } else {
    SUMMARY.className = "summary has-errors";
    SUMMARY.innerHTML = "⚠️ " + ok + " correcto" + (ok !== 1 ? "s" : "") + ", " + err + " error" + (err !== 1 ? "es" : "") + ".";
  }

  uploading = false;
  UPLOAD_BTN.disabled = false;
  UPLOAD_BTN.style.display = "none";
  queue = [];
  FILE_LIST.innerHTML = "";
  loadSavedFiles();
});

async function loadSavedFiles() {
  try {
    const res = await fetch("/api/files");
    if (!res.ok) return;
    const data = await res.json();
    SAVED_FILES.innerHTML = data.length
      ? data.map(f =>
          '<li class="file-item"><div class="file-info"><div class="file-name">' + esc(f.originalName) +
          '</div><div class="file-size">' + formatSize(f.size) +
          '</div></div><button class="delete-btn" data-id="' + f.id + '">Eliminar</button></li>'
        ).join("")
      : '<li class="file-item" style="color:#757575">No hay archivos guardados.</li>';
    document.querySelectorAll(".delete-btn").forEach(btn => {
      btn.addEventListener("click", async () => {
        const id = btn.dataset.id;
        const headers = {};
        if (PASSWORD_REQUIRED) headers["X-Password"] = getPassword();
        await fetch("/api/files/" + id, { method: "DELETE", headers });
        loadSavedFiles();
      });
    });
  } catch {}
}

REFRESH_BTN.addEventListener("click", loadSavedFiles);
loadSavedFiles();
</script>
</body>
</html>`;
}

function getPassword(req: Request, options: WebServerOptions): boolean {
  if (!options.password) return true;
  const url = new URL(req.url);
  if (url.searchParams.get("password") === options.password) return true;
  if (req.headers.get("x-password") === options.password) return true;
  return false;
}

async function processPdf(
  filePath: string,
  recordId: string,
  fileName: string,
  options: WebServerOptions,
): Promise<void> {
  if (!options.pdfExtractor || !options.embedder || !options.qdrantStore) return;

  const buffer = Buffer.from(await Bun.file(filePath).arrayBuffer());

  let text = await options.pdfExtractor.tryExtract(buffer);
  if (text === null && options.passwordStore) {
    const passwords = options.passwordStore.getAll();
    for (const pw of passwords) {
      text = await options.pdfExtractor.tryExtract(buffer, pw);
      if (text !== null) break;
    }
  }
  if (text === null) return;

  const splitter = new RecursiveCharacterTextSplitter({
    chunkSize: 1000,
    chunkOverlap: 200,
  });
  const chunks = await splitter.splitText(text);
  const vectors = await options.embedder.embed(chunks);
  await options.qdrantStore.index(chunks, vectors, recordId, fileName);
}

export function startWebServer(options: WebServerOptions): void {
  Bun.serve({
    port: options.port,
    hostname: options.host,
    async fetch(req) {
      const url = new URL(req.url);
      const method = req.method;

      if (method === "GET" && url.pathname === "/") {
        return new Response(htmlPage(!!options.password), {
          headers: { "Content-Type": "text/html; charset=utf-8" },
        });
      }

      if (method === "GET" && url.pathname === "/api/files") {
        const files = options.fileStore.list();
        return new Response(JSON.stringify(files), {
          headers: { "Content-Type": "application/json" },
        });
      }

      if (method === "DELETE" && url.pathname.startsWith("/api/files/")) {
        if (!getPassword(req, options)) {
          return new Response("Unauthorized", { status: 401 });
        }
        const id = url.pathname.slice("/api/files/".length);
        const record = options.fileStore.get(id);
        if (!record) return new Response("Not found", { status: 404 });

        options.fileStore.delete(id);
        if (options.qdrantStore) {
          await options.qdrantStore.deleteByFileId(id).catch(() => {});
        }
        return new Response(JSON.stringify({ ok: true }), {
          headers: { "Content-Type": "application/json" },
        });
      }

      if (method === "POST" && url.pathname === "/upload") {
        if (!getPassword(req, options)) {
          return new Response("Unauthorized", { status: 401 });
        }

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
          const record = await options.fileStore.saveStream(0, decodedName, mimeType, stream);

          if (record.mimeType === "application/pdf") {
            await processPdf(record.path, record.id, record.originalName, options);
          }

          return new Response(JSON.stringify({ ok: true, file: record }), {
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

      return new Response("Not found", { status: 404 });
    },
  });

  console.log(`Web server listening on http://${options.host}:${options.port}`);
}
