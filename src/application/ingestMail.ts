import type { DocumentRepository, MailSource, ProcessedMessages } from "../domain/ports";
import type { MailAttachment, MailMessage } from "../domain/types";
import type { IndexPdf } from "./indexPdf";
import type { IndexImage } from "./indexImage";
import type { IndexNote } from "./indexNote";

function isPdf(att: MailAttachment): boolean {
  return att.mimeType === "application/pdf" || att.name.toLowerCase().endsWith(".pdf");
}

function isImage(att: MailAttachment): boolean {
  return att.mimeType.startsWith("image/") || /\.(jpe?g|png|gif|webp|bmp|tiff?)$/i.test(att.name);
}

export interface IngestMailResult {
  messagesProcessed: number;
  documentsIndexed: number;
  notesCreated: number;
}

// Use case: pull new messages from allowed senders and turn them into indexed
// content. Messages with processable attachments (PDF/image) index only the
// attachments (the body is dropped); messages without become text notes.
// Each handled message id is recorded so reprocessing never duplicates.
export class IngestMail {
  constructor(
    private readonly mailSource: MailSource,
    private readonly processed: ProcessedMessages,
    private readonly indexPdf: IndexPdf,
    private readonly indexImage: IndexImage,
    private readonly indexNote: IndexNote,
    private readonly repo: DocumentRepository,
    private readonly userId: number,
  ) {}

  async run(): Promise<IngestMailResult> {
    const messages = await this.mailSource.fetchMessages({
      stopAtProcessed: (id) => this.processed.has(id),
    });

    const result: IngestMailResult = {
      messagesProcessed: 0,
      documentsIndexed: 0,
      notesCreated: 0,
    };

    // Oldest first, so storage order matches chronological order.
    for (const msg of [...messages].reverse()) {
      if (this.processed.has(msg.id)) continue;
      try {
        await this.handle(msg, result);
        this.processed.add(msg.id);
        result.messagesProcessed++;
      } catch (err) {
        console.error(`IngestMail: failed to process message ${msg.id}:`, err);
      }
    }

    return result;
  }

  private async handle(msg: MailMessage, result: IngestMailResult): Promise<void> {
    const processable = msg.attachments.filter((a) => isPdf(a) || isImage(a));

    if (processable.length > 0) {
      for (const att of processable) {
        const existing = this.repo.findByContent(att.buffer, this.userId);
        if (existing) continue;

        const record = await this.repo.save(this.userId, att.name, att.mimeType, att.buffer);
        const indexResult = isPdf(att)
          ? await this.indexPdf.run({
              buffer: att.buffer,
              fileId: record.id,
              fileName: att.name,
              userId: this.userId,
            })
          : await this.indexImage.run({
              buffer: att.buffer,
              fileId: record.id,
              fileName: att.name,
              userId: this.userId,
            });
        if (indexResult.indexed) result.documentsIndexed++;
      }
      return;
    }

    // No processable attachments → store the body as a note.
    const body = msg.bodyText.trim();
    if (!body) return;
    await this.indexNote.run({
      text: body,
      userId: this.userId,
      title: msg.subject.trim() || undefined,
    });
    result.notesCreated++;
  }
}
