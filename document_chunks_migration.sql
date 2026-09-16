-- Run this in your Supabase SQL editor:
-- Dashboard → SQL Editor → New query → paste → Run
--
-- Adds RAG (retrieval-augmented generation) support so large documents
-- (textbooks, long readings) can be searched by the AI instead of being
-- truncated. Small documents keep working exactly as before — this only
-- kicks in for documents over a size threshold, decided at extraction time.

CREATE EXTENSION IF NOT EXISTS vector;

ALTER TABLE documents
  ADD COLUMN IF NOT EXISTS needs_rag BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS chunk_status TEXT NOT NULL DEFAULT 'not_applicable',
  ADD COLUMN IF NOT EXISTS chunk_error TEXT;

CREATE TABLE IF NOT EXISTS document_chunks (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id   UUID        NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  user_id       UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  chunk_index   INT         NOT NULL,
  content       TEXT        NOT NULL,
  embedding     VECTOR(1536) NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS document_chunks_document_id_idx
  ON document_chunks (document_id);

-- HNSW index for fast approximate nearest-neighbor search over embeddings
CREATE INDEX IF NOT EXISTS document_chunks_embedding_idx
  ON document_chunks USING hnsw (embedding vector_cosine_ops);

ALTER TABLE document_chunks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage own document chunks"
  ON document_chunks FOR ALL
  USING  (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Similarity search RPC — called from the server with the service role key,
-- scoped to one user's chunks via match_user_id (never trust a client-supplied id).
CREATE OR REPLACE FUNCTION match_document_chunks(
  query_embedding VECTOR(1536),
  match_user_id UUID,
  match_count INT DEFAULT 8
)
RETURNS TABLE (
  id UUID,
  document_id UUID,
  chunk_index INT,
  content TEXT,
  similarity FLOAT
)
LANGUAGE sql STABLE
AS $$
  SELECT
    document_chunks.id,
    document_chunks.document_id,
    document_chunks.chunk_index,
    document_chunks.content,
    1 - (document_chunks.embedding <=> query_embedding) AS similarity
  FROM document_chunks
  WHERE document_chunks.user_id = match_user_id
  ORDER BY document_chunks.embedding <=> query_embedding
  LIMIT match_count;
$$;
