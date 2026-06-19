import type {
  Chunker,
  DocumentRepository,
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

// Why a PDF could not be indexed.
// - "locked": every password candidate failed; the PDF is encrypted.
// - "empty":  the PDF was readable but had no extractable text (e.g. scanned).
export type IndexPdfReason = "locked" | "empty";

export interface IndexPdfResult {
  indexed: boolean;
  reason?: IndexPdfReason;
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
    private readonly repo: DocumentRepository,
  ) {}

  async run(input: IndexPdfInput): Promise<IndexPdfResult> {
    const { buffer, fileId, fileName, password } = input;

    const candidates: (string | undefined)[] = [undefined];
    if (password) candidates.push(password);
    candidates.push(...this.vault.getAll());

    for (const candidate of candidates) {
      const text = await this.extractor.tryExtract(buffer, candidate);
      if (text === null) continue;

      // Persist a newly supplied password only after it actually unlocks the PDF.
      if (password && candidate === password) this.vault.add(password);

      const chunks = (await this.chunker.split(text)).filter((c) => c.trim().length > 0);
      // A readable PDF with no extractable text (typically a scan/image-only
      // document) yields no chunks. Don't treat that as a fatal error — record
      // it so the caller can tell the user OCR would be needed.
      if (chunks.length === 0) {
        this.repo.setIndexed(fileId, false);
        return { indexed: false, reason: "empty" };
      }

      const vectors = await this.embedder.embed(chunks);
      await this.vectorIndex.index(chunks, vectors, fileId, fileName);
      this.repo.setIndexed(fileId, true);
      return { indexed: true };
    }

    this.repo.setIndexed(fileId, false);
    return { indexed: false, reason: "locked" };
  }
}
