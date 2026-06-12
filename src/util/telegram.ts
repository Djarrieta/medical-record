/**
 * Telegram helpers: split long replies under the 4096-char limit (plan §5).
 */

const TELEGRAM_MAX = 4096;

/** Split text into chunks that fit Telegram's message limit, preferring line breaks. */
export function splitForTelegram(text: string, limit = TELEGRAM_MAX): string[] {
  if (text.length <= limit) return [text];

  const parts: string[] = [];
  let remaining = text;
  while (remaining.length > limit) {
    let cut = remaining.lastIndexOf("\n", limit);
    if (cut < limit * 0.5) cut = remaining.lastIndexOf(" ", limit);
    if (cut <= 0) cut = limit;
    parts.push(remaining.slice(0, cut));
    remaining = remaining.slice(cut).replace(/^\s+/, "");
  }
  if (remaining.length > 0) parts.push(remaining);
  return parts;
}
