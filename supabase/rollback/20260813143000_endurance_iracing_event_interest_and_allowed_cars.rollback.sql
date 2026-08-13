-- ============================================================================
-- Rollback: 20260813143000_endurance_iracing_event_interest_and_allowed_cars
-- ----------------------------------------------------------------------------
-- Draait in omgekeerde afhankelijkheidsvolgorde en verwijdert alleen de door
-- deze migratie toegevoegde/gewijzigde objecten:
--   1. nieuwe registro-guard-trigger + functie
--   2. activatie-RPC herstellen naar de versie uit 20260813120000 (welke de
--      extra validaties/automapping-kopie van déze migratie terugdraait)
--   3. interesse-RPC's (summary + set-interest)
--   4. interesse-tabel
--   5. additieve kolom `allowed_car_ids` op endurance_events
--   6. additieve kolom `local_car_ids` op endurance_iracing_events
-- Bestaande handmatige endurance_events worden niet geraakt; de catalogus en
-- de slot-activatie-objecten van 20260813120000 blijven intact.
-- ============================================================================

BEGIN;

-- 1. Registratie-guard-trigger + functie (alleen déze nieuwe guard).
DROP TRIGGER IF EXISTS endurance_guard_iracing_registration_car ON public.endurance_registrations;
DROP FUNCTION IF EXISTS public.endurance_guard_iracing_registration_car();

