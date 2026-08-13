ALTER TABLE documents
  ADD COLUMN IF NOT EXISTS attempt_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS next_attempt_at timestamptz DEFAULT now(),
  ADD COLUMN IF NOT EXISTS lease_until timestamptz,
  ADD COLUMN IF NOT EXISTS worker_id text,
  ADD COLUMN IF NOT EXISTS openai_file_id text,
  ADD COLUMN IF NOT EXISTS vector_store_id text,
  ADD COLUMN IF NOT EXISTS vector_store_file_id text,
  ADD COLUMN IF NOT EXISTS indexed_at timestamptz;

CREATE INDEX IF NOT EXISTS documents_ingestion_queue_idx
  ON documents (COALESCE(next_attempt_at, lease_until, created_at), created_at)
  WHERE status IN ('accepted', 'processing', 'failed');
