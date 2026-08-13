CREATE TABLE IF NOT EXISTS conversations (
  id text PRIMARY KEY,
  tenant_id text NOT NULL,
  external_user_hash text NOT NULL,
  channel text NOT NULL,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL
);

CREATE INDEX IF NOT EXISTS conversations_tenant_updated_idx
  ON conversations (tenant_id, updated_at DESC);

CREATE INDEX IF NOT EXISTS conversations_expiry_idx
  ON conversations (expires_at);

CREATE TABLE IF NOT EXISTS messages (
  id bigserial PRIMARY KEY,
  conversation_id text NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('user', 'assistant')),
  content_ciphertext bytea NOT NULL,
  content_iv bytea NOT NULL,
  content_auth_tag bytea NOT NULL,
  key_version integer NOT NULL DEFAULT 1,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL
);

CREATE INDEX IF NOT EXISTS messages_conversation_created_idx
  ON messages (conversation_id, created_at, id);

CREATE TABLE IF NOT EXISTS documents (
  id uuid PRIMARY KEY,
  tenant_id text NOT NULL,
  title text NOT NULL,
  category text NOT NULL,
  source_type text NOT NULL,
  access_level text NOT NULL CHECK (access_level IN ('global', 'tenant')),
  jurisdiction text NOT NULL,
  publisher text,
  source_url text,
  published_at date,
  valid_from date,
  valid_to date,
  original_filename text NOT NULL,
  mime_type text NOT NULL,
  size_bytes bigint NOT NULL,
  sha256 text NOT NULL,
  storage_key text NOT NULL,
  status text NOT NULL CHECK (status IN ('accepted', 'processing', 'ready', 'failed', 'archived')),
  error text,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL
);

CREATE INDEX IF NOT EXISTS documents_tenant_status_idx
  ON documents (tenant_id, status, created_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS documents_tenant_checksum_idx
  ON documents (tenant_id, sha256)
  WHERE status <> 'archived';

-- Run periodically from a protected maintenance job.
-- DELETE FROM conversations WHERE expires_at < now();
