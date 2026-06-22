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
}

export interface ChunkMetadata {
  text: string;
  fileId: string;
  fileName: string;
  userId: number;
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
