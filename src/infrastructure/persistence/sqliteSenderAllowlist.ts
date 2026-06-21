import { Database } from "bun:sqlite";

import type { SenderAllowlist } from "../../domain/ports";

// Normalize an entry/address: trim + lowercase. Domain entries keep their
// leading "@" (e.g. "@sura.com"); exact addresses are stored as-is otherwise.
function normalize(value: string): string {
  return value.trim().toLowerCase();
}

// Extract the bare address from a "Name <addr@host>" or plain "addr@host"
// string and lowercase it.
function extractAddress(from: string): string {
  const match = from.match(/<([^>]+)>/);
  return normalize(match ? match[1] : from);
}

export class SqliteSenderAllowlist implements SenderAllowlist {
  private db: Database;

  // Shares the unified app.db connection; only owns the `senders` table.
  constructor(db: Database) {
    this.db = db;
    this.db.run(`
      CREATE TABLE IF NOT EXISTS senders (
        entry TEXT PRIMARY KEY,
        created_at TEXT NOT NULL
      )
    `);
  }

  add(entry: string): void {
    const value = normalize(entry);
    if (!value) return;
    this.db.run(
      "INSERT OR IGNORE INTO senders (entry, created_at) VALUES (?, ?)",
      [value, new Date().toISOString()],
    );
  }

  remove(entry: string): void {
    this.db.run("DELETE FROM senders WHERE entry = ?", [normalize(entry)]);
  }

  list(): string[] {
    return this.db
      .query("SELECT entry FROM senders ORDER BY entry")
      .all()
      .map((r: any) => r.entry as string);
  }

  matches(fromAddress: string): boolean {
    const address = extractAddress(fromAddress);
    if (!address) return false;
    for (const entry of this.list()) {
      if (entry.startsWith("@")) {
        if (address.endsWith(entry)) return true;
      } else if (address === entry) {
        return true;
      }
    }
    return false;
  }
}
