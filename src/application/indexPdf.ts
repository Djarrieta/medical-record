import type {
  Chunker,
  Embedder,
  PasswordVault,
  TextExtractor,
  VectorIndex,
} from "../domain/ports";

export interface IndexPdfInput {
  buffer: Buffer;
  fileId: string;
  fileName: string;
  password?: string;
}

// Use case: extract a PDF's text (trying the given password, then known ones),
// chunk it, embed it and store it in the vector index.
// This is the single source of truth for indexing — used by both the Telegram
// bot and the web upload adapters.
export class IndexPdf {
  constructor(
    private readonly extractor: TextExtractor,
    private readonly chunker: Chunker,
    private readonly embedder: Embedder,
    private readonly vectorIndex: VectorIndex,
    private readonly vault: PasswordVault,
  ) {}

  async run(input: IndexPdfInput): Promise<{ indexed: boolean }> {
    const { buffer, fileId, fileName, password } = input;

    const candidates: (string | undefined)[] = [undefined];
    if (password) candidates.push(password);
    candidates.push(...this.vault.getAll());

    for (const candidate of candidates) {
      const text = await this.extractor.tryExtract(buffer, candidate);
      if (text === null) continue;

      // Persist a newly supplied password only after it actually unlocks the PDF.
      if (password && candidate === password) this.vault.add(password);

      const chunks = await this.chunker.split(text);
      const vectors = await this.embedder.embed(chunks);
      await this.vectorIndex.index(chunks, vectors, fileId, fileName);
      return { indexed: true };
    }

    return { indexed: false };
  }
}
