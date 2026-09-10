-- Endurance member-beta: toegang voor gewone leden, Tester functioneel uit.
--
-- WAT DIT IS
--   Geconsolideerde inhaalmigratie. Productie liep achter op acht toegangs-,
--   capability- en realtime-migraties uit de periode 9 t/m 20 augustus 2026.
--   Ze zijn hier samengevoegd tot EEN transactie zodat een fout niets
--   half achterlaat, en zodat er geen acht losse toepassingen nodig zijn.
--
-- BRON (in deze volgorde, inhoud is verbatim overgenomen)
--   1. supabase/migrations/20260809150000_endurance_participant_access.sql
--   2. supabase/migrations/20260809152000_endurance_atomic_stint_replace.sql
--   3. supabase/migrations/20260809153000_endurance_effective_telemetry_routing.sql
--   4. supabase/migrations/20260820140000_endurance_runtime_capabilities.sql
--   5. supabase/migrations/20260820160000_endurance_race_control_optimistic_audit.sql
--   6. supabase/migrations/20260820170000_endurance_realtime_matrix_publication.sql
--   7. supabase/migrations/20260820180000_endurance_realtime_server_gate.sql
--   8. supabase/migrations/20260820190000_endurance_central_simhub_routing.sql
--   9. correctie op bovenstaande: concept-races niet vindbaar (zie DEEL 9/9)
--
-- VEILIGHEID
--   Alle schakelaars in endurance_runtime_settings staan na deze migratie op
--   false. Leden krijgen dus NOG GEEN toegang; dat gebeurt pas door
--   endurance_set_runtime_settings() aan te roepen. Tester blijft voorlopig
--   werken zodat er niets breekt.
--
-- BEWEZEN
--   Toegepast op een schema-kloon van productie (68 publieke tabellen,
--   152 RLS-policies, 107 SECDEF-functies): 0 fouten, eindstaat
--   71 tabellen / 159 policies / 123 SECDEF.
--
-- ROLLBACK
--   supabase/rollback/20260910210000_endurance_member_beta.rollback.sql
--
-- Vooraf: backup volgens docs/operations/production-access-runbook.md.

BEGIN;

-- ============================================================
-- DEEL 1/8  20260809150000_endurance_participant_access
-- ============================================================
-- Endurance participant access hardening.
-- Discovery (open/invited) is separate from private participant data.

