import { Database } from "bun:sqlite";

import type { Note } from "../../domain/types";
import type { NoteRepository } from "../../domain/ports";

// Parses a JSON tags column into a string[], tolerating malformed/legacy data.
function parseTags(raw: unknown): string[] {
  if (typeof raw !== "string" || !raw) return [];
  try {
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr.map((x) => String(x)) : [];
  } catch {
    return [];
  }
}

export class SqliteNoteRepository implements NoteRepository {
  private db: Database;

  // Shares the unified app.db connection; only owns the `notes` table.
  constructor(db: Database) {
    this.db = db;
    this.db.run(`
      CREATE TABLE IF NOT EXISTS notes (
        id TEXT PRIMARY KEY,
        user_id INTEGER NOT NULL,
        title TEXT NOT NULL DEFAULT '',
        text TEXT NOT NULL,
        created_at TEXT NOT NULL,
        tags TEXT NOT NULL DEFAULT '[]'
      )
    `);
    this.db.run("CREATE INDEX IF NOT EXISTS idx_notes_user ON notes (user_id)");
  }

  save(userId: number, text: string, title: string): Note {
    const note: Note = {
      id: crypto.randomUUID(),
      userId,
      title,
      text,
      createdAt: new Date().toISOString(),
      tags: [],
    };
    this.db.run(
      "INSERT INTO notes (id, user_id, title, text, created_at, tags) VALUES (?, ?, ?, ?, ?, '[]')",
      [note.id, note.userId, note.title, note.text, note.createdAt],
    );
    return note;
  }

  list(userId: number): Note[] {
    const rows = this.db
      .query("SELECT * FROM notes WHERE user_id = ? ORDER BY created_at DESC")
      .all(userId) as Record<string, unknown>[];
    return rows.map((row) => this.mapRow(row));
  }

  get(id: string, userId: number): Note | null {
    const row = this.db
      .query("SELECT * FROM notes WHERE id = ? AND user_id = ?")
      .get(id, userId) as Record<string, unknown> | null;
    return row ? this.mapRow(row) : null;
  }

  delete(id: string, userId: number): boolean {
    const existing = this.get(id, userId);
    if (!existing) return false;
    this.db.run("DELETE FROM notes WHERE id = ? AND user_id = ?", [id, userId]);
    return true;
  }

  setTags(id: string, tags: string[]): void {
    this.db.run("UPDATE notes SET tags = ? WHERE id = ?", [JSON.stringify(tags), id]);
  }

  listTags(userId: number): string[] {
    const rows = this.db
      .query("SELECT DISTINCT value AS tag FROM notes, json_each(notes.tags) WHERE user_id = ? ORDER BY value")
      .all(userId) as { tag: string }[];
    return rows.map((r) => r.tag);
  }

  private mapRow(row: Record<string, unknown>): Note {
    return {
      id: row.id as string,
      userId: row.user_id as number,
      title: ((row.title as string) || "") as string,
      text: row.text as string,
      createdAt: row.created_at as string,
      tags: parseTags(row.tags),
    };
  }
}
