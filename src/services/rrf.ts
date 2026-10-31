export interface MemoryRecord {
  id: string;
  text: string;
  metadata: Record<string, unknown>;
  embedding?: number[];
  created_at: string;
  updated_at: string;
}

export interface ScoredMemory extends MemoryRecord {
  score: number;
  vectorRank?: number;
  textRank?: number;
}

/**
 * Combines ranked lists from multiple search strategies using Reciprocal Rank Fusion (RRF).
 * Formula: RRF_score(d) = sum_{s in strategies} (1 / (k + rank_s(d)))
 * where rank is 1-indexed.
 *
 * @param vectorResults Results ordered by vector cosine similarity
 * @param textResults Results ordered by full-text search rank
 * @param k Constant smoothing parameter, typically 60 (standard Cormack et al. setting)
 * @param topK Number of fused results to return
 */
export function reciprocalRankFusion(
  vectorResults: MemoryRecord[],
  textResults: MemoryRecord[],
  k = 60,
  topK = 5
): ScoredMemory[] {
  const scoreMap = new Map<
    string,
    {
      record: MemoryRecord;
      rrfScore: number;
      vectorRank?: number;
      textRank?: number;
    }
  >();

  // Process vector ranking (rank is 1-based)
  vectorResults.forEach((record, index) => {
    const rank = index + 1;
    const rrfContribution = 1 / (k + rank);
    const existing = scoreMap.get(record.id);
    if (existing) {
      existing.rrfScore += rrfContribution;
      existing.vectorRank = rank;
    } else {
      scoreMap.set(record.id, {
        record,
        rrfScore: rrfContribution,
        vectorRank: rank,
      });
    }
  });

  // Process text ranking (rank is 1-based)
  textResults.forEach((record, index) => {
    const rank = index + 1;
    const rrfContribution = 1 / (k + rank);
    const existing = scoreMap.get(record.id);
    if (existing) {
      existing.rrfScore += rrfContribution;
      existing.textRank = rank;
    } else {
      scoreMap.set(record.id, {
        record,
        rrfScore: rrfContribution,
        textRank: rank,
      });
    }
  });

  // Convert to array and sort descending by combined RRF score
  const fused: ScoredMemory[] = Array.from(scoreMap.values())
    .map((item) => ({
      ...item.record,
      score: Number(item.rrfScore.toFixed(6)),
      vectorRank: item.vectorRank,
      textRank: item.textRank,
    }))
    .sort((a, b) => b.score - a.score);

  return fused.slice(0, topK);
}
