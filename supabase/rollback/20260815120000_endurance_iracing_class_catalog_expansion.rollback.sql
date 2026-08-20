BEGIN;

-- ============================================================================
-- Rollback van 20260815120000_endurance_iracing_class_catalog_expansion.sql
-- Herstelt endurance_activate_iracing_slot en de registratie-guard naar de
-- oorspronkelijke GTP/LMP2/GT3(+HPD/GT1/GT2)-whitelist uit 20260813143000.
-- ============================================================================

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
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Permission denied' USING ERRCODE = '42501';
  END IF;
  IF NOT public.is_endurance_manager(v_user_id) THEN
    RAISE EXCEPTION 'Permission denied: alleen endurance_manager of super_admin kan een slot activeren'
      USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_event FROM public.endurance_iracing_events
    WHERE id = p_catalog_event_id AND active;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Onbekend of inactief iRacing catalogusevent'
      USING ERRCODE = '22023';
  END IF;

  IF coalesce(cardinality(v_event.local_class_ids), 0) = 0
     OR NOT (v_event.local_class_ids <@ ARRAY['GTP','LMP2','GT3','HPD','GT1','GT2']::TEXT[]) THEN
    RAISE EXCEPTION 'Voor dit officiële event ontbreekt een ondersteunde lokale 3SM-klassemapping'
      USING ERRCODE = '22023';
  END IF;

  IF coalesce(cardinality(v_event.local_car_ids), 0) = 0
     OR NOT (v_event.local_car_ids <@ ARRAY[
       'acura-arx-06','bmw-m-hybrid-v8','cadillac-v-series-r','ferrari-499p','porsche-963',
       'dallara-p217',
       'acura-nsx-gt3-evo-22','aston-martin-vantage-gt3-evo','audi-r8-lms-evo-ii-gt3',
       'bmw-m4-gt3-evo','chevrolet-corvette-z06-gt3-r','ferrari-296-gt3','ford-mustang-gt3',
       'lamborghini-huracan-gt3-evo','mclaren-720s-gt3-evo','mercedes-amg-gt3-2020','porsche-911-gt3-r-992',
       'hpd-arx-01c','chevrolet-corvette-c6r','aston-martin-dbr9-gt1','ford-gt-gt2-gt3'
     ]::TEXT[]) THEN
    RAISE EXCEPTION 'Voor dit officiële event ontbreekt een geldige lokale 3SM-automapping'
      USING ERRCODE = '22023';
  END IF;

  IF jsonb_typeof(COALESCE(v_event.cars, '[]'::JSONB)) <> 'array'
     OR jsonb_array_length(COALESCE(v_event.cars, '[]'::JSONB)) = 0
     OR EXISTS (
       SELECT 1
       FROM jsonb_array_elements(COALESCE(v_event.cars, '[]'::JSONB)) AS official_car
       WHERE nullif(official_car->>'localCarId', '') IS NULL
          OR NOT (v_event.local_car_ids @> ARRAY[official_car->>'localCarId'])
     ) THEN
    RAISE EXCEPTION 'Niet iedere officieel beschikbare auto heeft een gecontroleerde lokale 3SM-mapping'
      USING ERRCODE = '22023';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM unnest(v_event.local_car_ids) AS car_id
    WHERE CASE
      WHEN car_id IN ('acura-arx-06','bmw-m-hybrid-v8','cadillac-v-series-r','ferrari-499p','porsche-963') THEN 'GTP'
      WHEN car_id = 'dallara-p217' THEN 'LMP2'
      WHEN car_id IN (
        'acura-nsx-gt3-evo-22','aston-martin-vantage-gt3-evo','audi-r8-lms-evo-ii-gt3',
        'bmw-m4-gt3-evo','chevrolet-corvette-z06-gt3-r','ferrari-296-gt3','ford-mustang-gt3',
        'lamborghini-huracan-gt3-evo','mclaren-720s-gt3-evo','mercedes-amg-gt3-2020','porsche-911-gt3-r-992'
      ) THEN 'GT3'
      WHEN car_id = 'hpd-arx-01c' THEN 'HPD'
      WHEN car_id IN ('chevrolet-corvette-c6r','aston-martin-dbr9-gt1') THEN 'GT1'
      WHEN car_id = 'ford-gt-gt2-gt3' THEN 'GT2'
      ELSE NULL
    END <> ALL(v_event.local_class_ids)
  ) THEN
    RAISE EXCEPTION 'Lokale 3SM-auto- en klassemapping zijn onderling niet consistent'
      USING ERRCODE = '22023';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM unnest(v_event.local_class_ids) AS class_id
    WHERE NOT EXISTS (
      SELECT 1
      FROM unnest(v_event.local_car_ids) AS car_id
      WHERE CASE
        WHEN car_id IN ('acura-arx-06','bmw-m-hybrid-v8','cadillac-v-series-r','ferrari-499p','porsche-963') THEN 'GTP'
        WHEN car_id = 'dallara-p217' THEN 'LMP2'
        WHEN car_id IN (
          'acura-nsx-gt3-evo-22','aston-martin-vantage-gt3-evo','audi-r8-lms-evo-ii-gt3',
          'bmw-m4-gt3-evo','chevrolet-corvette-z06-gt3-r','ferrari-296-gt3','ford-mustang-gt3',
          'lamborghini-huracan-gt3-evo','mclaren-720s-gt3-evo','mercedes-amg-gt3-2020','porsche-911-gt3-r-992'
        ) THEN 'GT3'
        WHEN car_id = 'hpd-arx-01c' THEN 'HPD'
        WHEN car_id IN ('chevrolet-corvette-c6r','aston-martin-dbr9-gt1') THEN 'GT1'
        WHEN car_id = 'ford-gt-gt2-gt3' THEN 'GT2'
        ELSE NULL
      END = class_id
    )
  ) THEN
    RAISE EXCEPTION 'Niet iedere lokale 3SM-klasse heeft een toegestane auto voor dit officiële event'
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

  SELECT * INTO v_existing FROM public.endurance_events
    WHERE iracing_catalog_slot_id = p_catalog_slot_id;
  IF FOUND THEN
    RETURN v_existing.id;
  END IF;

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
      allowed_car_ids,
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
      v_event.local_car_ids,
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

