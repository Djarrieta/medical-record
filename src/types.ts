export interface PendingPassword {
  recordId: string;
  fileName: string;
}

export interface FileRecord {
  id: string;
  userId: number;
  originalName: string;
  mimeType: string;
  size: number;
  path: string;
  createdAt: string;
}

export interface BotConfig {
  botToken: string;
  allowedUserId: number;
  deepseekApiKey?: string;
  deepseekModel: string;
  deepseekBaseUrl: string;
  dataDir: string;
  qdrantUrl: string;
  embeddingModel: string;
}
