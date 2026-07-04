import { Database } from "bun:sqlite";

import type { ProcessedEmailLog } from "../../domain/ports";

// Tracks which Gmail messages have already been ingested, so the poller never
// processes the same message twice. Shares the unified app.db connection; only
// owns the `processed_emails` table.
export class SqliteProcessedEmails implements ProcessedEmailLog {
  private db: Database;

  constructor(db: Database) {
    this.db = db;
    this.db.run(`
      CREATE TABLE IF NOT EXISTS processed_emails (
        provider_id TEXT PRIMARY KEY,
        processed_at TEXT NOT NULL
      )
    `);
  }

  has(providerId: string): boolean {
    const row = this.db
      .query("SELECT 1 FROM processed_emails WHERE provider_id = ?")
      .get(providerId);
    return row !== null;
  }

  mark(providerId: string): void {
    this.db.run(
      "INSERT OR IGNORE INTO processed_emails (provider_id, processed_at) VALUES (?, ?)",
      [providerId, new Date().toISOString()],
    );
  }
}
