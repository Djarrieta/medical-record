export interface FileRecord {
  id: string;
  userId: number;
  originalName: string;
  mimeType: string;
  size: number;
  path: string;
  createdAt: string;
  indexed: boolean;
  // SHA-256 hex digest of the file's content, used for duplicate detection.
  hash: string;
  // Free-form medical tags (lowercase, deduped). May include a YYYY-MM-DD date.
  tags: string[];
}

export interface PendingPassword {
  recordId: string;
  fileName: string;
}

// A free-form text note. Lives in its own `notes` table (not a FileRecord) but
// is still chunked + embedded so RAG can retrieve it.
export interface Note {
  id: string;
  userId: number;
  title: string;
  text: string;
  createdAt: string;
  // Free-form medical tags (lowercase, deduped). May include a YYYY-MM-DD date.
  tags: string[];
}

export interface ChunkMetadata {
  text: string;
  fileId: string;
  fileName: string;
  userId: number;
  // Document-level tags mirrored onto every chunk so search can filter by them.
  tags: string[];
}

export type SearchResult = ChunkMetadata & { score: number };

export interface ConversationMessage {
  role: "user" | "assistant";
  content: string;
  createdAt: string;
}

export interface Session {
  userId: number;
  token: string;
  createdAt: string;
  lastActivityAt: string;
  warned: boolean;
}

export interface EmailAttachment {
  filename: string;
  mimeType: string;
  content: Buffer; // raw bytes, already used across the domain ports
}

// An email fetched from the shared mailbox, ready for attribution + ingestion.
// Dedup (by providerId) happens downstream, so the same message may appear in
// more than one fetch.
export interface IncomingEmail {
  providerId: string; // Gmail message id — used for dedup, never re-ingest
  from: string; // forwarder address, lowercased/trimmed
  subject: string;
  body: string; // plain-text body (HTML stripped via html-to-text)
  receivedAt: string; // ISO date
  attachments: EmailAttachment[];
}

// A calendar appointment to create. Times are ISO 8601 strings interpreted in
// `timeZone`. No reminders are configured (the user opted out).
export interface CalendarEvent {
  title: string;
  description?: string;
  startIso: string; // ISO 8601 (with offset or local + timeZone)
  endIso: string; // if the caller has no duration, defaults to +1h over start
  timeZone: string; // e.g. "America/Bogota"
}
