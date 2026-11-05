/**
 * Pure evaluation metrics for information retrieval.
 *
 * All functions are pure, deterministic, and handle edge cases gracefully:
 * - Empty relevantIds: returns null (excluded from retrieval averages)
 * - Empty retrievedIds: scores 0
 */

/**
 * Recall@K: Proportion of relevant documents retrieved in the top K positions.
 * Recall@K = |Retrieved@K ∩ Relevant| / |Relevant|
 */
export function recallAtK(retrievedIds: string[], relevantIds: string[], k: number): number | null {
  if (relevantIds.length === 0) {
    return null;
  }
  const topK = retrievedIds.slice(0, k);
  const relevantSet = new Set(relevantIds);
  let hits = 0;
  for (const id of topK) {
    if (relevantSet.has(id)) {
      hits++;
    }
  }
  return hits / relevantIds.length;
}

/**
 * Mean Reciprocal Rank (MRR): Reciprocal rank (1 / rank) of the FIRST relevant hit in retrievedIds.
 * Ranks are 1-based.
 */
export function mrr(retrievedIds: string[], relevantIds: string[]): number | null {
  if (relevantIds.length === 0) {
    return null;
  }
  const relevantSet = new Set(relevantIds);
  for (let i = 0; i < retrievedIds.length; i++) {
    if (relevantSet.has(retrievedIds[i])) {
      return 1 / (i + 1);
    }
  }
  return 0;
}

/**
 * Normalized Discounted Cumulative Gain (NDCG@K) with binary relevance.
 */
export function ndcgAtK(retrievedIds: string[], relevantIds: string[], k: number): number | null {
  if (relevantIds.length === 0) {
    return null;
  }
  const topK = retrievedIds.slice(0, k);
  const relevantSet = new Set(relevantIds);

  let dcg = 0;
  for (let i = 0; i < topK.length; i++) {
    if (relevantSet.has(topK[i])) {
      dcg += 1 / Math.log2(i + 2);
    }
  }

  const idealHits = Math.min(k, relevantIds.length);
  let idcg = 0;
  for (let i = 0; i < idealHits; i++) {
    idcg += 1 / Math.log2(i + 2);
  }

  if (idcg === 0) {
    return 0;
  }
  return dcg / idcg;
}

/**
 * HitRate@K: 1 if at least one relevant document is retrieved in top K, else 0.
 */
export function hitRateAtK(
  retrievedIds: string[],
  relevantIds: string[],
  k: number
): number | null {
  if (relevantIds.length === 0) {
    return null;
  }
  const topK = retrievedIds.slice(0, k);
  const relevantSet = new Set(relevantIds);
  for (const id of topK) {
    if (relevantSet.has(id)) {
      return 1;
    }
  }
  return 0;
}
