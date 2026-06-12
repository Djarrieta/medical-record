/**
 * Access control: allowlist + consent (plan §1, §9).
 */

import type { Context } from "grammy";
import { config } from "../config.ts";
import { hasConsent } from "../storage/db.ts";

/** True if the Telegram user is on the allowlist. */
export function isAllowed(userId: number | undefined): boolean {
  return userId !== undefined && config.allowedUserIds.has(userId);
}

/** True if the user has granted consent. */
export function userHasConsent(userId: number): boolean {
  return hasConsent(userId);
}

const NOT_ALLOWED_MSG =
  "🚫 No tienes acceso a este bot. Es de uso personal y restringido por lista de permitidos.";

/**
 * grammY middleware: reject any user not on the allowlist before handlers run.
 */
export async function allowlistGuard(ctx: Context, next: () => Promise<void>): Promise<void> {
  const userId = ctx.from?.id;
  if (!isAllowed(userId)) {
    if (ctx.chat) await ctx.reply(NOT_ALLOWED_MSG);
    return;
  }
  await next();
}
