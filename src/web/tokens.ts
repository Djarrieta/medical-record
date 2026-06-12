/**
 * One-time, single-session upload tokens tied to a Telegram user_id (plan §8).
 *
 * Tokens are random, short-lived (TTL), and valid for the whole upload session (multiple
 * files) until they expire. Stored in-memory: they are ephemeral by design and a restart
 * simply invalidates outstanding links.
 */

import { randomBytes } from "node:crypto";
import { config } from "../config.ts";

interface TokenEntry {
  userId: number;
  expiresAt: number;
}

const tokens = new Map<string, TokenEntry>();

function sweep(): void {
  const now = Date.now();
  for (const [token, entry] of tokens) {
    if (entry.expiresAt <= now) tokens.delete(token);
  }
}

/** Create a new upload token for a user. Returns the token and its absolute URL. */
export function createUploadToken(userId: number): { token: string; url: string; ttlMin: number } {
  sweep();
  const token = randomBytes(24).toString("base64url");
  const ttlMs = config.web.uploadTokenTtlMin * 60_000;
  tokens.set(token, { userId, expiresAt: Date.now() + ttlMs });
  const url = `${config.web.baseUrl.replace(/\/$/, "")}/u/${token}`;
  return { token, url, ttlMin: config.web.uploadTokenTtlMin };
}

/** Resolve a token to its user_id, or null if missing/expired. */
export function resolveUploadToken(token: string): number | null {
  sweep();
  const entry = tokens.get(token);
  if (!entry) return null;
  if (entry.expiresAt <= Date.now()) {
    tokens.delete(token);
    return null;
  }
  return entry.userId;
}

/** Invalidate a token (e.g. when the user finishes / on demand). */
export function revokeUploadToken(token: string): void {
  tokens.delete(token);
}
