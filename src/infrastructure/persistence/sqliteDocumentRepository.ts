import { Database } from "bun:sqlite";
import { existsSync, mkdirSync } from "fs";
import { join, extname } from "path";

import type { FileRecord } from "../../domain/types";
import type { DocumentRepository } from "../../domain/ports";

export class SqliteDocumentRepository implements DocumentRepository {
  private db: Database;
  private filesDir: string;

  // Shares the unified app.db connection; only owns the `files` table and the
  // on-disk files directory (data/files/).
  constructor(db: Database, dataDir: string) {
    this.db = db;

    this.filesDir = join(dataDir, "files");
    if (!existsSync(this.filesDir)) mkdirSync(this.filesDir, { recursive: true });

    this.db.run(`
      CREATE TABLE IF NOT EXISTS files (
        id TEXT PRIMARY KEY,
        user_id INTEGER NOT NULL,
        original_name TEXT NOT NULL,
        mime_type TEXT NOT NULL,
        size INTEGER NOT NULL,
        path TEXT NOT NULL,
        created_at TEXT NOT NULL,
        indexed INTEGER NOT NULL DEFAULT 0,
        sha256 TEXT NOT NULL DEFAULT ''
      )
    `);

    this.db.run("CREATE INDEX IF NOT EXISTS idx_files_sha256 ON files (sha256)");
    this.db.run("CREATE INDEX IF NOT EXISTS idx_files_user ON files (user_id)");
  }

  // SHA-256 hex digest of a file's content. Same bytes ⇒ same hash.
  private hash(buffer: Buffer): string {
    return new Bun.CryptoHasher("sha256").update(buffer).digest("hex");
  }

  // Per-user storage directory: data/files/<userId>/.
  private userDir(userId: number): string {
    const dir = join(this.filesDir, String(userId));
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    return dir;
  }

  async save(userId: number, originalName: string, mimeType: string, buffer: Buffer): Promise<FileRecord> {
    const id = crypto.randomUUID();
    const ext = extname(originalName);
    const fileName = `${id}${ext}`;
    const filePath = join(this.userDir(userId), fileName);

    const written = await Bun.write(filePath, buffer);

    const record: FileRecord = {
      id,
      userId,
      originalName,
      mimeType,
      size: written,
      path: filePath,
      createdAt: new Date().toISOString(),
      indexed: false,
      hash: this.hash(buffer),
    };

    this.db.run(
      "INSERT INTO files (id, user_id, original_name, mime_type, size, path, created_at, indexed, sha256) VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?)",
      [record.id, record.userId, record.originalName, record.mimeType, record.size, record.path, record.createdAt, record.hash],
    );

    return record;
  }

  async saveStream(
    userId: number,
    originalName: string,
    mimeType: string,
    stream: ReadableStream,
  ): Promise<FileRecord> {
    const id = crypto.randomUUID();
    const ext = extname(originalName);
    const fileName = `${id}${ext}`;
    const filePath = join(this.userDir(userId), fileName);

    const buffer = Buffer.from(await new Response(stream).arrayBuffer());
    const written = await Bun.write(filePath, buffer);

    const record: FileRecord = {
      id,
      userId,
      originalName,
      mimeType,
      size: written,
      path: filePath,
      createdAt: new Date().toISOString(),
      indexed: false,
      hash: this.hash(buffer),
    };

    this.db.run(
      "INSERT INTO files (id, user_id, original_name, mime_type, size, path, created_at, indexed, sha256) VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?)",
      [record.id, record.userId, record.originalName, record.mimeType, record.size, record.path, record.createdAt, record.hash],
    );

    return record;
  }

  list(userId: number): FileRecord[] {
    const rows = this.db
      .query("SELECT * FROM files WHERE user_id = ? ORDER BY created_at DESC")
      .all(userId) as Record<string, unknown>[];
    return rows.map((row) => this.mapRow(row));
  }

  get(id: string, userId: number): FileRecord | null {
    const row = this.db
      .query("SELECT * FROM files WHERE id = ? AND user_id = ?")
      .get(id, userId) as Record<string, unknown> | null;
    return row ? this.mapRow(row) : null;
  }

  findByContent(buffer: Buffer, userId: number): FileRecord | null {
    const hash = this.hash(buffer);
    const row = this.db
      .query("SELECT * FROM files WHERE sha256 = ? AND user_id = ?")
      .get(hash, userId) as Record<string, unknown> | null;
    return row ? this.mapRow(row) : null;
  }

  private mapRow(row: Record<string, unknown>): FileRecord {
    return {
      id: row.id as string,
      userId: row.user_id as number,
      originalName: row.original_name as string,
      mimeType: row.mime_type as string,
      size: row.size as number,
      path: row.path as string,
      createdAt: row.created_at as string,
      indexed: Boolean(row.indexed),
      hash: (row.sha256 as string) ?? "",
    };
  }

  setIndexed(id: string, indexed: boolean): void {
    this.db.run("UPDATE files SET indexed = ? WHERE id = ?", [indexed ? 1 : 0, id]);
  }

  // Renames a file's logical name. Keeps the current extension if `name` does
  // not already end with it, so downloads keep opening with the right app.
  setOriginalName(id: string, name: string): void {
    const row = this.db
      .query("SELECT original_name FROM files WHERE id = ?")
      .get(id) as { original_name: string } | null;
    if (!row) return;

    const ext = extname(row.original_name);
    const finalName =
      ext && !name.toLowerCase().endsWith(ext.toLowerCase()) ? `${name}${ext}` : name;

    this.db.run("UPDATE files SET original_name = ? WHERE id = ?", [finalName, id]);
  }

  delete(id: string, userId: number): boolean {
    const record = this.get(id, userId);
    if (!record) return false;

    try {
      Bun.spawnSync(["rm", "-f", record.path]);
    } catch {
      // file may already be gone
    }

    this.db.run("DELETE FROM files WHERE id = ? AND user_id = ?", [id, userId]);
    return true;
  }
}
