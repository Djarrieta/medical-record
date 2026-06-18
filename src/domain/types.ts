export interface FileRecord {
  id: string;
  userId: number;
  originalName: string;
  mimeType: string;
  size: number;
  path: string;
  createdAt: string;
}

export interface PendingPassword {
  recordId: string;
  fileName: string;
}

export interface ChunkMetadata {
  text: string;
  fileId: string;
  fileName: string;
}

export type SearchResult = ChunkMetadata & { score: number };
