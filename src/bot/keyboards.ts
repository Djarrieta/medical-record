/**
 * Inline keyboards / UX helpers (plan §5).
 */

import { InlineKeyboard } from "grammy";

/** Offer to save a password that just unlocked a PDF. */
export function savePasswordKeyboard(): InlineKeyboard {
  return new InlineKeyboard()
    .text("💾 Guardar contraseña", "pwd:save")
    .text("🗑️ No guardar", "pwd:discard");
}
