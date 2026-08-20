-- Rollback: remove only the alpha-role policies, before helper functions/tables.
BEGIN;

DO $$
DECLARE
  t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'endurance_events',
    'endurance_registrations',
    'endurance_availability',
    'endurance_pace_entries',
    'endurance_teams',
    'endurance_team_members',
    'endurance_stints',
    'endurance_planning_versions',
    'endurance_confirmations',
    'endurance_notifications',
    'endurance_audit_log',
    'endurance_practice_sessions',
    'endurance_practice_laps'
  ] LOOP
    EXECUTE format('DROP POLICY IF EXISTS "endurance manager all" ON public.%I', t);
    EXECUTE format('DROP POLICY IF EXISTS "endurance staff view" ON public.%I', t);
  END LOOP;
END;
$$;

DROP POLICY IF EXISTS "endurance staff own registration" ON public.endurance_registrations;
DROP POLICY IF EXISTS "endurance staff own availability" ON public.endurance_availability;

COMMIT;
