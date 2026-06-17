import { Database } from "bun:sqlite";
import { existsSync, mkdirSync } from "fs";
import { join, extname } from "path";

import type { FileRecord } from "./types";

export class FileStore {
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
        created_at TEXT NOT NULL
      )
    `);
  }

  save(userId: number, originalName: string, mimeType: string, buffer: Buffer): FileRecord {
    const id = crypto.randomUUID();
    const ext = extname(originalName);
    const fileName = `${id}${ext}`;
    const filePath = join(this.filesDir, fileName);

    Bun.write(filePath, buffer);

    const record: FileRecord = {
      id,
      userId,
      originalName,
      mimeType,
      size: buffer.length,
      path: filePath,
      createdAt: new Date().toISOString(),
    };

    this.db.run(
      "INSERT INTO files (id, user_id, original_name, mime_type, size, path, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
      [record.id, record.userId, record.originalName, record.mimeType, record.size, record.path, record.createdAt],
    );

    return record;
  }

  list(): FileRecord[] {
    return this.db
      .query("SELECT * FROM files ORDER BY created_at DESC")
      .all() as FileRecord[];
  }

  get(id: string): FileRecord | null {
    return this.db
      .query("SELECT * FROM files WHERE id = ?")
      .get(id) as FileRecord | null;
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
