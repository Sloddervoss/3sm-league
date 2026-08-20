-- Rollback: restore direct filtered domain-table publication used by phase 4A.
BEGIN;

ALTER PUBLICATION supabase_realtime DROP TABLE public.endurance_realtime_stream;
ALTER PUBLICATION supabase_realtime ADD TABLE public.endurance_events;
ALTER PUBLICATION supabase_realtime ADD TABLE public.endurance_registrations;
ALTER PUBLICATION supabase_realtime ADD TABLE public.endurance_availability;
ALTER PUBLICATION supabase_realtime ADD TABLE public.endurance_pace_entries;
ALTER PUBLICATION supabase_realtime ADD TABLE public.endurance_practice_sessions;
ALTER PUBLICATION supabase_realtime ADD TABLE public.endurance_practice_laps;
ALTER PUBLICATION supabase_realtime ADD TABLE public.endurance_teams;
ALTER PUBLICATION supabase_realtime ADD TABLE public.endurance_team_members;
ALTER PUBLICATION supabase_realtime ADD TABLE public.endurance_stints;
ALTER PUBLICATION supabase_realtime ADD TABLE public.endurance_planning_versions;
ALTER PUBLICATION supabase_realtime ADD TABLE public.endurance_confirmations;
ALTER PUBLICATION supabase_realtime ADD TABLE public.endurance_notifications;
ALTER PUBLICATION supabase_realtime ADD TABLE public.endurance_race_control_audit;

DO $$
DECLARE
  table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'endurance_events','endurance_registrations','endurance_availability',
    'endurance_pace_entries','endurance_practice_sessions','endurance_practice_laps',
    'endurance_teams','endurance_team_members','endurance_stints',
    'endurance_planning_versions','endurance_confirmations',
    'endurance_notifications','endurance_race_control_audit'
  ] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS endurance_realtime_enqueue_trg ON public.%I', table_name);
  END LOOP;
END;
$$;

DROP FUNCTION IF EXISTS public.endurance_realtime_enqueue();
DROP POLICY IF EXISTS "endurance realtime stream authorized select" ON public.endurance_realtime_stream;
DROP TABLE public.endurance_realtime_stream;

COMMIT;
