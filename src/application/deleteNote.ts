import type { NoteRepository, VectorIndex } from "../domain/ports";

// Use case: remove a stored note and its indexed vectors together.
export class DeleteNote {
  constructor(
    private readonly notes: NoteRepository,
    private readonly vectorIndex: VectorIndex,
  ) {}

  async run(id: string, userId: number): Promise<boolean> {
    const note = this.notes.get(id, userId);
    if (!note) return false;

    this.notes.delete(id, userId);
    await this.vectorIndex.deleteByFileId(id, userId).catch(() => {});
    return true;
  }
}
