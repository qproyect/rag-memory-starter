🇪🇸 [Leer en español](README.es.md)

# Minimal RAG Memory Service

A clean, production-grade Retrieval-Augmented Generation (RAG) memory microservice built with **Node.js 20**, **TypeScript (strict)**, **Fastify**, and **PostgreSQL 16 + pgvector**.

This repository demonstrates applied AI engineering patterns for long-term agent memory:
1. **Hybrid Retrieval**: PostgreSQL full-text search (`tsvector`) combined with semantic vector search (`pgvector` cosine distance).
2. **Reciprocal Rank Fusion (RRF)**: Parameter-free fusion algorithm merging semantic and lexical candidate ranks without manual score scaling.
3. **Resilient LLM Provider Layer**: Unified `LLMProvider` interface with a `FailoverProvider` chain that tries providers sequentially with timeouts, plus a deterministic zero-dependency `MockProvider` so the service and tests run out of the box without external API keys.
4. **Structured JSON Output with Retry**: Zod schema validation ensuring outputs conform strictly to predictable types, automatically prompting the LLM once with validation error details if the initial JSON output fails.

---

## Architecture Overview

```mermaid
flowchart TD
    Client([HTTP Client]) -->|POST /query or POST /answer| Fastify[Fastify REST API]

    subgraph Storage & Retrieval Layer
        Fastify --> MemorySvc[Memory Service]
        MemorySvc -->|Embed query| ProviderLayer[LLM Provider / Embedder]
        MemorySvc -->|pgvector cosine distance| PGVector[(PostgreSQL + pgvector)]
        MemorySvc -->|tsvector full-text match| PGText[(PostgreSQL FTS)]
        PGVector --> RRF[Reciprocal Rank Fusion Algorithm]
        PGText --> RRF
    end

    subgraph LLM Provider Layer
        ProviderLayer --> Failover[Failover Provider]
        Failover --> Mock[Deterministic Mock Provider]
        Failover --> OpenAI[OpenAI-Compatible HTTP API]
        Failover --> Ollama[Ollama Local Daemon]
    end

    subgraph Structured Generation Layer
        Fastify --> AnswerSvc[Answer Service]
        RRF -->|Top-K Context| AnswerSvc
        AnswerSvc -->|Prompt + Context| ProviderLayer
        ProviderLayer -->|Raw Output| ZodValidator{Zod Schema Validator}
        ZodValidator -->|Valid JSON| Client
        ZodValidator -->|Invalid / Malformed| RetryPrompt[Error-Feedback Retry Prompt]
        RetryPrompt --> ProviderLayer
    end
```

---

## Quick Start

### 1. Run with Docker Compose (Zero Configuration)
The default configuration uses the built-in deterministic `MockProvider`. No external API keys or third-party accounts are needed:

```bash
docker compose up --build
```

The database (`pgvector/pgvector:pg16`) and the Fastify app will start up. Database migrations run automatically on startup.

### 2. Seed Sample Public-Domain Facts
To populate the database with 20 sample public-domain notes (cooking science, world history, travel geography):

```bash
docker compose exec app npm run db:seed
```

Or when running locally:
```bash
npm run db:seed
```

---

## API Endpoints & Examples

### Store a Memory Note (`POST /memories`)
Store new knowledge with structured metadata and automated vector embedding calculation:

```bash
curl -X POST http://localhost:3000/memories \
  -H "Content-Type: application/json" \
  -d '{
    "text": "Sous-vide cooking involves sealing food in an airtight container and cooking it in a temperature-controlled water bath.",
    "metadata": {
      "category": "cooking",
      "topic": "technique"
    }
  }'
```

**Response:**
```json
{
  "status": "success",
  "data": {
    "id": "7f093256-42bb-4144-8c88-e24c084777b7",
    "text": "Sous-vide cooking involves sealing food in an airtight container and cooking it in a temperature-controlled water bath.",
    "metadata": {
      "category": "cooking",
      "topic": "technique"
    },
    "created_at": "2025-10-31T20:30:00.000Z",
    "updated_at": "2025-10-31T20:30:00.000Z"
  }
}
```

---

### Hybrid Search (`POST /query`)
Executes parallel semantic vector search and PostgreSQL full-text search, fused via Reciprocal Rank Fusion (RRF), with optional metadata filters:

```bash
curl -X POST http://localhost:3000/query \
  -H "Content-Type: application/json" \
  -d '{
    "query": "temperature controlled water cooking",
    "topK": 3,
    "metadataFilter": {
      "category": "cooking"
    }
  }'
```

**Response:**
```json
{
  "status": "success",
  "total": 1,
  "results": [
    {
      "id": "7f093256-42bb-4144-8c88-e24c084777b7",
      "text": "Sous-vide cooking involves sealing food in an airtight container and cooking it in a temperature-controlled water bath.",
      "metadata": {
        "category": "cooking",
        "topic": "technique"
      },
      "score": 0.032522,
      "vectorRank": 1,
      "textRank": 1
    }
  ]
}
```

---

