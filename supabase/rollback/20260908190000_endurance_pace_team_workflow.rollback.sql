-- Revert workflow behavior without deleting participant preferences, teams or plans.
-- Additive columns and prerequisite uniqueness invariants are deliberately retained.
-- Deploy the previous frontend before applying this rollback.
BEGIN;
DROP TRIGGER IF EXISTS endurance_draft_review ON public.endurance_stints;
DROP TRIGGER IF EXISTS endurance_roster_team_guard ON public.endurance_teams;
DROP TRIGGER IF EXISTS endurance_roster_member_guard ON public.endurance_team_members;
DROP TRIGGER IF EXISTS endurance_roster_review ON public.endurance_team_members;
DROP TRIGGER IF EXISTS endurance_availability_review ON public.endurance_availability;
DROP TRIGGER IF EXISTS endurance_registration_review ON public.endurance_registrations;
DROP TRIGGER IF EXISTS endurance_registration_lock ON public.endurance_registrations;
DROP TRIGGER IF EXISTS endurance_availability_lock ON public.endurance_availability;
DROP TRIGGER IF EXISTS endurance_pace_lock ON public.endurance_pace_entries;
DROP TRIGGER IF EXISTS endurance_event_roster_guard ON public.endurance_events;
DROP TRIGGER IF EXISTS endurance_validate_plan_version ON public.endurance_planning_versions;
DROP TRIGGER IF EXISTS endurance_confirmation_current_plan ON public.endurance_confirmations;
DROP TRIGGER IF EXISTS endurance_practice_context ON public.endurance_practice_sessions;
DROP POLICY IF EXISTS "endurance event manager teams" ON public.endurance_teams;
DROP POLICY IF EXISTS "endurance event manager members" ON public.endurance_team_members;
DROP POLICY IF EXISTS "endurance event manager availability" ON public.endurance_availability;
DROP POLICY IF EXISTS "endurance event manager pace" ON public.endurance_pace_entries;
DROP POLICY IF EXISTS "endurance event manager practice" ON public.endurance_practice_sessions;
DROP POLICY IF EXISTS "endurance event manager laps" ON public.endurance_practice_laps;
DROP POLICY IF EXISTS "endurance assigned manager stints" ON public.endurance_stints;
DROP POLICY IF EXISTS "endurance event manager plans" ON public.endurance_planning_versions;
DROP POLICY IF EXISTS "endurance event manager confirmations" ON public.endurance_confirmations;
DROP POLICY IF EXISTS "endurance roster manager registrations" ON public.endurance_registrations;
CREATE OR REPLACE FUNCTION public.endurance_publish_plan(
  p_event_id uuid,
  p_team_id uuid,
  p_label text,
  p_stints jsonb,
  p_confirmations jsonb
)
RETURNS public.endurance_planning_versions
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, auth, pg_temp
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_team public.endurance_teams%ROWTYPE;
  v_created_version public.endurance_planning_versions;
  v_confirm RECORD;
  v_json_status public.endurance_confirmation_status;
