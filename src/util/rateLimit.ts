/**
 * Simple in-memory per-user rate limiter (sliding window) for Q&A (plan §9, §12).
 */

const hits = new Map<number, number[]>();

/**
 * Returns true if the action is allowed (and records it). `limit` actions per `windowMs`.
 */
export function allow(userId: number, limit: number, windowMs = 3_600_000): boolean {
  const now = Date.now();
  const since = now - windowMs;
  const arr = (hits.get(userId) ?? []).filter((t) => t > since);
  if (arr.length >= limit) {
    hits.set(userId, arr);
    return false;
  }
  arr.push(now);
  hits.set(userId, arr);
  return true;
}
