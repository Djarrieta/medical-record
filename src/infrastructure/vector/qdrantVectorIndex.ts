import { QdrantClient } from "@qdrant/js-client-rest";

import type { VectorIndex } from "../../domain/ports";
import type { ChunkMetadata, SearchResult } from "../../domain/types";

const COLLECTION = "documents";
const VECTOR_SIZE = 384;

export class QdrantVectorIndex implements VectorIndex {
  private client: QdrantClient;
  private ready = false;

  constructor(url: string) {
    this.client = new QdrantClient({ url });
  }

  async ensureCollection(): Promise<void> {
    if (this.ready) return;
    const collections = await this.client.getCollections();
    const exists = collections.collections.some((c) => c.name === COLLECTION);
    if (!exists) {
      await this.client.createCollection(COLLECTION, {
        vectors: { size: VECTOR_SIZE, distance: "Cosine" },
      });
    }
    this.ready = true;
  }

  async index(
    chunks: string[],
    vectors: number[][],
    fileId: string,
    fileName: string,
  ): Promise<void> {
    await this.ensureCollection();
    const points = chunks.map((chunk, i) => ({
      id: crypto.randomUUID(),
      vector: vectors[i],
      payload: { text: chunk, fileId, fileName } satisfies ChunkMetadata,
    }));
    await this.client.upsert(COLLECTION, { points });
  }

  async search(
    vector: number[],
    topK = 5,
  ): Promise<SearchResult[]> {
    await this.ensureCollection();
    const result = await this.client.search(COLLECTION, {
      vector,
      limit: topK,
      with_payload: true,
    });
    return result.map((r) => ({
      ...(r.payload as unknown as ChunkMetadata),
      score: r.score ?? 0,
    }));
  }

  async deleteByFileId(fileId: string): Promise<void> {
    await this.ensureCollection();
    await this.client.delete(COLLECTION, {
      filter: {
        must: [{ key: "fileId", match: { value: fileId } }],
      },
    });
  }
}
