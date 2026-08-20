-- Rollback: Endurance Race Control optimistic concurrency + append-only audit.
-- Exacte inverse van 20260820160000; geen bestaande RPC-signature gewijzigd.
BEGIN;

REVOKE ALL ON FUNCTION public.endurance_race_control_apply(uuid, uuid, uuid, public.endurance_race_control_op, integer, integer, uuid, timestamptz, timestamptz) FROM PUBLIC, anon, authenticated;
DROP FUNCTION IF EXISTS public.endurance_race_control_apply(uuid, uuid, uuid, public.endurance_race_control_op, integer, integer, uuid, timestamptz, timestamptz);

REVOKE ALL ON FUNCTION public.endurance_list_race_control_audit(uuid) FROM PUBLIC, anon, authenticated;
DROP FUNCTION IF EXISTS public.endurance_list_race_control_audit(uuid);

DROP POLICY IF EXISTS "endurance race control audit super select" ON public.endurance_race_control_audit;
DROP TABLE IF EXISTS public.endurance_race_control_audit;

DROP TYPE IF EXISTS public.endurance_race_control_op;

COMMIT;