-- Enable extensions required for UUID generation and vector operations
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "vector";

-- Memories table
CREATE TABLE IF NOT EXISTS memories (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    text TEXT NOT NULL,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    embedding vector(384) NOT NULL,
    tsv tsvector GENERATED ALWAYS AS (to_tsvector('english', text)) STORED,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Full-text search GIN index
CREATE INDEX IF NOT EXISTS idx_memories_tsv ON memories USING GIN (tsv);

-- Metadata JSONB GIN index for efficient filtering
CREATE INDEX IF NOT EXISTS idx_memories_metadata ON memories USING GIN (metadata);

-- Cosine distance HNSW index for vector similarity search
CREATE INDEX IF NOT EXISTS idx_memories_embedding ON memories USING hnsw (embedding vector_cosine_ops);
