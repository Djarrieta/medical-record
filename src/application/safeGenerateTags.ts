import type { Tagger } from "../domain/ports";

// Best-effort tag generation shared by the indexing use cases.
// Never throws: when no Tagger is configured, or generation fails, it returns
// [] so the caller can proceed without tags.
export async function safeGenerateTags(
  tagger: Tagger | null,
  text: string,
): Promise<string[]> {
  if (!tagger) return [];
  try {
    return await tagger.generate(text);
  } catch (err) {
    console.error("Tag generation failed:", err);
    return [];
  }
}
