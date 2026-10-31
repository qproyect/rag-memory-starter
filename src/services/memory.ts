import { pool } from "../db/client.js";
import { LLMProvider } from "../providers/types.js";
import { MemoryRecord, ScoredMemory, reciprocalRankFusion } from "./rrf.js";

export interface StoreMemoryInput {
  id?: string;
  text: string;
  metadata?: Record<string, unknown>;
}

export interface QueryOptions {
  query: string;
  topK?: number;
  metadataFilter?: Record<string, unknown>;
  rrfK?: number;
}

export class MemoryService {
  constructor(private provider: LLMProvider) {}

  /**
   * Stores or updates a memory note, computing and storing its vector embedding.
   */
  async storeMemory(input: StoreMemoryInput): Promise<MemoryRecord> {
    const embedding = await this.provider.embed(input.text);
    const vectorStr = `[${embedding.join(",")}]`;
    const metadata = input.metadata || {};

    if (input.id) {
      const res = await pool.query<MemoryRecord>(
        `
        INSERT INTO memories (id, text, metadata, embedding, updated_at)
        VALUES ($1, $2, $3, $4::vector, NOW())
        ON CONFLICT (id) DO UPDATE
        SET text = EXCLUDED.text,
            metadata = EXCLUDED.metadata,
            embedding = EXCLUDED.embedding,
            updated_at = NOW()
        RETURNING id, text, metadata, created_at, updated_at;
      `,
        [input.id, input.text, JSON.stringify(metadata), vectorStr]
      );
      return res.rows[0];
    }

    const res = await pool.query<MemoryRecord>(
      `
      INSERT INTO memories (text, metadata, embedding)
      VALUES ($1, $2, $3::vector)
      RETURNING id, text, metadata, created_at, updated_at;
    `,
      [input.text, JSON.stringify(metadata), vectorStr]
    );
    return res.rows[0];
  }

  /**
   * Performs hybrid retrieval combining pgvector cosine distance and PostgreSQL full-text search,
   * merged using Reciprocal Rank Fusion (RRF).
   */
  async hybridQuery(options: QueryOptions): Promise<ScoredMemory[]> {
    const { query, topK = 5, metadataFilter, rrfK = 60 } = options;
    const fetchLimit = Math.max(topK * 2, 20);

    // 1. Semantic Vector Search
    const queryEmbedding = await this.provider.embed(query);
    const vectorStr = `[${queryEmbedding.join(",")}]`;

    let vectorSql = `
      SELECT id, text, metadata, created_at, updated_at,
             (embedding <=> $1::vector) as distance
      FROM memories
    `;
    const vectorParams: unknown[] = [vectorStr];

    if (metadataFilter && Object.keys(metadataFilter).length > 0) {
      vectorSql += ` WHERE metadata @> $2::jsonb`;
      vectorParams.push(JSON.stringify(metadataFilter));
    }
    vectorSql += ` ORDER BY distance ASC LIMIT $${vectorParams.length + 1}`;
    vectorParams.push(fetchLimit);

    const vectorResult = await pool.query<MemoryRecord>(vectorSql, vectorParams);

    // 2. Lexical Full-Text Search
    let textSql = `
      SELECT id, text, metadata, created_at, updated_at,
             ts_rank_cd(tsv, plainto_tsquery('english', $1)) as rank
      FROM memories
      WHERE tsv @@ plainto_tsquery('english', $1)
    `;
    const textParams: unknown[] = [query];

    if (metadataFilter && Object.keys(metadataFilter).length > 0) {
      textSql += ` AND metadata @> $2::jsonb`;
      textParams.push(JSON.stringify(metadataFilter));
    }
    textSql += ` ORDER BY rank DESC LIMIT $${textParams.length + 1}`;
    textParams.push(fetchLimit);

    const textResult = await pool.query<MemoryRecord>(textSql, textParams);

    // 3. Reciprocal Rank Fusion
    return reciprocalRankFusion(vectorResult.rows, textResult.rows, rrfK, topK);
  }
}
