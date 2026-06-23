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

export interface Password {
  id: number;
  password: string;
}

export interface ChatSource {
  id: string;
  name: string;
}

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  sources?: ChatSource[];
}

export interface UploadResult {
  ok: boolean;
  expired?: boolean;
  duplicate?: boolean;
  indexed?: boolean;
  reason?: string;
  error?: string;
}
