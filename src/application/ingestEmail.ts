import type { DocumentRepository, EmailSource, ProcessedEmailLog } from "../domain/ports";
import { isImageBuffer, isPdfBuffer } from "../domain/fileType";
import type { IndexImage } from "./indexImage";
import type { IndexNote } from "./indexNote";
import type { IndexPdf } from "./indexPdf";

export interface IngestEmailResult {
  emails: number;
  pdfs: number;
  images: number;
  others: number;
}

// Use case: poll the shared mailbox and ingest every email forwarded from a
// registered user's address. The body becomes a Note (RAG-searchable) and each
// attachment is routed exactly like a Telegram upload (PDF → IndexPdf, image →
// IndexImage, other → store only). Attribution is the users.json email match
// only; unmatched senders are ignored silently. Dedup is by Gmail providerId.
export class IngestEmail {
  constructor(
    private readonly source: EmailSource,
    // Lowercased/trimmed forwarder email → userId, built from users.json.
    private readonly emailToUserId: Map<string, number>,
    private readonly processed: ProcessedEmailLog,
    private readonly repo: DocumentRepository,
    private readonly indexNote: IndexNote,
    private readonly indexPdf: IndexPdf,
    private readonly indexImage: IndexImage,
  ) {}

  async run(): Promise<IngestEmailResult> {
    const result: IngestEmailResult = { emails: 0, pdfs: 0, images: 0, others: 0 };

    const incoming = await this.source.fetchRecent();

    for (const email of incoming) {
      const userId = this.emailToUserId.get(email.from);
      if (userId === undefined) continue; // not a registered user's address
      if (this.processed.has(email.providerId)) continue; // already ingested

      try {
        // Body → Note (reuses the title fallback + tags + RAG pipeline).
        const body = email.body.trim();
        if (body.length > 0) {
          await this.indexNote.run({
            text: `${email.subject}\n\n${email.body}`,
            userId,
            title: email.subject,
          });
        }

        // Attachments → routed like Telegram uploads, with content dedup.
        for (const att of email.attachments) {
          const existing = this.repo.findByContent(att.content, userId);
          const rec =
            existing ??
            (await this.repo.save(userId, att.filename, att.mimeType, att.content));

          // Route by MIME, falling back to magic bytes when the client sent a
          // generic type (email attachments are often application/octet-stream),
          // mirroring the Telegram/web upload paths.
          const isPdf = att.mimeType === "application/pdf" || isPdfBuffer(att.content);
          const isImage = att.mimeType.startsWith("image/") || isImageBuffer(att.content);

          if (isPdf) {
            await this.indexPdf.run({
              buffer: att.content,
              fileId: rec.id,
              fileName: att.filename,
              userId,
            });
            result.pdfs += 1;
          } else if (isImage) {
            await this.indexImage.run({
              buffer: att.content,
              fileId: rec.id,
              fileName: att.filename,
              userId,
            });
            result.images += 1;
          } else {
            // Stored only (the save above); not indexed.
            result.others += 1;
          }
        }

        // Mark only after the whole email succeeded, so a crash mid-email lets
        // the next poll retry it.
        this.processed.mark(email.providerId);
        result.emails += 1;
      } catch (err) {
        console.error(`Email ingestion failed for ${email.providerId}:`, err);
      }
    }

    return result;
  }
}
