import type {
  CalendarEvent,
  ConversationMessage,
  FileRecord,
  IncomingEmail,
  Note,
  SearchResult,
  Session,
} from "./types";

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
  // Renames a file's logical name (originalName). The implementation keeps the
  // original extension if `name` does not already include it.
  setOriginalName(id: string, name: string): void;
  // Replaces a file's tags (source of truth in SQLite).
  setTags(id: string, tags: string[]): void;
  // Distinct tags across the user's files (for listing available filters).
  listTags(userId: number): string[];
  delete(id: string, userId: number): boolean;
}

// Produces a short, human-friendly name for a document from its extracted text.
// Returns null when no useful name could be generated (caller keeps the
// existing file name).
export interface Titler {
  generate(text: string, originalName: string): Promise<string | null>;
}

// Extracts a small set of canonical medical tags from a document's text
// (organs/body zones, procedures/exam types, specialty, and the document date
// as a YYYY-MM-DD tag). Best-effort: returns [] when nothing useful is found.
export interface Tagger {
  generate(text: string): Promise<string[]>;
}

// Triage + rewrite for forwarded emails. Decides whether an email's body is
// worth keeping as a note and, if so, rewrites it into a short, clear Spanish
// summary the user can consult later (e.g. "Cita confirmada para el 12 mar",
// "Cita cancelada", "Resultados disponibles"). Returns null when the email
// carries no useful information (marketing, newsletters, automated noise), so
// the caller skips saving it.
export interface EmailNoteSummarizer {
  summarize(subject: string, body: string): Promise<string | null>;
}

export interface TextExtractor {
  tryExtract(buffer: Buffer, password?: string): Promise<string | null>;
}

// Expands an archive (zip) into its contained files. Returns a flat list of
// entries (directories and empty entries skipped). Used to route the files
// inside a forwarded zip through the normal upload pipeline.
export interface ArchiveExtractor {
  extract(buffer: Buffer): Promise<{ filename: string; content: Buffer }[]>;
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
  // Embedding vector size. Valid only after the embedder is initialized.
  dimensions(): number;
}

export interface VectorIndex {
  index(chunks: string[], vectors: number[][], fileId: string, fileName: string, userId: number): Promise<void>;
  search(vector: number[], userId: number, topK?: number, tags?: string[]): Promise<SearchResult[]>;
  // Lexical (full-text) fallback search: matches chunks whose text contains the
  // given terms, ignoring semantic similarity. Used when the dense vector search
  // misses literal keyword matches (e.g. a single word like "hijos"). Returns
  // chunks with score 0 (no relevance ranking).
  searchKeyword(query: string, userId: number, topK?: number, tags?: string[]): Promise<SearchResult[]>;
  deleteByFileId(fileId: string, userId: number): Promise<void>;
  // Update the fileName payload of every chunk of a file, so the vector index
  // stays in sync when the document is renamed (e.g. to an LLM-generated title).
  renameFile(fileId: string, fileName: string, userId: number): Promise<void>;
  // Update the tags payload of every chunk of a document, keeping the vector
  // index in sync with the source of truth in SQLite.
  setTags(fileId: string, tags: string[], userId: number): Promise<void>;
}

export interface PasswordVault {
  add(password: string): void;
  getAll(): string[];
  // Stored passwords with their row id, so callers (e.g. the web UI) can list
  // and delete individual entries.
  list(): { id: number; password: string }[];
  // Removes a single stored password by id. Returns true when a row was deleted.
  remove(id: number): boolean;
  count(): number;
  clear(): void;
}

// Persists free-form text notes (separate from documents). Notes are still
// embedded into the vector index so RAG can retrieve them.
export interface NoteRepository {
  save(userId: number, text: string, title: string): Note;
  list(userId: number): Note[];
  get(id: string, userId: number): Note | null;
  // Replaces a note's body and title. Returns false when the note does not
  // exist for that user.
  update(id: string, userId: number, text: string, title: string): boolean;
  // Replaces a note's tags (source of truth in SQLite).
  setTags(id: string, tags: string[]): void;
  // Distinct tags across the user's notes (for listing available filters).
  listTags(userId: number): string[];
  delete(id: string, userId: number): boolean;
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

// Driver port: a source of new emails. Implemented by GmailApiSource.
export interface EmailSource {
  // Recent emails within the configured day-window. Dedup is handled downstream
  // (ProcessedEmailLog), so this may return mail already ingested. The
  // implementation handles auth, paging, HTML→text and attachment decoding.
  fetchRecent(): Promise<IncomingEmail[]>;
}

// Tiny dedup log so the poller never re-ingests the same Gmail message.
export interface ProcessedEmailLog {
  has(providerId: string): boolean;
  mark(providerId: string): void;
}

// Creates appointments on an external calendar. Implemented by
// GoogleCalendarService. Optional — only wired when calendar is enabled.
export interface CalendarService {
  // Creates an event and returns its id + a link so the caller can confirm it
  // to the user.
  createEvent(event: CalendarEvent): Promise<{ id: string; htmlLink: string }>;
}

// Transcribes audio to text. Implemented by WhisperTranscriber.
export interface Transcriber {
  transcribe(audioBuffer: Buffer, mimeType: string): Promise<string>;
}
