-- Paired rollback for 20261119120000_personal_pitwall_share.sql.
-- Functions first, then the table. No other table, policy or grant is touched.
BEGIN;

DROP FUNCTION IF EXISTS public.pitwall_shared_snapshot_v1(text);
DROP FUNCTION IF EXISTS public.pitwall_share_revoke_v1(uuid);
DROP FUNCTION IF EXISTS public.pitwall_share_create_v1(uuid, integer);
DROP FUNCTION IF EXISTS public.pitwall_owner_device_detail_v1(uuid);
DROP FUNCTION IF EXISTS public.pitwall_my_devices_v1();
DROP FUNCTION IF EXISTS public.pitwall_share_session_active_v1(jsonb);
DROP TABLE IF EXISTS public.pitwall_shared_races;

COMMIT;
