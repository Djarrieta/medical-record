import type { Titler } from "../domain/ports";

// Best-effort title generation shared by the indexing use cases.
// Never throws: when no Titler is configured, or generation fails, it returns
// null so the caller can fall back to its own default (the original file name,
// a note's first line, etc.).
export async function safeGenerateTitle(
  titler: Titler | null,
  text: string,
  fallbackName: string,
): Promise<string | null> {
  if (!titler) return null;
  try {
    return await titler.generate(text, fallbackName);
  } catch (err) {
    console.error("Title generation failed:", err);
    return null;
  }
}
