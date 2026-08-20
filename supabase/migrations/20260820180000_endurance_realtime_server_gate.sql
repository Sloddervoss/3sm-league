-- Strict server-side Endurance Realtime gate via a dedicated carrier table.
-- Domain tables leave supabase_realtime so normal SELECT RLS cannot implicitly
-- grant postgres_changes. The carrier has independent staff/member+flag RLS.
BEGIN;

CREATE TABLE public.endurance_realtime_stream (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  source_table text NOT NULL CHECK (source_table = ANY (ARRAY[
    'endurance_events','endurance_registrations','endurance_availability',
    'endurance_pace_entries','endurance_practice_sessions','endurance_practice_laps',
    'endurance_teams','endurance_team_members','endurance_stints',
    'endurance_planning_versions','endurance_confirmations',
    'endurance_notifications','endurance_race_control_audit'
  ])),
  event_id uuid,
  team_id uuid,
  user_id uuid,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX endurance_realtime_stream_event_idx ON public.endurance_realtime_stream (event_id, id);
CREATE INDEX endurance_realtime_stream_user_idx ON public.endurance_realtime_stream (user_id, id);
CREATE INDEX endurance_realtime_stream_created_idx ON public.endurance_realtime_stream (created_at);

ALTER TABLE public.endurance_realtime_stream ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.endurance_realtime_stream FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.endurance_realtime_stream TO authenticated;

CREATE POLICY "endurance realtime stream authorized select"
  ON public.endurance_realtime_stream
  FOR SELECT TO authenticated
  USING (
    public.is_endurance_manager(auth.uid())
    OR (
      (
        public.is_endurance_staff(auth.uid())
        OR EXISTS (
          SELECT 1 FROM public.endurance_current_capabilities() capability
          WHERE capability.can_access AND capability.multi_user_realtime_enabled
        )
      )
      AND CASE
        WHEN source_table = 'endurance_events' THEN
          event_id IS NOT NULL AND public.endurance_can_discover_event(event_id, auth.uid())
        WHEN source_table IN ('endurance_registrations', 'endurance_notifications') THEN
          user_id = auth.uid()
        WHEN source_table = 'endurance_race_control_audit' THEN
          EXISTS (
            SELECT 1 FROM public.endurance_teams team
            WHERE team.id = endurance_realtime_stream.team_id
              AND team.manager_id = auth.uid()
          )
        ELSE
          event_id IS NOT NULL AND public.endurance_is_participant(event_id, auth.uid())
      END
    )
  );

CREATE OR REPLACE FUNCTION public.endurance_realtime_enqueue()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_row jsonb := CASE WHEN TG_OP = 'DELETE' THEN to_jsonb(OLD) ELSE to_jsonb(NEW) END;
  v_event_id uuid;
  v_team_id uuid;
  v_user_id uuid;
BEGIN
  v_event_id := CASE
    WHEN TG_TABLE_NAME = 'endurance_events' THEN NULLIF(v_row ->> 'id', '')::uuid
    ELSE NULLIF(v_row ->> 'event_id', '')::uuid
  END;
  v_team_id := NULLIF(v_row ->> 'team_id', '')::uuid;
  v_user_id := NULLIF(v_row ->> 'user_id', '')::uuid;

  INSERT INTO public.endurance_realtime_stream (source_table, event_id, team_id, user_id)
  VALUES (TG_TABLE_NAME, v_event_id, v_team_id, v_user_id);

  -- Signal-only retention: domain data remains authoritative; stream rows older
  -- than 24h have no replay value and are removed opportunistically.
  DELETE FROM public.endurance_realtime_stream
  WHERE created_at < clock_timestamp() - interval '24 hours';
  RETURN NULL;
EXCEPTION WHEN OTHERS THEN
  -- Realtime is best-effort and may never abort the authoritative domain write.
  RAISE WARNING 'Endurance realtime enqueue failed for %.%: %', TG_TABLE_SCHEMA, TG_TABLE_NAME, SQLERRM;
  RETURN NULL;
END;
$$;
REVOKE ALL ON FUNCTION public.endurance_realtime_enqueue() FROM PUBLIC, anon, authenticated;

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
    EXECUTE format(
      'CREATE TRIGGER endurance_realtime_enqueue_trg AFTER INSERT OR UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.endurance_realtime_enqueue()',
      table_name
    );
  END LOOP;
END;
$$;

-- Critical gate: unpublished domain tables cannot be streamed by a custom client,
-- even when ordinary members retain SELECT rights for normal HTTP/RPC reads.
ALTER PUBLICATION supabase_realtime DROP TABLE public.endurance_events;
ALTER PUBLICATION supabase_realtime DROP TABLE public.endurance_registrations;
ALTER PUBLICATION supabase_realtime DROP TABLE public.endurance_availability;
ALTER PUBLICATION supabase_realtime DROP TABLE public.endurance_pace_entries;
ALTER PUBLICATION supabase_realtime DROP TABLE public.endurance_practice_sessions;
ALTER PUBLICATION supabase_realtime DROP TABLE public.endurance_practice_laps;
ALTER PUBLICATION supabase_realtime DROP TABLE public.endurance_teams;
ALTER PUBLICATION supabase_realtime DROP TABLE public.endurance_team_members;
ALTER PUBLICATION supabase_realtime DROP TABLE public.endurance_stints;
ALTER PUBLICATION supabase_realtime DROP TABLE public.endurance_planning_versions;
ALTER PUBLICATION supabase_realtime DROP TABLE public.endurance_confirmations;
ALTER PUBLICATION supabase_realtime DROP TABLE public.endurance_notifications;
ALTER PUBLICATION supabase_realtime DROP TABLE public.endurance_race_control_audit;
ALTER PUBLICATION supabase_realtime ADD TABLE public.endurance_realtime_stream;

COMMIT;
