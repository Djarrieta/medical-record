import type {
  Chunker,
  DocumentRepository,
  Embedder,
  Ocr,
  PasswordVault,
  TextExtractor,
  Titler,
  VectorIndex,
} from "../domain/ports";
import { embedAndIndex } from "./embedAndIndex";
import { safeGenerateTitle } from "./safeGenerateTitle";

export interface IndexPdfInput {
  buffer: Buffer;
  fileId: string;
  fileName: string;
  userId: number;
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
    private readonly ocr: Ocr,
    private readonly titler: Titler | null = null,
  ) {}

  async run(input: IndexPdfInput): Promise<IndexPdfResult> {
    const { buffer, fileId, fileName, userId, password } = input;

    const candidates: (string | undefined)[] = [undefined];
    if (password) candidates.push(password);
    candidates.push(...this.vault.getAll());

    for (const candidate of candidates) {
      const text = await this.extractor.tryExtract(buffer, candidate);
      if (text === null) continue;

      // Persist a newly supplied password only after it actually unlocks the PDF.
      if (password && candidate === password) this.vault.add(password);

      const deps = { chunker: this.chunker, embedder: this.embedder, vectorIndex: this.vectorIndex };

      let sourceText = text;
      let indexed = await embedAndIndex(deps, text, fileId, fileName, userId);

      // A readable PDF with no extractable text is typically a scan/image-only
      // document. Fall back to OCR before giving up.
      if (!indexed) {
        const ocrText = await this.ocr.extract(buffer, candidate).catch((err) => {
          console.error("OCR failed:", err);
          return "";
        });
        sourceText = ocrText;
        indexed = await embedAndIndex(deps, ocrText, fileId, fileName, userId);
      }

      // Still nothing even after OCR — record it so the caller can tell the user.
      if (!indexed) {
        this.repo.setIndexed(fileId, false);
        return { indexed: false, reason: "empty" };
      }

      this.repo.setIndexed(fileId, true);
      await this.applyName(fileId, sourceText, fileName, userId);
      return { indexed: true };
    }

    this.repo.setIndexed(fileId, false);
    return { indexed: false, reason: "locked" };
  }

  // Generate a friendly name from the document's text and rename the file.
  // Best-effort: a failure here must never break indexing, so the record keeps
  // its original file name. The vector index is renamed too so its fileName
  // payload stays in sync with the stored document.
  private async applyName(
    fileId: string,
    text: string,
    originalName: string,
    userId: number,
  ): Promise<void> {
    const name = await safeGenerateTitle(this.titler, text, originalName);
    if (!name) return;
    this.repo.setOriginalName(fileId, name);
    await this.vectorIndex.renameFile(fileId, name, userId).catch((err) => {
      console.error("Vector index rename failed:", err);
    });
  }
}
