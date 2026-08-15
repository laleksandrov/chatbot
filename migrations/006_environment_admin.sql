ALTER TABLE admin_sessions
  ALTER COLUMN user_id DROP NOT NULL,
  ADD COLUMN admin_email text;

ALTER TABLE admin_sessions
  ADD CONSTRAINT admin_sessions_identity_check
  CHECK (num_nonnulls(user_id, admin_email) = 1);

CREATE INDEX admin_sessions_admin_email_idx ON admin_sessions (admin_email)
  WHERE admin_email IS NOT NULL;
