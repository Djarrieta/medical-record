/**
 * Vector store wrapper around the sqlite-vec `vectors` table (plan §4, §6).
 * Every operation is scoped by `user_id` for isolation.
 */

import { getDb } from "../storage/db.ts";

export interface ScoredChunk {
  chunk_id: string;
  doc_id: string;
  page: number;
  text: string;
  filename: string;
  distance: number;
}

/** Insert embeddings for a set of chunks. Vectors are stored as JSON arrays (sqlite-vec). */
export function upsertVectors(
  userId: number,
  rows: { chunkId: string; embedding: number[] }[],
): void {
  if (rows.length === 0) return;
  const db = getDb();
  const stmt = db.query(
    `INSERT INTO vectors (chunk_id, user_id, embedding) VALUES (?, ?, ?)`,
  );
  const tx = db.transaction((items: typeof rows) => {
    for (const r of items) {
      stmt.run(r.chunkId, userId, JSON.stringify(r.embedding));
    }
  });
  tx(rows);
}

/**
 * k-NN search over a user's vectors (cosine distance), joined back to chunk text + filename.
 * Filtered by user_id so results never cross users.
 */
export function search(userId: number, queryEmbedding: number[], k: number): ScoredChunk[] {
  const db = getDb();
  return db
    .query<ScoredChunk, [string, number, number]>(
      `SELECT v.chunk_id        AS chunk_id,
              c.doc_id          AS doc_id,
              c.page            AS page,
              c.text            AS text,
              d.filename        AS filename,
              v.distance        AS distance
         FROM vectors v
         JOIN chunks c    ON c.chunk_id = v.chunk_id
         JOIN documents d ON d.doc_id = c.doc_id
        WHERE v.embedding MATCH ?
          AND v.user_id = ?
          AND k = ?
        ORDER BY v.distance`,
    )
    .all(JSON.stringify(queryEmbedding), userId, k);
}
