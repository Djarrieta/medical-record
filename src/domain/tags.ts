import { toIsoDate } from "./date";

export const MAX_TAGS = 8;

// Canonicalizes a raw list of tags into the stored form: lowercase, trimmed,
// de-duplicated, date-like entries normalized to YYYY-MM-DD, and capped to
// `max`. Shared by the tagger (post-processing the LLM output) and the web
// layer (sanitizing manually-entered tags) so both write identical tags.
export function normalizeTags(raw: string[], max: number = MAX_TAGS): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    if (typeof item !== "string") continue;
    let tag = item.trim().toLowerCase();
    if (!tag) continue;
    const iso = toIsoDate(tag);
    if (iso) tag = iso;
    if (seen.has(tag)) continue;
    seen.add(tag);
    out.push(tag);
    if (out.length >= max) break;
  }
  return out;
}
