import { pipeline } from "@huggingface/transformers";
import type { FeatureExtractionPipeline } from "@huggingface/transformers";

import type { Embedder } from "../../domain/ports";
export class TransformersEmbedder implements Embedder {
  private pipe: FeatureExtractionPipeline | null = null;
  private modelName: string;
  private cacheDir: string;
  private dim = 0;

  constructor(modelName: string, cacheDir: string) {
    this.modelName = modelName;
    this.cacheDir = cacheDir;
  }

  async initialize(): Promise<void> {
    this.pipe = await pipeline("feature-extraction", this.modelName, {
      cache_dir: this.cacheDir,
    }) as unknown as FeatureExtractionPipeline;
    // Probe the model once so the vector dimension is derived from the model
    // itself (the single source of truth) instead of a hardcoded constant.
    this.dim = (await this.embedQuery("dimension probe")).length;
  }

  dimensions(): number {
    if (this.dim === 0) throw new Error("EmbeddingProvider not initialized");
    return this.dim;
  }

  async embed(texts: string[]): Promise<number[][]> {
    if (!this.pipe) throw new Error("EmbeddingProvider not initialized");
    const prefixed = texts.map((t) => `passage: ${t}`);
    const result = await this.pipe(prefixed, {
      pooling: "mean",
      normalize: true,
    });
    return result.tolist();
  }

  async embedQuery(text: string): Promise<number[]> {
    if (!this.pipe) throw new Error("EmbeddingProvider not initialized");
    const result = await this.pipe(`query: ${text}`, {
      pooling: "mean",
      normalize: true,
    });
    return result.tolist()[0];
  }
}
