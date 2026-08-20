-- Keep SimHub latest-telemetry RLS and Race Control routing aligned with the
-- same date-aware effective Endurance event/team binding used by ingest.
BEGIN;

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

COMMIT;
