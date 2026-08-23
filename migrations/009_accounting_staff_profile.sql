ALTER TABLE conversations
  DROP CONSTRAINT IF EXISTS conversations_assistant_profile_check;

ALTER TABLE conversations
  ADD CONSTRAINT conversations_assistant_profile_check
  CHECK (assistant_profile IN ('public_pre_registration', 'registered_customer', 'accounting_staff'));

ALTER TABLE api_clients
  DROP CONSTRAINT IF EXISTS api_clients_profiles_valid;

ALTER TABLE api_clients
  DROP CONSTRAINT IF EXISTS api_clients_default_profile_valid;

ALTER TABLE api_clients
  ADD CONSTRAINT api_clients_profiles_valid CHECK (
    cardinality(allowed_profiles) > 0
    AND allowed_profiles <@ ARRAY['public_pre_registration', 'registered_customer', 'accounting_staff']::text[]
  );

ALTER TABLE api_clients
  ADD CONSTRAINT api_clients_default_profile_valid CHECK (
    default_profile = ANY(allowed_profiles)
  );
