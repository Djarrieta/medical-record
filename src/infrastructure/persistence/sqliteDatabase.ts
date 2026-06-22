import { Database } from "bun:sqlite";
import { existsSync, mkdirSync } from "fs";
import { join } from "path";

// Single SQLite database for all relational data (files, passwords, notes).
// Qdrant stays dedicated to vectors. Every adapter owns its own table(s) via
// CREATE TABLE IF NOT EXISTS.
export function openAppDatabase(dataDir: string): Database {
  if (!existsSync(dataDir)) mkdirSync(dataDir, { recursive: true });
  const db = new Database(join(dataDir, "app.db"));
  db.run("PRAGMA journal_mode = WAL");
  return db;
}
