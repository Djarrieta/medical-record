import type { Chunker, Embedder, VectorIndex } from "../domain/ports";

export interface EmbedAndIndexDeps {
  chunker: Chunker;
  embedder: Embedder;
  vectorIndex: VectorIndex;
}

// Shared tail of every "index X" use case (PDF, image, note): split the text
// into chunks, drop empty ones, then embed and store them in the vector index
// under (fileId, fileName, userId).
//
// Returns true if anything was indexed, false when the text yielded no usable
// chunks (e.g. a scanned page with no extractable text).
export async function embedAndIndex(
  deps: EmbedAndIndexDeps,
  text: string,
  fileId: string,
  fileName: string,
  userId: number,
): Promise<boolean> {
  const chunks = (await deps.chunker.split(text)).filter((c) => c.trim().length > 0);
  if (chunks.length === 0) return false;

  const vectors = await deps.embedder.embed(chunks);
  await deps.vectorIndex.index(chunks, vectors, fileId, fileName, userId);
  return true;
}
