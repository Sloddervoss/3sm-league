-- Endurance Fase 2A: device -> endurance entry binding.
-- Additie en nieuw: voegt nullable endurance-binding-kolommen en super-admin-only
-- toewijzings-RPC's toe. Raakt geen bestaande live-gedrag (race/team-binding en
-- ongebonden devices blijven exact werken). Server-side autoriteit: de plugin
-- stuurt alleen telemetry + identiteit; de koppeling aan event/team staat hier.
BEGIN;

ALTER TABLE public.simhub_devices
  ADD COLUMN IF NOT EXISTS endurance_event_id UUID REFERENCES public.endurance_events(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS endurance_team_id UUID REFERENCES public.endurance_teams(id) ON DELETE SET NULL;

-- Billijke toestand: beide endurance-waarden samen, en niet gemengd met legacy race/team.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'simhub_devices_binding_check') THEN
    ALTER TABLE public.simhub_devices ADD CONSTRAINT simhub_devices_binding_check CHECK (
      (endurance_event_id IS NULL) = (endurance_team_id IS NULL)
      AND (endurance_event_id IS NULL OR (race_id IS NULL AND team_id IS NULL))
    );
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS simhub_devices_endurance_event_idx
  ON public.simhub_devices (endurance_event_id, endurance_team_id)
  WHERE revoked_at IS NULL;

-- Super-admin koppelt een (nog ongebonden) device aan een endurance event + team.
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

COMMIT;
