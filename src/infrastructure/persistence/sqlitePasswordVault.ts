import { Database } from "bun:sqlite";

import type { PasswordVault } from "../../domain/ports";

export class SqlitePasswordVault implements PasswordVault {
  private db: Database;

  // Shares the unified app.db connection; only owns the `passwords` table.
  constructor(db: Database) {
    this.db = db;
    this.db.run(`
      CREATE TABLE IF NOT EXISTS passwords (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        password TEXT NOT NULL,
        created_at TEXT NOT NULL
      )
    `);
  }

  add(password: string): void {
    this.db.run(
      "INSERT INTO passwords (password, created_at) VALUES (?, ?)",
      [password, new Date().toISOString()],
    );
  }

  getAll(): string[] {
    return this.db
      .query("SELECT password FROM passwords ORDER BY id")
      .all()
      .map((r: any) => r.password);
  }

  count(): number {
    const row = this.db
      .query("SELECT COUNT(*) AS n FROM passwords")
      .get() as { n: number };
    return row.n;
  }

  clear(): void {
    this.db.run("DELETE FROM passwords");
  }
}
