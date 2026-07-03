import { google, type gmail_v1 } from "googleapis";
import { convert as htmlToText } from "html-to-text";

import type { EmailSource } from "../../domain/ports";
import type { EmailAttachment, IncomingEmail } from "../../domain/types";
import type { GoogleOAuthClient } from "../google/googleAuth";

// Driver adapter: reads recent messages from a dedicated Gmail mailbox via the
// Gmail API. Read-only — it never modifies read state or labels. Dedup is the
// caller's job (ProcessedEmailLog), so fetchRecent may return mail already
// ingested within the day-window.
export class GmailApiSource implements EmailSource {
  private readonly gmail: gmail_v1.Gmail;

  constructor(
    auth: GoogleOAuthClient,
    private readonly queryDays: number,
  ) {
    this.gmail = google.gmail({ version: "v1", auth });
  }

  async fetchRecent(): Promise<IncomingEmail[]> {
    const ids = await this.listMessageIds();
    const emails: IncomingEmail[] = [];
    for (const id of ids) {
      const email = await this.fetchMessage(id);
      if (email) emails.push(email);
    }
    return emails;
  }

  // Page through every message id within the configured day-window.
  private async listMessageIds(): Promise<string[]> {
    const q = `newer_than:${this.queryDays}d`;
    const ids: string[] = [];
    let pageToken: string | undefined;
    do {
      const res = await this.gmail.users.messages.list({
        userId: "me",
        q,
        pageToken,
      });
      for (const m of res.data.messages ?? []) {
        if (m.id) ids.push(m.id);
      }
      pageToken = res.data.nextPageToken ?? undefined;
    } while (pageToken);
    return ids;
  }

  private async fetchMessage(id: string): Promise<IncomingEmail | null> {
    const res = await this.gmail.users.messages.get({
      userId: "me",
      id,
      format: "full",
    });
    const msg = res.data;
    const payload = msg.payload;
    if (!payload) return null;

    const headers = payload.headers ?? [];
    const from = parseFromAddress(headerValue(headers, "From"));
    const subject = headerValue(headers, "Subject") ?? "";
    const dateHeader = headerValue(headers, "Date");
    const receivedAt = toIso(dateHeader, msg.internalDate);

    const body = extractBody(payload);
    const attachments = await this.extractAttachments(id, payload);

    return { providerId: id, from, subject, body, receivedAt, attachments };
  }

  // Walk the MIME tree and download every part that carries an attachmentId.
  private async extractAttachments(
    messageId: string,
    payload: gmail_v1.Schema$MessagePart,
  ): Promise<EmailAttachment[]> {
    const out: EmailAttachment[] = [];
    const walk = async (part: gmail_v1.Schema$MessagePart): Promise<void> => {
      const attachmentId = part.body?.attachmentId;
      if (attachmentId && part.filename) {
        const res = await this.gmail.users.messages.attachments.get({
          userId: "me",
          messageId,
          id: attachmentId,
        });
        const data = res.data.data;
        if (data) {
          out.push({
            filename: part.filename,
            mimeType: part.mimeType ?? "application/octet-stream",
            content: Buffer.from(data, "base64url"),
          });
        }
      }
      for (const child of part.parts ?? []) await walk(child);
    };
    await walk(payload);
    return out;
  }
}

function headerValue(
  headers: gmail_v1.Schema$MessagePartHeader[],
  name: string,
): string | undefined {
  const lower = name.toLowerCase();
  return headers.find((h) => (h.name ?? "").toLowerCase() === lower)?.value ?? undefined;
}

// "Display Name <addr@x.com>" → "addr@x.com" (lowercased/trimmed). Falls back to
// the whole header when there are no angle brackets.
function parseFromAddress(raw: string | undefined): string {
  if (!raw) return "";
  const match = raw.match(/<([^>]+)>/);
  const addr = match ? match[1] : raw;
  return addr.trim().toLowerCase();
}

function toIso(dateHeader: string | undefined, internalDate: string | null | undefined): string {
  if (dateHeader) {
    const d = new Date(dateHeader);
    if (!Number.isNaN(d.getTime())) return d.toISOString();
  }
  if (internalDate) {
    const ms = Number(internalDate);
    if (Number.isFinite(ms)) return new Date(ms).toISOString();
  }
  return new Date().toISOString();
}

// Prefer the text/plain part; fall back to text/html stripped via html-to-text.
function extractBody(payload: gmail_v1.Schema$MessagePart): string {
  const plain = findPart(payload, "text/plain");
  if (plain) return decodePartData(plain);

  const html = findPart(payload, "text/html");
  if (html) {
    const rawHtml = decodePartData(html);
    return htmlToText(rawHtml, { wordwrap: false }).trim();
  }
  return "";
}

// First part of the given MIME type that actually carries body data, ignoring
// attachment parts.
function findPart(
  part: gmail_v1.Schema$MessagePart,
  mimeType: string,
): gmail_v1.Schema$MessagePart | null {
  if (part.mimeType === mimeType && part.body?.data && !part.body.attachmentId) return part;
  for (const child of part.parts ?? []) {
    const found = findPart(child, mimeType);
    if (found) return found;
  }
  return null;
}

function decodePartData(part: gmail_v1.Schema$MessagePart): string {
  const data = part.body?.data;
  if (!data) return "";
  return Buffer.from(data, "base64url").toString("utf-8");
}
