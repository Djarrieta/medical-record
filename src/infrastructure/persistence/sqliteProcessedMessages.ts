import { Database } from "bun:sqlite";

import type { ProcessedMessages } from "../../domain/ports";

export class SqliteProcessedMessages implements ProcessedMessages {
  private db: Database;

  // Shares the unified app.db connection; only owns the `processed_messages`
  // table that records which mail message IDs have already been ingested.
  constructor(db: Database) {
    this.db = db;
    this.db.run(`
      CREATE TABLE IF NOT EXISTS processed_messages (
        message_id TEXT PRIMARY KEY,
        processed_at TEXT NOT NULL
      )
    `);
  }

  has(id: string): boolean {
    const row = this.db
      .query("SELECT 1 FROM processed_messages WHERE message_id = ?")
      .get(id);
    return row !== null;
  }

  add(id: string): void {
    this.db.run(
      "INSERT OR IGNORE INTO processed_messages (message_id, processed_at) VALUES (?, ?)",
      [id, new Date().toISOString()],
    );
  }
}
