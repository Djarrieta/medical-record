/**
 * Local text embeddings via transformers.js (plan §3, §6).
 *
 * Model: multilingual-e5-small (384-dim). e5 requires task prefixes:
 *   - documents/passages → "passage: ..."
 *   - search queries      → "query: ..."
 * Vectors are mean-pooled and L2-normalized so cosine == dot product.
 *
 * The model is cached under MODEL_CACHE_DIR so first run works offline once warmed.
 */

import { config } from "../config.ts";
import { createLogger } from "../util/logger.ts";

const log = createLogger("embeddings");

// Lazy import + init so startup doesn't block on model load.
type Extractor = (
  input: string | string[],
  opts: { pooling: "mean"; normalize: boolean },
) => Promise<{ tolist: () => number[][] }>;

let extractorPromise: Promise<Extractor> | null = null;

async function getExtractor(): Promise<Extractor> {
  if (!extractorPromise) {
    extractorPromise = (async () => {
      const { pipeline, env } = await import("@huggingface/transformers");
      env.cacheDir = config.embeddings.cacheDir;
      env.allowRemoteModels = true;
      log.info(`Loading embedding model ${config.embeddings.model}`);
      const extractor = (await pipeline(
        "feature-extraction",
        config.embeddings.model,
      )) as unknown as Extractor;
      log.info("Embedding model ready");
      return extractor;
    })();
  }
  return extractorPromise;
}

async function embedPrefixed(texts: string[]): Promise<number[][]> {
  if (texts.length === 0) return [];
  const extractor = await getExtractor();
  const output = await extractor(texts, { pooling: "mean", normalize: true });
  return output.tolist();
}

/** Embed document chunks (adds the "passage: " prefix). */
export async function embedPassages(texts: string[]): Promise<number[][]> {
  return embedPrefixed(texts.map((t) => `passage: ${t}`));
}

/** Embed a single search query (adds the "query: " prefix). */
export async function embedQuery(text: string): Promise<number[]> {
  const [vec] = await embedPrefixed([`query: ${text}`]);
  if (!vec) throw new Error("Embedding failed for query");
  return vec;
}

/** Embed passages in batches to bound memory on large documents. */
export async function embedPassagesBatched(
  texts: string[],
  batchSize = 16,
): Promise<number[][]> {
  const out: number[][] = [];
  for (let i = 0; i < texts.length; i += batchSize) {
    const batch = texts.slice(i, i + batchSize);
    out.push(...(await embedPassages(batch)));
  }
  return out;
}
