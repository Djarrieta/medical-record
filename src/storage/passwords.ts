/**
 * Per-user PDF password vault (plan §7).
 * Passwords are secrets: never log them, and delete chat messages that contain them.
 * Stored in plaintext for the MVP (at-rest encryption is deferred — see plan §9).
 */

import { getDb } from "./db.ts";

export interface PasswordRow {
  id: number;
  user_id: number;
  password: string;
  last_used_at: number | null;
  created_at: number;
}

export function addPassword(userId: number, password: string): boolean {
  const res = getDb()
    .prepare(
      `INSERT INTO pdf_passwords (user_id, password, created_at) VALUES (?, ?, ?)
       ON CONFLICT(user_id, password) DO NOTHING`,
    )
    .run(userId, password, Date.now());
  return res.changes > 0;
}

export function deletePassword(userId: number, id: number): boolean {
  const res = getDb()
    .prepare(`DELETE FROM pdf_passwords WHERE user_id = ? AND id = ?`)
    .run(userId, id);
  return res.changes > 0;
}

/** Candidate passwords, most-recently-used first (best chance of an early hit). */
export function listPasswords(userId: number): PasswordRow[] {
  return getDb()
    .prepare<[number], PasswordRow>(
      `SELECT * FROM pdf_passwords WHERE user_id = ?
       ORDER BY (last_used_at IS NULL), last_used_at DESC, created_at DESC`,
    )
    .all(userId);
}

export function markPasswordUsed(userId: number, id: number): void {
  getDb()
    .prepare(`UPDATE pdf_passwords SET last_used_at = ? WHERE user_id = ? AND id = ?`)
    .run(Date.now(), userId, id);
}

/** Mask a password for display (e.g. in /passwords). */
export function maskPassword(password: string): string {
  if (password.length <= 2) return "*".repeat(password.length);
  return `${password[0]}${"*".repeat(Math.max(1, password.length - 2))}${password[password.length - 1]}`;
}
