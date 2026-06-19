import type { ConversationMessage, FileRecord, SearchResult, Session } from "./types";

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
  delete(id: string, userId: number): boolean;
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
