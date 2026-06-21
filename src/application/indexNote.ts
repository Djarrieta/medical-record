import type { Chunker, Embedder, NoteRepository, Titler, VectorIndex } from "../domain/ports";

export interface IndexNoteInput {
  text: string;
  userId: number;
  title?: string;
}

export interface IndexNoteResult {
  noteId: string;
  title: string;
}

// Derive a short fallback title from the note's text: first non-empty line,
// capped. Used when no title is supplied and the Titler is unavailable/fails.
function fallbackTitle(text: string): string {
  const firstLine = text
    .split("\n")
    .map((l) => l.trim())
    .find((l) => l.length > 0);
  const base = (firstLine ?? "Nota").slice(0, 60).trim();
  return base || "Nota";
}

// Use case: persist a free-form text note and make it RAG-searchable.
// Saves the note in its own table, then chunks → embeds → indexes its text in
// the vector store under the note's id (so DeleteNote can remove it later).
export class IndexNote {
  constructor(
    private readonly chunker: Chunker,
    private readonly embedder: Embedder,
    private readonly vectorIndex: VectorIndex,
    private readonly notes: NoteRepository,
    private readonly titler: Titler | null = null,
  ) {}

  async run(input: IndexNoteInput): Promise<IndexNoteResult> {
    const { text, userId } = input;

    let title = (input.title ?? "").trim();
    if (!title && this.titler) {
      try {
        title = (await this.titler.generate(text, "Nota")) ?? "";
      } catch (err) {
        console.error("Note title generation failed:", err);
      }
    }
    if (!title) title = fallbackTitle(text);

    const note = this.notes.save(userId, text, title);

    const chunks = (await this.chunker.split(text)).filter((c) => c.trim().length > 0);
    if (chunks.length > 0) {
      const vectors = await this.embedder.embed(chunks);
      await this.vectorIndex.index(chunks, vectors, note.id, note.title, userId);
    }

    return { noteId: note.id, title: note.title };
  }
}
