import type { Chunker, Embedder, NoteRepository, VectorIndex } from "../domain/ports";
import { embedAndIndex } from "./embedAndIndex";

export interface UpdateNoteInput {
  id: string;
  userId: number;
  text: string;
  title?: string;
}

export interface UpdateNoteResult {
  ok: boolean;
  title: string;
}

// Derive a short fallback title from the note's text: first non-empty line,
// capped. Mirrors IndexNote so re-saved notes keep a sensible title.
function fallbackTitle(text: string): string {
  const firstLine = text
    .split("\n")
    .map((l) => l.trim())
    .find((l) => l.length > 0);
  const base = (firstLine ?? "Nota").slice(0, 60).trim();
  return base || "Nota";
}

// Use case: edit an existing note's body/title and keep its vectors in sync.
// Re-indexes from scratch (delete old chunks → re-embed) so RAG sees the new
// text. Tags are preserved as-is.
export class UpdateNote {
  constructor(
    private readonly chunker: Chunker,
    private readonly embedder: Embedder,
    private readonly vectorIndex: VectorIndex,
    private readonly notes: NoteRepository,
  ) {}

  async run(input: UpdateNoteInput): Promise<UpdateNoteResult> {
    const { id, userId } = input;
    const existing = this.notes.get(id, userId);
    if (!existing) return { ok: false, title: "" };

    const text = input.text.trim();
    let title = (input.title ?? "").trim();
    if (!title) title = fallbackTitle(text);

    const updated = this.notes.update(id, userId, text, title);
    if (!updated) return { ok: false, title: "" };

    // Replace the note's vectors with the new body so search stays accurate.
    await this.vectorIndex.deleteByFileId(id, userId).catch(() => {});
    const deps = { chunker: this.chunker, embedder: this.embedder, vectorIndex: this.vectorIndex };
    await embedAndIndex(deps, text, id, title, userId);

    // Re-apply existing tags onto the freshly indexed chunks.
    if (existing.tags && existing.tags.length > 0) {
      await this.vectorIndex.setTags(id, existing.tags, userId).catch(() => {});
    }

    return { ok: true, title };
  }
}
