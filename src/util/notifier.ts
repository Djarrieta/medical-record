/**
 * Lightweight indirection so background ingestion (web or Telegram uploads) can
 * push a completion/error message to a user without importing the bot directly.
 *
 * The bot registers a sender at startup via setNotifier(); intake calls notifyUser()
 * when a document finishes processing (ready) or fails.
 */

import { createLogger } from "./logger.ts";

const log = createLogger("notifier");

type Sender = (userId: number, text: string) => Promise<unknown>;

let sender: Sender | null = null;

/** Register the function used to deliver messages (called once at startup). */
export function setNotifier(fn: Sender): void {
  sender = fn;
}

/** Fire-and-forget a message to a user; no-op if no sender is registered. */
export function notifyUser(userId: number, text: string): void {
  if (!sender) return;
  void sender(userId, text).catch((err) => {
    log.error("Failed to notify user", err instanceof Error ? err.message : err);
  });
}
