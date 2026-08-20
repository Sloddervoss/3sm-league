BEGIN;

CREATE OR REPLACE FUNCTION public.endurance_replace_draft_stints(
  p_event_id uuid,
  p_team_id uuid,
  p_stints jsonb
)
RETURNS SETOF public.endurance_stints
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, auth, pg_temp
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_event public.endurance_events%ROWTYPE;
  v_team public.endurance_teams%ROWTYPE;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Permission denied' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_event FROM public.endurance_events WHERE id = p_event_id;
  SELECT * INTO v_team FROM public.endurance_teams WHERE id = p_team_id AND event_id = p_event_id;
  IF NOT FOUND OR v_event.id IS NULL THEN
    RAISE EXCEPTION 'Unknown event/team combination' USING ERRCODE = '22023';
  END IF;

  IF NOT public.is_endurance_manager(v_user_id) AND v_team.manager_id IS DISTINCT FROM v_user_id THEN
    RAISE EXCEPTION 'Permission denied' USING ERRCODE = '42501';
  END IF;

  IF p_stints IS NULL OR jsonb_typeof(p_stints) <> 'array'
     OR jsonb_array_length(p_stints) < 1 OR jsonb_array_length(p_stints) > 200 THEN
    RAISE EXCEPTION 'Stints must be a non-empty array of at most 200 items' USING ERRCODE = '22023';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.endurance_stints
    WHERE event_id = p_event_id AND team_id = p_team_id AND status <> 'draft'
  ) THEN
    RAISE EXCEPTION 'A non-draft plan already exists' USING ERRCODE = '23514';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM jsonb_to_recordset(p_stints) AS item(
      driver_id uuid, original_start_at timestamptz, original_end_at timestamptz,
      actual_start_at timestamptz, actual_end_at timestamptz,
      expected_laps integer, fuel_litres numeric, tyre_change boolean,
      double_stint boolean, notes text
    )
    WHERE item.original_start_at IS NULL OR item.original_end_at IS NULL
       OR item.actual_start_at IS NULL OR item.actual_end_at IS NULL
       OR item.original_start_at >= item.original_end_at
       OR item.actual_start_at >= item.actual_end_at
       OR item.actual_start_at < v_event.start_at OR item.actual_end_at > v_event.end_at
       OR item.expected_laps < 0 OR item.fuel_litres < 0
       OR (item.driver_id IS NOT NULL AND NOT EXISTS (
         SELECT 1 FROM public.endurance_team_members member
         WHERE member.team_id = p_team_id AND member.user_id = item.driver_id
       ))
  ) OR EXISTS (
    SELECT 1
    FROM jsonb_array_elements(p_stints) WITH ORDINALITY AS left_item(value, position)
    JOIN jsonb_array_elements(p_stints) WITH ORDINALITY AS right_item(value, position)
      ON left_item.position < right_item.position
     AND tstzrange((left_item.value->>'actual_start_at')::timestamptz, (left_item.value->>'actual_end_at')::timestamptz, '[)')
         && tstzrange((right_item.value->>'actual_start_at')::timestamptz, (right_item.value->>'actual_end_at')::timestamptz, '[)')
  ) THEN
    RAISE EXCEPTION 'Invalid or overlapping stint payload' USING ERRCODE = '22023';
  END IF;

  DELETE FROM public.endurance_stints
  WHERE event_id = p_event_id AND team_id = p_team_id AND status = 'draft';

  RETURN QUERY
  INSERT INTO public.endurance_stints (
    event_id, team_id, driver_id,
    original_start_at, original_end_at, actual_start_at, actual_end_at,
    expected_laps, fuel_litres, tyre_change, double_stint, notes, status
  )
  SELECT
    p_event_id, p_team_id, item.driver_id,
    item.original_start_at, item.original_end_at,
    item.actual_start_at, item.actual_end_at,
    item.expected_laps, item.fuel_litres,
    COALESCE(item.tyre_change, false), COALESCE(item.double_stint, false),
    item.notes, 'draft'::public.endurance_stint_status
  FROM jsonb_to_recordset(p_stints) AS item(
    driver_id uuid, original_start_at timestamptz, original_end_at timestamptz,
    actual_start_at timestamptz, actual_end_at timestamptz,
    expected_laps integer, fuel_litres numeric, tyre_change boolean,
    double_stint boolean, notes text
  )
  RETURNING *;
END;
$$;

