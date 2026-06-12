/**
 * Inline keyboards / UX helpers (plan §5).
 */

import { InlineKeyboard } from "grammy";

/** Consent prompt shown on /start before storing anything. */
export const consentKeyboard = new InlineKeyboard()
  .text("✅ Acepto", "consent:accept")
  .text("❌ No acepto", "consent:decline");

/** Offer to save a password that just unlocked a PDF. */
export function savePasswordKeyboard(): InlineKeyboard {
  return new InlineKeyboard()
    .text("💾 Guardar contraseña", "pwd:save")
    .text("🗑️ No guardar", "pwd:discard");
}
