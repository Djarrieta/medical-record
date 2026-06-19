import { Database } from "bun:sqlite";
import { existsSync, mkdirSync } from "fs";
import { join, extname } from "path";

import type { FileRecord } from "../../domain/types";
import type { DocumentRepository } from "../../domain/ports";

export class SqliteDocumentRepository implements DocumentRepository {
  private db: Database;
  private filesDir: string;

  constructor(dataDir: string) {
    const dbDir = join(dataDir);
    if (!existsSync(dbDir)) mkdirSync(dbDir, { recursive: true });

    this.filesDir = join(dataDir, "files");
    if (!existsSync(this.filesDir)) mkdirSync(this.filesDir, { recursive: true });

    this.db = new Database(join(dbDir, "metadata.db"));
    this.db.run("PRAGMA journal_mode = WAL");
    this.db.run(`
      CREATE TABLE IF NOT EXISTS files (
        id TEXT PRIMARY KEY,
        user_id INTEGER NOT NULL,
        original_name TEXT NOT NULL,
        mime_type TEXT NOT NULL,
        size INTEGER NOT NULL,
        path TEXT NOT NULL,
        created_at TEXT NOT NULL,
        indexed INTEGER NOT NULL DEFAULT 0
      )
    `);

    // Migration: add the `indexed` column to pre-existing databases.
    const columns = this.db
      .query("PRAGMA table_info(files)")
      .all() as { name: string }[];
    if (!columns.some((c) => c.name === "indexed")) {
      this.db.run("ALTER TABLE files ADD COLUMN indexed INTEGER NOT NULL DEFAULT 0");
    }
  }

  async save(userId: number, originalName: string, mimeType: string, buffer: Buffer): Promise<FileRecord> {
    const id = crypto.randomUUID();
    const ext = extname(originalName);
    const fileName = `${id}${ext}`;
    const filePath = join(this.filesDir, fileName);

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
    };

    this.db.run(
      "INSERT INTO files (id, user_id, original_name, mime_type, size, path, created_at, indexed) VALUES (?, ?, ?, ?, ?, ?, ?, 0)",
      [record.id, record.userId, record.originalName, record.mimeType, record.size, record.path, record.createdAt],
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
    const filePath = join(this.filesDir, fileName);

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
    };

    this.db.run(
      "INSERT INTO files (id, user_id, original_name, mime_type, size, path, created_at, indexed) VALUES (?, ?, ?, ?, ?, ?, ?, 0)",
      [record.id, record.userId, record.originalName, record.mimeType, record.size, record.path, record.createdAt],
    );

    return record;
  }

  list(): FileRecord[] {
    const rows = this.db
      .query("SELECT * FROM files ORDER BY created_at DESC")
      .all() as Record<string, unknown>[];
    return rows.map((row) => this.mapRow(row));
  }

  get(id: string): FileRecord | null {
    const row = this.db
      .query("SELECT * FROM files WHERE id = ?")
      .get(id) as Record<string, unknown> | null;
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
    };
  }

  setIndexed(id: string, indexed: boolean): void {
    this.db.run("UPDATE files SET indexed = ? WHERE id = ?", [indexed ? 1 : 0, id]);
  }

  delete(id: string): boolean {
    const record = this.get(id);
    if (!record) return false;

    try {
      Bun.spawnSync(["rm", "-f", record.path]);
    } catch {
      // file may already be gone
    }

    this.db.run("DELETE FROM files WHERE id = ?", [id]);
    return true;
  }
}
