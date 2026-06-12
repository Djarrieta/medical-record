/**
 * Text chunking for the RAG pipeline (plan §6).
 *
 * Targets ~350-token chunks with ~64-token overlap, kept under the e5 512-token limit.
 * Token counts are approximated here; `embeddings.ts` re-checks against the model's real
 * tokenizer and hard-truncates before encoding, so this only needs to be a good estimate.
 */

import { rag } from "../rag-config.ts";

export interface SourceText {
  page: number;
  text: string;
}

export interface Chunk {
  page: number;
  text: string;
}

/** Rough token estimate: e5/BERT-style WordPiece averages ~1.3 tokens per whitespace word. */
export function estimateTokens(text: string): number {
  const words = text.trim().split(/\s+/).filter(Boolean).length;
  return Math.ceil(words * 1.3);
}

function splitSentences(text: string): string[] {
  // Split on sentence-ish boundaries while keeping Spanish punctuation intact.
  return text
    .replace(/\s+/g, " ")
    .split(/(?<=[.!?¿¡;:\n])\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

function chunkPageText(page: number, text: string): Chunk[] {
  const sentences = splitSentences(text);
  const chunks: Chunk[] = [];

  let current: string[] = [];
  let currentTokens = 0;

  const flush = () => {
    if (current.length === 0) return;
    chunks.push({ page, text: current.join(" ").trim() });
    // Build overlap from the tail of the current chunk.
    const overlap: string[] = [];
    let overlapTokens = 0;
    for (let i = current.length - 1; i >= 0; i--) {
      const t = estimateTokens(current[i]!);
      if (overlapTokens + t > rag.chunkOverlapTokens) break;
      overlap.unshift(current[i]!);
      overlapTokens += t;
    }
    current = overlap;
    currentTokens = overlapTokens;
  };

  for (const sentence of sentences) {
    const sentenceTokens = estimateTokens(sentence);

    // A single very long sentence: hard-split by words to respect the max.
    if (sentenceTokens > rag.maxChunkTokens) {
      flush();
      if (current.length > 0) flush();
      const words = sentence.split(/\s+/);
      let buf: string[] = [];
      let bufTokens = 0;
      for (const w of words) {
        const wt = estimateTokens(w);
        if (bufTokens + wt > rag.chunkTargetTokens && buf.length > 0) {
          chunks.push({ page, text: buf.join(" ") });
          buf = [];
          bufTokens = 0;
        }
        buf.push(w);
        bufTokens += wt;
      }
      if (buf.length > 0) chunks.push({ page, text: buf.join(" ") });
      continue;
    }

    if (currentTokens + sentenceTokens > rag.chunkTargetTokens && current.length > 0) {
      flush();
    }
    current.push(sentence);
    currentTokens += sentenceTokens;
  }

  if (current.length > 0) {
    chunks.push({ page, text: current.join(" ").trim() });
  }

  return chunks.filter((c) => c.text.length > 0);
}

/** Chunk a set of page texts, preserving page metadata for citations. */
export function chunkDocument(pages: SourceText[]): Chunk[] {
  const all: Chunk[] = [];
  for (const p of pages) {
    if (!p.text || p.text.trim().length === 0) continue;
    all.push(...chunkPageText(p.page, p.text));
  }
  return all;
}
