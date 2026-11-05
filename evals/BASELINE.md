# Baseline Evaluation Results (Mock Provider)

Committed baseline evaluation measurements executed against PostgreSQL 16 + pgvector using the zero-dependency deterministic `MockProvider`.

- **Corpus size:** 30 documents (20 seed facts + 10 hard distractors)
- **Queries:** 38 labeled evaluation queries (32 retrieval queries across 4 categories + 6 unanswerable queries)
- **Top-K:** 5

---

## 1. Retrieval Performance by Mode (K=5)

| Retrieval Mode | Recall@5 | MRR | NDCG@5 | HitRate@5 | Queries |
|---|---|---|---|---|---|
| **Hybrid (RRF)** | **0.6563** | **0.5104** | **0.5484** | **0.6563** | 32 |
| **Vector Only**  | 0.4063 | 0.2734 | 0.3070 | 0.4063 | 32 |
| **Text Only**    | 0.3750 | 0.3750 | 0.3750 | 0.3750 | 32 |

### Category Breakdown

| Category | Mode | Recall@5 | MRR | NDCG@5 | HitRate@5 |
|---|---|---|---|---|---|
| `exact_keyword` | Hybrid | 1.0000 | 0.8500 | 0.8893 | 1.0000 |
| `exact_keyword` | Vector | 0.4000 | 0.1917 | 0.2431 | 0.4000 |
| `exact_keyword` | Text   | **1.0000** | **1.0000** | **1.0000** | **1.0000** |
| `paraphrase` | Hybrid | **0.2000** | **0.0833** | **0.1131** | **0.2000** |
| `paraphrase` | Vector | **0.2000** | **0.0833** | **0.1131** | **0.2000** |
| `paraphrase` | Text   | 0.0000 | 0.0000 | 0.0000 | 0.0000 |
| `entity_numeric` | Hybrid | **0.5000** | 0.2500 | 0.3155 | **0.5000** |
| `entity_numeric` | Vector | 0.1667 | 0.0833 | 0.1052 | 0.1667 |
| `entity_numeric` | Text   | 0.3333 | **0.3333** | **0.3333** | 0.3333 |
| `filtered` | Hybrid | **1.0000** | **0.9167** | **0.9385** | **1.0000** |
| `filtered` | Vector | **1.0000** | **0.9167** | **0.9385** | **1.0000** |
| `filtered` | Text   | 0.0000 | 0.0000 | 0.0000 | 0.0000 |

### Explanation of Single-Mode Observations

1. **Text-only scoring 0 on `filtered` and `paraphrase`:**
   PostgreSQL's `plainto_tsquery('english', query)` converts natural language phrases into strict conjunctions (`&`), requiring **every single stemmed term** to be present in the document. For instance, in the filtered query `"browning reaction at high heat"`, the generated query is `'brown' & 'reaction' & 'high' & 'heat'`. Even though relevant notes describe browning reactions or high heat (such as the Maillard reaction above 140°C), no note contains all four terms simultaneously, causing text search to return zero results. Similarly, pure paraphrase queries deliberately share zero distinctive keywords with the target documents, so a strict conjunctive text search cannot match them.
2. **Where Single Modes Win:**
   - **`exact_keyword` MRR:** Text-only achieves **1.0000** MRR vs. **0.8500** for Hybrid. When rare keywords match exactly, lexical search places the target note at rank 1. Under Hybrid search, RRF sums reciprocal ranks from both text and vector lists; if the pseudo-hash mock embedder ranks the note slightly lower on the vector side, the combined RRF score can place another candidate slightly higher.
   - **`entity_numeric` MRR:** Text-only achieves **0.3333** MRR vs. **0.2500** for Hybrid on specific numeric terms.
3. **Hybrid Outperforms Overall:**
   In overall retrieval, **Hybrid (RRF)** substantially outperforms both single modes:
   - **Recall@5:** 0.6563 (Hybrid) vs. 0.4063 (Vector) and 0.3750 (Text)
   - **MRR:** 0.5104 (Hybrid) vs. 0.2734 (Vector) and 0.3750 (Text)
   - **NDCG@5:** 0.5484 (Hybrid) vs. 0.3070 (Vector) and 0.3750 (Text)

---

## 2. Answer Quality & Reliability

| Metric | Measured Baseline | Description |
|---|---|---|
| **Schema Valid Rate** | 100.0% | Valid JSON conforming strictly to Zod schema |
| **Self-Correction Retry Rate** | 0.0% | Queries that required an error-feedback retry |
| **Citation Validity** | 100.0% | Cited IDs that were present in the retrieved context |
| **Citation Recall** | 62.5% | Relevant gold IDs cited in the answer (top-2 citation cap) |
| **Abstention Rate (`no_answer`)** | 0.0% | *Not meaningful with MockProvider (confidence fixed at 0.95)* |
| **Answer Errors** | 0 | Unhandled exceptions or failures during answer generation |

---

## 3. Provider Robustness Evaluation

| Scenario | Recovered | Description |
|---|---|---|
| Markdown Code Fences (` ```json `) | ✅ Yes | Strips enclosing backtick markdown wrappers |
| Invalid JSON -> Self-Correction | ✅ Yes | Catches syntax error, retries with error feedback |
| Schema Violation -> Self-Correction | ✅ Yes | Catches Zod validation error, retries with schema message |
| Primary Provider Throws Error | ✅ Yes | FailoverProvider delegates to secondary provider |
| Primary Provider Times Out | ✅ Yes | FailoverProvider detects timeout and invokes fallback |
| **Overall Recovery Rate** | **100.0%** | Full resilience loop coverage |
