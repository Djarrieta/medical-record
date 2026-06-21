import type { ConversationMessage, FileRecord, MailMessage, Note, SearchResult, Session } from "./types";

// Ports = interfaces the domain/application need. Infrastructure implements them.
// Dependencies point inward: use cases depend on these, never on concrete adapters.

export interface DocumentRepository {
  save(userId: number, originalName: string, mimeType: string, buffer: Buffer): Promise<FileRecord>;
  saveStream(
    userId: number,
    originalName: string,
    mimeType: string,
    stream: ReadableStream,
  ): Promise<FileRecord>;
  list(userId: number): FileRecord[];
  get(id: string, userId: number): FileRecord | null;
  // Returns an existing record (owned by `userId`) whose content matches `buffer`
  // (by SHA-256), or null.
  findByContent(buffer: Buffer, userId: number): FileRecord | null;
  setIndexed(id: string, indexed: boolean): void;
  setTitle(id: string, title: string): void;
  delete(id: string, userId: number): boolean;
}

// Produces a short, human-friendly title for a document from its extracted
// text. Returns null when no useful title could be generated (caller keeps the
// existing fallback, e.g. the original file name).
export interface Titler {
  generate(text: string, originalName: string): Promise<string | null>;
}

export interface TextExtractor {
  tryExtract(buffer: Buffer, password?: string): Promise<string | null>;
}

export interface Chunker {
  split(text: string): Promise<string[]>;
}

export interface Ocr {
  // Extract text from a scanned/image-only PDF via OCR.
  // `password` is forwarded to the rasterizer for encrypted PDFs.
  extract(buffer: Buffer, password?: string): Promise<string>;
}

export interface Embedder {
  embed(texts: string[]): Promise<number[][]>;
  embedQuery(text: string): Promise<number[]>;
}

export interface VectorIndex {
  index(chunks: string[], vectors: number[][], fileId: string, fileName: string, userId: number): Promise<void>;
  search(vector: number[], userId: number, topK?: number): Promise<SearchResult[]>;
  deleteByFileId(fileId: string, userId: number): Promise<void>;
}

export interface PasswordVault {
  add(password: string): void;
  getAll(): string[];
}

// Persists free-form text notes (separate from documents). Notes are still
// embedded into the vector index so RAG can retrieve them.
export interface NoteRepository {
  save(userId: number, text: string, title: string): Note;
  list(userId: number): Note[];
  get(id: string, userId: number): Note | null;
  delete(id: string, userId: number): boolean;
}

// User-controlled allowlist of email senders whose messages get ingested.
// Entries are either a full address (exact match) or a domain starting with
// "@" (suffix match), e.g. "@sura.com".
export interface SenderAllowlist {
  add(entry: string): void;
  remove(entry: string): void;
  list(): string[];
  matches(fromAddress: string): boolean;
}

// Reads messages from a mailbox (e.g. Outlook/Hotmail via Microsoft Graph),
// normalized to the domain's MailMessage shape. `stopAtProcessed` lets the
// adapter stop paginating once it reaches an already-handled message (messages
// come newest-first), so steady-state polls stay cheap while the first run
// backfills all history.
export interface MailSource {
  fetchMessages(opts: { stopAtProcessed?: (id: string) => boolean }): Promise<MailMessage[]>;
}

// Tracks which mail message IDs have already been ingested, so reprocessing
// never duplicates documents/notes.
export interface ProcessedMessages {
  has(id: string): boolean;
  add(id: string): void;
}

// One conversation/session per user. Backs both the multi-turn chat memory
// (Telegram) and the expiring web upload token. Implementations live in
// infrastructure and must stay framework-agnostic.
export interface SessionStore {
  // Creates a session with a fresh random token if none is active; otherwise
  // returns the current one.
  getOrCreate(userId: number): Session;
  // Validates a web link token. Returns null if there is no active session or
  // the token does not match.
  getByToken(userId: number, token: string): Session | null;
  // Marks activity: creates the session if missing, resets lastActivityAt and
  // clears the warning flag. Returns the live session.
  touch(userId: number): Session;
  appendMessage(userId: number, msg: ConversationMessage): void;
  history(userId: number): ConversationMessage[];
  // Clears history and invalidates the token (removes the session).
  close(userId: number): void;
  dueForWarning(now: number): Session[];
  dueForClose(now: number): Session[];
  markWarned(userId: number): void;
}

// A tool the LLM can call during an agentic answer (function calling).
// `parameters` is a JSON Schema describing the arguments object.
export interface Tool {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  execute(args: Record<string, unknown>): Promise<string>;
}

export interface Llm {
  // Agentic answer: the model may call the provided tools as many times as it
  // needs before producing a final natural-language reply. `history` carries the
  // prior turns of the conversation (oldest first), excluding the current one.
  answer(
    systemPrompt: string,
    history: ConversationMessage[],
    userMessage: string,
    tools: Tool[],
  ): Promise<string>;
}