CREATE OR REPLACE FUNCTION public.endurance_guard_iracing_registration_car()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_is_iracing BOOLEAN;
  v_allowed_car_ids TEXT[];
  v_expected_class TEXT;
BEGIN
  SELECT (e.iracing_catalog_event_id IS NOT NULL), e.allowed_car_ids
    INTO v_is_iracing, v_allowed_car_ids
    FROM public.endurance_events AS e
    WHERE e.id = NEW.event_id;

  IF NOT COALESCE(v_is_iracing, false) THEN
    RETURN NEW;
  END IF;

  IF NEW.preferred_car_id IS NOT NULL
     AND NOT (COALESCE(v_allowed_car_ids, '{}') @> ARRAY[NEW.preferred_car_id]) THEN
    RAISE EXCEPTION 'Gekozen auto staat niet in de toegestane auto''s voor dit officiële iRacing-event'
      USING ERRCODE = '23514';
  END IF;

  IF NEW.preferred_car_id IS NOT NULL THEN
    v_expected_class := CASE
      WHEN NEW.preferred_car_id IN ('acura-arx-06','bmw-m-hybrid-v8','cadillac-v-series-r','ferrari-499p','porsche-963') THEN 'GTP'
      WHEN NEW.preferred_car_id = 'dallara-p217' THEN 'LMP2'
      WHEN NEW.preferred_car_id IN (
        'acura-nsx-gt3-evo-22','aston-martin-vantage-gt3-evo','audi-r8-lms-evo-ii-gt3',
        'bmw-m4-gt3-evo','chevrolet-corvette-z06-gt3-r','ferrari-296-gt3','ford-mustang-gt3',
        'lamborghini-huracan-gt3-evo','mclaren-720s-gt3-evo','mercedes-amg-gt3-2020','porsche-911-gt3-r-992'
      ) THEN 'GT3'
      WHEN NEW.preferred_car_id = 'hpd-arx-01c' THEN 'HPD'
      WHEN NEW.preferred_car_id IN ('chevrolet-corvette-c6r','aston-martin-dbr9-gt1') THEN 'GT1'
      WHEN NEW.preferred_car_id = 'ford-gt-gt2-gt3' THEN 'GT2'
      ELSE NULL
    END;
    IF v_expected_class IS DISTINCT FROM NEW.class_preference THEN
      RAISE EXCEPTION 'Gekozen auto hoort niet bij de gekozen klasse voor dit officiële iRacing-event'
        USING ERRCODE = '23514';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

COMMIT;
