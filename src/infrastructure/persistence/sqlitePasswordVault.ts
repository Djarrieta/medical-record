import { Database } from "bun:sqlite";
import { existsSync, mkdirSync } from "fs";
import { join } from "path";

export class PasswordStore {
  private db: Database;

  constructor(dataDir: string) {
    if (!existsSync(dataDir)) mkdirSync(dataDir, { recursive: true });
    this.db = new Database(join(dataDir, "passwords.db"));
    this.db.run("PRAGMA journal_mode = WAL");
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
}
