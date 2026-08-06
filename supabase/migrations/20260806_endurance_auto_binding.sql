-- Endurance: automatische device->team-koppeling op basis van teamlidmaatschap.
-- Doel: aanmelden bij een team (endurance_team_members INSERT) bindt het device
-- van die rijder automatisch aan (event, team); afmelden (DELETE) ontbindt het.
-- Regel: handmatige toewijzing (Apparaten-tab) is leidend en wordt door de
-- automatische trigger NOOIT overschreven (endurance_binding_source='manual').
-- Additief + omkeerbaar via de bijbehorende rollback.
BEGIN;

-- 1) Bron van de binding: 'manual' (Apparaten-tab) of 'auto' (teamlidmaatschap).
ALTER TABLE public.simhub_devices
  ADD COLUMN IF NOT EXISTS endurance_binding_source TEXT;

-- Bestaande (handmatig aangemaakte) bindings als manual markeren zodat de
-- trigger ze ongemoeid laat.
UPDATE public.simhub_devices
   SET endurance_binding_source = 'manual'
 WHERE endurance_event_id IS NOT NULL AND endurance_binding_source IS NULL;

-- 2) Volgorde van lidmaatschappen (nodig voor last-join-wins + rebind).
ALTER TABLE public.endurance_team_members
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT now();

-- 3) Handmatige toewijzing stelt de bron in op 'manual'.
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

  RETURN v_updated IS NOT NULL;
END;
$$;

-- Manual clear zet de bron terug (device blijft via pairing gekoppeld).
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

  RETURN v_updated IS NOT NULL;
END;
$$;

-- 4) Trigger: bind bij teamlidmaatschap, ontbind bij verlaten (met rebind naar
--    het meest recente overgebleven lidmaatschap). Handmatig = leidend.
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
    RETURN OLD;
  END IF;
END;
$$;

DROP TRIGGER IF EXISTS trg_endurance_auto_bind ON public.endurance_team_members;
CREATE TRIGGER trg_endurance_auto_bind
AFTER INSERT OR DELETE ON public.endurance_team_members
FOR EACH ROW EXECUTE FUNCTION public.endurance_auto_bind_member_device();

COMMIT;
