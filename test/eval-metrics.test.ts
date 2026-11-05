import { describe, it, expect } from "vitest";
import { recallAtK, mrr, ndcgAtK, hitRateAtK } from "../src/evals/metrics.js";

describe("IR Evaluation Metrics", () => {
  describe("recallAtK", () => {
    it("returns null when relevantIds is empty", () => {
      expect(recallAtK(["doc-1", "doc-2"], [], 5)).toBeNull();
    });

    it("returns 0 when retrievedIds is empty or contains no relevant docs", () => {
      expect(recallAtK([], ["doc-1"], 5)).toBe(0);
      expect(recallAtK(["doc-2", "doc-3"], ["doc-1"], 5)).toBe(0);
    });

    it("computes exact recall within top K", () => {
      expect(recallAtK(["doc-1", "doc-2", "doc-3"], ["doc-2", "doc-4"], 3)).toBe(0.5);
      expect(recallAtK(["doc-2", "doc-4", "doc-3"], ["doc-2", "doc-4"], 3)).toBe(1.0);
      expect(recallAtK(["doc-1", "doc-2", "doc-5", "doc-4"], ["doc-2", "doc-4"], 3)).toBe(0.5);
    });
  });

  describe("mrr", () => {
    it("returns null when relevantIds is empty", () => {
      expect(mrr(["doc-1"], [])).toBeNull();
    });

    it("returns 0 when no relevant docs found", () => {
      expect(mrr([], ["doc-1"])).toBe(0);
      expect(mrr(["doc-2", "doc-3"], ["doc-1"])).toBe(0);
    });

    it("computes reciprocal rank of first relevant item", () => {
      expect(mrr(["doc-1", "doc-2"], ["doc-1"])).toBe(1.0);
      expect(mrr(["doc-x", "doc-1", "doc-2"], ["doc-1", "doc-2"])).toBe(0.5);
      expect(mrr(["doc-a", "doc-b", "doc-c"], ["doc-c"])).toBeCloseTo(1 / 3, 5);
    });
  });

  describe("ndcgAtK", () => {
    it("returns null when relevantIds is empty", () => {
      expect(ndcgAtK(["doc-1"], [], 5)).toBeNull();
    });

    it("returns 0 when no relevant items found in top K", () => {
      expect(ndcgAtK([], ["doc-1"], 5)).toBe(0);
      expect(ndcgAtK(["doc-x"], ["doc-1"], 5)).toBe(0);
    });

    it("returns 1.0 for perfect ranking", () => {
      expect(ndcgAtK(["doc-1", "doc-2", "doc-3"], ["doc-1", "doc-2"], 3)).toBe(1.0);
    });

    it("computes hand-calculated binary NDCG@3", () => {
      const dcg = 1 / Math.log2(3);
      const idcg = 1 / Math.log2(2) + 1 / Math.log2(3);
      const expectedNdcg = dcg / idcg;

      expect(ndcgAtK(["doc-X", "doc-A", "doc-Y"], ["doc-A", "doc-B"], 3)).toBeCloseTo(
        expectedNdcg,
        5
      );
    });
  });

  describe("hitRateAtK", () => {
    it("returns null when relevantIds is empty", () => {
      expect(hitRateAtK(["doc-1"], [], 5)).toBeNull();
    });

    it("returns 0 when no relevant items in top K", () => {
      expect(hitRateAtK([], ["doc-1"], 5)).toBe(0);
      expect(hitRateAtK(["doc-2", "doc-3"], ["doc-1"], 2)).toBe(0);
      expect(hitRateAtK(["doc-2", "doc-3", "doc-1"], ["doc-1"], 2)).toBe(0);
    });

    it("returns 1 when at least one relevant item in top K", () => {
      expect(hitRateAtK(["doc-2", "doc-1"], ["doc-1"], 2)).toBe(1);
      expect(hitRateAtK(["doc-1", "doc-2"], ["doc-1", "doc-2"], 1)).toBe(1);
    });
  });
});
