-- ============================================================================
-- S2E2 — paired rollback van public.simhub_observation_policy_v1(text)
--
-- Verwijdert uitsluitend de nieuwe functie uit 20261114000945. Geen tabellen,
-- kolommen, data, policyrijen, andere functies of andere grants worden
-- aangeraakt. Idempotent: een tweede toepassing is een no-op.
-- ============================================================================

DO $guard$
BEGIN
  IF to_regprocedure('public.simhub_observation_policy_v1(text)') IS NULL THEN
    RAISE NOTICE 'public.simhub_observation_policy_v1(text) already absent; nothing to drop';
    RETURN;
  END IF;
  IF user <> 'supabase_admin' AND current_user <> 'supabase_admin'
     AND NOT EXISTS (
       SELECT 1 FROM pg_roles
        WHERE rolname = current_user AND rolsuper
     ) THEN
    RAISE EXCEPTION 'rollback must run as migration owner or superuser'
      USING ERRCODE = 'PWL23';
  END IF;
END
$guard$;

DROP FUNCTION IF EXISTS public.simhub_observation_policy_v1(text);
