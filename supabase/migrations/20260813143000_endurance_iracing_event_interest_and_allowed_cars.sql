BEGIN;

-- ============================================================================
-- 3SM Endurance — pre-activatie-interesse + event-specifieke toegestane auto's
-- ----------------------------------------------------------------------------
-- Voortbouwend op 20260813120000_endurance_iracing_event_catalog. Puur
-- additief; handmatige events blijven volledig werken.
--
-- Doel:
--   * Compacte catalogus-popup: eenieder kan vóór activatie interesse tonen in
--     een officieel iRacing event zonder dat daarvoor al een lokaal event of
--     inschrijving nodig is.
--   * Manager activeert een slot pas bij genoeg animo. Na activatie wordt op
--     het lokale `endurance_events`-record de officieel beschikbare + expliciet
--     lokaal gemapte autoset gekopieerd naar `allowed_car_ids`.
--   * Server-side gate: bij officiële iRacing events wordt een inschrijving met
--     `preferred_car_id` buiten `allowed_car_ids` geweigerd.
--
-- VEILIGHEIDSCONTRACT:
--   * `endurance_iracing_event_interest` is een unieke event+user-tabel zonder
--     enige blootstelling van identiteiten:
--       - RLS staat uitsluitend eigen-rij SELECT toe (auth.uid() = user_id);
--       - er is GEEN INSERT/UPDATE/DELETE-policy en GEEN grant op de tabel voor
--         de browser — alle toegang loopt via de SECURITY DEFINER-RPC's;
--       - geaggregeerde tellingen komen uit een SECURITY DEFINER-functie die
--         géén user-specifieke rijen exposeert, alleen counts + self-flag.
--   * `endurance_iracing_interest_summary()` is authenticated/SECURITY DEFINER
--     en retourneert per catalogusevent alleen het aantal geïnteresseerden en
--     of de aanroeper zelf interesse heeft (nooit user-identiteiten).
--   * `endurance_set_iracing_interest()` is authenticated/SECURITY DEFINER en
--     gebruikt uitsluitend auth.uid() als user_id (client kan nooit een ander
--     profiel interesseren).
--   * `endurance_activate_iracing_slot()` (CREATE OR REPLACE,zelfde signature)
--     vereist nu niet-lege geldige lokale klas- én automapping en kopieert de
--     toegestane auto's naar het lokale event; manager/super_admin-only en
--     idempotent als voorheen.
--   * Nieuwe guard-trigger op `endurance_registrations` weigert
--     `preferred_car_id` buiten `allowed_car_ids` enkel voor iRacing-import-
--     events; NULL blijft toegestaan waar de bestaande flow dat toestaat.
--   * Alle SECURITY DEFINER-functies hebben een vast search_path; revokes en
--     grants beperken executie tot authenticated.
-- ============================================================================

-- ===================================================================
-- 1. Catalogus-event: lokale 3SM-auto-IDs (naast lokale klassen).
--    De sync-functie schrijft `local_car_ids` inmiddels al; deze kolom
--    is de DB-kant van die contract-uitbreiding.
-- ===================================================================
ALTER TABLE public.endurance_iracing_events
  ADD COLUMN local_car_ids TEXT[] NOT NULL DEFAULT '{}';

-- ===================================================================
-- 2. Lokaal event: expliciete set toegestane auto's.
--    NULL = handmatig event (geen restrictie); bij activatie van een
--    officieel event wordt dit gekopieerd uit de lokale automapping.
-- ===================================================================
ALTER TABLE public.endurance_events
  ADD COLUMN allowed_car_ids TEXT[];

