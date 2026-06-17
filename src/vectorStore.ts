import { QdrantClient } from "@qdrant/js-client-rest";

const COLLECTION = "documents";
const VECTOR_SIZE = 384;

export class QdrantStore {
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

  async index(chunks: string[], vectors: number[][]): Promise<void> {
    await this.ensureCollection();
    const points = chunks.map((chunk, i) => ({
      id: crypto.randomUUID(),
      vector: vectors[i],
      payload: { text: chunk },
    }));
    await this.client.upsert(COLLECTION, { points });
  }

  async search(
    vector: number[],
    topK = 5,
  ): Promise<{ text: string; score: number }[]> {
    await this.ensureCollection();
    const result = await this.client.search(COLLECTION, {
      vector,
      limit: topK,
      with_payload: true,
    });
    return result.map((r) => ({
      text: (r.payload as { text: string }).text,
      score: r.score ?? 0,
    }));
  }
}