-- 2. Activatie-RPC herstellen naar de originele vorm uit 20260813120000:
--    géén lokale-automapping-validatie en géén allowed_car_ids-kopie.
CREATE OR REPLACE FUNCTION public.endurance_activate_iracing_slot(
  p_catalog_event_id UUID,
  p_catalog_slot_id UUID,
  p_registration_deadline TIMESTAMPTZ DEFAULT NULL,
  p_visibility public.endurance_event_visibility DEFAULT 'open',
  p_max_drivers_per_car INTEGER DEFAULT 4,
  p_invited_user_ids UUID[] DEFAULT '{}',
  p_manager_ids UUID[] DEFAULT '{}'
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, auth, pg_temp
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_event public.endurance_iracing_events%ROWTYPE;
  v_slot public.endurance_iracing_event_slots%ROWTYPE;
  v_duration_minutes INTEGER;
  v_start_at TIMESTAMPTZ;
  v_end_at TIMESTAMPTZ;
  v_slot_snapshot JSONB;
  v_existing public.endurance_events%ROWTYPE;
  v_row public.endurance_events%ROWTYPE;
BEGIN
  -- 1. Manager/super_admin-only + ingelogd.
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Permission denied' USING ERRCODE = '42501';
  END IF;
  IF NOT public.is_endurance_manager(v_user_id) THEN
    RAISE EXCEPTION 'Permission denied: alleen endurance_manager of super_admin kan een slot activeren'
      USING ERRCODE = '42501';
  END IF;

  -- 2. Valideer catalogus-bron (officiële data is read-only bronwaarheid).
  SELECT * INTO v_event FROM public.endurance_iracing_events
    WHERE id = p_catalog_event_id AND active;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Onbekend of inactief iRacing catalogusevent'
      USING ERRCODE = '22023';
  END IF;
  IF coalesce(cardinality(v_event.local_class_ids), 0) = 0
     OR NOT (v_event.local_class_ids <@ ARRAY['GTP','LMP2','GT3']::TEXT[]) THEN
    RAISE EXCEPTION 'Voor dit officiële event ontbreekt een ondersteunde lokale 3SM-klassemapping'
      USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_slot FROM public.endurance_iracing_event_slots
    WHERE id = p_catalog_slot_id
      AND catalog_event_id = p_catalog_event_id
      AND active;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Onbekend, inactief of niet bij dit event horend catalogusslot'
      USING ERRCODE = '22023';
  END IF;

  -- 3. Serializeer activatie per catalogusevent. Daardoor kan een gelijktijdige
  --    klik op twee verschillende slots nooit twee lokale races produceren.
  PERFORM pg_advisory_xact_lock(hashtextextended(p_catalog_event_id::TEXT, 0));

  SELECT * INTO v_existing FROM public.endurance_events
    WHERE iracing_catalog_event_id = p_catalog_event_id;
  IF FOUND THEN
    IF v_existing.iracing_catalog_slot_id = p_catalog_slot_id THEN
      RETURN v_existing.id;
    END IF;
    RAISE EXCEPTION 'Voor dit officiële event heeft 3SM al een ander timeslot gekozen'
      USING ERRCODE = '23505';
  END IF;

  -- Idempotent: als dit slot al gekoppeld is, geef het bestaande event terug.
  SELECT * INTO v_existing FROM public.endurance_events
    WHERE iracing_catalog_slot_id = p_catalog_slot_id;
  IF FOUND THEN
    RETURN v_existing.id;
  END IF;

  -- 4. Afleiden van tijden: officiële sessiestart = slot.session_start_at.
  v_start_at := v_slot.session_start_at;
  v_duration_minutes := COALESCE(v_slot.session_duration_minutes, v_slot.race_duration_minutes, v_event.duration_minutes);
  IF v_duration_minutes IS NULL THEN
    RAISE EXCEPTION 'Officiële race-/sessieduur ontbreekt; activeer pas na publicatie of een expliciete beheeroverride'
      USING ERRCODE = '22023';
  END IF;
  v_end_at := v_start_at + make_interval(mins => v_duration_minutes);

  v_slot_snapshot := jsonb_build_object(
    'catalog_event_id', p_catalog_event_id,
    'id', v_slot.id,
    'source_slot_key', v_slot.source_slot_key,
    'startAt', v_slot.session_start_at,
    'label', COALESCE(v_slot.label, to_char(v_slot.session_start_at AT TIME ZONE 'Europe/Amsterdam', 'DD Mon HH24:MI')),
    'source', v_slot.source,
    'sessionDurationMinutes', v_slot.session_duration_minutes
  );

  BEGIN
    INSERT INTO public.endurance_events (
      name, circuit, configuration, image_url,
      start_at, end_at,
      registration_deadline,
      slots, class_ids, selected_class_id, selected_car_id,
      max_drivers_per_car, visibility, status, source,
      invited_user_ids, manager_ids,
      iracing_catalog_event_id, iracing_catalog_slot_id,
      iracing_source_key, iracing_source_hash, iracing_slot_key,
      iracing_imported_at
    )
    VALUES (
      v_event.name,
      COALESCE(v_event.circuit, 'TBD'),
      COALESCE(v_event.configuration, ''),
      NULL,
      v_start_at, v_end_at,
      p_registration_deadline,
      jsonb_build_array(v_slot_snapshot),
      v_event.local_class_ids,
      NULL, NULL,
      GREATEST(p_max_drivers_per_car, 1),
      p_visibility,
      'registration_open'::public.endurance_event_status,
      'iracing_catalog',
      COALESCE(p_invited_user_ids, '{}'),
      COALESCE(p_manager_ids, '{}'),
      p_catalog_event_id, p_catalog_slot_id,
      v_event.source_key, v_event.source_hash, v_slot.source_slot_key,
      now()
    )
    RETURNING * INTO v_row;

    RETURN v_row.id;
  EXCEPTION
    WHEN unique_violation THEN
      SELECT * INTO v_existing FROM public.endurance_events
        WHERE iracing_catalog_event_id = p_catalog_event_id;
      IF FOUND THEN
        RETURN v_existing.id;
      END IF;
      RAISE;
  END;
END;
$$;

-- 3. Interesse-RPC's (summary + set-interest).
DROP FUNCTION IF EXISTS public.endurance_iracing_interest_summary();
DROP FUNCTION IF EXISTS public.endurance_set_iracing_interest(UUID, BOOLEAN);

-- 4. Interesse-tabel.
DROP TABLE IF EXISTS public.endurance_iracing_event_interest;

-- 5. Additieve kolommen (FK/index/constraint volgen de kolomdrop).
ALTER TABLE public.endurance_events
  DROP COLUMN IF EXISTS allowed_car_ids;
ALTER TABLE public.endurance_iracing_events
  DROP COLUMN IF EXISTS local_car_ids;

COMMIT;