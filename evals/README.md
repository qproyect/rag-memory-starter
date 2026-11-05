# RAG Evaluation Suite

A reproducible evaluation suite measuring retrieval accuracy, answer generation reliability, and provider layer robustness.

Designed for automated CI regression guarding and local benchmarking across retrieval strategies (`hybrid`, `vector`, `text`) and providers (`mock`, `ollama`, `openai`).

---

## What is Measured

### 1. Retrieval Performance
Evaluated across all answerable queries at $K = 5$ for **Hybrid (RRF)**, **Vector Only**, and **Text Only**:
- **Recall@K**: Proportion of target relevant documents retrieved in the top $K$ positions.
- **MRR (Mean Reciprocal Rank)**: Reciprocal rank ($1 / \text{rank}$) of the first relevant document retrieved.
- **NDCG@K**: Normalized Discounted Cumulative Gain with binary relevance, penalizing lower ranks.
- **HitRate@K**: Share of queries with at least one relevant document in the top $K$.
- **Category breakdown**: Performance segmented by query type (`exact_keyword`, `paraphrase`, `entity_numeric`, `filtered`).

### 2. Answer Reliability & Groundedness
Evaluated across all test queries through `AnswerService.answer`:
- **Schema Valid Rate**: Percentage of answers conforming strictly to the Zod schema (`answer`, `confidence`, `citations`, `summary`).
- **Self-Correction Retry Rate**: Proportion of queries that failed initial generation and required the error-feedback retry loop.
- **Citation Validity**: Share of cited memory IDs that were actually present in the retrieved context window (preventing hallucinated references).
- **Citation Recall**: Share of target gold IDs that were cited in the answer (top-2 citation cap).
- **Abstention Rate**: Frequency with which the model expresses low confidence ($\text{confidence} < 0.5$) on unanswerable topics (`no_answer`).
- **Answer Errors**: Count of any uncaught exceptions during answer generation.

### 3. Resilience & Robustness
Deterministic evaluation using isolated test doubles (no external network dependencies):
- **Markdown Code Fences**: Tests stripping of \`\`\`json wrappers.
- **Invalid JSON Recovery**: Verifies single-retry self-correction when initial output has malformed syntax.
- **Schema Violation Recovery**: Verifies retry prompt with specific Zod validation error messages.
- **Primary Provider Error**: Confirms `FailoverProvider` cascades to secondary provider on exceptions.
- **Primary Provider Timeout**: Confirms `FailoverProvider` cascades to secondary provider when response exceeds configured threshold.

---

## Running the Evals Locally

### Prerequisites
- Node.js 20+ installed
- Dependencies installed:
```bash
npm install
```

### Safety Guard
The evaluation suite runs database migrations and executes `TRUNCATE memories` before seeding the golden corpus. To protect production and development data, the runner **refuses to run** unless:
1. The database name in `DATABASE_URL` ends in `_eval` or `_test`, OR
2. The `--allow-truncate` flag is passed explicitly.

### Quick Start with Dedicated Eval Database

1. Create a dedicated evaluation database inside your PostgreSQL container:
```bash
docker compose exec db createdb -U postgres rag_memory_eval
```

2. Run the evaluation suite with the default `MockProvider`:
```bash
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/rag_memory_eval npm run eval
```

3. Run with CI threshold enforcement (exits 1 on metric regression):
```bash
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/rag_memory_eval npm run eval -- --ci
```

---

## Running Locally with Ollama

To test semantic vector retrieval with real continuous embeddings:

1. Ensure Ollama is running and download the embedding model (`all-minilm` produces 384-dimensional embeddings matching the schema):
```bash
ollama pull all-minilm
ollama pull llama3
```

2. Run the eval suite targeting Ollama:
```bash
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/rag_memory_eval \
PRIMARY_LLM_PROVIDER=ollama \
OLLAMA_EMBEDDING_MODEL=all-minilm \
OLLAMA_MODEL=llama3 \
npm run eval -- --provider ollama
```

---

## CLI Options

| Flag | Description | Default |
|---|---|---|
| `--provider <mock\|ollama\|openai>` | LLM provider to evaluate | `process.env.PRIMARY_LLM_PROVIDER` or `mock` |
| `--k <n>` | Retrieval depth cutoff | `5` |
| `--ci` | Check results against `evals/thresholds.json` and exit 1 on regression (enforces `k=5`) | `false` |
| `--out <path>` | JSON output path | `evals/results/latest.json` |
| `--allow-truncate` | Allow truncating database names that do not end in `_eval` or `_test` | `false` |

---

## Golden Dataset Structure

Located in `evals/datasets/`:
- `corpus.json`: 30 curated notes with fixed UUIDs. Contains the 20 public-domain seed facts plus 10 hard distractors sharing vocabulary (e.g., *caramelization* vs. *Maillard reaction*, *Lima* vs. *Machu Picchu*, *Suez Canal* vs. *Panama Canal*).
- `queries.json`: 38 labeled evaluation queries with labeled gold relevance IDs:
  - `exact_keyword` (10 queries): rare terms and proper nouns.
  - `paraphrase` (10 queries): zero distinctive lexical keyword overlap with target facts.
  - `entity_numeric` (6 queries): dates, elevations, counts, and measurements.
  - `filtered` (6 queries): queries paired with metadata category/topic filters.
  - `no_answer` (6 queries): out-of-domain topics used to test abstention.

---

## Limitations

1. **Mock Embedder Characteristics**: The built-in mock provider produces deterministic token hash embeddings (lexical bag-of-words approximation), not true semantic representations. Paraphrase scores under the mock provider understate real continuous embedding capabilities; for true semantic benchmarks, run against Ollama (`all-minilm`) or OpenAI.
2. **PostgreSQL FTS Conjunction (`plainto_tsquery`)**: Full-text search with `plainto_tsquery` strictly ANDs all tokens (`&`). Queries containing terms not all present simultaneously in target documents (e.g. paraphrase or detailed queries) return 0 results in text-only mode. Adding OR-style lexical matching (e.g. constructing `tsquery` with `|`) is tracked as future work.
3. **Dataset Size**: The golden evaluation set currently contains 38 queries across 30 notes. While sufficient for regression testing and CI verification, broader domain evaluations would benefit from larger corpora.
4. **LLM-as-a-Judge**: Groundedness and factual consistency are currently verified via citation checks and schema constraints; an automated LLM-as-a-judge evaluation for answer faithfulness is planned as future work.
