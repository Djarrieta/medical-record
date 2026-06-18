import { pipeline } from "@huggingface/transformers";
import type { FeatureExtractionPipeline } from "@huggingface/transformers";
import { join } from "path";

import type { Embedder } from "../../domain/ports";

export class TransformersEmbedder implements Embedder {
  private pipe: FeatureExtractionPipeline | null = null;
  private modelName: string;
  private cacheDir: string;

  constructor(modelName: string, cacheDir: string) {
    this.modelName = modelName;
    this.cacheDir = cacheDir;
  }

  async initialize(): Promise<void> {
    this.pipe = await pipeline("feature-extraction", this.modelName, {
      cache_dir: this.cacheDir,
    }) as unknown as FeatureExtractionPipeline;
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
