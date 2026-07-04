import type {
  ArchiveExtractor,
  CalendarService,
  DocumentRepository,
  EmailNoteSummarizer,
  EmailSource,
  ProcessedEmailLog,
} from "../domain/ports";
import type { EmailAttachment } from "../domain/types";
import { isImageBuffer, isPdfBuffer, isZipBuffer } from "../domain/fileType";
import { isIcsBuffer, parseIcsEvents } from "../domain/icalendar";
import type { IndexImage } from "./indexImage";
import type { IndexNote } from "./indexNote";
import type { IndexPdf } from "./indexPdf";

export interface IngestEmailResult {
  emails: number;
  pdfs: number;
  images: number;
  events: number;
  others: number;
}

// Use case: poll the shared mailbox and ingest every email forwarded from a
// registered user's address. The body is first triaged/summarized by the LLM
// (EmailNoteSummarizer): only emails carrying useful health information become a
// Note (RAG-searchable), rewritten into a short clear summary; noise is dropped.
// Each attachment is routed exactly like a Telegram upload, but ONLY indexable
// files are kept: PDF → IndexPdf, image → IndexImage. Anything that cannot be
// indexed is dropped (never archived as dead weight). Zip attachments are
// expanded first and their inner files routed the same way. Attribution is the
// user-registry email match only (the USERS env var); unmatched senders are
// ignored silently. Dedup is by Gmail providerId.
export class IngestEmail {
  constructor(
    private readonly source: EmailSource,
    // Lowercased/trimmed forwarder email → userId, built from the user registry
    // (config.users — the USERS env var).
    private readonly emailToUserId: Map<string, number>,
    private readonly processed: ProcessedEmailLog,
    private readonly repo: DocumentRepository,
    private readonly indexNote: IndexNote,
    private readonly indexPdf: IndexPdf,
    private readonly indexImage: IndexImage,
    // Expands zip attachments into their contained files so each can be routed
    // through the normal PDF/image pipeline.
    private readonly archive: ArchiveExtractor,
    // Optional LLM triage. When absent (no LLM configured) the raw body is saved
    // as before; when present it decides whether the body is worth saving and,
    // if so, rewrites it into a concise summary.
    private readonly summarizer: EmailNoteSummarizer | null = null,
    // Optional calendar. When present, .ics attachments (appointment invites)
    // are turned into calendar events instead of being stored/indexed. When
    // null, .ics attachments are simply dropped like any other non-indexable
    // file.
    private readonly calendar: CalendarService | null = null,
    // userId → display name, used to prefix events created in the shared
    // calendar (e.g. "Dario: Cita cardiología").
    private readonly userNames: Map<number, string> = new Map(),
    // Time zone used to interpret floating/all-day .ics times and to display
    // UTC ones (e.g. "America/Bogota").
    private readonly timeZone: string = "America/Bogota",
  ) {}

