CREATE OR REPLACE FUNCTION public.simhub_start_race_run(p_event_id uuid, p_team_id uuid, p_run_kind text)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'auth', 'pg_temp'
AS $function$
DECLARE
  v_run_kind public.endurance_run_kind;
  v_team_event UUID;
  v_existing UUID;
  v_new_id UUID;
BEGIN
  -- Authorization: only service_role
  IF auth.role() <> 'service_role' THEN
    RETURN 'unauthorized';
  END IF;

  -- Validate required inputs
  IF p_event_id IS NULL OR p_team_id IS NULL OR p_run_kind IS NULL THEN
    RETURN 'invalid_input';
  END IF;

  -- Een afgerond event krijgt geen nieuwe run meer. Zonder deze grens bleef de
  -- ingest na de finish runs starten op een race die al klaar was.
  IF EXISTS (SELECT 1 FROM public.endurance_events
              WHERE id = p_event_id AND status = 'completed') THEN
    RETURN 'event_completed';
  END IF;

  -- Validate run_kind is a known enum value
  BEGIN
    v_run_kind := p_run_kind::public.endurance_run_kind;
  EXCEPTION WHEN others THEN
    RETURN 'invalid_run_kind';
  END;

  -- Validate event exists
  IF NOT EXISTS (SELECT 1 FROM public.endurance_events WHERE id = p_event_id) THEN
    RETURN 'invalid_event';
  END IF;

  -- Validate team exists and belongs to the event
  SELECT event_id INTO v_team_event
    FROM public.endurance_teams
   WHERE id = p_team_id;
  IF v_team_event IS NULL THEN
    RETURN 'invalid_team';
  END IF;
  IF v_team_event <> p_event_id THEN
    RETURN 'invalid_binding';
  END IF;

  -- Check if an active run already exists for this (event, team, run_kind)
  SELECT id INTO v_existing
    FROM public.endurance_race_runs
   WHERE event_id = p_event_id
     AND team_id = p_team_id
     AND run_kind = v_run_kind
     AND status = 'active'
   LIMIT 1;

  IF FOUND THEN
    RETURN 'already_active';
  END IF;

  -- Create the new run
  INSERT INTO public.endurance_race_runs (event_id, team_id, run_kind, status, started_at)
  VALUES (p_event_id, p_team_id, v_run_kind, 'active', now())
  RETURNING id INTO v_new_id;

  RETURN 'accepted';
END;
$function$;
