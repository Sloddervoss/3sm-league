-- Rollback: remove only the publication entries introduced by 20260820170000.
BEGIN;

DROP POLICY IF EXISTS "endurance race control audit managers select"
  ON public.endurance_race_control_audit;

ALTER PUBLICATION supabase_realtime DROP TABLE public.endurance_registrations;
ALTER PUBLICATION supabase_realtime DROP TABLE public.endurance_pace_entries;
ALTER PUBLICATION supabase_realtime DROP TABLE public.endurance_practice_sessions;
ALTER PUBLICATION supabase_realtime DROP TABLE public.endurance_practice_laps;
ALTER PUBLICATION supabase_realtime DROP TABLE public.endurance_confirmations;
ALTER PUBLICATION supabase_realtime DROP TABLE public.endurance_race_control_audit;

COMMIT;
