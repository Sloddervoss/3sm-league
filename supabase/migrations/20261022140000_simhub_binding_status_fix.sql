-- Zet de apparaatstatus goed bij het binden en ontbinden.
--
-- Probleem: simhub_devices_binding_check eist dat een gebonden device
-- device_status='active_binding' EN device_role NOT NULL heeft. Zowel
-- simhub_assign_device_to_entry als de trigger endurance_auto_bind_member_device
-- zetten alleen endurance_event_id en endurance_team_id. Elke binding via de
-- normale flow faalt daardoor op 23514, en een verse pairing blijft 'inactive'.
--
-- Gevolg in de praktijk: de overlay kan helemaal geen team krijgen, dus
-- simhub_effective_endurance_binding levert niets en de snapshot geeft
-- 'not_bound'. Dit is de reden dat de overlay nooit iets toont.

BEGIN;

-- 1. Handmatige toewijzing: zet ook status en rol.
CREATE OR REPLACE FUNCTION public.simhub_assign_device_to_entry(
  p_device_id uuid,
  p_endurance_event_id uuid,
  p_endurance_team_id uuid,
  p_assigned_by uuid
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
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
      -- Deze twee ontbraken en zijn verplicht zodra er een team hangt.
      device_status = 'active_binding',
      device_role = COALESCE(device_role, 'primary'),
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
$function$;

-- 2. Automatische binding via lidmaatschap: zelfde correctie.
CREATE OR REPLACE FUNCTION public.endurance_auto_bind_member_device()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
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

  SELECT d.id, d.endurance_binding_source
    INTO v_device, v_source
    FROM public.simhub_devices d
   WHERE d.owner_user_id = v_user_id AND d.revoked_at IS NULL
   ORDER BY d.paired_at
   LIMIT 1;

  IF v_device IS NULL THEN
    RETURN NULL;
  END IF;

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
           device_status = 'active_binding',
           device_role = COALESCE(device_role, 'primary'),
           updated_at = now()
     WHERE id = v_device;
    PERFORM public.simhub_reconcile_device_latest(v_device);
    RETURN NEW;
  ELSE
    IF (SELECT endurance_team_id FROM public.simhub_devices WHERE id = v_device) = OLD.team_id THEN
      SELECT tm.team_id, t.event_id
        INTO v_team_id, v_event_id
        FROM public.endurance_team_members tm
        JOIN public.endurance_teams t ON t.id = tm.team_id
       WHERE tm.user_id = v_user_id
       ORDER BY tm.created_at DESC
       LIMIT 1;
      IF v_team_id IS NULL THEN
        -- Ontbinden: status en rol moeten mee terug, anders schendt de rij
        -- opnieuw de constraint.
        UPDATE public.simhub_devices
           SET endurance_event_id = NULL,
               endurance_team_id = NULL,
               endurance_binding_source = NULL,
               device_status = 'inactive',
               device_role = NULL,
               updated_at = now()
         WHERE id = v_device;
      ELSE
        UPDATE public.simhub_devices
           SET endurance_event_id = v_event_id,
               endurance_team_id = v_team_id,
               endurance_binding_source = 'auto',
               device_status = 'active_binding',
               device_role = COALESCE(device_role, 'primary'),
               updated_at = now()
         WHERE id = v_device;
      END IF;
    END IF;
    PERFORM public.simhub_reconcile_device_latest(v_device);
    RETURN OLD;
  END IF;
END;
$function$;

-- 3. Handmatige ontkoppeling: zelfde correctie.
CREATE OR REPLACE FUNCTION public.simhub_clear_device_entry(
  p_device_id uuid,
  p_assigned_by uuid
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_updated UUID;
BEGIN
  IF auth.role() <> 'service_role' THEN
    RAISE EXCEPTION 'Permission denied' USING ERRCODE = '42501';
  END IF;

  UPDATE public.simhub_devices
  SET endurance_event_id = NULL,
      endurance_team_id = NULL,
      endurance_binding_source = NULL,
      device_status = 'inactive',
      device_role = NULL,
      updated_at = now()
  WHERE id = p_device_id
  RETURNING id INTO v_updated;

  RETURN v_updated IS NOT NULL;
END;
$function$;

COMMIT;
