/**
 * Shared ingestion entrypoint for both web and Telegram uploads (plan §4, §8).
 *
 * Pipeline: dedup (content hash) → extract/unlock/OCR → chunk → embed → store vectors.
 * Jobs run through a SERIAL in-process queue (INGEST_CONCURRENCY) to bound CPU/OCR load.
 */

import { createHash, randomUUID } from "node:crypto";
import { config } from "../config.ts";
import { createLogger } from "../util/logger.ts";
import { chunkDocument } from "./chunker.ts";
import { extract } from "./extractors.ts";
import { PdfLockedError } from "./pdfUnlock.ts";
import { embedPassagesBatched } from "../rag/embeddings.ts";
import { upsertVectors } from "../rag/vectorstore.ts";
import { notifyUser } from "../util/notifier.ts";
import {
  audit,
  ensureUser,
  findDocByHash,
  insertChunks,
  insertDocument,
  setDocStatus,
  type ChunkRow,
} from "../storage/db.ts";
import { listPasswords, markPasswordUsed } from "../storage/passwords.ts";

const log = createLogger("intake");

export interface IngestRequest {
  userId: number;
  filename: string;
  mime: string;
  data: Uint8Array;
  source: "web" | "telegram" | "note";
}

export interface IngestQueued {
  docId: string;
  filename: string;
  status: "queued" | "duplicate";
}

type ProgressFn = (docId: string, status: string, info?: string) => void;

interface Job {
  req: IngestRequest;
  docId: string;
  onProgress?: ProgressFn;
}

const queue: Job[] = [];
let active = 0;

function sha256(data: Uint8Array): string {
  return createHash("sha256").update(data).digest("hex");
}

/**
 * Notify the uploader once processing reaches a terminal state. Notes are skipped
 * because /addnote already acknowledges inline.
 */
function notifyTerminal(req: IngestRequest, status: "ready" | "failed", info: string): void {
  if (req.source === "note") return;
  const text =
    status === "ready"
      ? `\u2705 ${req.filename} procesado correctamente. ${info}`
      : `\u26a0\ufe0f No se pudo procesar ${req.filename}. ${info}`;
  notifyUser(req.userId, text);
}

/**
 * Register a file for ingestion. Returns immediately with a doc id (or "duplicate").
 * Processing happens in the background via the serial queue.
 */
export function ingestFile(req: IngestRequest, onProgress?: ProgressFn): IngestQueued {
  ensureUser(req.userId);

  const hash = sha256(req.data);
  const existing = findDocByHash(req.userId, hash);
  if (existing) {
    log.info(`Duplicate upload skipped (doc ${existing.doc_id})`);
    return { docId: existing.doc_id, filename: req.filename, status: "duplicate" };
  }

  const docId = randomUUID();
  insertDocument({
    docId,
    userId: req.userId,
    filename: req.filename,
    mime: req.mime,
    contentHash: hash,
    source: req.source,
  });
  audit(req.userId, "document_uploaded", docId);

  queue.push({ req, docId, onProgress });
  void pump();
  return { docId, filename: req.filename, status: "queued" };
}

async function pump(): Promise<void> {
  if (active >= config.limits.ingestConcurrency) return;
  const job = queue.shift();
  if (!job) return;

  active += 1;
  try {
    await processJob(job);
  } catch (err) {
    log.error(`Ingestion failed for doc ${job.docId}: ${(err as Error).message}`, (err as Error).stack);
    const message =
      err instanceof PdfLockedError
        ? err.message
        : "No se pudo procesar el archivo.";
    setDocStatus(job.docId, "failed", { error: message });
    job.onProgress?.(job.docId, "failed", message);
    notifyTerminal(job.req, "failed", message);
  } finally {
    active -= 1;
    // Continue with the next queued job.
    if (queue.length > 0) void pump();
  }
}

async function processJob(job: Job): Promise<void> {
  const { req, docId } = job;
  setDocStatus(docId, "processing");
  job.onProgress?.(docId, "processing");

  // Candidate passwords from the user's vault (MRU first).
  const passwords = listPasswords(req.userId);
  const candidates = passwords.map((p) => p.password);

  const result = await extract({
    data: req.data,
    mime: req.mime,
    filename: req.filename,
    candidatePasswords: candidates,
  });

  // Remember which saved password worked.
  if (result.usedPassword) {
    const match = passwords.find((p) => p.password === result.usedPassword);
    if (match) markPasswordUsed(req.userId, match.id);
  }

  const chunks = chunkDocument(result.pages);
  if (chunks.length === 0) {
    setDocStatus(docId, "failed", {
      pages: result.pageCount,
      error: "No se extrajo texto del documento.",
    });
    job.onProgress?.(docId, "failed", "No se extrajo texto.");
    notifyTerminal(req, "failed", "No se extrajo texto del documento.");
    return;
  }

  // Embed and store vectors.
  const embeddings = await embedPassagesBatched(chunks.map((c) => c.text));
  const chunkRows: ChunkRow[] = chunks.map((c) => ({
    chunk_id: randomUUID(),
    doc_id: docId,
    user_id: req.userId,
    page: c.page,
    text: c.text,
  }));

  insertChunks(chunkRows);
  upsertVectors(
    req.userId,
    chunkRows.map((row, i) => ({ chunkId: row.chunk_id, embedding: embeddings[i]! })),
  );

  setDocStatus(docId, "ready", { pages: result.pageCount });
  audit(req.userId, "document_indexed", docId);
  job.onProgress?.(docId, "ready", `${chunkRows.length} fragmentos indexados`);
  notifyTerminal(req, "ready", `${result.pageCount} pág., ${chunkRows.length} fragmentos indexados.`);
  log.info(`Indexed doc ${docId}: ${chunkRows.length} chunks, ${result.pageCount} pages`);
}

/** Store a typed note as a document (used by /addnote). */
export function ingestNote(userId: number, text: string): IngestQueued {
  const data = new TextEncoder().encode(text);
  const filename = `nota-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-")}.txt`;
  return ingestFile({ userId, filename, mime: "text/plain", data, source: "note" });
}