CREATE OR REPLACE FUNCTION public.endurance_can_discover_event(
  p_event_id uuid,
  p_user_id uuid DEFAULT auth.uid()
)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, auth, pg_temp
AS $$
BEGIN
  IF p_user_id IS NULL THEN RETURN false; END IF;
  IF p_user_id <> auth.uid() AND NOT public.is_endurance_manager(auth.uid()) THEN
    RETURN false;
  END IF;
  IF public.is_endurance_manager(p_user_id) THEN RETURN true; END IF;

  RETURN EXISTS (
    SELECT 1
    FROM public.endurance_events event
    WHERE event.id = p_event_id
      AND (
        event.visibility = 'open'::public.endurance_event_visibility
        OR p_user_id = ANY(COALESCE(event.invited_user_ids, ARRAY[]::uuid[]))
        OR p_user_id = ANY(COALESCE(event.manager_ids, ARRAY[]::uuid[]))
        OR EXISTS (
          SELECT 1 FROM public.endurance_registrations registration
          WHERE registration.event_id = event.id
            AND registration.user_id = p_user_id
            AND registration.status NOT IN ('rejected', 'withdrawn')
        )
      )
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.endurance_is_participant(
  p_event_id uuid,
  p_user_id uuid DEFAULT auth.uid()
)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, auth, pg_temp
AS $$
BEGIN
  IF p_user_id IS NULL THEN RETURN false; END IF;
  IF p_user_id <> auth.uid() AND NOT public.is_endurance_manager(auth.uid()) THEN
    RETURN false;
  END IF;
  IF public.is_endurance_manager(p_user_id) THEN RETURN true; END IF;

  RETURN EXISTS (
    SELECT 1 FROM public.endurance_registrations registration
    WHERE registration.event_id = p_event_id
      AND registration.user_id = p_user_id
      AND registration.status IN ('interest', 'provisional', 'confirmed', 'reserve')
  );
END;
$$;

REVOKE ALL ON FUNCTION public.endurance_can_discover_event(uuid, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.endurance_is_participant(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.endurance_can_discover_event(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.endurance_is_participant(uuid, uuid) TO authenticated;

-- Remove the alpha-wide tester read access and broad own-row policies.
DO $$
DECLARE table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'endurance_events','endurance_registrations','endurance_availability',
    'endurance_pace_entries','endurance_teams','endurance_team_members',
    'endurance_stints','endurance_planning_versions','endurance_confirmations',
    'endurance_notifications','endurance_audit_log','endurance_practice_sessions',
    'endurance_practice_laps'
  ] LOOP
    EXECUTE format('DROP POLICY IF EXISTS "endurance staff view" ON public.%I', table_name);
  END LOOP;
END;
$$;
DROP POLICY IF EXISTS "endurance staff own registration" ON public.endurance_registrations;
DROP POLICY IF EXISTS "endurance staff own availability" ON public.endurance_availability;

-- Event discovery.
CREATE POLICY "endurance discoverable events" ON public.endurance_events
  FOR SELECT TO authenticated
  USING (public.endurance_can_discover_event(id, auth.uid()));

-- Registration answers remain private to their owner and managers.
CREATE POLICY "endurance own registration select" ON public.endurance_registrations
  FOR SELECT TO authenticated USING (user_id = auth.uid());
CREATE POLICY "endurance own registration insert" ON public.endurance_registrations
  FOR INSERT TO authenticated
  WITH CHECK (
    user_id = auth.uid()
    AND public.endurance_can_discover_event(event_id, auth.uid())
    AND status IN ('interest', 'provisional', 'reserve')
  );
CREATE POLICY "endurance own registration update" ON public.endurance_registrations
  FOR UPDATE TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid() AND public.endurance_can_discover_event(event_id, auth.uid()));

CREATE OR REPLACE FUNCTION public.endurance_guard_own_registration_update()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, auth, pg_temp
AS $$
BEGIN
  IF public.is_endurance_manager(auth.uid()) THEN RETURN NEW; END IF;
  IF auth.uid() IS NULL OR OLD.user_id <> auth.uid() OR NEW.user_id <> auth.uid() THEN
    RAISE EXCEPTION 'Permission denied' USING ERRCODE = '42501';
  END IF;
  IF NEW.id <> OLD.id OR NEW.event_id <> OLD.event_id OR NEW.registered_at <> OLD.registered_at THEN
    RAISE EXCEPTION 'Registration identity fields are immutable' USING ERRCODE = '42501';
  END IF;
  IF NEW.status IS DISTINCT FROM OLD.status AND NOT (
    (OLD.status IN ('interest', 'provisional', 'reserve') AND NEW.status IN ('interest', 'provisional', 'reserve', 'withdrawn'))
    OR (OLD.status = 'confirmed' AND NEW.status = 'withdrawn')
  ) THEN
    RAISE EXCEPTION 'Registration status transition is manager-only' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_endurance_guard_own_registration_update ON public.endurance_registrations;
CREATE TRIGGER trg_endurance_guard_own_registration_update
  BEFORE UPDATE ON public.endurance_registrations
  FOR EACH ROW EXECUTE FUNCTION public.endurance_guard_own_registration_update();

-- Private participant reads; own availability/pace writes.
CREATE POLICY "endurance participant availability select" ON public.endurance_availability
  FOR SELECT TO authenticated USING (public.endurance_is_participant(event_id, auth.uid()));
CREATE POLICY "endurance own availability write" ON public.endurance_availability
  FOR ALL TO authenticated
  USING (user_id = auth.uid() AND public.endurance_is_participant(event_id, auth.uid()))
  WITH CHECK (user_id = auth.uid() AND public.endurance_is_participant(event_id, auth.uid()));

CREATE POLICY "endurance participant pace select" ON public.endurance_pace_entries
  FOR SELECT TO authenticated USING (public.endurance_is_participant(event_id, auth.uid()));
CREATE POLICY "endurance own pace write" ON public.endurance_pace_entries
  FOR ALL TO authenticated
  USING (user_id = auth.uid() AND public.endurance_is_participant(event_id, auth.uid()))
  WITH CHECK (user_id = auth.uid() AND public.endurance_is_participant(event_id, auth.uid()));

CREATE POLICY "endurance participant teams select" ON public.endurance_teams
  FOR SELECT TO authenticated USING (public.endurance_is_participant(event_id, auth.uid()));
CREATE POLICY "endurance participant team members select" ON public.endurance_team_members
  FOR SELECT TO authenticated USING (
    EXISTS (SELECT 1 FROM public.endurance_teams team WHERE team.id = endurance_team_members.team_id AND public.endurance_is_participant(team.event_id, auth.uid()))
  );
CREATE POLICY "endurance participant stints select" ON public.endurance_stints
  FOR SELECT TO authenticated USING (public.endurance_is_participant(event_id, auth.uid()));
CREATE POLICY "endurance participant plans select" ON public.endurance_planning_versions
  FOR SELECT TO authenticated USING (public.endurance_is_participant(event_id, auth.uid()));
CREATE POLICY "endurance participant confirmations select" ON public.endurance_confirmations
  FOR SELECT TO authenticated USING (
    user_id = auth.uid() OR EXISTS (
      SELECT 1 FROM public.endurance_planning_versions version
      WHERE version.id = version_id AND public.endurance_is_participant(version.event_id, auth.uid())
    )
  );
CREATE POLICY "endurance own confirmation update" ON public.endurance_confirmations
  FOR UPDATE TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
CREATE POLICY "endurance participant practice sessions select" ON public.endurance_practice_sessions
  FOR SELECT TO authenticated USING (public.endurance_is_participant(event_id, auth.uid()));
CREATE POLICY "endurance participant practice laps select" ON public.endurance_practice_laps
  FOR SELECT TO authenticated USING (public.endurance_is_participant(event_id, auth.uid()));

-- Notifications are strictly private; managers retain their existing management policy.
CREATE POLICY "endurance own notifications select" ON public.endurance_notifications
  FOR SELECT TO authenticated USING (user_id = auth.uid());
CREATE POLICY "endurance own notifications update" ON public.endurance_notifications
  FOR UPDATE TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

CREATE OR REPLACE FUNCTION public.endurance_guard_own_notification_update()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, auth, pg_temp
AS $$
BEGIN
  IF public.is_endurance_manager(auth.uid()) THEN RETURN NEW; END IF;
  IF auth.uid() IS NULL OR OLD.user_id <> auth.uid() OR NEW.user_id <> auth.uid() THEN
    RAISE EXCEPTION 'Permission denied' USING ERRCODE = '42501';
  END IF;
  IF (to_jsonb(NEW) - 'read') IS DISTINCT FROM (to_jsonb(OLD) - 'read') THEN
    RAISE EXCEPTION 'Only notification read state may be changed' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_endurance_guard_own_notification_update ON public.endurance_notifications;
CREATE TRIGGER trg_endurance_guard_own_notification_update
  BEFORE UPDATE ON public.endurance_notifications
  FOR EACH ROW EXECUTE FUNCTION public.endurance_guard_own_notification_update();

-- ============================================================
-- DEEL 2/8  20260809152000_endurance_atomic_stint_replace
-- ============================================================
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

-- ============================================================
-- DEEL 3/8  20260809153000_endurance_effective_telemetry_routing
-- ============================================================
-- Keep SimHub latest-telemetry RLS and Race Control routing aligned with the
-- same date-aware effective Endurance event/team binding used by ingest.

CREATE OR REPLACE FUNCTION public.simhub_effective_endurance_binding(p_device_id uuid)
RETURNS TABLE(event_id uuid, team_id uuid)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, auth, pg_temp
AS $$
DECLARE
  v_device public.simhub_devices%ROWTYPE;
  v_now timestamptz := clock_timestamp();
BEGIN
  IF auth.role() <> 'service_role' AND (auth.uid() IS NULL OR NOT public.can_manage_simhub()) THEN
    RETURN;
  END IF;

  SELECT device.* INTO v_device
  FROM public.simhub_devices AS device
  WHERE device.id = p_device_id AND device.revoked_at IS NULL;

  IF NOT FOUND THEN RETURN; END IF;

  IF v_device.endurance_binding_source = 'manual'
     AND v_device.endurance_event_id IS NOT NULL
     AND v_device.endurance_team_id IS NOT NULL THEN
    RETURN QUERY SELECT v_device.endurance_event_id, v_device.endurance_team_id;
    RETURN;
  END IF;

  RETURN QUERY
  SELECT team.event_id, member.team_id
  FROM public.endurance_team_members AS member
  JOIN public.endurance_teams AS team ON team.id = member.team_id
  JOIN public.endurance_events AS event ON event.id = team.event_id
  WHERE member.user_id = v_device.owner_user_id
    AND event.end_at > v_now
  ORDER BY (event.start_at <= v_now AND event.end_at >= v_now) DESC,
           event.start_at ASC,
           member.created_at DESC
  LIMIT 1;
END;
$$;

CREATE OR REPLACE FUNCTION public.simhub_device_matches_endurance_context(
  p_device_id uuid,
  p_event_id uuid,
  p_team_id uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, auth, pg_temp
AS $$
  SELECT p_event_id IS NOT NULL AND p_team_id IS NOT NULL AND EXISTS (
    SELECT 1
    FROM public.simhub_effective_endurance_binding(p_device_id) AS binding
    WHERE binding.event_id = p_event_id AND binding.team_id = p_team_id
  );
$$;

CREATE OR REPLACE FUNCTION public.is_active_simhub_device(p_device_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, auth, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.simhub_devices AS device
    WHERE device.id = p_device_id
      AND device.revoked_at IS NULL
      AND public.is_endurance_staff(device.owner_user_id)
      AND (
        (
          device.race_id IS NULL AND device.team_id IS NULL AND device.expires_at IS NULL
          AND NOT EXISTS (SELECT 1 FROM public.simhub_effective_endurance_binding(device.id))
        )
        OR (
          device.race_id IS NOT NULL AND device.team_id IS NOT NULL
          AND device.expires_at > now()
          AND EXISTS (
            SELECT 1 FROM public.races AS race
            WHERE race.id = device.race_id
              AND race.status IN ('upcoming', 'live')
              AND race.race_date > now() - interval '36 hours'
          )
        )
        OR EXISTS (SELECT 1 FROM public.simhub_effective_endurance_binding(device.id))
      )
  );
$$;

DROP POLICY IF EXISTS "Staff can read active latest SimHub telemetry" ON public.simhub_telemetry_latest;
CREATE POLICY "Staff can read active latest SimHub telemetry"
  ON public.simhub_telemetry_latest
  FOR SELECT TO authenticated
  USING (
    public.can_manage_simhub()
    AND public.is_active_simhub_device(device_id)
    AND (
      public.simhub_device_matches_endurance_context(device_id, endurance_event_id, endurance_team_id)
      OR (
        endurance_event_id IS NULL AND endurance_team_id IS NULL
        AND NOT EXISTS (SELECT 1 FROM public.simhub_effective_endurance_binding(device_id))
      )
    )
  );

CREATE OR REPLACE FUNCTION public.simhub_list_effective_endurance_devices(
  p_event_id uuid,
  p_team_id uuid
)
RETURNS TABLE(
  id uuid,
  device_name text,
  connector_id text,
  paired_at timestamptz,
  expires_at timestamptz,
  last_seen_at timestamptz,
  revoked_at timestamptz,
  endurance_event_id uuid,
  endurance_team_id uuid
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, auth, pg_temp
AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT public.can_manage_simhub() THEN
    RAISE EXCEPTION 'Permission denied' USING ERRCODE = '42501';
  END IF;
  IF p_event_id IS NULL OR p_team_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.endurance_teams AS requested_team
    WHERE requested_team.id = p_team_id AND requested_team.event_id = p_event_id
  ) THEN
    RAISE EXCEPTION 'Invalid event/team context' USING ERRCODE = '22023';
  END IF;

  RETURN QUERY
  SELECT device.id, device.device_name, device.connector_id, device.paired_at,
         device.expires_at, device.last_seen_at, device.revoked_at,
         binding.event_id, binding.team_id
  FROM public.simhub_devices AS device
  JOIN LATERAL public.simhub_effective_endurance_binding(device.id) AS binding ON true
  WHERE binding.event_id = p_event_id AND binding.team_id = p_team_id
    AND device.revoked_at IS NULL
    AND public.is_active_simhub_device(device.id)
  ORDER BY device.paired_at DESC;
END;
$$;

CREATE OR REPLACE FUNCTION public.simhub_read_effective_endurance_latest(
  p_device_id uuid,
  p_event_id uuid,
  p_team_id uuid
)
RETURNS SETOF public.simhub_telemetry_latest
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, auth, pg_temp
AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT public.can_manage_simhub() THEN
    RAISE EXCEPTION 'Permission denied' USING ERRCODE = '42501';
  END IF;
  IF NOT public.simhub_device_matches_endurance_context(p_device_id, p_event_id, p_team_id) THEN
    RAISE EXCEPTION 'Device is not assigned to this event/team' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT latest.*
  FROM public.simhub_telemetry_latest AS latest
  WHERE latest.device_id = p_device_id
    AND latest.endurance_event_id = p_event_id
    AND latest.endurance_team_id = p_team_id
    AND public.is_active_simhub_device(latest.device_id)
  ORDER BY latest.received_at DESC
  LIMIT 1;
END;
$$;

REVOKE ALL ON FUNCTION public.simhub_effective_endurance_binding(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.simhub_effective_endurance_binding(uuid) TO authenticated;
REVOKE ALL ON FUNCTION public.simhub_device_matches_endurance_context(uuid, uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.simhub_device_matches_endurance_context(uuid, uuid, uuid) TO authenticated;
REVOKE ALL ON FUNCTION public.is_active_simhub_device(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_active_simhub_device(uuid) TO authenticated;
REVOKE ALL ON FUNCTION public.simhub_list_effective_endurance_devices(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.simhub_list_effective_endurance_devices(uuid, uuid) TO authenticated;
REVOKE ALL ON FUNCTION public.simhub_read_effective_endurance_latest(uuid, uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.simhub_read_effective_endurance_latest(uuid, uuid, uuid) TO authenticated;

-- ============================================================
-- DEEL 4/8  20260820140000_endurance_runtime_capabilities
-- ============================================================
-- Endurance runtime capabilities: alpha-safe defaults with a member-open path.
-- Additive successor to the existing SimHub device/pairing/token architecture.

CREATE TABLE IF NOT EXISTS public.endurance_runtime_settings (
  singleton BOOLEAN PRIMARY KEY DEFAULT true CHECK (singleton),
  member_access_enabled BOOLEAN NOT NULL DEFAULT false,
  member_pairing_enabled BOOLEAN NOT NULL DEFAULT false,
  member_ingest_enabled BOOLEAN NOT NULL DEFAULT false,
  multi_user_realtime_enabled BOOLEAN NOT NULL DEFAULT false,
  simhub_ingest_enabled BOOLEAN NOT NULL DEFAULT true,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by UUID NULL REFERENCES auth.users(id) ON DELETE SET NULL
);

ALTER TABLE public.endurance_runtime_settings ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.endurance_runtime_settings FROM PUBLIC, anon, authenticated;

INSERT INTO public.endurance_runtime_settings (singleton)
VALUES (true)
ON CONFLICT (singleton) DO NOTHING;

CREATE OR REPLACE FUNCTION public.endurance_capabilities_for_user(_user_id UUID)
RETURNS TABLE (
  can_access BOOLEAN,
  can_pair_own_device BOOLEAN,
  can_ingest_own_device BOOLEAN,
  can_manage_events BOOLEAN,
  can_manage_devices BOOLEAN,
  multi_user_realtime_enabled BOOLEAN,
  simhub_ingest_enabled BOOLEAN
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_staff BOOLEAN := false;
  v_manager BOOLEAN := false;
  v_member_access BOOLEAN := false;
  v_member_pairing BOOLEAN := false;
  v_member_ingest BOOLEAN := false;
  v_realtime BOOLEAN := false;
  v_ingest BOOLEAN := true;
BEGIN
  IF _user_id IS NULL THEN
    RETURN QUERY SELECT false, false, false, false, false, false, false;
    RETURN;
  END IF;

  v_staff := public.is_endurance_staff(_user_id);
  v_manager := public.is_endurance_manager(_user_id);

  SELECT
    settings.member_access_enabled,
    settings.member_pairing_enabled,
    settings.member_ingest_enabled,
    settings.multi_user_realtime_enabled,
    settings.simhub_ingest_enabled
  INTO
    v_member_access,
    v_member_pairing,
    v_member_ingest,
    v_realtime,
    v_ingest
  FROM public.endurance_runtime_settings AS settings
  WHERE settings.singleton = true;

  -- Missing settings row is deliberately alpha-safe.
  v_member_access := COALESCE(v_member_access, false);
  v_member_pairing := COALESCE(v_member_pairing, false);
  v_member_ingest := COALESCE(v_member_ingest, false);
  v_realtime := COALESCE(v_realtime, false);
  v_ingest := COALESCE(v_ingest, true);

  RETURN QUERY SELECT
    (v_staff OR v_member_access),
    (v_staff OR v_member_pairing),
    (v_ingest AND (v_staff OR v_member_ingest)),
    v_manager,
    v_manager,
    (v_realtime AND (v_staff OR v_member_access)),
    v_ingest;
END;
$$;

CREATE OR REPLACE FUNCTION public.endurance_current_capabilities()
RETURNS TABLE (
  can_access BOOLEAN,
  can_pair_own_device BOOLEAN,
  can_ingest_own_device BOOLEAN,
  can_manage_events BOOLEAN,
  can_manage_devices BOOLEAN,
  multi_user_realtime_enabled BOOLEAN,
  simhub_ingest_enabled BOOLEAN
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user_id UUID := auth.uid();
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY SELECT * FROM public.endurance_capabilities_for_user(v_user_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.endurance_set_runtime_settings(
  p_member_access_enabled BOOLEAN DEFAULT NULL,
  p_member_pairing_enabled BOOLEAN DEFAULT NULL,
  p_member_ingest_enabled BOOLEAN DEFAULT NULL,
  p_multi_user_realtime_enabled BOOLEAN DEFAULT NULL,
  p_simhub_ingest_enabled BOOLEAN DEFAULT NULL
)
RETURNS public.endurance_runtime_settings
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_result public.endurance_runtime_settings;
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_role(auth.uid(), 'super_admin'::public.app_role) THEN
    RAISE EXCEPTION 'Super-admin required' USING ERRCODE = '42501';
  END IF;

  INSERT INTO public.endurance_runtime_settings (
    singleton,
    member_access_enabled,
    member_pairing_enabled,
    member_ingest_enabled,
    multi_user_realtime_enabled,
    simhub_ingest_enabled,
    updated_at,
    updated_by
  ) VALUES (
    true,
    COALESCE(p_member_access_enabled, false),
    COALESCE(p_member_pairing_enabled, false),
    COALESCE(p_member_ingest_enabled, false),
    COALESCE(p_multi_user_realtime_enabled, false),
    COALESCE(p_simhub_ingest_enabled, true),
    now(),
    auth.uid()
  )
  ON CONFLICT (singleton) DO UPDATE SET
    member_access_enabled = COALESCE(p_member_access_enabled, endurance_runtime_settings.member_access_enabled),
    member_pairing_enabled = COALESCE(p_member_pairing_enabled, endurance_runtime_settings.member_pairing_enabled),
    member_ingest_enabled = COALESCE(p_member_ingest_enabled, endurance_runtime_settings.member_ingest_enabled),
    multi_user_realtime_enabled = COALESCE(p_multi_user_realtime_enabled, endurance_runtime_settings.multi_user_realtime_enabled),
    simhub_ingest_enabled = COALESCE(p_simhub_ingest_enabled, endurance_runtime_settings.simhub_ingest_enabled),
    updated_at = now(),
    updated_by = auth.uid()
  RETURNING * INTO v_result;

  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.endurance_capabilities_for_user(UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.endurance_current_capabilities() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.endurance_set_runtime_settings(BOOLEAN, BOOLEAN, BOOLEAN, BOOLEAN, BOOLEAN) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.endurance_capabilities_for_user(UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.endurance_current_capabilities() TO authenticated;
GRANT EXECUTE ON FUNCTION public.endurance_set_runtime_settings(BOOLEAN, BOOLEAN, BOOLEAN, BOOLEAN, BOOLEAN) TO authenticated;

-- Existing pairing RPC signatures stay stable; only their authorization source
-- changes from hard-coded alpha roles to the runtime capability contract.
CREATE OR REPLACE FUNCTION public.simhub_create_device_pairing_code(
  p_code_hash TEXT,
  p_owner_user_id UUID,
  p_expires_at TIMESTAMPTZ
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, auth, pg_temp
AS $$
BEGIN
  IF auth.role() <> 'service_role' THEN
    RAISE EXCEPTION 'Permission denied' USING ERRCODE = '42501';
  END IF;

  IF p_code_hash IS NULL OR p_code_hash !~ '^[0-9a-f]{64}$'
     OR p_owner_user_id IS NULL
     OR p_expires_at IS NULL OR p_expires_at <= now()
     OR p_expires_at > now() + interval '15 minutes' THEN
    RETURN false;
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(p_owner_user_id::TEXT, 0));

  IF NOT COALESCE((SELECT caps.can_pair_own_device FROM public.endurance_capabilities_for_user(p_owner_user_id) AS caps), false) THEN
    RETURN false;
  END IF;

  DELETE FROM public.simhub_pairing_codes
  WHERE owner_user_id = p_owner_user_id AND consumed_at IS NULL;

  INSERT INTO public.simhub_pairing_codes (code_hash, owner_user_id, race_id, team_id, expires_at)
  VALUES (p_code_hash, p_owner_user_id, NULL, NULL, p_expires_at);

  RETURN true;
END;
$$;

CREATE OR REPLACE FUNCTION public.simhub_exchange_pairing_code(
  p_code_hash TEXT,
  p_token_hash TEXT,
  p_connector_id TEXT,
  p_device_name TEXT
)
RETURNS TABLE(
  result TEXT,
  device_id UUID,
  race_id UUID,
  team_id UUID,
  owner_user_id UUID
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, auth, pg_temp
AS $$
DECLARE
  v_pairing public.simhub_pairing_codes%ROWTYPE;
  v_device_id UUID;
  v_device_expires_at TIMESTAMPTZ;
BEGIN
  IF auth.role() <> 'service_role' THEN
    RAISE EXCEPTION 'Permission denied' USING ERRCODE = '42501';
  END IF;

  IF p_code_hash IS NULL OR p_code_hash !~ '^[0-9a-f]{64}$'
     OR p_token_hash IS NULL OR p_token_hash !~ '^[0-9a-f]{64}$'
     OR char_length(trim(COALESCE(p_connector_id, ''))) NOT BETWEEN 1 AND 120
     OR char_length(trim(COALESCE(p_device_name, ''))) NOT BETWEEN 1 AND 120 THEN
    RETURN QUERY SELECT 'invalid_request'::TEXT, NULL::UUID, NULL::UUID, NULL::UUID, NULL::UUID;
    RETURN;
  END IF;

  SELECT pairing.*
  INTO v_pairing
  FROM public.simhub_pairing_codes AS pairing
  WHERE pairing.code_hash = p_code_hash
  FOR UPDATE;

  IF NOT FOUND OR v_pairing.consumed_at IS NOT NULL OR v_pairing.expires_at <= now() THEN
    RETURN QUERY SELECT 'invalid_code'::TEXT, NULL::UUID, NULL::UUID, NULL::UUID, NULL::UUID;
    RETURN;
  END IF;

  UPDATE public.simhub_pairing_codes AS pairing
  SET consumed_at = now()
  WHERE pairing.id = v_pairing.id;

  IF NOT COALESCE((SELECT caps.can_pair_own_device FROM public.endurance_capabilities_for_user(v_pairing.owner_user_id) AS caps), false) THEN
    RETURN QUERY SELECT 'invalid_code'::TEXT, NULL::UUID, NULL::UUID, NULL::UUID, NULL::UUID;
    RETURN;
  END IF;

  IF (v_pairing.race_id IS NULL) <> (v_pairing.team_id IS NULL) THEN
    RETURN QUERY SELECT 'invalid_code'::TEXT, NULL::UUID, NULL::UUID, NULL::UUID, NULL::UUID;
    RETURN;
  END IF;

  IF v_pairing.race_id IS NOT NULL THEN
    SELECT race.race_date + interval '36 hours'
    INTO v_device_expires_at
    FROM public.races AS race
    WHERE race.id = v_pairing.race_id
      AND race.status IN ('upcoming', 'live')
      AND race.race_date > now() - interval '36 hours';
    IF v_device_expires_at IS NULL THEN
      RETURN QUERY SELECT 'invalid_code'::TEXT, NULL::UUID, NULL::UUID, NULL::UUID, NULL::UUID;
      RETURN;
    END IF;
  ELSE
    v_device_expires_at := NULL;
  END IF;

  INSERT INTO public.simhub_devices (
    owner_user_id, race_id, team_id, token_hash, connector_id, device_name, expires_at
  ) VALUES (
    v_pairing.owner_user_id, v_pairing.race_id, v_pairing.team_id,
    p_token_hash, trim(p_connector_id), trim(p_device_name), v_device_expires_at
  )
  RETURNING id INTO v_device_id;

  RETURN QUERY SELECT
    'paired'::TEXT,
    v_device_id,
    v_pairing.race_id,
    v_pairing.team_id,
    v_pairing.owner_user_id;
END;
$$;

REVOKE ALL ON FUNCTION public.simhub_create_device_pairing_code(TEXT, UUID, TIMESTAMPTZ) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.simhub_create_device_pairing_code(TEXT, UUID, TIMESTAMPTZ) TO service_role;
REVOKE ALL ON FUNCTION public.simhub_exchange_pairing_code(TEXT, TEXT, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.simhub_exchange_pairing_code(TEXT, TEXT, TEXT, TEXT) TO service_role;

DROP POLICY IF EXISTS "Owners can read own latest SimHub telemetry" ON public.simhub_telemetry_latest;
CREATE POLICY "Owners can read own latest SimHub telemetry"
  ON public.simhub_telemetry_latest
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.simhub_devices AS device
      WHERE device.id = simhub_telemetry_latest.device_id
        AND device.owner_user_id = auth.uid()
        AND device.revoked_at IS NULL
    )
  );

-- Replace the current ingest implementation in place. Runtime disablement is
-- non-destructive: it pauses frames without revoking the paired device/token.
CREATE OR REPLACE FUNCTION public.simhub_ingest_snapshot(p_token_hash text, p_session_id text, p_sequence bigint, p_captured_at timestamp with time zone, p_connector_id text, p_simhub_version text, p_game text, p_telemetry jsonb, p_driver_id text DEFAULT NULL::text, p_current_driver_id text DEFAULT NULL::text, p_current_driver_name text DEFAULT NULL::text, p_car_id text DEFAULT NULL::text, p_car_name text DEFAULT NULL::text, p_track_name text DEFAULT NULL::text, p_track_config text DEFAULT NULL::text)
 RETURNS TABLE(result text, received_at timestamp with time zone)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'auth', 'pg_temp'
AS $function$
DECLARE
  v_device public.simhub_devices%ROWTYPE;
  v_now TIMESTAMPTZ := clock_timestamp();
  v_device_found BOOLEAN;
  v_session_sequence BIGINT;
  v_session_found BOOLEAN;
  v_session_count INTEGER;
  v_registered BOOLEAN;
  v_practice_session public.endurance_practice_sessions%ROWTYPE;
  v_lap_time NUMERIC;
  v_completed_laps INTEGER;
  v_eff_event UUID;
  v_eff_team UUID;
  v_can_ingest BOOLEAN := false;
BEGIN
  IF auth.role() <> 'service_role' THEN
    RAISE EXCEPTION 'Permission denied' USING ERRCODE = '42501';
  END IF;

  IF p_token_hash IS NULL OR p_token_hash !~ '^[0-9a-f]{64}$'
     OR char_length(trim(COALESCE(p_session_id, ''))) NOT BETWEEN 1 AND 120
     OR p_sequence IS NULL OR p_sequence < 0
     OR p_captured_at IS NULL
     OR p_captured_at < v_now - interval '1 hour'
     OR p_captured_at > v_now + interval '5 minutes'
     OR char_length(trim(COALESCE(p_connector_id, ''))) NOT BETWEEN 1 AND 120
     OR char_length(trim(COALESCE(p_simhub_version, ''))) NOT BETWEEN 1 AND 60
     OR p_game IS DISTINCT FROM 'IRacing'
     OR p_telemetry IS NULL
     OR jsonb_typeof(p_telemetry) <> 'object' THEN
    RETURN QUERY SELECT 'invalid_payload'::TEXT, NULL::TIMESTAMPTZ;
    RETURN;
  END IF;

  SELECT device.*
  INTO v_device
  FROM public.simhub_devices AS device
  WHERE device.token_hash = p_token_hash
  FOR UPDATE;

  v_device_found := FOUND;

  IF v_device_found THEN
    SELECT caps.can_ingest_own_device
      INTO v_can_ingest
      FROM public.endurance_capabilities_for_user(v_device.owner_user_id) AS caps;
    IF NOT COALESCE(v_can_ingest, false) THEN
      RETURN QUERY SELECT 'ingest_disabled'::TEXT, v_now;
      RETURN;
    END IF;
  END IF;

  -- Effectieve endurance-binding, datum-bewust: handmatig (Apparaten-tab) is
  -- leidend; anders volgt het device het event dat nu actief is of het eerst
  -- komt, waarvan de rijder teamlid is.
  IF v_device.endurance_binding_source = 'manual' AND v_device.endurance_event_id IS NOT NULL THEN
    v_eff_event := v_device.endurance_event_id;
    v_eff_team := v_device.endurance_team_id;
  ELSE
    SELECT t.event_id, tm.team_id
      INTO v_eff_event, v_eff_team
      FROM public.endurance_team_members AS tm
      JOIN public.endurance_teams AS t ON t.id = tm.team_id
      JOIN public.endurance_events AS e ON e.id = t.event_id
     WHERE tm.user_id = v_device.owner_user_id
       AND e.end_at > v_now
     ORDER BY (e.start_at <= v_now AND e.end_at >= v_now) DESC, e.start_at ASC
     LIMIT 1;
  END IF;


  IF NOT v_device_found OR v_device.revoked_at IS NOT NULL
     OR NOT (
       (v_device.race_id IS NULL AND v_device.team_id IS NULL AND v_device.expires_at IS NULL AND v_eff_event IS NULL AND v_eff_team IS NULL)
       OR (
         v_device.race_id IS NOT NULL AND v_device.team_id IS NOT NULL
         AND v_device.expires_at > v_now
         AND EXISTS (
           SELECT 1 FROM public.races AS race
           WHERE race.id = v_device.race_id
             AND race.status IN ('upcoming', 'live')
             AND race.race_date > v_now - interval '36 hours'
         )
       )
       OR (
         v_eff_event IS NOT NULL AND v_eff_team IS NOT NULL
       )
     ) THEN
    IF v_device_found THEN
      UPDATE public.simhub_devices
      SET revoked_at = COALESCE(revoked_at, v_now), updated_at = v_now
      WHERE id = v_device.id;
      DELETE FROM public.simhub_telemetry_latest WHERE device_id = v_device.id;
      DELETE FROM public.simhub_device_sessions WHERE device_id = v_device.id;
    END IF;
    RETURN QUERY SELECT 'invalid_device'::TEXT, NULL::TIMESTAMPTZ;
    RETURN;
  END IF;

  -- Endurance-gate: een endurance-gebonden device mag pas telemetry leveren als
  -- de eigenaar (de coureur) ingeschreven is voor het event.
  IF v_eff_event IS NOT NULL THEN
    SELECT EXISTS (
      SELECT 1 FROM public.endurance_registrations AS reg
      WHERE reg.event_id = v_eff_event
        AND reg.user_id = v_device.owner_user_id
        AND reg.status NOT IN ('rejected', 'withdrawn')
    ) INTO v_registered;

    IF NOT v_registered THEN
      RETURN QUERY SELECT 'not_registered'::TEXT, v_now;
      RETURN;
    END IF;

  END IF;

  IF v_device.last_seen_at IS NOT NULL
     AND v_device.last_seen_at > v_now - interval '400 milliseconds' THEN
    RETURN QUERY SELECT 'rate_limited'::TEXT, v_now;
    RETURN;
  END IF;

  SELECT session.last_sequence
  INTO v_session_sequence
  FROM public.simhub_device_sessions AS session
  WHERE session.device_id = v_device.id AND session.session_id = p_session_id
  FOR UPDATE;
  v_session_found := FOUND;

  IF NOT v_session_found THEN
    SELECT count(*)::INTEGER INTO v_session_count
    FROM public.simhub_device_sessions AS session
    WHERE session.device_id = v_device.id;
    IF v_session_count >= 64 THEN
      RETURN QUERY SELECT 'session_limit'::TEXT, v_now;
      RETURN;
    END IF;
  END IF;

  IF NOT v_session_found
     AND v_device.last_session_id IS NOT NULL
     AND (v_device.last_seen_at > v_now - interval '5 seconds' OR p_sequence > 5) THEN
    RETURN QUERY SELECT 'replayed'::TEXT, v_now;
    RETURN;
  END IF;

  IF v_session_found AND p_sequence <= v_session_sequence THEN
    RETURN QUERY SELECT 'replayed'::TEXT, v_now;
    RETURN;
  END IF;


  -- Persist each completed lap once, after replay/sequence validation.
  IF v_eff_event IS NOT NULL THEN
    SELECT session.* INTO v_practice_session
    FROM public.endurance_practice_sessions AS session
    WHERE session.event_id = v_eff_event AND session.ended_at IS NULL
    ORDER BY session.started_at DESC
    LIMIT 1;

    IF FOUND THEN
      BEGIN
        v_lap_time := (p_telemetry->>'lapTimeSeconds')::NUMERIC;
        v_completed_laps := (p_telemetry->>'completedLaps')::INTEGER;
      EXCEPTION WHEN OTHERS THEN
        v_lap_time := NULL;
        v_completed_laps := NULL;
      END;

      IF v_lap_time IS NOT NULL AND v_lap_time > 0 AND v_lap_time <= 3600
         AND v_completed_laps IS NOT NULL AND v_completed_laps > 0 THEN
        INSERT INTO public.endurance_practice_laps (
          session_id, event_id, user_id, car_id, circuit,
          lap_seconds, fuel_used_litres, fuel_per_lap_litres,
          incident_count, recorded_at,
          source_session_id, source_device_id, completed_laps
        ) VALUES (
          v_practice_session.id, v_eff_event, v_device.owner_user_id,
          NULLIF(trim(COALESCE(p_car_id, '')), ''), NULLIF(trim(COALESCE(p_track_name, '')), ''),
          v_lap_time,
          NULLIF((p_telemetry->>'fuelPerLapLitres')::TEXT, '')::NUMERIC,
          NULLIF((p_telemetry->>'fuelPerLapLitres')::TEXT, '')::NUMERIC,
          COALESCE(NULLIF((p_telemetry->>'incidents')::TEXT, '')::INTEGER, 0),
          p_captured_at, trim(p_session_id), v_device.id, v_completed_laps
        )
        ON CONFLICT (event_id, source_session_id, source_device_id, completed_laps)
          WHERE source_session_id IS NOT NULL AND source_device_id IS NOT NULL AND completed_laps IS NOT NULL
        DO NOTHING;
      END IF;
    END IF;
  END IF;

  INSERT INTO public.simhub_device_sessions (device_id, session_id, last_sequence, first_seen_at, last_seen_at)
  VALUES (v_device.id, p_session_id, p_sequence, v_now, v_now)
  ON CONFLICT (device_id, session_id) DO UPDATE
  SET last_sequence = EXCLUDED.last_sequence, last_seen_at = EXCLUDED.last_seen_at;

  UPDATE public.simhub_devices AS device
  SET last_seen_at = v_now,
      last_session_id = p_session_id,
      last_sequence = p_sequence,
      connector_id = trim(p_connector_id),
      updated_at = v_now
  WHERE device.id = v_device.id;

  INSERT INTO public.simhub_telemetry_latest (
    device_id, owner_user_id, race_id, team_id, endurance_event_id, endurance_team_id,
    session_id, sequence, captured_at, received_at, connector_id, simhub_version, game,
    driver_id, current_driver_id, current_driver_name, car_id, car_name, track_name, track_config,
    telemetry
  ) VALUES (
    v_device.id, v_device.owner_user_id, v_device.race_id, v_device.team_id,
    v_eff_event, v_eff_team,
    trim(p_session_id), p_sequence, p_captured_at, v_now, trim(p_connector_id), trim(p_simhub_version), p_game,
    NULLIF(trim(COALESCE(p_driver_id, '')), ''), NULLIF(trim(COALESCE(p_current_driver_id, '')), ''),
    NULLIF(trim(COALESCE(p_current_driver_name, '')), ''), NULLIF(trim(COALESCE(p_car_id, '')), ''),
    NULLIF(trim(COALESCE(p_car_name, '')), ''), NULLIF(trim(COALESCE(p_track_name, '')), ''),
    NULLIF(trim(COALESCE(p_track_config, '')), ''),
    p_telemetry
  )
  ON CONFLICT (device_id) DO UPDATE
  SET owner_user_id = EXCLUDED.owner_user_id,
      race_id = EXCLUDED.race_id,
      team_id = EXCLUDED.team_id,
      endurance_event_id = EXCLUDED.endurance_event_id,
      endurance_team_id = EXCLUDED.endurance_team_id,
      session_id = EXCLUDED.session_id,
      sequence = EXCLUDED.sequence,
      captured_at = EXCLUDED.captured_at,
      received_at = EXCLUDED.received_at,
      connector_id = EXCLUDED.connector_id,
      simhub_version = EXCLUDED.simhub_version,
      game = EXCLUDED.game,
      driver_id = EXCLUDED.driver_id,
      current_driver_id = EXCLUDED.current_driver_id,
      current_driver_name = EXCLUDED.current_driver_name,
      car_id = EXCLUDED.car_id,
      car_name = EXCLUDED.car_name,
      track_name = EXCLUDED.track_name,
      track_config = EXCLUDED.track_config,
      telemetry = EXCLUDED.telemetry;

  RETURN QUERY SELECT 'accepted'::TEXT, v_now;
END;
$function$;

REVOKE ALL ON FUNCTION public.simhub_ingest_snapshot(TEXT, TEXT, BIGINT, TIMESTAMPTZ, TEXT, TEXT, TEXT, JSONB, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.simhub_ingest_snapshot(TEXT, TEXT, BIGINT, TIMESTAMPTZ, TEXT, TEXT, TEXT, JSONB, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT) TO service_role;

-- ============================================================
-- DEEL 5/8  20260820160000_endurance_race_control_optimistic_audit
-- ============================================================
-- Endurance Race Control — optimistic concurrency + append-only audit (additive, Fase 3B).
-- ----------------------------------------------------------------------------
-- 1) Nieuwe SECURITY DEFINER RPC `endurance_race_control_apply` die een stip
--    server-side with een relatieve delta (delay in minuten óf repair in
--    seconden, semantisch onderscheiden) verschuift. De bestaande
--    `endurance_apply_stint_updates` / `endurance_replace_draft_stints`
--    signatures blijven onaangeraakt voor oude clients (backend-first).
-- 2) Optistiche concurrency: de client stuurt `expected_updated_at`; past de
--    rij inmiddels, weigert de RPC hard met SQLSTATE 40001 + expliciete
--    stalemessage. No silent retry/overwrite.
-- 3) Iedere schrijft append uitsluitend een immutable before/after audit rij
--    in `endurance_race_control_audit` (geen direct client write; managers
--    lezen via de SECURITY DEFINER `endurance_list_race_control_audit` RPC).
-- Additief: geen bestaande tabellen/policies/RPC-signatures gewijzigd.

-- =========================================================================
-- (1) capture op enum + append-only audit-tabel
-- =========================================================================
CREATE TYPE public.endurance_race_control_op AS ENUM ('delay', 'repair', 'complete', 'replace_driver');

CREATE TABLE public.endurance_race_control_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Bewust zonder cascade-FK's: auditgeschiedenis overleeft latere cleanup.
  -- De schrijf-RPC valideert event/team/stint onder locks.
  event_id uuid NOT NULL,
  team_id uuid NOT NULL,
  stint_id uuid NOT NULL,
  actor_id uuid NOT NULL,
  operation public.endurance_race_control_op NOT NULL,
  delta_minutes integer,
  repair_seconds integer,
  replacement_driver_id uuid,
  effective_at timestamptz,
  expected_updated_at timestamptz,
  before_actual_start_at timestamptz,
  before_actual_end_at timestamptz,
  after_actual_start_at timestamptz,
  after_actual_end_at timestamptz,
  before_status public.endurance_stint_status NOT NULL,
  after_status public.endurance_stint_status NOT NULL,
  before_driver_id uuid,
  after_driver_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT endurance_race_control_audit_op_delta CHECK (
    (operation = 'delay'::public.endurance_race_control_op AND delta_minutes IS NOT NULL AND delta_minutes <> 0 AND repair_seconds IS NULL AND replacement_driver_id IS NULL AND effective_at IS NOT NULL)
    OR (operation = 'repair'::public.endurance_race_control_op AND repair_seconds IS NOT NULL AND repair_seconds > 0 AND delta_minutes IS NULL AND replacement_driver_id IS NULL AND effective_at IS NOT NULL)
    OR (operation = 'complete'::public.endurance_race_control_op AND effective_at IS NOT NULL AND delta_minutes IS NULL AND repair_seconds IS NULL AND replacement_driver_id IS NULL)
    OR (operation = 'replace_driver'::public.endurance_race_control_op AND replacement_driver_id IS NOT NULL AND delta_minutes IS NULL AND repair_seconds IS NULL AND effective_at IS NULL)
  )
);

CREATE INDEX endurance_race_control_audit_event_time_idx
  ON public.endurance_race_control_audit (event_id, created_at DESC);

-- Append-only: uitsluitend SELECT voor super_admin via RLS; geen direct
-- INSERT/UPDATE/DELETE policy ⇒ clients kunnen nooit muteren. Writes gangen
-- alleen via de SECURITY DEFINER RPC (owner-recht), managers lezen via RPC.
ALTER TABLE public.endurance_race_control_audit ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.endurance_race_control_audit FROM PUBLIC, anon;

CREATE POLICY "endurance race control audit super select"
  ON public.endurance_race_control_audit
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'super_admin'));

-- Basis-SELECT-recht voor authenticated (nodig voor de policy), maar de policy
-- filtert hard op super_admin; INSERT/UPDATE/DELETE blijven grantless en
-- onmogelijk voor elke clientrol. Manager-lezen loopt via de RPC.
GRANT SELECT ON public.endurance_race_control_audit TO authenticated;

-- =============================================================================
-- (2) optimistic, server-side delta RPC (+ before/after audit in same xact)
-- =============================================================================
CREATE OR REPLACE FUNCTION public.endurance_race_control_apply(
  p_event_id uuid,
  p_team_id uuid,
  p_stint_id uuid,
  p_operation public.endurance_race_control_op,
  p_delta_minutes integer,
  p_repair_seconds integer,
  p_replacement_driver_id uuid,
  p_effective_at timestamptz,
  p_expected_updated_at timestamptz
) RETURNS public.endurance_stints
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, auth, pg_temp
AS $$
DECLARE
  v_user uuid := auth.uid();
  v_team public.endurance_teams%ROWTYPE;
  v_stint public.endurance_stints%ROWTYPE;
  v_shift interval;
  v_start timestamptz;
  v_end timestamptz;
  v_new_start timestamptz;
  v_new_end timestamptz;
  v_result public.endurance_stints;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501';
  END IF;

  -- Serialiseer alle Race Control-writes voor hetzelfde event/team zodat twee
  -- gelijktijdige correcties niet interleaven.
  PERFORM pg_advisory_xact_lock(hashtextextended(p_event_id::text || ':' || p_team_id::text, 0));

  SELECT * INTO v_team
  FROM public.endurance_teams
  WHERE id = p_team_id AND event_id = p_event_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Unknown event/team combination' USING ERRCODE = '22023';
  END IF;

  -- Globale Endurance Managers én de toegewezen manager van deze crew mogen
  -- correcteren. Server-side autorisatie; UI-gates zijn presentatie-only.
  IF NOT public.is_endurance_manager(v_user) AND v_team.manager_id IS DISTINCT FROM v_user THEN
    RAISE EXCEPTION 'Permission denied' USING ERRCODE = '42501';
  END IF;

  -- Semantisch distincte operaties: delay is een signed minutencorrectie
  -- (negatief = eerder), repair is een positieve correctie in seconden.
  IF p_operation = 'delay'::public.endurance_race_control_op THEN
    IF p_delta_minutes IS NULL OR p_delta_minutes = 0 OR p_effective_at IS NULL
       OR p_repair_seconds IS NOT NULL OR p_replacement_driver_id IS NOT NULL THEN
      RAISE EXCEPTION 'delay requires delta_minutes and effective_at' USING ERRCODE = '22023';
    END IF;
    v_shift := make_interval(mins => p_delta_minutes);
  ELSIF p_operation = 'repair'::public.endurance_race_control_op THEN
    IF p_repair_seconds IS NULL OR p_repair_seconds <= 0 OR p_effective_at IS NULL
       OR p_delta_minutes IS NOT NULL OR p_replacement_driver_id IS NOT NULL THEN
      RAISE EXCEPTION 'repair requires repair_seconds and effective_at' USING ERRCODE = '22023';
    END IF;
    v_shift := make_interval(secs => p_repair_seconds);
  ELSIF p_operation = 'complete'::public.endurance_race_control_op THEN
    IF p_effective_at IS NULL OR p_delta_minutes IS NOT NULL OR p_repair_seconds IS NOT NULL OR p_replacement_driver_id IS NOT NULL THEN
      RAISE EXCEPTION 'complete requires effective_at' USING ERRCODE = '22023';
    END IF;
  ELSIF p_operation = 'replace_driver'::public.endurance_race_control_op THEN
    IF p_delta_minutes IS NOT NULL OR p_repair_seconds IS NOT NULL OR p_effective_at IS NOT NULL
       OR p_replacement_driver_id IS NULL OR NOT EXISTS (
      SELECT 1 FROM public.endurance_team_members AS member
      WHERE member.team_id = p_team_id AND member.user_id = p_replacement_driver_id
    ) THEN
      RAISE EXCEPTION 'replacement driver must belong to this team' USING ERRCODE = '22023';
    END IF;
  ELSE
    RAISE EXCEPTION 'Invalid operation' USING ERRCODE = '22023';
  END IF;

  -- Rij-lock vóór versiecheck: hieldt een concurrent write af buiten onze
  -- transactie, zodat expected-versie + before-snapshot gefuls is.
  SELECT * INTO v_stint
  FROM public.endurance_stints
  WHERE id = p_stint_id AND event_id = p_event_id AND team_id = p_team_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Unknown stint for event/team' USING ERRCODE = '22023';
  END IF;
  IF v_stint.status IN ('completed', 'replaced', 'expired') THEN
    RAISE EXCEPTION 'Terminal stint cannot be changed by Race Control' USING ERRCODE = '22023';
  END IF;

  -- Optistiche conversie: weigert een stale write expliciet (SQLSTATE 40001).
  -- Geen automatic retry: de client hoedt de conflict en past opnieuw aan.
  IF p_expected_updated_at IS NULL OR v_stint.updated_at IS DISTINCT FROM p_expected_updated_at THEN
    RAISE EXCEPTION '%',
      format('%s Stale Race Control update: stint %s changed since loaded (expected updated_at %s, current %s). Reload before retrying.',
        'SQLSTATE 40001', p_stint_id, COALESCE(p_expected_updated_at::text, 'NULL'), v_stint.updated_at::text)
      USING ERRCODE = '40001';
  END IF;

  v_start := COALESCE(v_stint.actual_start_at, v_stint.original_start_at);
  v_end := COALESCE(v_stint.actual_end_at, v_stint.original_end_at);

  IF p_operation = 'delay'::public.endurance_race_control_op THEN
    -- Actief/verlopen: alleen het einde; toekomstig: start en einde verschuiven.
    IF v_start <= p_effective_at THEN
      v_new_start := v_start;
      v_new_end := v_end + v_shift;
    ELSE
      v_new_start := v_start + v_shift;
      v_new_end := v_end + v_shift;
    END IF;
  ELSIF p_operation = 'repair'::public.endurance_race_control_op THEN
    -- Repairtijd verlengt uitsluitend de eindtijd; nooit de starttijd.
    IF p_effective_at < v_start OR p_effective_at >= v_end OR v_stint.status IN ('completed', 'replaced', 'expired') THEN
      RAISE EXCEPTION 'repair requires an active non-terminal stint' USING ERRCODE = '22023';
    END IF;
    v_new_start := v_start;
    v_new_end := v_end + v_shift;
  ELSIF p_operation = 'complete'::public.endurance_race_control_op THEN
    v_new_start := v_start;
    v_new_end := p_effective_at;
  ELSE
    v_new_start := v_start;
    v_new_end := v_end;
  END IF;

  IF v_new_end <= v_new_start THEN
    RAISE EXCEPTION 'Shift would produce a non-positive stint duration' USING ERRCODE = '22023';
  END IF;

  UPDATE public.endurance_stints
  SET actual_start_at = v_new_start,
      actual_end_at = v_new_end,
      driver_id = CASE WHEN p_operation = 'replace_driver'::public.endurance_race_control_op THEN p_replacement_driver_id ELSE v_stint.driver_id END,
      status = CASE
        WHEN p_operation = 'complete'::public.endurance_race_control_op THEN 'completed'::public.endurance_stint_status
        WHEN p_operation = 'replace_driver'::public.endurance_race_control_op THEN 'replaced'::public.endurance_stint_status
        ELSE v_stint.status
      END,
      updated_at = now()
  WHERE id = p_stint_id
  RETURNING * INTO v_result;

  INSERT INTO public.endurance_race_control_audit (
    event_id, team_id, stint_id, actor_id, operation,
    delta_minutes, repair_seconds, replacement_driver_id, effective_at, expected_updated_at,
    before_actual_start_at, before_actual_end_at,
    after_actual_start_at, after_actual_end_at,
    before_status, after_status, before_driver_id, after_driver_id
  ) VALUES (
    p_event_id, p_team_id, p_stint_id, v_user, p_operation,
    p_delta_minutes, p_repair_seconds, p_replacement_driver_id, p_effective_at, p_expected_updated_at,
    v_stint.actual_start_at, v_stint.actual_end_at,
    v_result.actual_start_at, v_result.actual_end_at,
    v_stint.status, v_result.status, v_stint.driver_id, v_result.driver_id
  );

  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.endurance_race_control_apply(uuid, uuid, uuid, public.endurance_race_control_op, integer, integer, uuid, timestamptz, timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.endurance_race_control_apply(uuid, uuid, uuid, public.endurance_race_control_op, integer, integer, uuid, timestamptz, timestamptz) TO authenticated;

-- =============================================================================
-- (3) append-only auditleez via SECURITY DEFINER (manager-scoped)
-- =============================================================================
CREATE OR REPLACE FUNCTION public.endurance_list_race_control_audit(p_event_id uuid)
RETURNS SETOF public.endurance_race_control_audit
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, auth, pg_temp
AS $$
DECLARE
  v_user uuid := auth.uid();
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501';
  END IF;
  IF public.has_role(v_user, 'super_admin') OR public.is_endurance_manager(v_user) THEN
    RETURN QUERY
    SELECT a.* FROM public.endurance_race_control_audit AS a
    WHERE a.event_id = p_event_id
    ORDER BY a.created_at DESC;
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.endurance_teams AS team
    WHERE team.event_id = p_event_id AND team.manager_id = v_user
  ) THEN
    RETURN QUERY
    SELECT a.* FROM public.endurance_race_control_audit AS a
    WHERE a.event_id = p_event_id
      AND EXISTS (
        SELECT 1 FROM public.endurance_teams AS team
        WHERE team.id = a.team_id AND team.manager_id = v_user
      )
    ORDER BY a.created_at DESC;
  END IF;
  RAISE EXCEPTION 'Permission denied' USING ERRCODE = '42501';
END;
$$;

REVOKE ALL ON FUNCTION public.endurance_list_race_control_audit(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.endurance_list_race_control_audit(uuid) TO authenticated;

-- ============================================================
-- DEEL 6/8  20260820170000_endurance_realtime_matrix_publication
-- ============================================================
-- Complete Endurance Realtime publication for filtered event/user subscriptions.
-- Historical publication migrations remain untouched; only tables absent from
-- their declared publication set are added here.

ALTER PUBLICATION supabase_realtime ADD TABLE public.endurance_registrations;
ALTER PUBLICATION supabase_realtime ADD TABLE public.endurance_pace_entries;
ALTER PUBLICATION supabase_realtime ADD TABLE public.endurance_practice_sessions;
ALTER PUBLICATION supabase_realtime ADD TABLE public.endurance_practice_laps;
ALTER PUBLICATION supabase_realtime ADD TABLE public.endurance_confirmations;
ALTER PUBLICATION supabase_realtime ADD TABLE public.endurance_race_control_audit;

-- Realtime past dezelfde RLS-grens toe als de manager-scoped audit-RPC.
-- Zonder deze SELECT-policy ontvangen toegewezen crewmanagers geen audit-events.
CREATE POLICY "endurance race control audit managers select"
  ON public.endurance_race_control_audit
  FOR SELECT TO authenticated
  USING (
    public.is_endurance_manager(auth.uid())
    OR EXISTS (
      SELECT 1 FROM public.endurance_teams AS team
      WHERE team.id = endurance_race_control_audit.team_id
        AND team.manager_id = auth.uid()
    )
  );

-- ============================================================
-- DEEL 7/8  20260820180000_endurance_realtime_server_gate
-- ============================================================
-- Strict server-side Endurance Realtime gate via a dedicated carrier table.
-- Domain tables leave supabase_realtime so normal SELECT RLS cannot implicitly
-- grant postgres_changes. The carrier has independent staff/member+flag RLS.

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

-- ============================================================
-- DEEL 8/8  20260820190000_endurance_central_simhub_routing
-- ============================================================
-- Centralize effective SimHub routing and remove stale latest telemetry on route changes.

CREATE OR REPLACE FUNCTION public.simhub_effective_endurance_binding(p_device_id uuid)
RETURNS TABLE(event_id uuid, team_id uuid)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, auth, pg_temp
AS $$
DECLARE
  v_device public.simhub_devices%ROWTYPE;
  v_now timestamptz := clock_timestamp();
  v_count integer;
  v_next_start timestamptz;
BEGIN
  IF auth.role() <> 'service_role' AND (auth.uid() IS NULL OR NOT public.can_manage_simhub()) THEN
    RETURN;
  END IF;

  SELECT device.* INTO v_device
  FROM public.simhub_devices AS device
  WHERE device.id = p_device_id AND device.revoked_at IS NULL;
  IF NOT FOUND THEN RETURN; END IF;

  IF v_device.endurance_binding_source = 'manual' THEN
    IF v_device.endurance_event_id IS NULL OR v_device.endurance_team_id IS NULL OR NOT EXISTS (
      SELECT 1
      FROM public.endurance_teams AS team
      JOIN public.endurance_events AS event ON event.id = team.event_id
      WHERE team.id = v_device.endurance_team_id
        AND team.event_id = v_device.endurance_event_id
        AND event.end_at > v_now
    ) THEN
      RETURN;
    END IF;
    RETURN QUERY SELECT v_device.endurance_event_id, v_device.endurance_team_id;
    RETURN;
  END IF;

  SELECT count(*)::integer INTO v_count
  FROM public.endurance_team_members AS member
  JOIN public.endurance_teams AS team ON team.id = member.team_id
  JOIN public.endurance_events AS event ON event.id = team.event_id
  WHERE member.user_id = v_device.owner_user_id
    AND event.start_at <= v_now AND event.end_at >= v_now;
  IF v_count > 1 THEN
    RETURN;
  ELSIF v_count = 1 THEN
    RETURN QUERY
    SELECT team.event_id, member.team_id
    FROM public.endurance_team_members AS member
    JOIN public.endurance_teams AS team ON team.id = member.team_id
    JOIN public.endurance_events AS event ON event.id = team.event_id
    WHERE member.user_id = v_device.owner_user_id
      AND event.start_at <= v_now AND event.end_at >= v_now;
    RETURN;
  END IF;

  SELECT min(event.start_at) INTO v_next_start
  FROM public.endurance_team_members AS member
  JOIN public.endurance_teams AS team ON team.id = member.team_id
  JOIN public.endurance_events AS event ON event.id = team.event_id
  WHERE member.user_id = v_device.owner_user_id AND event.start_at > v_now;
  IF v_next_start IS NULL THEN RETURN; END IF;

  SELECT count(*)::integer INTO v_count
  FROM public.endurance_team_members AS member
  JOIN public.endurance_teams AS team ON team.id = member.team_id
  JOIN public.endurance_events AS event ON event.id = team.event_id
  WHERE member.user_id = v_device.owner_user_id AND event.start_at = v_next_start;
  IF v_count <> 1 THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT team.event_id, member.team_id
  FROM public.endurance_team_members AS member
  JOIN public.endurance_teams AS team ON team.id = member.team_id
  JOIN public.endurance_events AS event ON event.id = team.event_id
  WHERE member.user_id = v_device.owner_user_id AND event.start_at = v_next_start;
END;
$$;

CREATE OR REPLACE FUNCTION public.simhub_reconcile_device_latest(p_device_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
BEGIN
  IF p_device_id IS NOT NULL THEN
    DELETE FROM public.simhub_telemetry_latest WHERE device_id = p_device_id;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.simhub_ingest_snapshot(p_token_hash text, p_session_id text, p_sequence bigint, p_captured_at timestamp with time zone, p_connector_id text, p_simhub_version text, p_game text, p_telemetry jsonb, p_driver_id text DEFAULT NULL::text, p_current_driver_id text DEFAULT NULL::text, p_current_driver_name text DEFAULT NULL::text, p_car_id text DEFAULT NULL::text, p_car_name text DEFAULT NULL::text, p_track_name text DEFAULT NULL::text, p_track_config text DEFAULT NULL::text)
 RETURNS TABLE(result text, received_at timestamp with time zone)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'auth', 'pg_temp'
AS $function$
DECLARE
  v_device public.simhub_devices%ROWTYPE;
  v_now TIMESTAMPTZ := clock_timestamp();
  v_device_found BOOLEAN;
  v_session_sequence BIGINT;
  v_session_found BOOLEAN;
  v_session_count INTEGER;
  v_registered BOOLEAN;
  v_practice_session public.endurance_practice_sessions%ROWTYPE;
  v_lap_time NUMERIC;
  v_completed_laps INTEGER;
  v_eff_event UUID;
  v_eff_team UUID;
  v_can_ingest BOOLEAN := false;
BEGIN
  IF auth.role() <> 'service_role' THEN
    RAISE EXCEPTION 'Permission denied' USING ERRCODE = '42501';
  END IF;

  IF p_token_hash IS NULL OR p_token_hash !~ '^[0-9a-f]{64}$'
     OR char_length(trim(COALESCE(p_session_id, ''))) NOT BETWEEN 1 AND 120
     OR p_sequence IS NULL OR p_sequence < 0
     OR p_captured_at IS NULL
     OR p_captured_at < v_now - interval '1 hour'
     OR p_captured_at > v_now + interval '5 minutes'
     OR char_length(trim(COALESCE(p_connector_id, ''))) NOT BETWEEN 1 AND 120
     OR char_length(trim(COALESCE(p_simhub_version, ''))) NOT BETWEEN 1 AND 60
     OR p_game IS DISTINCT FROM 'IRacing'
     OR p_telemetry IS NULL
     OR jsonb_typeof(p_telemetry) <> 'object' THEN
    RETURN QUERY SELECT 'invalid_payload'::TEXT, NULL::TIMESTAMPTZ;
    RETURN;
  END IF;

  SELECT device.*
  INTO v_device
  FROM public.simhub_devices AS device
  WHERE device.token_hash = p_token_hash
  FOR UPDATE;

  v_device_found := FOUND;

  IF v_device_found THEN
    SELECT caps.can_ingest_own_device
      INTO v_can_ingest
      FROM public.endurance_capabilities_for_user(v_device.owner_user_id) AS caps;
    IF NOT COALESCE(v_can_ingest, false) THEN
      RETURN QUERY SELECT 'ingest_disabled'::TEXT, v_now;
      RETURN;
    END IF;
  END IF;

  -- Eén centrale resolver bepaalt handmatige override versus automatische route.
  SELECT binding.event_id, binding.team_id
    INTO v_eff_event, v_eff_team
    FROM public.simhub_effective_endurance_binding(v_device.id) AS binding;


  IF NOT v_device_found OR v_device.revoked_at IS NOT NULL
     OR NOT (
       (v_device.race_id IS NULL AND v_device.team_id IS NULL AND v_device.expires_at IS NULL AND v_eff_event IS NULL AND v_eff_team IS NULL)
       OR (
         v_device.race_id IS NOT NULL AND v_device.team_id IS NOT NULL
         AND v_device.expires_at > v_now
         AND EXISTS (
           SELECT 1 FROM public.races AS race
           WHERE race.id = v_device.race_id
             AND race.status IN ('upcoming', 'live')
             AND race.race_date > v_now - interval '36 hours'
         )
       )
       OR (
         v_eff_event IS NOT NULL AND v_eff_team IS NOT NULL
       )
     ) THEN
    IF v_device_found THEN
      UPDATE public.simhub_devices
      SET revoked_at = COALESCE(revoked_at, v_now), updated_at = v_now
      WHERE id = v_device.id;
      DELETE FROM public.simhub_telemetry_latest WHERE device_id = v_device.id;
      DELETE FROM public.simhub_device_sessions WHERE device_id = v_device.id;
    END IF;
    RETURN QUERY SELECT 'invalid_device'::TEXT, NULL::TIMESTAMPTZ;
    RETURN;
  END IF;

  -- Endurance-gate: een endurance-gebonden device mag pas telemetry leveren als
  -- de eigenaar (de coureur) ingeschreven is voor het event.
  IF v_eff_event IS NOT NULL THEN
    SELECT EXISTS (
      SELECT 1 FROM public.endurance_registrations AS reg
      WHERE reg.event_id = v_eff_event
        AND reg.user_id = v_device.owner_user_id
        AND reg.status NOT IN ('rejected', 'withdrawn')
    ) INTO v_registered;

    IF NOT v_registered THEN
      RETURN QUERY SELECT 'not_registered'::TEXT, v_now;
      RETURN;
    END IF;

  END IF;

  IF v_device.last_seen_at IS NOT NULL
     AND v_device.last_seen_at > v_now - interval '400 milliseconds' THEN
    RETURN QUERY SELECT 'rate_limited'::TEXT, v_now;
    RETURN;
  END IF;

  SELECT session.last_sequence
  INTO v_session_sequence
  FROM public.simhub_device_sessions AS session
  WHERE session.device_id = v_device.id AND session.session_id = p_session_id
  FOR UPDATE;
  v_session_found := FOUND;

  IF NOT v_session_found THEN
    SELECT count(*)::INTEGER INTO v_session_count
    FROM public.simhub_device_sessions AS session
    WHERE session.device_id = v_device.id;
    IF v_session_count >= 64 THEN
      RETURN QUERY SELECT 'session_limit'::TEXT, v_now;
      RETURN;
    END IF;
  END IF;

  IF NOT v_session_found
     AND v_device.last_session_id IS NOT NULL
     AND (v_device.last_seen_at > v_now - interval '5 seconds' OR p_sequence > 5) THEN
    RETURN QUERY SELECT 'replayed'::TEXT, v_now;
    RETURN;
  END IF;

  IF v_session_found AND p_sequence <= v_session_sequence THEN
    RETURN QUERY SELECT 'replayed'::TEXT, v_now;
    RETURN;
  END IF;


  -- Persist each completed lap once, after replay/sequence validation.
  IF v_eff_event IS NOT NULL THEN
    SELECT session.* INTO v_practice_session
    FROM public.endurance_practice_sessions AS session
    WHERE session.event_id = v_eff_event AND session.ended_at IS NULL
    ORDER BY session.started_at DESC
    LIMIT 1;

    IF FOUND THEN
      BEGIN
        v_lap_time := (p_telemetry->>'lapTimeSeconds')::NUMERIC;
        v_completed_laps := (p_telemetry->>'completedLaps')::INTEGER;
      EXCEPTION WHEN OTHERS THEN
        v_lap_time := NULL;
        v_completed_laps := NULL;
      END;

      IF v_lap_time IS NOT NULL AND v_lap_time > 0 AND v_lap_time <= 3600
         AND v_completed_laps IS NOT NULL AND v_completed_laps > 0 THEN
        INSERT INTO public.endurance_practice_laps (
          session_id, event_id, user_id, car_id, circuit,
          lap_seconds, fuel_used_litres, fuel_per_lap_litres,
          incident_count, recorded_at,
          source_session_id, source_device_id, completed_laps
        ) VALUES (
          v_practice_session.id, v_eff_event, v_device.owner_user_id,
          NULLIF(trim(COALESCE(p_car_id, '')), ''), NULLIF(trim(COALESCE(p_track_name, '')), ''),
          v_lap_time,
          NULLIF((p_telemetry->>'fuelPerLapLitres')::TEXT, '')::NUMERIC,
          NULLIF((p_telemetry->>'fuelPerLapLitres')::TEXT, '')::NUMERIC,
          COALESCE(NULLIF((p_telemetry->>'incidents')::TEXT, '')::INTEGER, 0),
          p_captured_at, trim(p_session_id), v_device.id, v_completed_laps
        )
        ON CONFLICT (event_id, source_session_id, source_device_id, completed_laps)
          WHERE source_session_id IS NOT NULL AND source_device_id IS NOT NULL AND completed_laps IS NOT NULL
        DO NOTHING;
      END IF;
    END IF;
  END IF;

  INSERT INTO public.simhub_device_sessions (device_id, session_id, last_sequence, first_seen_at, last_seen_at)
  VALUES (v_device.id, p_session_id, p_sequence, v_now, v_now)
  ON CONFLICT (device_id, session_id) DO UPDATE
  SET last_sequence = EXCLUDED.last_sequence, last_seen_at = EXCLUDED.last_seen_at;

  UPDATE public.simhub_devices AS device
  SET last_seen_at = v_now,
      last_session_id = p_session_id,
      last_sequence = p_sequence,
      connector_id = trim(p_connector_id),
      updated_at = v_now
  WHERE device.id = v_device.id;

  INSERT INTO public.simhub_telemetry_latest (
    device_id, owner_user_id, race_id, team_id, endurance_event_id, endurance_team_id,
    session_id, sequence, captured_at, received_at, connector_id, simhub_version, game,
    driver_id, current_driver_id, current_driver_name, car_id, car_name, track_name, track_config,
    telemetry
  ) VALUES (
    v_device.id, v_device.owner_user_id, v_device.race_id, v_device.team_id,
    v_eff_event, v_eff_team,
    trim(p_session_id), p_sequence, p_captured_at, v_now, trim(p_connector_id), trim(p_simhub_version), p_game,
    NULLIF(trim(COALESCE(p_driver_id, '')), ''), NULLIF(trim(COALESCE(p_current_driver_id, '')), ''),
    NULLIF(trim(COALESCE(p_current_driver_name, '')), ''), NULLIF(trim(COALESCE(p_car_id, '')), ''),
    NULLIF(trim(COALESCE(p_car_name, '')), ''), NULLIF(trim(COALESCE(p_track_name, '')), ''),
    NULLIF(trim(COALESCE(p_track_config, '')), ''),
    p_telemetry
  )
  ON CONFLICT (device_id) DO UPDATE
  SET owner_user_id = EXCLUDED.owner_user_id,
      race_id = EXCLUDED.race_id,
      team_id = EXCLUDED.team_id,
      endurance_event_id = EXCLUDED.endurance_event_id,
      endurance_team_id = EXCLUDED.endurance_team_id,
      session_id = EXCLUDED.session_id,
      sequence = EXCLUDED.sequence,
      captured_at = EXCLUDED.captured_at,
      received_at = EXCLUDED.received_at,
      connector_id = EXCLUDED.connector_id,
      simhub_version = EXCLUDED.simhub_version,
      game = EXCLUDED.game,
      driver_id = EXCLUDED.driver_id,
      current_driver_id = EXCLUDED.current_driver_id,
      current_driver_name = EXCLUDED.current_driver_name,
      car_id = EXCLUDED.car_id,
      car_name = EXCLUDED.car_name,
      track_name = EXCLUDED.track_name,
      track_config = EXCLUDED.track_config,
      telemetry = EXCLUDED.telemetry;

  RETURN QUERY SELECT 'accepted'::TEXT, v_now;
END;
$function$;

CREATE OR REPLACE FUNCTION public.simhub_assign_device_to_entry(
  p_device_id UUID,
  p_endurance_event_id UUID,
  p_endurance_team_id UUID,
  p_assigned_by UUID
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, auth, pg_temp
AS $$
DECLARE
  v_team_event UUID;
  v_updated UUID;
BEGIN
  IF auth.role() <> 'service_role' THEN
    RAISE EXCEPTION 'Permission denied' USING ERRCODE = '42501';
  END IF;
  IF p_device_id IS NULL OR p_endurance_event_id IS NULL OR p_endurance_team_id IS NULL THEN
    RETURN false;
  END IF;

  SELECT event_id INTO v_team_event
  FROM public.endurance_teams
  WHERE id = p_endurance_team_id;
  IF v_team_event IS NULL OR v_team_event <> p_endurance_event_id THEN
    RETURN false;
  END IF;

  UPDATE public.simhub_devices
  SET endurance_event_id = p_endurance_event_id,
      endurance_team_id = p_endurance_team_id,
      endurance_binding_source = 'manual',
      race_id = NULL,
      team_id = NULL,
      updated_at = now()
  WHERE id = p_device_id AND revoked_at IS NULL
  RETURNING id INTO v_updated;

  IF v_updated IS NOT NULL THEN
    PERFORM public.simhub_reconcile_device_latest(v_updated);
  END IF;
  RETURN v_updated IS NOT NULL;
END;
$$;

CREATE OR REPLACE FUNCTION public.simhub_clear_device_entry(
  p_device_id UUID,
  p_assigned_by UUID
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, auth, pg_temp
AS $$
DECLARE
  v_updated UUID;
BEGIN
  IF auth.role() <> 'service_role' THEN
    RAISE EXCEPTION 'Permission denied' USING ERRCODE = '42501';
  END IF;
  IF p_device_id IS NULL THEN
    RETURN false;
  END IF;

  UPDATE public.simhub_devices
  SET endurance_event_id = NULL,
      endurance_team_id = NULL,
      endurance_binding_source = NULL,
      updated_at = now()
  WHERE id = p_device_id AND revoked_at IS NULL
  RETURNING id INTO v_updated;

  IF v_updated IS NOT NULL THEN
    PERFORM public.simhub_reconcile_device_latest(v_updated);
  END IF;
  RETURN v_updated IS NOT NULL;
END;
$$;

CREATE OR REPLACE FUNCTION public.simhub_revoke_device(
  p_device_id UUID,
  p_revoked_by UUID
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, auth, pg_temp
AS $$
DECLARE
  v_updated UUID;
BEGIN
  IF auth.role() <> 'service_role' THEN
    RAISE EXCEPTION 'Permission denied' USING ERRCODE = '42501';
  END IF;

  UPDATE public.simhub_devices
  SET revoked_at = now(), revoked_by = p_revoked_by, updated_at = now()
  WHERE id = p_device_id AND revoked_at IS NULL
  RETURNING id INTO v_updated;

  IF v_updated IS NULL THEN RETURN false; END IF;
  PERFORM public.simhub_reconcile_device_latest(v_updated);
  DELETE FROM public.simhub_device_sessions WHERE device_id = v_updated;
  RETURN true;
END;
$$;

CREATE OR REPLACE FUNCTION public.endurance_auto_bind_member_device()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, auth, pg_temp
AS $$
DECLARE
  v_user_id UUID;
  v_team_id UUID;
  v_event_id UUID;
  v_device UUID;
  v_source TEXT;
BEGIN
  IF TG_OP = 'INSERT' THEN
    v_user_id := NEW.user_id;
    v_team_id := NEW.team_id;
  ELSIF TG_OP = 'DELETE' THEN
    v_user_id := OLD.user_id;
  ELSE
    RETURN NULL;
  END IF;

  -- Actieve device van de gebruiker (éénmalige pairing; eerste actieve).
  SELECT d.id, d.endurance_binding_source
    INTO v_device, v_source
    FROM public.simhub_devices d
   WHERE d.owner_user_id = v_user_id AND d.revoked_at IS NULL
   ORDER BY d.paired_at
   LIMIT 1;

  IF v_device IS NULL THEN
    RETURN NULL;
  END IF;

  -- Handmatige toewijzing is leidend; de automatische trigger overschrijft die niet.
  IF v_source = 'manual' THEN
    RETURN NULL;
  END IF;

  IF TG_OP = 'INSERT' THEN
    SELECT event_id INTO v_event_id FROM public.endurance_teams WHERE id = v_team_id;
    IF v_event_id IS NULL THEN
      RETURN NULL;
    END IF;
    UPDATE public.simhub_devices
       SET endurance_event_id = v_event_id,
           endurance_team_id = v_team_id,
           endurance_binding_source = 'auto',
           updated_at = now()
     WHERE id = v_device;
    PERFORM public.simhub_reconcile_device_latest(v_device);
    RETURN NEW;
  ELSE
    -- DELETE: ontbind alleen als het verwijderde lidmaatschap het gebonden team was.
    IF (SELECT endurance_team_id FROM public.simhub_devices WHERE id = v_device) = OLD.team_id THEN
      SELECT tm.team_id, t.event_id
        INTO v_team_id, v_event_id
        FROM public.endurance_team_members tm
        JOIN public.endurance_teams t ON t.id = tm.team_id
       WHERE tm.user_id = v_user_id
       ORDER BY tm.created_at DESC
       LIMIT 1;
      IF v_team_id IS NULL THEN
        UPDATE public.simhub_devices
           SET endurance_event_id = NULL,
               endurance_team_id = NULL,
               endurance_binding_source = NULL,
               updated_at = now()
         WHERE id = v_device;
      ELSE
        UPDATE public.simhub_devices
           SET endurance_event_id = v_event_id,
               endurance_team_id = v_team_id,
               endurance_binding_source = 'auto',
               updated_at = now()
         WHERE id = v_device;
      END IF;
    END IF;
    PERFORM public.simhub_reconcile_device_latest(v_device);
    RETURN OLD;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.simhub_reconcile_device_latest(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.simhub_reconcile_device_latest(uuid) TO service_role;
REVOKE ALL ON FUNCTION public.simhub_effective_endurance_binding(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.simhub_effective_endurance_binding(uuid) TO authenticated;

-- ============================================================
-- DEEL 9/9  CORRECTIE — concept-races niet vindbaar voor leden
-- ============================================================
-- Gevonden met de negatieve autorisatietest (controle 2 op de kloon): een
-- gewoon lid zag een event met status 'draft' zodra visibility 'open' was.
-- endurance_can_discover_event toetste alleen visibility, uitnodigingen,
-- manager_ids en inschrijvingen. De ontwerpregel luidt "drafts zijn
-- manager-only"; dat moet de server afdwingen, niet de interface.
-- Beheerders blijven concepten zien via de aparte policy
-- "endurance manager all", dus aan hun gedrag verandert niets.
CREATE OR REPLACE FUNCTION public.endurance_can_discover_event(p_event_id uuid, p_user_id uuid DEFAULT auth.uid())
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'auth', 'pg_temp'
AS $function$
BEGIN
  IF p_user_id IS NULL THEN RETURN false; END IF;
  IF p_user_id <> auth.uid() AND NOT public.is_endurance_manager(auth.uid()) THEN
    RETURN false;
  END IF;
  IF public.is_endurance_manager(p_user_id) THEN RETURN true; END IF;

  RETURN EXISTS (
    SELECT 1
    FROM public.endurance_events event
    WHERE event.id = p_event_id
      -- Concept-races zijn manager-only: nooit vindbaar voor gewone leden.
      AND event.status <> 'draft'::public.endurance_event_status
      AND (
        event.visibility = 'open'::public.endurance_event_visibility
        OR p_user_id = ANY(COALESCE(event.invited_user_ids, ARRAY[]::uuid[]))
        OR p_user_id = ANY(COALESCE(event.manager_ids, ARRAY[]::uuid[]))
        OR EXISTS (
          SELECT 1 FROM public.endurance_registrations registration
          WHERE registration.event_id = event.id
            AND registration.user_id = p_user_id
            AND registration.status NOT IN ('rejected', 'withdrawn')
        )
      )
  );
END;
$function$;

COMMIT;
