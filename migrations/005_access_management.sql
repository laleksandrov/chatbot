CREATE TABLE users (
  id uuid PRIMARY KEY,
  email text NOT NULL,
  password_hash text NOT NULL,
  is_admin boolean NOT NULL DEFAULT false,
  active boolean NOT NULL DEFAULT true,
  last_login_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX users_email_lower_unique ON users (lower(email));

CREATE TABLE api_clients (
  id uuid PRIMARY KEY,
  name text NOT NULL,
  tenant_id text NOT NULL,
  key_hash text NOT NULL UNIQUE,
  key_prefix text NOT NULL,
  roles text[] NOT NULL,
  allowed_profiles text[] NOT NULL,
  default_profile text NOT NULL,
  active boolean NOT NULL DEFAULT true,
  last_used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT api_clients_roles_not_empty CHECK (cardinality(roles) > 0),
  CONSTRAINT api_clients_roles_valid CHECK (
    roles <@ ARRAY['chat', 'documents:read', 'documents:write', 'documents:global', 'documents:tenants']::text[]
  ),
  CONSTRAINT api_clients_profiles_not_empty CHECK (cardinality(allowed_profiles) > 0),
  CONSTRAINT api_clients_profiles_valid CHECK (
    allowed_profiles <@ ARRAY['public_pre_registration', 'registered_customer', 'accounting_client']::text[]
  ),
  CONSTRAINT api_clients_default_profile_valid CHECK (default_profile = ANY(allowed_profiles))
);

CREATE INDEX api_clients_tenant_id_idx ON api_clients (tenant_id);

CREATE TABLE admin_sessions (
  token_hash text PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  csrf_token text NOT NULL,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX admin_sessions_user_id_idx ON admin_sessions (user_id);
CREATE INDEX admin_sessions_expires_at_idx ON admin_sessions (expires_at);
