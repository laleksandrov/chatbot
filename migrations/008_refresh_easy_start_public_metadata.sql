UPDATE documents
SET status = 'accepted',
    error = NULL,
    attempt_count = 0,
    next_attempt_at = now(),
    lease_until = NULL,
    worker_id = NULL,
    updated_at = now()
WHERE tenant_id = 'easystart'
  AND publicly_accessible = true
  AND category IN ('platform_capabilities', 'platform_pricing')
  AND status = 'ready';
