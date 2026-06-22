// Pure date helpers (no external deps). Shared by the tagger (when generating a
// date tag) and the web layer (when normalizing manually-entered tags), so a
// document's date is always stored in the same sortable form.

// Normalizes a variety of date inputs to a canonical `YYYY-MM-DD` string, or
// returns null when the input does not look like a date. Recognizes:
//   - ISO-ish: 2024-03-12, 2024/03/12, 2024.03.12
//   - Day-first: 12-03-2024, 12/03/2024, 12.03.2024
// Two-digit years are rejected (too ambiguous). Out-of-range months/days return
// null. No locale month names — the tagger is instructed to emit ISO dates.
export function toIsoDate(input: string): string | null {
  const s = input.trim();
  if (!s) return null;

  // YYYY[-/.]MM[-/.]DD
  let m = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/);
  if (m) return build(Number(m[1]), Number(m[2]), Number(m[3]));

  // DD[-/.]MM[-/.]YYYY
  m = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/);
  if (m) return build(Number(m[3]), Number(m[2]), Number(m[1]));

  return null;
}

function build(year: number, month: number, day: number): string | null {
  if (month < 1 || month > 12) return null;
  if (day < 1 || day > 31) return null;
  const mm = String(month).padStart(2, "0");
  const dd = String(day).padStart(2, "0");
  return `${year}-${mm}-${dd}`;
}