BEGIN
  -- Expliciet client-auth: anon / geen sessie wordt hard geweigerd.
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501';
  END IF;

  -- Serialiseer ook de eerste publicatie, wanneer nog geen published rij bestaat.
  PERFORM pg_advisory_xact_lock(hashtextextended(p_event_id::text || ':' || p_team_id::text, 0));

  SELECT team.* INTO v_team
  FROM public.endurance_teams AS team
  WHERE team.id = p_team_id AND team.event_id = p_event_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Unknown event/team combination' USING ERRCODE = '22023';
  END IF;

  -- Globale Endurance Managers én de toegewezen manager van deze crew mogen
  -- publiceren. Dit sluit aan op de bestaande StintPlanner-editability.
  IF NOT public.is_endurance_manager(v_user_id) AND v_team.manager_id IS DISTINCT FROM v_user_id THEN
    RAISE EXCEPTION 'Permission denied' USING ERRCODE = '42501';
  END IF;

  IF p_label IS NULL OR char_length(trim(p_label)) = 0 THEN
    RAISE EXCEPTION 'Label is required' USING ERRCODE = '22023';
  END IF;

  IF p_stints IS NULL OR jsonb_typeof(p_stints) <> 'array' THEN
    RAISE EXCEPTION 'Stints must be a JSON array' USING ERRCODE = '22023';
  END IF;

  IF p_confirmations IS NULL OR jsonb_typeof(p_confirmations) <> 'array' THEN
    RAISE EXCEPTION 'Confirmations must be a JSON array' USING ERRCODE = '22023';
  END IF;

  IF jsonb_array_length(p_confirmations) > 500 THEN
    RAISE EXCEPTION 'Too many confirmations' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM jsonb_to_recordset(p_confirmations) AS item(user_id uuid)
    GROUP BY item.user_id
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'Duplicate confirmation user_id' USING ERRCODE = '22023';
  END IF;

  -- Nieuwe gepubliceerde versie deelt de vorige uit: exact één actieve.
  UPDATE public.endurance_planning_versions
  SET published = false
  WHERE event_id = p_event_id AND team_id = p_team_id AND published = true;

  INSERT INTO public.endurance_planning_versions (
    event_id, team_id, label, created_by, published, stints, created_at
  ) VALUES (
    p_event_id, p_team_id, trim(p_label), v_user_id, true, p_stints, now()
  )
  RETURNING * INTO v_created_version;

  -- Alle confirmations in dezelfde transactie als de versie (atomic publicatie).
  FOR v_confirm IN SELECT * FROM jsonb_to_recordset(p_confirmations) AS item(
    user_id uuid, status text, note text
  )
  LOOP
    IF v_confirm.user_id IS NULL THEN
      RAISE EXCEPTION 'Confirmation user_id is required' USING ERRCODE = '22023';
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM public.endurance_team_members AS member
      WHERE member.team_id = p_team_id AND member.user_id = v_confirm.user_id
    ) THEN
      RAISE EXCEPTION 'Confirmation user is not a member of this team' USING ERRCODE = '22023';
    END IF;
    BEGIN
      v_json_status := COALESCE(v_confirm.status::public.endurance_confirmation_status, 'unseen');
    EXCEPTION WHEN invalid_text_representation OR invalid_parameter_value THEN
      RAISE EXCEPTION 'Invalid confirmation status' USING ERRCODE = '22023';
    END;

    INSERT INTO public.endurance_confirmations (
      event_id, version_id, user_id, status, note, updated_at
    ) VALUES (
      p_event_id, v_created_version.id, v_confirm.user_id, v_json_status, v_confirm.note, now()
    );
  END LOOP;

  RETURN v_created_version;
END;
$$;

REVOKE ALL ON FUNCTION public.endurance_publish_plan(uuid, uuid, text, jsonb, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.endurance_publish_plan(uuid, uuid, text, jsonb, jsonb) TO authenticated;

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

DROP FUNCTION IF EXISTS public.endurance_sync_practice_pace(uuid,text);
DROP FUNCTION IF EXISTS public.endurance_practice_context();
DROP FUNCTION IF EXISTS public.endurance_confirmation_current_plan();
DROP FUNCTION IF EXISTS public.endurance_validate_plan_version();
DROP FUNCTION IF EXISTS public.endurance_event_roster_guard();
DROP FUNCTION IF EXISTS public.endurance_lock_roster_input();
DROP FUNCTION IF EXISTS public.endurance_manage_team(uuid,text,jsonb);
DROP FUNCTION IF EXISTS public.endurance_apply_team_proposal(uuid,text,jsonb);
DROP FUNCTION IF EXISTS public.endurance_mark_plan_review();
DROP FUNCTION IF EXISTS public.endurance_roster_guard();
DROP FUNCTION IF EXISTS public.endurance_team_workspace(uuid);
DROP FUNCTION IF EXISTS public.endurance_can_manage_roster(uuid);
NOTIFY pgrst, 'reload schema';
COMMIT;
