import type { FileRecord, SearchResult } from "./types";

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
  list(): FileRecord[];
  get(id: string): FileRecord | null;
  delete(id: string): boolean;
}

export interface TextExtractor {
  tryExtract(buffer: Buffer, password?: string): Promise<string | null>;
}

export interface Chunker {
  split(text: string): Promise<string[]>;
}

export interface Embedder {
  embed(texts: string[]): Promise<number[][]>;
  embedQuery(text: string): Promise<number[]>;
}

export interface VectorIndex {
  index(chunks: string[], vectors: number[][], fileId: string, fileName: string): Promise<void>;
  search(vector: number[], topK?: number): Promise<SearchResult[]>;
  deleteByFileId(fileId: string): Promise<void>;
}

export interface PasswordVault {
  add(password: string): void;
  getAll(): string[];
}

export interface Llm {
  complete(prompt: string): Promise<string>;
}
