import { describe, it, expect } from "vitest";
import { reciprocalRankFusion, MemoryRecord } from "../src/services/rrf.js";

describe("Reciprocal Rank Fusion (RRF)", () => {
  const makeRecord = (id: string, text: string): MemoryRecord => ({
    id,
    text,
    metadata: {},
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  });

  const docA = makeRecord("doc-a", "Document A about cooking");
  const docB = makeRecord("doc-b", "Document B about travel");
  const docC = makeRecord("doc-c", "Document C about history");
  const docD = makeRecord("doc-d", "Document D about science");

  it("calculates RRF scores correctly for overlapping lists", () => {
    // Vector ranked: docA (rank 1), docB (rank 2), docC (rank 3)
    // Text ranked: docB (rank 1), docA (rank 2), docD (rank 3)
    // With k = 60:
    // docA: 1/(60+1) + 1/(60+2) = 1/61 + 1/62 = 0.016393 + 0.016129 = 0.032522
    // docB: 1/(60+2) + 1/(60+1) = 1/62 + 1/61 = 0.032522 (tied with A)
    // docC: 1/(60+3) = 1/63 = 0.015873
    // docD: 1/(60+3) = 1/63 = 0.015873

    const vectorResults = [docA, docB, docC];
    const textResults = [docB, docA, docD];

    const fused = reciprocalRankFusion(vectorResults, textResults, 60, 4);

    expect(fused.length).toBe(4);
    // Both docA and docB have both rankings and higher score than docC and docD
    expect(fused[0].score).toBeGreaterThan(fused[2].score);
    expect(fused[1].score).toBeGreaterThan(fused[3].score);
    expect(["doc-a", "doc-b"]).toContain(fused[0].id);
    expect(["doc-a", "doc-b"]).toContain(fused[1].id);
    expect(["doc-c", "doc-d"]).toContain(fused[2].id);
    expect(["doc-c", "doc-d"]).toContain(fused[3].id);
  });

  it("prioritizes documents appearing at top rank in both lists over single-list hits", () => {
    const vectorResults = [docA, docC];
    const textResults = [docA, docD];

    const fused = reciprocalRankFusion(vectorResults, textResults, 60, 3);

    expect(fused[0].id).toBe("doc-a");
    expect(fused[0].score).toBeCloseTo(1 / 61 + 1 / 61, 5);
    expect(fused[0].vectorRank).toBe(1);
    expect(fused[0].textRank).toBe(1);
  });

  it("handles empty lists gracefully", () => {
    const fused = reciprocalRankFusion([], [], 60, 5);
    expect(fused).toEqual([]);
  });

  it("handles when only vector or only text results are returned", () => {
    const vectorResults = [docA, docB];
    const fused = reciprocalRankFusion(vectorResults, [], 60, 5);

    expect(fused.length).toBe(2);
    expect(fused[0].id).toBe("doc-a");
    expect(fused[0].score).toBeCloseTo(1 / 61, 5);
    expect(fused[0].vectorRank).toBe(1);
    expect(fused[0].textRank).toBeUndefined();
  });

  it("respects topK limit", () => {
    const vectorResults = [docA, docB, docC, docD];
    const fused = reciprocalRankFusion(vectorResults, [], 60, 2);

    expect(fused.length).toBe(2);
    expect(fused.map((f) => f.id)).toEqual(["doc-a", "doc-b"]);
  });
});
