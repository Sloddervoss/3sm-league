-- Rollback for 20260902150000_simhub_primary_authority_handoff.sql.
-- Existing device roles and bindings are intentionally preserved; this only removes
-- the new manual-handoff RPC. A completed handoff is reversed operationally by
-- calling simhub_set_primary_device(old_primary_id) before this rollback.

DROP FUNCTION IF EXISTS public.simhub_set_primary_device(UUID);
