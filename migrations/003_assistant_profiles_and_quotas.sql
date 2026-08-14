ALTER TABLE conversations
  ADD COLUMN IF NOT EXISTS assistant_profile text NOT NULL DEFAULT 'accounting_client',
  ADD COLUMN IF NOT EXISTS external_organization_hash text;

ALTER TABLE conversations
  ADD CONSTRAINT conversations_assistant_profile_check
  CHECK (assistant_profile IN ('public_pre_registration', 'registered_customer', 'accounting_client'));

ALTER TABLE documents
  ADD COLUMN IF NOT EXISTS organization_id text;

ALTER TABLE documents
  ADD CONSTRAINT documents_organization_scope_check
  CHECK (organization_id IS NULL OR access_level = 'tenant');

CREATE INDEX IF NOT EXISTS documents_tenant_organization_status_idx
  ON documents (tenant_id, organization_id, status, created_at DESC)
  WHERE organization_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS chat_quota_windows (
  tenant_id text NOT NULL,
  assistant_profile text NOT NULL,
  subject_hash text NOT NULL,
  window_start timestamptz NOT NULL,
  message_count integer NOT NULL CHECK (message_count > 0),
  updated_at timestamptz NOT NULL,
  PRIMARY KEY (tenant_id, assistant_profile, subject_hash, window_start)
);

CREATE INDEX IF NOT EXISTS chat_quota_windows_updated_idx
  ON chat_quota_windows (updated_at);

-- Run periodically from a protected maintenance job.
-- DELETE FROM chat_quota_windows WHERE updated_at < now() - interval '7 days';