  async run(): Promise<IngestEmailResult> {
    const result: IngestEmailResult = { emails: 0, pdfs: 0, images: 0, events: 0, others: 0 };

    const incoming = await this.source.fetchRecent();

    for (const email of incoming) {
      const userId = this.emailToUserId.get(email.from);
      if (userId === undefined) continue; // not a registered user's address
      if (this.processed.has(email.providerId)) continue; // already ingested

      try {
        // Body → Note, but only when it carries useful health information.
        // The LLM triages and rewrites it into a short, clear summary; noise is
        // dropped (no note). Without an LLM, the raw body is saved as before.
        const body = email.body.trim();
        if (body.length > 0) {
          const noteText = this.summarizer
            ? await this.summarizer.summarize(email.subject, body)
            : `${email.subject}\n\n${email.body}`;
          if (noteText) {
            await this.indexNote.run({
              text: noteText,
              userId,
              title: email.subject,
            });
          }
        }

        // Attachments → expand zips, then route like Telegram uploads. Only
        // indexable files (PDF/image) are saved; the rest are dropped.
        const candidates = await this.expandAttachments(email.attachments);
        for (const att of candidates) {
          // Appointment invites (.ics) → create a calendar event, never store or
          // index them. Detect by MIME/filename with a content fallback (the
          // client often sends text/calendar, application/ics or octet-stream).
          if (this.isIcs(att)) {
            result.events += await this.scheduleFromIcs(att, userId, email.subject);
            continue;
          }

          // Route by MIME, falling back to magic bytes when the client sent a
          // generic type (email attachments are often application/octet-stream),
          // mirroring the Telegram/web upload paths.
          const isPdf = att.mimeType === "application/pdf" || isPdfBuffer(att.content);
          const isImage = att.mimeType.startsWith("image/") || isImageBuffer(att.content);

          if (!isPdf && !isImage) {
            // Not indexable → not stored. Better to drop it than to archive a
            // file we can never search.
            result.others += 1;
            continue;
          }

          // Only now do we persist it (content-deduped).
          const existing = this.repo.findByContent(att.content, userId);
          const rec =
            existing ??
            (await this.repo.save(userId, att.filename, att.mimeType, att.content));

          if (isPdf) {
            await this.indexPdf.run({
              buffer: att.content,
              fileId: rec.id,
              fileName: att.filename,
              userId,
            });
            result.pdfs += 1;
          } else {
            await this.indexImage.run({
              buffer: att.content,
              fileId: rec.id,
              fileName: att.filename,
              userId,
            });
            result.images += 1;
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

  // Is this attachment an iCalendar appointment invite? Checks MIME and the
  // ".ics" extension, then falls back to sniffing the content (clients often
  // send text/calendar, application/ics, or a generic octet-stream).
  private isIcs(att: EmailAttachment): boolean {
    const mime = att.mimeType.toLowerCase();
    return (
      mime.startsWith("text/calendar") ||
      mime === "application/ics" ||
      att.filename.toLowerCase().endsWith(".ics") ||
      isIcsBuffer(att.content)
    );
  }

  // Turns an .ics attachment into calendar events. The file itself is never
  // stored or indexed. Returns how many events were created (0 when calendar is
  // disabled or the invite has no usable/non-cancelled event). Failures are
  // logged and swallowed so one bad invite never aborts the email.
  private async scheduleFromIcs(
    att: EmailAttachment,
    userId: number,
    subject: string,
  ): Promise<number> {
    if (!this.calendar) return 0; // calendar disabled → just drop the .ics

    let created = 0;
    try {
      const events = parseIcsEvents(att.content.toString("utf8"), this.timeZone);
      const userName = this.userNames.get(userId);
      for (const ev of events) {
        const base = ev.title.trim() || subject.trim() || "Cita";
        const title = userName ? `${userName}: ${base}` : base;
        await this.calendar.createEvent({
          title,
          description: ev.description,
          startIso: ev.startIso,
          endIso: ev.endIso,
          timeZone: ev.timeZone,
        });
        created += 1;
      }
    } catch (err) {
      console.error(`Failed to create calendar event from ${att.filename}:`, err);
    }
    return created;
  }

  // Flattens attachments, expanding zip archives into their contained files so
  // each inner PDF/image can be routed through the normal pipeline. Non-zip
  // attachments pass through unchanged. A zip that fails to open is skipped
  // (logged), so one bad archive never aborts the whole email.
  private async expandAttachments(
    attachments: EmailAttachment[],
  ): Promise<EmailAttachment[]> {
    const out: EmailAttachment[] = [];
    for (const att of attachments) {
      const isZip =
        att.mimeType === "application/zip" ||
        att.mimeType === "application/x-zip-compressed" ||
        isZipBuffer(att.content);

      if (!isZip) {
        out.push(att);
        continue;
      }

      try {
        const entries = await this.archive.extract(att.content);
        for (const entry of entries) {
          out.push({
            filename: entry.filename,
            // Let the magic-byte routing decide the real type of each entry.
            mimeType: "application/octet-stream",
            content: entry.content,
          });
        }
      } catch (err) {
        console.error(`Failed to open zip attachment ${att.filename}:`, err);
      }
    }
    return out;
  }
}
