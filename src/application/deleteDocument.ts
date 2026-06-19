import type { DocumentRepository, VectorIndex } from "../domain/ports";

// Use case: remove a stored document and its indexed vectors together.
export class DeleteDocument {
  constructor(
    private readonly repo: DocumentRepository,
    private readonly vectorIndex: VectorIndex,
  ) {}

  async run(id: string, userId: number): Promise<boolean> {
    const record = this.repo.get(id, userId);
    if (!record) return false;

    this.repo.delete(id, userId);
    await this.vectorIndex.deleteByFileId(id, userId).catch(() => {});
    return true;
  }
}
