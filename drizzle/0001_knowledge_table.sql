-- Migration: Add knowledge table for AI Knowledge Hub
-- This table stores ingested code, documents, and videos with pgvector embeddings

-- Create the knowledge table
CREATE TABLE IF NOT EXISTS knowledge (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  subtype TEXT,
  name TEXT NOT NULL,
  content TEXT NOT NULL,
  summary TEXT,
  embedding vector(384),
  metadata JSONB NOT NULL DEFAULT '{}',
  file_path TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Create indexes for efficient querying
CREATE INDEX IF NOT EXISTS idx_knowledge_type ON knowledge(type);
CREATE INDEX IF NOT EXISTS idx_knowledge_subtype ON knowledge(subtype);
CREATE INDEX IF NOT EXISTS idx_knowledge_name ON knowledge(name);
CREATE INDEX IF NOT EXISTS idx_knowledge_file_path ON knowledge(file_path);

-- Create vector similarity index for semantic search
-- Note: ivfflat requires at least 1 row to build, so we create it after data exists
-- For initial setup, use this command after inserting some data:
-- CREATE INDEX idx_knowledge_embedding ON knowledge USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);

-- Alternative: Use HNSW index (better for smaller datasets, no minimum row requirement)
CREATE INDEX IF NOT EXISTS idx_knowledge_embedding ON knowledge USING hnsw (embedding vector_cosine_ops);
