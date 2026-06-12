/**
 * SQLite storage layer (bun:sqlite) + sqlite-vec for vectors.
 *
 * Design rules (see plan §4, §9):
 *  - One embedded DB holds users, documents, chunks, vectors, passwords, audit log.
 *  - Every domain row is keyed by `user_id`; ALL reads must filter on it (isolation).
 *  - `documents.content_hash` enforces per-user dedup via a UNIQUE constraint.
 */

import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import * as sqliteVec from "sqlite-vec";
import { config } from "../config.ts";
import { createLogger } from "../util/logger.ts";

const log = createLogger("db");

export type DocumentStatus = "pending" | "processing" | "ready" | "failed";

export interface DocumentRow {
  doc_id: string;
  user_id: number;
  filename: string;
  mime: string;
  content_hash: string;
  pages: number;
  status: DocumentStatus;
  error: string | null;
  source: string;
  created_at: number;
}

export interface ChunkRow {
  chunk_id: string;
  doc_id: string;
  user_id: number;
  page: number;
  text: string;
}

let db: Database | null = null;

export function getDb(): Database {
  if (db) return db;

  const dbPath = join(config.storage.dataDir, "medical-record.sqlite");
  mkdirSync(dirname(dbPath), { recursive: true });

  const database = new Database(dbPath, { create: true });
  database.exec("PRAGMA journal_mode = WAL;");
  database.exec("PRAGMA foreign_keys = ON;");

  // Load sqlite-vec extension (vec0 virtual tables).
  try {
    sqliteVec.load(database);
  } catch (err) {
    log.error("Failed to load sqlite-vec extension", err);
    throw err;
  }

  migrate(database);
  db = database;
  log.info(`SQLite ready at ${dbPath}`);
  return database;
}

function migrate(database: Database): void {
  database.exec(`
    CREATE TABLE IF NOT EXISTS users (
      user_id     INTEGER PRIMARY KEY,
      consent_at  INTEGER,
      created_at  INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS documents (
      doc_id        TEXT PRIMARY KEY,
      user_id       INTEGER NOT NULL,
      filename      TEXT NOT NULL,
      mime          TEXT NOT NULL,
      content_hash  TEXT NOT NULL,
      pages         INTEGER NOT NULL DEFAULT 0,
      status        TEXT NOT NULL DEFAULT 'pending',
      error         TEXT,
      source        TEXT NOT NULL DEFAULT 'web',
      created_at    INTEGER NOT NULL,
      UNIQUE (user_id, content_hash)
    );

    CREATE TABLE IF NOT EXISTS chunks (
      chunk_id  TEXT PRIMARY KEY,
      doc_id    TEXT NOT NULL,
      user_id   INTEGER NOT NULL,
      page      INTEGER NOT NULL DEFAULT 0,
      text      TEXT NOT NULL,
      FOREIGN KEY (doc_id) REFERENCES documents (doc_id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_chunks_user ON chunks (user_id);
    CREATE INDEX IF NOT EXISTS idx_chunks_doc ON chunks (doc_id);

    CREATE TABLE IF NOT EXISTS pdf_passwords (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id       INTEGER NOT NULL,
      password      TEXT NOT NULL,
      last_used_at  INTEGER,
      created_at    INTEGER NOT NULL,
      UNIQUE (user_id, password)
    );

    CREATE TABLE IF NOT EXISTS audit_log (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id     INTEGER NOT NULL,
      event       TEXT NOT NULL,
      doc_id      TEXT,
      created_at  INTEGER NOT NULL
    );
  `);

  // Vector table (sqlite-vec). 384-dim float, cosine distance. Keyed by chunk rowid mapping.
  database.exec(`
    CREATE VIRTUAL TABLE IF NOT EXISTS vectors USING vec0(
      chunk_id TEXT PRIMARY KEY,
      user_id INTEGER,
      embedding FLOAT[${config.embeddings.dimension}] distance_metric=cosine
    );
  `);
}

/* ----------------------------- users / consent ----------------------------- */

export function ensureUser(userId: number): void {
  getDb()
    .query(
      `INSERT INTO users (user_id, created_at) VALUES (?, ?)
       ON CONFLICT(user_id) DO NOTHING`,
    )
    .run(userId, Date.now());
}

export function hasConsent(userId: number): boolean {
  const row = getDb()
    .query<{ consent_at: number | null }, [number]>(
      `SELECT consent_at FROM users WHERE user_id = ?`,
    )
    .get(userId);
  return !!row && row.consent_at != null;
}

