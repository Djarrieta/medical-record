import type {
  Chunker,
  DocumentRepository,
  Embedder,
  Ocr,
  VectorIndex,
} from "../domain/ports";

export interface IndexImageInput {
  buffer: Buffer;
  fileId: string;
  fileName: string;
  userId: number;
}

// Why an image could not be indexed.
// - "empty": OCR ran but found no text (e.g. a photo with no readable text).
export type IndexImageReason = "empty";

export interface IndexImageResult {
  indexed: boolean;
  reason?: IndexImageReason;
}

// Use case: OCR an image, chunk the text, embed it and store it in the vector
// index. Shared by the Telegram bot and the web upload adapters.
// Unlike IndexPdf, images have no password and no TextExtractor — the only
// path to text is OCR — so the embed/index tail is duplicated on purpose.
export class IndexImage {
  constructor(
    private readonly ocr: Ocr,
    private readonly chunker: Chunker,
    private readonly embedder: Embedder,
    private readonly vectorIndex: VectorIndex,
    private readonly repo: DocumentRepository,
  ) {}

  async run(input: IndexImageInput): Promise<IndexImageResult> {
    const { buffer, fileId, fileName, userId } = input;

    const text = await this.ocr.extract(buffer).catch((err) => {
      console.error("OCR failed:", err);
      return "";
    });

    const chunks = (await this.chunker.split(text)).filter((c) => c.trim().length > 0);

    if (chunks.length === 0) {
      this.repo.setIndexed(fileId, false);
      return { indexed: false, reason: "empty" };
    }

    const vectors = await this.embedder.embed(chunks);
    await this.vectorIndex.index(chunks, vectors, fileId, fileName, userId);
    this.repo.setIndexed(fileId, true);
    return { indexed: true };
  }
}
