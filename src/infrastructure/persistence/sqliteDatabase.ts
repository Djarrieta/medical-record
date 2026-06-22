import { Database } from "bun:sqlite";
import { existsSync, mkdirSync, renameSync } from "fs";
import { join } from "path";

// Single SQLite database for all relational data (files, passwords, and any
// future tables like notes). Qdrant stays dedicated to vectors.
// Centralizing in one `app.db` keeps backups and maintenance simple while
// every adapter still owns its own table(s) via CREATE TABLE IF NOT EXISTS.
export function openAppDatabase(dataDir: string): Database {
  if (!existsSync(dataDir)) mkdirSync(dataDir, { recursive: true });
  const db = new Database(join(dataDir, "app.db"));
  db.run("PRAGMA journal_mode = WAL");
  return db;
}

// One-time migration from the legacy per-feature database files
// (metadata.db, passwords.db) into the unified app.db. Idempotent: legacy
// files are renamed to *.migrated once copied, so re-running is a no-op.
// Must be called AFTER the adapters have created their tables in `db`.
export function migrateLegacyDatabases(db: Database, dataDir: string): void {
  importLegacy(db, dataDir, "metadata.db", "files", [
    "id",
    "user_id",
    "original_name",
    "mime_type",
    "size",
    "path",
    "created_at",
    "indexed",
    "sha256",
    "title",
  ]);
  importLegacy(db, dataDir, "passwords.db", "passwords", [
    "id",
    "password",
    "created_at",
  ]);
}

// Copy rows from a legacy single-table database into the matching table in the
// unified db, then mark the legacy file as migrated. Only columns present in
// BOTH schemas are copied, so older legacy schemas migrate safely.
function importLegacy(
  db: Database,
  dataDir: string,
  legacyFile: string,
  table: string,
  knownColumns: string[],
): void {
  const legacyPath = join(dataDir, legacyFile);
  if (!existsSync(legacyPath)) return;

  db.run("ATTACH ? AS legacy", [legacyPath]);
  try {
    const legacyTables = db
      .query("SELECT name FROM legacy.sqlite_master WHERE type = 'table'")
      .all() as { name: string }[];
    if (legacyTables.some((t) => t.name === table)) {
      const legacyCols = (
        db.query(`PRAGMA legacy.table_info(${table})`).all() as { name: string }[]
      ).map((c) => c.name);
      const shared = knownColumns.filter((c) => legacyCols.includes(c));
      if (shared.length > 0) {
        const list = shared.join(", ");
        // INSERT OR IGNORE skips rows whose PRIMARY KEY already exists, so a
        // partial previous migration won't duplicate.
        db.run(`INSERT OR IGNORE INTO ${table} (${list}) SELECT ${list} FROM legacy.${table}`);
      }
    }
  } finally {
    db.run("DETACH legacy");
  }

  renameSync(legacyPath, `${legacyPath}.migrated`);
  for (const suffix of ["-wal", "-shm"]) {
    const sidecar = `${legacyPath}${suffix}`;
    if (existsSync(sidecar)) renameSync(sidecar, `${sidecar}.migrated`);
  }
}