export function setConsent(userId: number): void {
  ensureUser(userId);
  getDb()
    .query(`UPDATE users SET consent_at = ? WHERE user_id = ?`)
    .run(Date.now(), userId);
  audit(userId, "consent_granted");
}

/* -------------------------------- documents -------------------------------- */

export function findDocByHash(userId: number, contentHash: string): DocumentRow | null {
  return (
    getDb()
      .query<DocumentRow, [number, string]>(
        `SELECT * FROM documents WHERE user_id = ? AND content_hash = ?`,
      )
      .get(userId, contentHash) ?? null
  );
}

export function insertDocument(doc: {
  docId: string;
  userId: number;
  filename: string;
  mime: string;
  contentHash: string;
  source: string;
}): void {
  getDb()
    .query(
      `INSERT INTO documents (doc_id, user_id, filename, mime, content_hash, status, source, created_at)
       VALUES (?, ?, ?, ?, ?, 'pending', ?, ?)`,
    )
    .run(doc.docId, doc.userId, doc.filename, doc.mime, doc.contentHash, doc.source, Date.now());
}

export function setDocStatus(
  docId: string,
  status: DocumentStatus,
  opts: { pages?: number; error?: string | null } = {},
): void {
  getDb()
    .query(
      `UPDATE documents SET status = ?, pages = COALESCE(?, pages), error = ? WHERE doc_id = ?`,
    )
    .run(status, opts.pages ?? null, opts.error ?? null, docId);
}

export function listDocuments(userId: number): DocumentRow[] {
  return getDb()
    .query<DocumentRow, [number]>(
      `SELECT * FROM documents WHERE user_id = ? ORDER BY created_at DESC`,
    )
    .all(userId);
}

export function getDocument(userId: number, docId: string): DocumentRow | null {
  return (
    getDb()
      .query<DocumentRow, [number, string]>(
        `SELECT * FROM documents WHERE user_id = ? AND doc_id = ?`,
      )
      .get(userId, docId) ?? null
  );
}

export function deleteDocument(userId: number, docId: string): boolean {
  const database = getDb();
  const doc = getDocument(userId, docId);
  if (!doc) return false;

  const tx = database.transaction(() => {
    database.query(`DELETE FROM vectors WHERE chunk_id IN (SELECT chunk_id FROM chunks WHERE doc_id = ?)`).run(docId);
    database.query(`DELETE FROM chunks WHERE doc_id = ? AND user_id = ?`).run(docId, userId);
    database.query(`DELETE FROM documents WHERE doc_id = ? AND user_id = ?`).run(docId, userId);
  });
  tx();
  audit(userId, "document_deleted", docId);
  return true;
}

export function resetUser(userId: number): void {
  const database = getDb();
  const tx = database.transaction(() => {
    database.query(`DELETE FROM vectors WHERE user_id = ?`).run(userId);
    database.query(`DELETE FROM chunks WHERE user_id = ?`).run(userId);
    database.query(`DELETE FROM documents WHERE user_id = ?`).run(userId);
    database.query(`DELETE FROM pdf_passwords WHERE user_id = ?`).run(userId);
  });
  tx();
  audit(userId, "user_reset");
}

/* ---------------------------------- chunks --------------------------------- */

export function insertChunks(rows: ChunkRow[]): void {
  if (rows.length === 0) return;
  const database = getDb();
  const stmt = database.query(
    `INSERT INTO chunks (chunk_id, doc_id, user_id, page, text) VALUES (?, ?, ?, ?, ?)`,
  );
  const tx = database.transaction((items: ChunkRow[]) => {
    for (const c of items) stmt.run(c.chunk_id, c.doc_id, c.user_id, c.page, c.text);
  });
  tx(rows);
}

export function getChunk(userId: number, chunkId: string): ChunkRow | null {
  return (
    getDb()
      .query<ChunkRow, [number, string]>(
        `SELECT * FROM chunks WHERE user_id = ? AND chunk_id = ?`,
      )
      .get(userId, chunkId) ?? null
  );
}

/* --------------------------------- audit ----------------------------------- */

export function audit(userId: number, event: string, docId?: string): void {
  getDb()
    .query(`INSERT INTO audit_log (user_id, event, doc_id, created_at) VALUES (?, ?, ?, ?)`)
    .run(userId, event, docId ?? null, Date.now());
}
