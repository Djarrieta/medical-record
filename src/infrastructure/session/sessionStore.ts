import { randomBytes, timingSafeEqual } from "crypto";

import type { SessionStore } from "../../domain/ports";
import type { ConversationMessage, Session } from "../../domain/types";

// Keep the prompt bounded: last 20 messages (~10 turns).
const MAX_HISTORY = 20;

interface StoredSession extends Session {
  messages: ConversationMessage[];
}

// In-memory session store: one session per user, holding the random web token
// and the ephemeral conversation history. Sessions expire by inactivity; the
// sweep in main.ts drives warnings/closes via `dueForWarning`/`dueForClose`.
// Restarting the process clears all sessions and conversations (by design).
export class InMemorySessionStore implements SessionStore {
  private sessions = new Map<number, StoredSession>();

  constructor(
    private readonly ttlMs: number,
    private readonly warningGraceMs: number,
  ) {}

  private newToken(): string {
    return randomBytes(32).toString("hex");
  }

  getOrCreate(userId: number): Session {
    const existing = this.sessions.get(userId);
    if (existing) return existing;
    const now = new Date().toISOString();
    const session: StoredSession = {
      userId,
      token: this.newToken(),
      createdAt: now,
      lastActivityAt: now,
      warned: false,
      messages: [],
    };
    this.sessions.set(userId, session);
    return session;
  }

  getByToken(userId: number, token: string): Session | null {
    const session = this.sessions.get(userId);
    if (!session) return null;
    // Reject expired sessions even if the periodic sweep hasn't collected them
    // yet. Otherwise an old link would authenticate (and `touch` would revive
    // it) in the window between TTL elapsing and the sweep running.
    if (Date.now() - Date.parse(session.lastActivityAt) >= this.ttlMs) {
      this.sessions.delete(userId);
      return null;
    }
    // Constant-time compare with a length guard (timingSafeEqual throws on
    // mismatched buffer sizes).
    const a = Buffer.from(session.token);
    const b = Buffer.from(token);
    if (a.length !== b.length) return null;
    if (!timingSafeEqual(a, b)) return null;
    return session;
  }

  touch(userId: number): Session {
    const session = this.sessions.get(userId) ?? (this.getOrCreate(userId) as StoredSession);
    session.lastActivityAt = new Date().toISOString();
    session.warned = false;
    return session;
  }

  appendMessage(userId: number, msg: ConversationMessage): void {
    const session = this.sessions.get(userId);
    if (!session) return;
    session.messages.push(msg);
    if (session.messages.length > MAX_HISTORY) {
      session.messages = session.messages.slice(-MAX_HISTORY);
    }
  }

  history(userId: number): ConversationMessage[] {
    return this.sessions.get(userId)?.messages ?? [];
  }

  close(userId: number): void {
    this.sessions.delete(userId);
  }

  dueForWarning(now: number): Session[] {
    const threshold = this.ttlMs - this.warningGraceMs;
    return Array.from(this.sessions.values()).filter(
      (s) => !s.warned && now - Date.parse(s.lastActivityAt) >= threshold,
    );
  }

  dueForClose(now: number): Session[] {
    return Array.from(this.sessions.values()).filter(
      (s) => now - Date.parse(s.lastActivityAt) >= this.ttlMs,
    );
  }

  markWarned(userId: number): void {
    const session = this.sessions.get(userId);
    if (session) session.warned = true;
  }
}