### Structured RAG Answer (`POST /answer`)
Retrieves relevant memories, injects them into an instruction prompt, queries the provider chain, and validates the response against a strict Zod schema:

```bash
curl -X POST http://localhost:3000/answer \
  -H "Content-Type: application/json" \
  -d '{
    "query": "How does sous-vide cooking work?",
    "topK": 2
  }'
```

**Response:**
```json
{
  "status": "success",
  "data": {
    "answer": "Deterministic mock answer responding to context.",
    "confidence": 0.95,
    "citations": ["seed-1", "seed-2"],
    "summary": "Synthetic mock summary generated without external network dependencies."
  },
  "context": [
    {
      "id": "7f093256-42bb-4144-8c88-e24c084777b7",
      "text": "Sous-vide cooking involves sealing food in an airtight container...",
      "score": 0.032522
    }
  ],
  "meta": {
    "retried": false
  }
}
```

---

### Health Check (`GET /health`)
```bash
curl -i http://localhost:3000/health
```

---

## Design Decisions

### 1. Why Hybrid Retrieval (Vector + Full-Text)?
Pure vector search excels at conceptual and semantic associations (e.g., matching "culinary heat reaction" with "Maillard reaction"), but frequently struggles with exact entity lookups, product codes, unique acronyms, or specific numbers. Full-text search (BM25 or PostgreSQL's `tsvector` with `ts_rank_cd`) excels at exact keyword precision.

By executing both strategies concurrently against PostgreSQL, we gain the strengths of both retrieval paradigms without requiring a separate vector database or specialized search cluster.

### 2. Why Reciprocal Rank Fusion (RRF)?
A common challenge in hybrid search is score calibration: vector distance (cosine distance between 0 and 2) cannot be linearly summed or compared with BM25/FTS relevance scores without arbitrary weights and continuous re-normalization across changing data distributions.

Reciprocal Rank Fusion solves this by operating exclusively on the **ordinal ranks** of results rather than raw scores:

$$RRF\_Score(d) = \sum_{m \in M} \frac{1}{k + r_m(d)}$$

Where:
- $M$ is the set of retrieval methods (vector search and full-text search).
- $r_m(d)$ is the 1-based rank position of document $d$ in system $m$.
- $k$ is a constant smoothing factor (standard literature default: 60) that penalizes low-ranked outliers while giving substantial boosts to items appearing near the top of both lists.

RRF is robust, parameter-light, and requires no fine-tuning as dataset size evolves.

### 3. Why Structured JSON Validation & Self-Correction Retry?
Real-world generative models occasionally produce conversational preamble (e.g., *"Sure, here is your answer:"*), wrap responses in inconsistent markdown code fences, or hallucinate missing keys.

To safeguard downstream microservice consumers:
- We parse and strip potential code blocks.
- We validate payloads against a strict **Zod schema** (`answer`, `confidence: [0, 1]`, `citations: string[]`).
- If parsing or validation fails, `AnswerService` captures the exact Zod error explanation and dispatches an immediate **single targeted retry** prompt. This self-correction loop resolves formatting discrepancies without crashing requests.

### 4. Why Failover & Deterministic Mocking?
Testing and local container development must never depend on third-party API availability, network connectivity, or paid API credits. The unified `LLMProvider` architecture includes:
- `MockProvider`: Provides deterministic 384-dimensional normalized embeddings and structured JSON answers.
- `FailoverProvider`: Wraps any list of providers (e.g. `[ollama, openai, mock]`) with per-call timeouts and fallback logging.

---

## Configuration (`.env`)

See `.env.example` for all configurable environment variables:

| Variable | Description | Default |
|---|---|---|
| `PORT` | Fastify server port | `3000` |
| `DATABASE_URL` | PostgreSQL connection string | `postgresql://postgres:postgres@localhost:5432/rag_memory` |
| `PRIMARY_LLM_PROVIDER` | Primary provider (`mock`, `openai`, `ollama`) | `mock` |
| `FALLBACK_LLM_PROVIDERS` | Comma-separated fallback chain | `ollama,openai` |
| `PROVIDER_TIMEOUT_MS` | Timeout before triggering next fallback | `5000` |
| `OPENAI_API_KEY` | OpenAI API key (optional) | - |
| `OPENAI_BASE_URL` | OpenAI-compatible endpoint | `https://api.openai.com/v1` |
| `OLLAMA_BASE_URL` | Local Ollama endpoint | `http://localhost:11434` |

---

## Limitations & Production Considerations

- **Single Node Embeddings**: The mock embedder produces deterministic vectors suitable for local validation and tests. For high-volume production, configure an OpenAI `text-embedding-3-small` or self-hosted Ollama `all-minilm` instance.
- **Index Optimization**: The schema employs `HNSW` vector indexing. For millions of rows, consider index tuning (`m = 16`, `ef_construction = 64`) or partitioning vectors by tenant/metadata.
- **Single Retry Boundary**: The self-correction loop intentionally retries once to prevent token waste and latency spikes. Persistent invalid outputs return a clean HTTP 500 with error details.

---

## License

MIT © Lucas F. Meneses
