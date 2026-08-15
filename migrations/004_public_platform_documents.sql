ALTER TABLE documents
  ADD COLUMN IF NOT EXISTS publicly_accessible boolean NOT NULL DEFAULT false;

ALTER TABLE documents
  ADD CONSTRAINT documents_public_access_check
  CHECK (NOT publicly_accessible OR (access_level = 'tenant' AND organization_id IS NULL));

CREATE INDEX IF NOT EXISTS documents_public_tenant_status_idx
  ON documents (tenant_id, status, created_at DESC)
  WHERE publicly_accessible = true;
