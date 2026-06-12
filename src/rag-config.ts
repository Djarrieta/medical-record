/**
 * RAG tuning constants (split from config.ts to avoid env-var validation at import time).
 */

export const rag = {
  chunkTargetTokens: 350,
  chunkOverlapTokens: 64,
  maxChunkTokens: 480,
  topK: 6,
} as const;
