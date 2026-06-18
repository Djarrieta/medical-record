import type { DocumentRepository, VectorIndex } from "../domain/ports";

// Use case: remove a stored document and its indexed vectors together.
export class DeleteDocument {
  constructor(
    private readonly repo: DocumentRepository,
    private readonly vectorIndex: VectorIndex,
  ) {}

  async run(id: string): Promise<boolean> {
    const record = this.repo.get(id);
    if (!record) return false;

    this.repo.delete(id);
    await this.vectorIndex.deleteByFileId(id).catch(() => {});
    return true;
  }
}
