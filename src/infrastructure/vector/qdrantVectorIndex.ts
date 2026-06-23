import { QdrantClient } from "@qdrant/js-client-rest";

import type { VectorIndex } from "../../domain/ports";
import type { ChunkMetadata, SearchResult } from "../../domain/types";

const COLLECTION = "documents";

export class QdrantVectorIndex implements VectorIndex {
  private client: QdrantClient;
  private ready = false;
  private readonly vectorSize: number;

  constructor(url: string, vectorSize: number) {
    this.client = new QdrantClient({ url });
    this.vectorSize = vectorSize;
  }

  async ensureCollection(): Promise<void> {
    if (this.ready) return;
    const collections = await this.client.getCollections();
    const exists = collections.collections.some((c) => c.name === COLLECTION);
    if (!exists) {
      await this.client.createCollection(COLLECTION, {
        vectors: { size: this.vectorSize, distance: "Cosine" },
      });
    }
    // Payload index on userId so per-user filters stay efficient.
    await this.client
      .createPayloadIndex(COLLECTION, { field_name: "userId", field_schema: "integer" })
      .catch(() => {});
    // Payload index on tags so tag filters stay efficient.
    await this.client
      .createPayloadIndex(COLLECTION, { field_name: "tags", field_schema: "keyword" })
      .catch(() => {});
    // Full-text payload index on the chunk text, enabling the lexical fallback
    // search (searchKeyword) to match literal keywords the dense search misses.
    await this.client
      .createPayloadIndex(COLLECTION, {
        field_name: "text",
        field_schema: { type: "text", tokenizer: "word", lowercase: true },
      })
      .catch(() => {});
    this.ready = true;
  }

  async index(
    chunks: string[],
    vectors: number[][],
    fileId: string,
    fileName: string,
    userId: number,
  ): Promise<void> {
    await this.ensureCollection();
    const points = chunks.map((chunk, i) => ({
      id: crypto.randomUUID(),
      vector: vectors[i],
      // Tags start empty; the indexing use case fills them via setTags once the
      // document text (incl. OCR) is known, mirroring how the title is applied.
      payload: { text: chunk, fileId, fileName, userId, tags: [] } satisfies ChunkMetadata,
    }));
    await this.client.upsert(COLLECTION, { points });
  }

  async search(
    vector: number[],
    userId: number,
    topK = 5,
    tags?: string[],
  ): Promise<SearchResult[]> {
    await this.ensureCollection();
    const must: Record<string, unknown>[] = [{ key: "userId", match: { value: userId } }];
    if (tags && tags.length > 0) {
      must.push({ key: "tags", match: { any: tags } });
    }
    const result = await this.client.search(COLLECTION, {
      vector,
      limit: topK,
      with_payload: true,
      filter: { must },
    });
    return result.map((r) => ({
      ...(r.payload as unknown as ChunkMetadata),
      score: r.score ?? 0,
    }));
  }

  async searchKeyword(
    query: string,
    userId: number,
    topK = 5,
    tags?: string[],
  ): Promise<SearchResult[]> {
    await this.ensureCollection();
    const text = query.trim();
    if (!text) return [];
    const must: Record<string, unknown>[] = [
      { key: "userId", match: { value: userId } },
      // Full-text match: returns chunks whose text contains the query terms.
      { key: "text", match: { text } },
    ];
    if (tags && tags.length > 0) {
      must.push({ key: "tags", match: { any: tags } });
    }
    const result = await this.client.scroll(COLLECTION, {
      limit: topK,
      with_payload: true,
      with_vector: false,
      filter: { must },
    });
    return result.points.map((p) => ({
      ...(p.payload as unknown as ChunkMetadata),
      score: 0,
    }));
  }

  async deleteByFileId(fileId: string, userId: number): Promise<void> {
    await this.ensureCollection();
    await this.client.delete(COLLECTION, {
      filter: {
        must: [
          { key: "fileId", match: { value: fileId } },
          { key: "userId", match: { value: userId } },
        ],
      },
    });
  }

  async renameFile(fileId: string, fileName: string, userId: number): Promise<void> {
    await this.ensureCollection();
    await this.client.setPayload(COLLECTION, {
      payload: { fileName },
      filter: {
        must: [
          { key: "fileId", match: { value: fileId } },
          { key: "userId", match: { value: userId } },
        ],
      },
    });
  }

  async setTags(fileId: string, tags: string[], userId: number): Promise<void> {
    await this.ensureCollection();
    await this.client.setPayload(COLLECTION, {
      payload: { tags },
      filter: {
        must: [
          { key: "fileId", match: { value: fileId } },
          { key: "userId", match: { value: userId } },
        ],
      },
    });
  }
}
