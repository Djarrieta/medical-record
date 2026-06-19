import type { DocumentRepository, SessionStore } from "../../domain/ports";
import type { IndexPdf } from "../../application/indexPdf";
import type { DeleteDocument } from "../../application/deleteDocument";

interface WebServerOptions {
  port: number;
  host: string;
  repo: DocumentRepository;
  indexPdf: IndexPdf;
  deleteDocument: DeleteDocument;
  sessions: SessionStore;
}

function htmlPage(): string {
  return `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Expediente médico</title>
<style>
  :root {
    --bg: #f1f5f3;
    --surface: #ffffff;
    --ink: #14302a;
    --muted: #5e726b;
    --faint: #8a9b94;
    --line: #e2eae6;
    --primary: #0e7c66;
    --primary-d: #0a5d4c;
    --primary-tint: #e5f3ef;
    --danger: #b4453a;
    --danger-tint: #fbece9;
    --warn: #9a6a16;
    --warn-tint: #f6eddc;
    --radius: 14px;
    --shadow: 0 1px 2px rgba(20,48,42,.04), 0 8px 24px rgba(20,48,42,.06);
  }
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
    background: var(--bg); color: var(--ink); min-height: 100vh;
    line-height: 1.45; -webkit-font-smoothing: antialiased;
    padding: 2.5rem 1rem 4rem;
  }
  .wrap { max-width: 720px; margin: 0 auto; }

  header.app { display: flex; align-items: center; gap: .85rem; margin-bottom: 1.75rem; }
  .mark {
    width: 44px; height: 44px; border-radius: 12px; flex-shrink: 0;
    background: var(--primary); color: #fff; display: grid; place-items: center;
    box-shadow: var(--shadow);
  }
  .mark svg { width: 24px; height: 24px; }
  .app h1 { font-size: 1.35rem; font-weight: 650; letter-spacing: -.01em; }
  .app p { font-size: .9rem; color: var(--muted); }

  .card {
    background: var(--surface); border: 1px solid var(--line);
    border-radius: var(--radius); box-shadow: var(--shadow);
    padding: 1.25rem; margin-bottom: 1.25rem;
  }

  /* Upload */
  #dropZone {
    border: 2px dashed #cdded7; border-radius: 12px; padding: 2rem 1.25rem;
    text-align: center; cursor: pointer; transition: border-color .15s, background .15s;
    background: #fafdfb;
  }
  #dropZone:hover { border-color: var(--primary); }
  #dropZone.dragover { border-color: var(--primary); background: var(--primary-tint); }
  #dropZone .icon {
    width: 40px; height: 40px; margin: 0 auto .6rem; color: var(--primary);
  }
  #dropZone .icon svg { width: 100%; height: 100%; }
  #dropZone strong { display: block; font-weight: 600; font-size: 1rem; }
  #dropZone span { font-size: .85rem; color: var(--muted); }

  .password-row { margin-top: 1rem; }
  .password-row label { display: block; font-size: .8rem; color: var(--muted); margin-bottom: .3rem; font-weight: 500; }
  #passwordInput {
    width: 100%; padding: .6rem .75rem; border: 1px solid var(--line);
    border-radius: 9px; font-size: .9rem; color: var(--ink); background: #fafdfb;
  }
  #passwordInput:focus { outline: 2px solid var(--primary-tint); border-color: var(--primary); }

  .btn {
    font: inherit; cursor: pointer; border-radius: 9px; border: 1px solid transparent;
    padding: .6rem 1rem; font-size: .9rem; font-weight: 600; transition: background .15s, border-color .15s, color .15s;
  }
  .btn-primary { background: var(--primary); color: #fff; }
  .btn-primary:hover { background: var(--primary-d); }
  .btn-primary:disabled { background: #a9c7be; cursor: not-allowed; }
  .btn-upload { display: none; width: 100%; margin-top: 1rem; }

  /* Queue + lists */
  .list { list-style: none; }
  .row {
    display: flex; align-items: center; gap: .75rem;
    padding: .7rem .25rem; border-top: 1px solid var(--line);
  }
  .row:first-child { border-top: none; }
  .row .fi {
    width: 34px; height: 34px; border-radius: 8px; flex-shrink: 0;
    display: grid; place-items: center; background: var(--primary-tint); color: var(--primary);
  }
  .row .fi svg { width: 18px; height: 18px; }
  .row .body { flex: 1; min-width: 0; }
  .row .name { font-weight: 550; font-size: .92rem; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .row .meta { font-size: .78rem; color: var(--faint); display: flex; gap: .5rem; flex-wrap: wrap; margin-top: .1rem; }
  .row .meta span::after { content: "·"; margin-left: .5rem; color: #cfdbd6; }
  .row .meta span:last-child::after { content: ""; margin: 0; }

  .badge {
    font-size: .68rem; font-weight: 600; padding: .15rem .45rem; border-radius: 999px;
    letter-spacing: .02em; white-space: nowrap;
  }
  .badge-idx { background: var(--primary-tint); color: var(--primary-d); }
  .badge-warn { background: var(--warn-tint); color: var(--warn); }

  .row .actions { display: flex; gap: .3rem; flex-shrink: 0; }
  .icon-btn {
    width: 32px; height: 32px; border-radius: 8px; border: 1px solid var(--line);
    background: #fff; cursor: pointer; display: grid; place-items: center; color: var(--muted);
    transition: background .15s, color .15s, border-color .15s;
  }
  .icon-btn svg { width: 16px; height: 16px; }
  .icon-btn:hover { background: #f4f7f5; color: var(--ink); }
  .icon-btn.danger:hover { background: var(--danger-tint); color: var(--danger); border-color: #ecc6c0; }

  .status { font-size: .8rem; font-weight: 600; white-space: nowrap; }
  .status-queued { color: var(--faint); }
  .status-uploading, .status-processing { color: var(--warn); }
  .status-warn { color: var(--warn); }
  .status-done { color: var(--primary); }
  .status-error { color: var(--danger); }

  /* Files admin */
  .files-head { display: flex; align-items: center; gap: .6rem; margin-bottom: .9rem; }
  .files-head h2 { font-size: 1.05rem; font-weight: 600; }
  .count-chip {
    font-size: .72rem; font-weight: 600; color: var(--muted);
    background: #eef3f1; padding: .12rem .5rem; border-radius: 999px;
  }
  .files-head .spacer { flex: 1; }
  .search-wrap { position: relative; margin-bottom: .5rem; }
  .search-wrap svg { position: absolute; left: .65rem; top: 50%; transform: translateY(-50%); width: 16px; height: 16px; color: var(--faint); }
  #searchInput {
    width: 100%; padding: .55rem .75rem .55rem 2.1rem; border: 1px solid var(--line);
    border-radius: 9px; font-size: .88rem; background: #fafdfb; color: var(--ink);
  }
  #searchInput:focus { outline: 2px solid var(--primary-tint); border-color: var(--primary); }

  .empty { text-align: center; padding: 1.75rem 1rem; color: var(--faint); font-size: .9rem; }

  .summary { margin-top: 1rem; padding: .8rem 1rem; border-radius: 10px; font-size: .88rem; font-weight: 500; display: none; }
  .summary.ok { background: var(--primary-tint); color: var(--primary-d); }
  .summary.has-warn { background: var(--warn-tint); color: var(--warn); }
  .summary.has-errors { background: var(--danger-tint); color: var(--danger); }

  #toast {
    position: fixed; left: 50%; bottom: 1.5rem; transform: translate(-50%, 1.5rem);
    background: var(--ink); color: #fff; padding: .65rem 1rem; border-radius: 10px;
    font-size: .85rem; font-weight: 500; box-shadow: var(--shadow);
    opacity: 0; pointer-events: none; transition: opacity .2s, transform .2s; z-index: 10;
  }
  #toast.show { opacity: 1; transform: translate(-50%, 0); }

  @media (max-width: 520px) {
    .row .meta span:nth-child(n+3) { display: none; }
  }
</style>
</head>
<body>
<div class="wrap">
  <header class="app">
    <div class="mark" aria-hidden="true">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12h4l2 5 4-12 2 7h6"/></svg>
    </div>
    <div>
      <h1>Expediente médico</h1>
      <p>Sube y administra tus documentos clínicos.</p>
    </div>
  </header>

  <section class="card">
    <div id="dropZone">
      <div class="icon" aria-hidden="true">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M12 16V4m0 0L7 9m5-5 5 5"/><path d="M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2"/></svg>
      </div>
      <strong>Arrastra archivos aquí</strong>
      <span>o haz clic para seleccionar · PDF, imágenes y más</span>
    </div>
    <input id="fileInput" type="file" multiple style="display:none">

    <div class="password-row"><label for="pdfPasswordInput">Contraseña del PDF (si aplica)</label><input id="pdfPasswordInput" type="password" placeholder="••••••••"></div>

    <button id="uploadBtn" class="btn btn-primary btn-upload">Subir archivos</button>
    <ul id="fileList" class="list"></ul>
    <div id="summary" class="summary"></div>
  </section>

  <section class="card">
    <div class="files-head">
      <h2>Archivos guardados</h2>
      <span id="countChip" class="count-chip">0</span>
      <span class="spacer"></span>
      <button id="refreshBtn" class="icon-btn" title="Actualizar" aria-label="Actualizar">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 1 1-2.64-6.36M21 3v6h-6"/></svg>
      </button>
    </div>
    <div class="search-wrap">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/></svg>
      <input id="searchInput" type="search" placeholder="Buscar por nombre…" autocomplete="off">
    </div>
    <ul id="savedFiles" class="list"></ul>
  </section>
</div>

<div id="toast" role="status" aria-live="polite"></div>

<script>
const DROP_ZONE = document.getElementById("dropZone");
const FILE_INPUT = document.getElementById("fileInput");
const UPLOAD_BTN = document.getElementById("uploadBtn");
const FILE_LIST = document.getElementById("fileList");
const SUMMARY = document.getElementById("summary");
const SAVED_FILES = document.getElementById("savedFiles");
const REFRESH_BTN = document.getElementById("refreshBtn");
const SEARCH_INPUT = document.getElementById("searchInput");
const COUNT_CHIP = document.getElementById("countChip");
const PDF_PASSWORD_INPUT = document.getElementById("pdfPasswordInput");
const TOAST = document.getElementById("toast");

// Auth comes from the URL: /u/<userId>?token=<sessionToken>.
const PATH_MATCH = window.location.pathname.match(/\\/u\\/(\\d+)/);
const USER_ID = PATH_MATCH ? PATH_MATCH[1] : "";
const TOKEN = new URLSearchParams(window.location.search).get("token") || "";

const ICON_DOC = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/></svg>';
const ICON_IMG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="9" cy="9" r="1.6"/><path d="m21 15-5-5L5 21"/></svg>';
const ICON_VIEW = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/></svg>';
const ICON_DEL = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m2 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/></svg>';

let queue = [];
let uploading = false;
let savedData = [];
let toastTimer = null;
let sessionExpired = false;

function getPdfPassword() { return PDF_PASSWORD_INPUT ? PDF_PASSWORD_INPUT.value : ""; }
function esc(s) { const d = document.createElement("div"); d.textContent = s == null ? "" : s; return d.innerHTML; }

// Append the auth params (userId + token) to any API URL.
function authQuery(extra) {
  const p = new URLSearchParams();
  p.set("userId", USER_ID);
  p.set("token", TOKEN);
  if (extra) for (const k in extra) p.set(k, extra[k]);
  return p.toString();
}

function handleExpired() {
  if (sessionExpired) return;
  sessionExpired = true;
  showToast("Sesión expirada. Vuelve a pedir el enlace en Telegram.");
}

function showToast(msg) {
  TOAST.textContent = msg;
  TOAST.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => TOAST.classList.remove("show"), 2600);
}

function formatSize(bytes) {
  if (bytes < 1024) return bytes + " B";
  if (bytes < 1048576) return (bytes / 1024).toFixed(1) + " KB";
  return (bytes / 1048576).toFixed(1) + " MB";
}

function formatDate(iso) {
  const d = new Date(iso);
  if (isNaN(d)) return "";
  return d.toLocaleDateString("es-CO", { day: "2-digit", month: "short", year: "numeric" });
}

function typeLabel(mime) {
  if (!mime) return "Archivo";
  if (mime === "application/pdf") return "PDF";
  if (mime.startsWith("image/")) return "Imagen";
  if (mime.startsWith("text/")) return "Texto";
  return mime.split("/").pop().toUpperCase();
}

function fileIcon(mime) { return mime && mime.startsWith("image/") ? ICON_IMG : ICON_DOC; }

function rawUrl(id, download) {
  return "/api/files/" + encodeURIComponent(id) + "/raw?" + authQuery(download ? { download: "1" } : null);
}

/* ---------- Upload queue ---------- */
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

function statusText(s) {
  const map = { queued: "En cola", uploading: "Subiendo…", processing: "Procesando…", done: "Listo", warn: "Atención", error: "Error" };
  return map[s] || s;
}

function renderQueue() {
  FILE_LIST.innerHTML = queue.map((f) =>
    '<li class="row"><div class="fi">' + fileIcon(f.file.type) + '</div>' +
    '<div class="body"><div class="name">' + esc(f.name) + '</div>' +
    '<div class="meta"><span>' + formatSize(f.size) + '</span>' +
    (f.detail ? '<span>' + esc(f.detail) + '</span>' : '') + '</div></div>' +
    '<div class="status status-' + f.status + '">' + statusText(f.status) + '</div></li>'
  ).join("");
}

UPLOAD_BTN.addEventListener("click", async () => {
  if (uploading) return;
  uploading = true;
  UPLOAD_BTN.disabled = true;
  SUMMARY.style.display = "none";
  let ok = 0, err = 0, warn = 0;

  for (const item of queue) {
    if (item.status === "done" || item.status === "error") continue;
    item.status = "uploading";
    item.detail = "";
    renderQueue();
    try {
      const headers = { "X-File-Name": encodeURIComponent(item.name), "Content-Type": item.file.type || "application/octet-stream" };
      const pdfPassword = getPdfPassword();
      if (pdfPassword) headers["X-Pdf-Password"] = pdfPassword;
      const res = await fetch("/upload?" + authQuery(), { method: "POST", headers, body: item.file });
      if (res.status === 401) { handleExpired(); item.status = "error"; item.detail = "Sesión expirada"; err++; renderQueue(); break; }
      let data = {};
      try { data = await res.json(); } catch {}
      if (!res.ok || !data.ok) {
        item.status = "error";
        item.detail = data.error ? String(data.error) : ("HTTP " + res.status);
        err++;
      } else if (data.duplicate) {
        item.status = "warn";
        item.detail = "Duplicado · ya estaba guardado";
        warn++;
      } else if (data.reason === "locked") {
        item.status = "warn";
        item.detail = "Guardado · PDF protegido, contraseña incorrecta";
        warn++;
      } else if (data.reason === "empty") {
        item.status = "warn";
        item.detail = "Guardado · sin texto indexable (PDF escaneado)";
        warn++;
      } else if (data.indexed) {
        item.status = "done";
        item.detail = "Guardado e indexado";
        ok++;
      } else {
        item.status = "done";
        item.detail = "Guardado";
        ok++;
      }
    } catch (e) {
      item.status = "error";
      item.detail = String(e && e.message ? e.message : e);
      err++;
    }
    renderQueue();
  }

  SUMMARY.style.display = "block";
  const parts = [];
  if (ok) parts.push(ok + " correcto" + (ok !== 1 ? "s" : ""));
  if (warn) parts.push(warn + " con aviso" + (warn !== 1 ? "s" : ""));
  if (err) parts.push(err + " con error" + (err !== 1 ? "es" : ""));
  SUMMARY.className = "summary " + (err ? "has-errors" : warn ? "has-warn" : "ok");
  SUMMARY.textContent = parts.join(", ") + ".";

  uploading = false;
  UPLOAD_BTN.disabled = false;
  UPLOAD_BTN.style.display = "none";
  queue = queue.filter(item => item.status === "warn" || item.status === "error");
  if (!queue.length) FILE_LIST.innerHTML = "";
  else renderQueue();
  loadSavedFiles();
});

/* ---------- Files admin ---------- */
function renderSaved() {
  const q = SEARCH_INPUT.value.trim().toLowerCase();
  const items = q ? savedData.filter(f => (f.originalName || "").toLowerCase().includes(q)) : savedData;
  COUNT_CHIP.textContent = String(savedData.length);

  if (!savedData.length) {
    SAVED_FILES.innerHTML = '<li class="empty">Aún no hay archivos. Sube tu primer documento arriba.</li>';
    return;
  }
  if (!items.length) {
    SAVED_FILES.innerHTML = '<li class="empty">Ningún archivo coincide con la búsqueda.</li>';
    return;
  }

  SAVED_FILES.innerHTML = items.map(f => {
    const isPdf = f.mimeType === "application/pdf";
    const indexed = isPdf
      ? (f.indexed
          ? '<span class="badge badge-idx">Indexado</span>'
          : '<span class="badge badge-warn" title="PDF guardado pero sin indexar (protegido o sin texto)">Sin indexar</span>')
      : "";
    return '<li class="row"><div class="fi">' + fileIcon(f.mimeType) + '</div>' +
      '<div class="body"><div class="name">' + esc(f.originalName) + '</div>' +
      '<div class="meta"><span>' + typeLabel(f.mimeType) + '</span>' +
      '<span>' + formatSize(f.size) + '</span>' +
      '<span>' + formatDate(f.createdAt) + '</span></div></div>' +
      indexed +
      '<div class="actions">' +
      '<button class="icon-btn" data-view="' + f.id + '" title="Ver" aria-label="Ver">' + ICON_VIEW + '</button>' +
      '<button class="icon-btn danger" data-del="' + f.id + '" title="Eliminar" aria-label="Eliminar">' + ICON_DEL + '</button>' +
      '</div></li>';
  }).join("");

  SAVED_FILES.querySelectorAll("[data-view]").forEach(btn => {
    btn.addEventListener("click", () => window.open(rawUrl(btn.dataset.view, false), "_blank"));
  });
  SAVED_FILES.querySelectorAll("[data-del]").forEach(btn => {
    btn.addEventListener("click", () => deleteFile(btn.dataset.del));
  });
}

async function deleteFile(id) {
  const file = savedData.find(f => f.id === id);
  const name = file ? file.originalName : "este archivo";
  if (!confirm("¿Eliminar \\"" + name + "\\"? Esta acción no se puede deshacer.")) return;
  try {
    const res = await fetch("/api/files/" + encodeURIComponent(id) + "?" + authQuery(), { method: "DELETE" });
    if (res.status === 401) { handleExpired(); return; }
    if (res.ok) { showToast("Archivo eliminado"); loadSavedFiles(); }
    else showToast("No se pudo eliminar");
  } catch { showToast("No se pudo eliminar"); }
}

async function loadSavedFiles() {
  try {
    const res = await fetch("/api/files?" + authQuery());
    if (res.status === 401) { handleExpired(); return; }
    if (!res.ok) return;
    savedData = await res.json();
    renderSaved();
  } catch {}
}

SEARCH_INPUT.addEventListener("input", renderSaved);
REFRESH_BTN.addEventListener("click", loadSavedFiles);
loadSavedFiles();
</script>
</body>
</html>`;
}

export function startWebServer(options: WebServerOptions): void {
  Bun.serve({
    port: options.port,
    hostname: options.host,
    async fetch(req) {
      const url = new URL(req.url);
      const method = req.method;

      // The only entry point is /u/<userId> (HTML). Serve it as long as the path
      // matches; the front-end reads the token from the query and the API calls
      // are what actually enforce auth.
      if (method === "GET" && /^\/u\/\d+\/?$/.test(url.pathname)) {
        return new Response(htmlPage(), {
          headers: { "Content-Type": "text/html; charset=utf-8" },
        });
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
            const pdfPassword = req.headers.get("x-pdf-password") || undefined;
            const result = await options.indexPdf.run({
              buffer,
              fileId: record.id,
              fileName: record.originalName,
              userId,
              password: pdfPassword,
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

      return new Response("Not found", { status: 404 });
    },
  });

  console.log(`Web server listening on http://${options.host}:${options.port}`);
}
