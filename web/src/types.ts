export interface FileRecord {
  id: string;
  originalName: string;
  title?: string;
  mimeType: string;
  size: number;
  createdAt: string;
  indexed: boolean;
  tags?: string[];
}

export interface Note {
  id: string;
  title?: string;
  text: string;
  tags?: string[];
  createdAt?: string;
}

export type TagKind = "file" | "note";

export interface UploadResult {
  ok: boolean;
  expired?: boolean;
  duplicate?: boolean;
  indexed?: boolean;
  reason?: string;
  error?: string;
}
