-- Rollback: automatic member binding. Restore the assignment RPCs from the
-- preceding device-binding migration before removing endurance_binding_source.
BEGIN;

DROP TRIGGER IF EXISTS trg_endurance_auto_bind ON public.endurance_team_members;
DROP FUNCTION IF EXISTS public.endurance_auto_bind_member_device();

ALTER TABLE public.endurance_team_members
  DROP COLUMN IF EXISTS created_at;

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

  -- Het team moet tot het event behoren.
  SELECT event_id INTO v_team_event
  FROM public.endurance_teams
  WHERE id = p_endurance_team_id;
  IF v_team_event IS NULL OR v_team_event <> p_endurance_event_id THEN
    RETURN false;
  END IF;

  UPDATE public.simhub_devices
  SET endurance_event_id = p_endurance_event_id,
      endurance_team_id = p_endurance_team_id,
      race_id = NULL,
      team_id = NULL,
      updated_at = now()
  WHERE id = p_device_id AND revoked_at IS NULL
  RETURNING id INTO v_updated;

  RETURN v_updated IS NOT NULL;
END;
$$;

-- Super-admin maakt de endurance-binding van een device ongedaan (blijft gekoppeld via pairing).
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
      updated_at = now()
  WHERE id = p_device_id AND revoked_at IS NULL
  RETURNING id INTO v_updated;

  RETURN v_updated IS NOT NULL;
END;
$$;

REVOKE ALL ON FUNCTION public.simhub_assign_device_to_entry(UUID, UUID, UUID, UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.simhub_assign_device_to_entry(UUID, UUID, UUID, UUID) TO service_role;
REVOKE ALL ON FUNCTION public.simhub_clear_device_entry(UUID, UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.simhub_clear_device_entry(UUID, UUID) TO service_role;


ALTER TABLE public.simhub_devices
  DROP COLUMN IF EXISTS endurance_binding_source;

COMMIT;