-- ===================================================================
-- 3. Pre-activatie-interesse (record per unieke event+user).
-- ===================================================================
CREATE TABLE public.endurance_iracing_event_interest (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  catalog_event_id UUID NOT NULL
    REFERENCES public.endurance_iracing_events(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (catalog_event_id, user_id)
);

CREATE INDEX endurance_iracing_event_interest_event_idx
  ON public.endurance_iracing_event_interest (catalog_event_id);
CREATE INDEX endurance_iracing_event_interest_user_idx
  ON public.endurance_iracing_event_interest (user_id);

ALTER TABLE public.endurance_iracing_event_interest ENABLE ROW LEVEL SECURITY;

-- Defense-in-depth: mocht iemand ooit een directe grant geven, dan kan de
-- browser nóg altijd alleen de eigen rij lezen (auth.uid() = user_id). Er is
-- bewust géén INSERT/UPDATE/DELETE-policy: schrijven loopt uitsluitend via
-- de SECURITY DEFINER-RPC's, zodat een client nooit een ander user_id kan
-- meegeven.
CREATE POLICY "endurance own interest row only" ON public.endurance_iracing_event_interest
  FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

-- De browser krijgt GEEN directe tabeltoegang: alles via de RPC's hieronder,
-- die de counts aggregeren zonder identiteiten te exposeren.
REVOKE ALL ON public.endurance_iracing_event_interest FROM PUBLIC, anon, authenticated;

-- ===================================================================
-- 4. Geaggregeerde counts + self-interesse (authenticated, SECURITY
--    DEFINER, geen identiteiten).
-- ===================================================================
CREATE OR REPLACE FUNCTION public.endurance_iracing_interest_summary()
RETURNS TABLE (
  catalog_event_id UUID,
  interested_count BIGINT,
  is_current_user_interested BOOLEAN
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, auth, pg_temp
AS $$
  SELECT
    interest.catalog_event_id,
    count(*)::BIGINT AS interested_count,
    bool_or(interest.user_id = auth.uid()) AS is_current_user_interested
  FROM public.endurance_iracing_event_interest AS interest
  GROUP BY interest.catalog_event_id
$$;

REVOKE ALL ON FUNCTION public.endurance_iracing_interest_summary() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.endurance_iracing_interest_summary() TO authenticated;

-- ===================================================================
-- 5. Toggle/set-interesse (authenticated, SECURITY DEFINER). Gebruikt
--    uitsluitend auth.uid() als user_id.
-- ===================================================================
CREATE OR REPLACE FUNCTION public.endurance_set_iracing_interest(
  p_catalog_event_id UUID,
  p_interested BOOLEAN
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, auth, pg_temp
AS $$
DECLARE
  v_user_id UUID := auth.uid();
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Permission denied' USING ERRCODE = '42501';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.endurance_iracing_events
    WHERE id = p_catalog_event_id
      AND active
  ) THEN
    RAISE EXCEPTION 'Onbekend iRacing catalogusevent' USING ERRCODE = '22023';
  END IF;

  IF p_interested THEN
    INSERT INTO public.endurance_iracing_event_interest (catalog_event_id, user_id)
    VALUES (p_catalog_event_id, v_user_id)
    ON CONFLICT (catalog_event_id, user_id) DO NOTHING;
  ELSE
    DELETE FROM public.endurance_iracing_event_interest
    WHERE catalog_event_id = p_catalog_event_id
      AND user_id = v_user_id;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.endurance_set_iracing_interest(UUID, BOOLEAN) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.endurance_set_iracing_interest(UUID, BOOLEAN) TO authenticated;

-- ===================================================================
-- 6. Activatie-RPC: eis niet-lege geldige lokale klas- én automapping
--    en kopieer de toegestane auto's naar het lokale event.
--    CREATE OR REPLACE met dezelfde signature (regressievrij). Bleek
--    één officieel slot per event en idempotent (dubbelklik kan nooit
--    twee lokale races opleveren).
-- ===================================================================
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

  -- Activering vereist een niet-lege, geldige lokale 3SM-klassemapping.
  -- Heldere, expliciet geënumerde ondersteunde klassen (moderne endurance
  -- + legacy Portimão HPD/GT1/GT2-deelname).
  IF coalesce(cardinality(v_event.local_class_ids), 0) = 0
     OR NOT (v_event.local_class_ids <@ ARRAY['GTP','LMP2','GT3','HPD','GT1','GT2']::TEXT[]) THEN
    RAISE EXCEPTION 'Voor dit officiële event ontbreekt een ondersteunde lokale 3SM-klassemapping'
      USING ERRCODE = '22023';
  END IF;

  -- Activering vereist óók een niet-lege, geldige lokale 3SM-automapping.
  -- De toegestane set wordt expliciet geënumerd en bevat naast het moderne
  -- endurance-aanbod ook de legacy Portimão HPD/GT1/GT2-auto's.
  IF coalesce(cardinality(v_event.local_car_ids), 0) = 0
     OR NOT (v_event.local_car_ids <@ ARRAY[
       -- GTP
       'acura-arx-06','bmw-m-hybrid-v8','cadillac-v-series-r','ferrari-499p','porsche-963',
       -- LMP2
       'dallara-p217',
       -- GT3
       'acura-nsx-gt3-evo-22','aston-martin-vantage-gt3-evo','audi-r8-lms-evo-ii-gt3',
       'bmw-m4-gt3-evo','chevrolet-corvette-z06-gt3-r','ferrari-296-gt3','ford-mustang-gt3',
       'lamborghini-huracan-gt3-evo','mclaren-720s-gt3-evo','mercedes-amg-gt3-2020',
       'porsche-911-gt3-r-992',
       -- Legacy Portimão (HPD/GT1/GT2)
       'hpd-arx-01c','chevrolet-corvette-c6r','aston-martin-dbr9-gt1','ford-gt-gt2-gt3'
     ]::TEXT[]) THEN
    RAISE EXCEPTION 'Voor dit officiële event ontbreekt een geldige lokale 3SM-automapping'
      USING ERRCODE = '22023';
  END IF;

  -- De lijst mag niet losstaan van de officiële bronauto's: iedere door de
  -- sync gelezen auto moet expliciet naar een lokale 3SM-auto zijn gemapt.
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

  -- Iedere toegestane auto moet ook bij een van de lokaal gemapte klassen horen.
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

  -- Omgekeerde dekking: iedere geactiveerde lokale klasse moet minstens één
  -- toegestane auto hebben, anders ontstaat een lege stemkeuze.
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
  --    Zonder officiële race-/sessieduur wordt niets gegokt.
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

  -- 5. Atomaire insert. De partial unique index garandeert dat parallel
  --    activeren nooit een tweede lokaal event oplevert; bij een race slaat
  --    de unieke-index-uitspraak toe en retourneren we het andere record.
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

-- ===================================================================
-- 7. Registratie-guard: weiger preferred_car_id buiten allowed_car_ids
--    voor officiële iRacing events. Handmatige events blijven ongemoeid.
--    NULL preferred_car_id blijft toegestaan (bestaande flow laat een
--    niet-ingevulde autovoorkeur toe).
-- ===================================================================
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

  -- Alleen officiële iRacing-importevents worden bewaakt; handmatige events
  -- (of een nog onbekend event id) behouden hun bestaande gedrag.
  IF NOT COALESCE(v_is_iracing, false) THEN
    RETURN NEW;
  END IF;

  -- Een expliciete autovoorkeur moet binnen de bij activatie gekopieerde,
  -- lokaal gemapte toegestane set vallen. NULL = geen voorkeur (toegestaan).
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

DROP TRIGGER IF EXISTS endurance_guard_iracing_registration_car ON public.endurance_registrations;
CREATE TRIGGER endurance_guard_iracing_registration_car
  BEFORE INSERT OR UPDATE OF event_id, class_preference, preferred_car_id
  ON public.endurance_registrations
  FOR EACH ROW EXECUTE FUNCTION public.endurance_guard_iracing_registration_car();

COMMIT;