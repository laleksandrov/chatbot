ALTER TABLE conversations
  DROP CONSTRAINT IF EXISTS conversations_assistant_profile_check;

ALTER TABLE conversations
  ALTER COLUMN assistant_profile SET DEFAULT 'registered_customer';

UPDATE conversations
SET assistant_profile = 'registered_customer'
WHERE assistant_profile = 'accounting_client';

ALTER TABLE conversations
  ADD CONSTRAINT conversations_assistant_profile_check
  CHECK (assistant_profile IN ('public_pre_registration', 'registered_customer'));

DELETE FROM chat_quota_windows
WHERE assistant_profile = 'accounting_client';

ALTER TABLE api_clients
  DROP CONSTRAINT IF EXISTS api_clients_profiles_valid;

ALTER TABLE api_clients
  DROP CONSTRAINT IF EXISTS api_clients_default_profile_valid;

UPDATE api_clients
SET allowed_profiles = ARRAY(
      SELECT DISTINCT CASE
        WHEN profile = 'accounting_client' THEN 'registered_customer'
        ELSE profile
      END
      FROM unnest(allowed_profiles) AS profile
    ),
    default_profile = CASE
      WHEN default_profile = 'accounting_client' THEN 'registered_customer'
      ELSE default_profile
    END,
    updated_at = now()
WHERE 'accounting_client' = ANY(allowed_profiles)
   OR default_profile = 'accounting_client';

ALTER TABLE api_clients
  ADD CONSTRAINT api_clients_profiles_valid CHECK (
    cardinality(allowed_profiles) > 0
    AND allowed_profiles <@ ARRAY['public_pre_registration', 'registered_customer']::text[]
  );

ALTER TABLE api_clients
  ADD CONSTRAINT api_clients_default_profile_valid CHECK (
    default_profile = ANY(allowed_profiles)
  );