REVOKE ALL ON FUNCTION public.endurance_replace_draft_stints(uuid, uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.endurance_replace_draft_stints(uuid, uuid, jsonb) TO authenticated;

CREATE OR REPLACE FUNCTION public.endurance_apply_stint_updates(
  p_event_id uuid,
  p_team_id uuid,
  p_stints jsonb
)
RETURNS SETOF public.endurance_stints
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, auth, pg_temp
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_team public.endurance_teams%ROWTYPE;
  v_item_count integer;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Permission denied' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_team FROM public.endurance_teams WHERE id = p_team_id AND event_id = p_event_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Unknown event/team combination' USING ERRCODE = '22023';
  END IF;
  IF NOT public.is_endurance_manager(v_user_id) AND v_team.manager_id IS DISTINCT FROM v_user_id THEN
    RAISE EXCEPTION 'Permission denied' USING ERRCODE = '42501';
  END IF;

  IF p_stints IS NULL OR jsonb_typeof(p_stints) <> 'array'
     OR jsonb_array_length(p_stints) < 1 OR jsonb_array_length(p_stints) > 200 THEN
    RAISE EXCEPTION 'Stints must be a non-empty array of at most 200 items' USING ERRCODE = '22023';
  END IF;
  v_item_count := jsonb_array_length(p_stints);

  IF (
    SELECT count(DISTINCT item.id)
    FROM jsonb_to_recordset(p_stints) AS item(
      id uuid, driver_id uuid, original_start_at timestamptz, original_end_at timestamptz,
      actual_start_at timestamptz, actual_end_at timestamptz, expected_laps integer,
      fuel_litres numeric, tyre_change boolean, double_stint boolean,
      notes text, status public.endurance_stint_status
    )
  ) <> v_item_count OR (
    SELECT count(*)
    FROM public.endurance_stints stint
    JOIN jsonb_to_recordset(p_stints) AS item(id uuid) ON item.id = stint.id
    WHERE stint.event_id = p_event_id AND stint.team_id = p_team_id
  ) <> v_item_count THEN
    RAISE EXCEPTION 'Unknown or duplicate stint id' USING ERRCODE = '22023';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM jsonb_to_recordset(p_stints) AS item(
      id uuid, driver_id uuid, original_start_at timestamptz, original_end_at timestamptz,
      actual_start_at timestamptz, actual_end_at timestamptz, expected_laps integer,
      fuel_litres numeric, tyre_change boolean, double_stint boolean,
      notes text, status public.endurance_stint_status
    )
    WHERE item.original_start_at IS NULL OR item.original_end_at IS NULL
       OR item.actual_start_at IS NULL OR item.actual_end_at IS NULL
       OR item.original_start_at >= item.original_end_at
       OR item.actual_start_at >= item.actual_end_at
       OR item.expected_laps < 0 OR item.fuel_litres < 0
       OR item.status IS NULL
       OR item.actual_start_at < (SELECT start_at FROM public.endurance_events WHERE id = p_event_id)
       OR item.actual_end_at > (SELECT end_at FROM public.endurance_events WHERE id = p_event_id)
       OR (item.driver_id IS NOT NULL AND NOT EXISTS (
         SELECT 1 FROM public.endurance_team_members member
         WHERE member.team_id = p_team_id AND member.user_id = item.driver_id
       ))
  ) OR EXISTS (
    SELECT 1
    FROM jsonb_array_elements(p_stints) WITH ORDINALITY AS left_item(value, position)
    JOIN jsonb_array_elements(p_stints) WITH ORDINALITY AS right_item(value, position)
      ON left_item.position < right_item.position
     AND tstzrange((left_item.value->>'actual_start_at')::timestamptz, (left_item.value->>'actual_end_at')::timestamptz, '[)')
         && tstzrange((right_item.value->>'actual_start_at')::timestamptz, (right_item.value->>'actual_end_at')::timestamptz, '[)')
  ) OR EXISTS (
    SELECT 1
    FROM jsonb_to_recordset(p_stints) AS item(id uuid, actual_start_at timestamptz, actual_end_at timestamptz)
    JOIN public.endurance_stints existing
      ON existing.event_id = p_event_id AND existing.team_id = p_team_id
     AND tstzrange(item.actual_start_at, item.actual_end_at, '[)')
         && tstzrange(existing.actual_start_at, existing.actual_end_at, '[)')
    WHERE NOT EXISTS (
      SELECT 1 FROM jsonb_to_recordset(p_stints) AS changed(id uuid) WHERE changed.id = existing.id
    )
  ) THEN
    RAISE EXCEPTION 'Invalid or overlapping stint payload' USING ERRCODE = '22023';
  END IF;

  RETURN QUERY
  UPDATE public.endurance_stints AS stint
  SET driver_id = item.driver_id,
      original_start_at = item.original_start_at,
      original_end_at = item.original_end_at,
      actual_start_at = item.actual_start_at,
      actual_end_at = item.actual_end_at,
      expected_laps = item.expected_laps,
      fuel_litres = item.fuel_litres,
      tyre_change = COALESCE(item.tyre_change, false),
      double_stint = COALESCE(item.double_stint, false),
      notes = item.notes,
      status = item.status,
      updated_at = now()
  FROM jsonb_to_recordset(p_stints) AS item(
    id uuid, driver_id uuid, original_start_at timestamptz, original_end_at timestamptz,
    actual_start_at timestamptz, actual_end_at timestamptz, expected_laps integer,
    fuel_litres numeric, tyre_change boolean, double_stint boolean,
    notes text, status public.endurance_stint_status
  )
  WHERE stint.id = item.id AND stint.event_id = p_event_id AND stint.team_id = p_team_id
  RETURNING stint.*;
END;
$$;

REVOKE ALL ON FUNCTION public.endurance_apply_stint_updates(uuid, uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.endurance_apply_stint_updates(uuid, uuid, jsonb) TO authenticated;

COMMIT;
