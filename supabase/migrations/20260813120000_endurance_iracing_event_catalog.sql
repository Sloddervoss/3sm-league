BEGIN;

-- ============================================================================
-- 3SM Endurance — iRacing Special Events catalogus + slot-activatie
-- ----------------------------------------------------------------------------
-- Doel (zie .hermes/plans/2026-08-13_074800-iracing-special-events-weekly-sync.md,
-- Task 3 + backendhelft Task 8):
--   * Drie uitsluitend NIEUWE `endurance_iracing_*`-tabellen voor de externe,
--     wekelijks bijgewerkte catalogus (events, slots, syncruns).
--   * Additieve bronkolommen op `endurance_events` — er worden GEEN bestaande
--     kolommen/waarden gewijzigd, handmatige events blijven volledig werken.
--   * Harde unieke constraints: één geactiveerd `endurance_events`-record per
--     catalogusevent én per slot (partial unique indexes).
--   * Atomaire, manager-only activatie-RPC `endurance_activate_iracing_slot`
--     die precies één gekoppeld `endurance_events`-record maakt en idempotent
--     is (dubbelklik/parallel kan nooit een tweede lokale race opleveren).
--   * Registratie-slot-gate: een trigger op `endurance_registrations` lockt het
--     registratie-slot server-side op het geactiveerde iRacing-slot.
--
-- VEILIGHEIDSCONTRACT:
--   * Browser (authenticated) leest de catalogus uitsluitend via de bestaande
--     staff-voorwaarde (SELECT); er is GEEN INSERT/UPDATE/DELETE-policy en geen
--     schrijfrecht voor de browser op catalogus of syncruns.
--   * Alleen manager/super_admin kan activeren via de SECURITY DEFINER-RPC
--     (server-side; geen service-role key in de browser).
--   * De wekelijkse sync schrijft via een server-only databaseclient — er wordt
--     niets aan de browser geëxposeerd.
--   * Er worden geen bestaande tabellen, RLS-policies of privileges gewijzigd,
--     behalve de additieve bronkolommen + een guard-trigger op
--     `endurance_registrations` (regressievrij: alleen iRacing-importevents
--     worden bewaakt, handmatige events worden niet geraakt).
-- ============================================================================

-- ========================= CATALOGUS-EVENTS =================================
CREATE TABLE public.endurance_iracing_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_key TEXT NOT NULL UNIQUE,
  iracing_series_id INTEGER,
  iracing_season_id INTEGER,
  name TEXT NOT NULL,
  year INTEGER NOT NULL,
  circuit TEXT,
  configuration TEXT,
  track_id INTEGER,
  event_start_date DATE,
  event_end_date DATE,
  duration_minutes INTEGER,
  class_ids TEXT[] NOT NULL DEFAULT '{}',
  local_class_ids TEXT[] NOT NULL DEFAULT '{}',
  cars JSONB NOT NULL DEFAULT '[]'::jsonb,
  team_event BOOLEAN NOT NULL DEFAULT true,
  official_url TEXT,
  poster_url TEXT,
  source_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  source_hash TEXT NOT NULL,
  availability_status TEXT NOT NULL DEFAULT 'tbd'
    CHECK (availability_status IN ('exact_slots', 'date_only', 'tbd')),
  active BOOLEAN NOT NULL DEFAULT true,
  first_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  source_updated_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ========================= CATALOGUS-SLOTS ==================================
CREATE TABLE public.endurance_iracing_event_slots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  catalog_event_id UUID NOT NULL
    REFERENCES public.endurance_iracing_events(id) ON DELETE CASCADE,
  source_slot_key TEXT NOT NULL,
  session_start_at TIMESTAMPTZ NOT NULL,
  practice_start_at TIMESTAMPTZ,
  practice_duration_minutes INTEGER,
  qualifying_start_at TIMESTAMPTZ,
  qualifying_duration_minutes INTEGER,
  transition_duration_minutes INTEGER,
  estimated_race_start_at TIMESTAMPTZ,
  race_duration_minutes INTEGER,
  race_lap_limit INTEGER,
  session_duration_minutes INTEGER,
  session_timing_status TEXT NOT NULL DEFAULT 'race_only'
    CHECK (session_timing_status IN ('full', 'partial', 'race_only')),
  registration_open_at TIMESTAMPTZ,
  label TEXT,
  source TEXT NOT NULL,
  active BOOLEAN NOT NULL DEFAULT true,
  missing_successful_syncs INTEGER NOT NULL DEFAULT 0,
  first_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (catalog_event_id, source_slot_key)
);

-- ========================= SYNC-RUNS ========================================
CREATE TABLE public.endurance_iracing_sync_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'running'
    CHECK (status IN ('running', 'success', 'partial', 'failed')),
  events_seen INTEGER NOT NULL DEFAULT 0,
  events_inserted INTEGER NOT NULL DEFAULT 0,
  events_updated INTEGER NOT NULL DEFAULT 0,
  slots_seen INTEGER NOT NULL DEFAULT 0,
  slots_inserted INTEGER NOT NULL DEFAULT 0,
  slots_updated INTEGER NOT NULL DEFAULT 0,
  error_summary TEXT,
  source_modified_at TIMESTAMPTZ
);

-- ======================= INDEXEN (opzoek + sortering) =======================
CREATE INDEX endurance_iracing_events_active_idx
  ON public.endurance_iracing_events (active);
CREATE INDEX endurance_iracing_events_year_idx
  ON public.endurance_iracing_events (year);
CREATE INDEX endurance_iracing_events_start_date_idx
  ON public.endurance_iracing_events (event_start_date);
CREATE INDEX endurance_iracing_events_created_idx
  ON public.endurance_iracing_events (created_at);
CREATE INDEX endurance_iracing_events_series_idx
  ON public.endurance_iracing_events (iracing_series_id);

CREATE INDEX endurance_iracing_event_slots_event_idx
  ON public.endurance_iracing_event_slots (catalog_event_id);
CREATE INDEX endurance_iracing_event_slots_start_idx
  ON public.endurance_iracing_event_slots (session_start_at);
CREATE INDEX endurance_iracing_event_slots_active_idx
  ON public.endurance_iracing_event_slots (active);

CREATE INDEX endurance_iracing_sync_runs_started_idx
  ON public.endurance_iracing_sync_runs (started_at DESC);
CREATE UNIQUE INDEX endurance_iracing_sync_runs_one_running
  ON public.endurance_iracing_sync_runs ((status))
  WHERE status = 'running';

-- =================== UITBREIDING `endurance_events` =========================
-- Additief: bronverwijzing naar catalogus. Beide null  = handmatig event,
-- beide gevuld = iRacing-import. De check + trigger garanderen consistentie.
ALTER TABLE public.endurance_events
  ADD COLUMN iracing_catalog_event_id UUID
    REFERENCES public.endurance_iracing_events(id) ON DELETE SET NULL,
  ADD COLUMN iracing_catalog_slot_id UUID
    REFERENCES public.endurance_iracing_event_slots(id) ON DELETE RESTRICT,
  ADD COLUMN iracing_source_key TEXT,
  ADD COLUMN iracing_source_hash TEXT,
  ADD COLUMN iracing_slot_key TEXT,
  ADD COLUMN iracing_imported_at TIMESTAMPTZ;

-- Handmatig (both null) óf iRacing-import (beide gevuld); nooit half.
ALTER TABLE public.endurance_events
  ADD CONSTRAINT endurance_events_iracing_link_check
  CHECK (
    (iracing_catalog_event_id IS NULL AND iracing_catalog_slot_id IS NULL)
    OR
    (iracing_catalog_event_id IS NOT NULL AND iracing_catalog_slot_id IS NOT NULL)
  );

-- Eén gekozen 3SM-event per officieel catalogusevent...
CREATE UNIQUE INDEX endurance_events_one_per_catalog_event
  ON public.endurance_events (iracing_catalog_event_id)
  WHERE iracing_catalog_event_id IS NOT NULL;

-- ...en hetzelfde officiële slot kan niet dubbel worden geactiveerd.
CREATE UNIQUE INDEX endurance_events_one_per_catalog_slot
  ON public.endurance_events (iracing_catalog_slot_id)
  WHERE iracing_catalog_slot_id IS NOT NULL;

-- Trigger: het gekozen slot moet bij het gekozen catalogusevent horen.
CREATE OR REPLACE FUNCTION public.endurance_validate_iracing_link()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_belongs BOOLEAN;
BEGIN
  IF NEW.iracing_catalog_event_id IS NULL OR NEW.iracing_catalog_slot_id IS NULL THEN
    IF NEW.iracing_catalog_event_id IS DISTINCT FROM NEW.iracing_catalog_slot_id THEN
      RAISE EXCEPTION 'iRacing catalog event en slot moeten beide gevuld of beide leeg zijn'
        USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.endurance_iracing_event_slots slot
    WHERE slot.id = NEW.iracing_catalog_slot_id
      AND slot.catalog_event_id = NEW.iracing_catalog_event_id
  ) INTO v_belongs;

  IF NOT v_belongs THEN
    RAISE EXCEPTION 'Slot behoort niet bij het gekozen iRacing catalogusevent'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS endurance_events_validate_iracing_link ON public.endurance_events;
CREATE TRIGGER endurance_events_validate_iracing_link
  BEFORE INSERT OR UPDATE OF iracing_catalog_event_id, iracing_catalog_slot_id
  ON public.endurance_events
  FOR EACH ROW EXECUTE FUNCTION public.endurance_validate_iracing_link();

-- ======================= RLS: alleen lezen, nooit browser-schrijven =========
ALTER TABLE public.endurance_iracing_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.endurance_iracing_event_slots ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.endurance_iracing_sync_runs ENABLE ROW LEVEL SECURITY;

-- Racebeheer (super_admin/endurance_manager/tester = staff) mag de catalogus
-- alleen LEZEN. Er is bewust géén INSERT/UPDATE/DELETE-policy: de browser kan
-- de catalogus en syncruns nooit schrijven (RLS weigert zonder policy).
CREATE POLICY "endurance member catalog event view" ON public.endurance_iracing_events
  FOR SELECT TO authenticated
  USING (auth.uid() IS NOT NULL);

CREATE POLICY "endurance member catalog slot view" ON public.endurance_iracing_event_slots
  FOR SELECT TO authenticated
  USING (auth.uid() IS NOT NULL);

CREATE POLICY "endurance staff sync run view" ON public.endurance_iracing_sync_runs
  FOR SELECT TO authenticated
  USING (public.is_endurance_staff(auth.uid()));

-- Geen anon/public-leesrechten; write blijft alleen server-sync en de
-- SECURITY DEFINER-activatie-RPC. SELECT-rechten voor staff-exposed reads.
REVOKE ALL ON public.endurance_iracing_events,
  public.endurance_iracing_event_slots,
  public.endurance_iracing_sync_runs FROM PUBLIC, anon;
GRANT SELECT ON public.endurance_iracing_events,
  public.endurance_iracing_event_slots,
  public.endurance_iracing_sync_runs TO authenticated;

-- ============ ATOMAIRE MANAGER-ACTIVATIE (server-side RPC) ==================
-- Maakt precies één gekoppeld `endurance_events`-record voor één officieel
-- slot, of retourneert het bestaande record (idempotent). Officiële source-
-- data wordt GELEZEN uit catalogus+slot (read-only), nooit uit browserinput.
-- De manager levert uitsluitend 3SM-specifieke velden.
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

REVOKE ALL ON FUNCTION public.endurance_activate_iracing_slot(
  UUID, UUID, TIMESTAMPTZ, public.endurance_event_visibility, INTEGER, UUID[], UUID[])
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.endurance_activate_iracing_slot(
  UUID, UUID, TIMESTAMPTZ, public.endurance_event_visibility, INTEGER, UUID[], UUID[])
  TO authenticated;

-- ========== REGISTRATIE-SLOT-GATE (server-side locked slot) =================
-- Bij een iRacing-importevent wordt het registratie-slot op het geactiveerde
-- slot vergrendeld. De browser kan géén ander officieel slot injecteren: een
-- afwijkend `slot_id` wordt geweigerd, ontbrekend wordt genormaliseerd naar
-- het geactiveerde slot. Handmatige events (geen iRacing-koppeling) worden
-- niet geraakt en behouden hun bestaande gedrag.
CREATE OR REPLACE FUNCTION public.endurance_guard_iracing_registration_slot()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_locked_slot_id TEXT;
  v_is_iracing BOOLEAN;
  v_event_status public.endurance_event_status;
  v_registration_deadline TIMESTAMPTZ;
BEGIN
  SELECT (iracing_catalog_event_id IS NOT NULL), iracing_catalog_slot_id::TEXT, status, registration_deadline
    INTO v_is_iracing, v_locked_slot_id, v_event_status, v_registration_deadline
    FROM public.endurance_events
    WHERE id = NEW.event_id;

  IF v_is_iracing THEN
    IF v_event_status <> 'registration_open'::public.endurance_event_status THEN
      RAISE EXCEPTION 'Inschrijving voor dit officiële iRacing-event is gesloten'
        USING ERRCODE = '23514';
    END IF;
    IF v_registration_deadline IS NOT NULL AND now() > v_registration_deadline THEN
      RAISE EXCEPTION 'De aanmelddeadline voor dit officiële iRacing-event is verstreken'
        USING ERRCODE = '23514';
    END IF;
    IF NEW.slot_id IS NULL THEN
      NEW.slot_id := v_locked_slot_id;
    ELSIF NEW.slot_id IS DISTINCT FROM v_locked_slot_id THEN
      RAISE EXCEPTION 'Registratie-slot is server-side vergrendeld op het geactiveerde iRacing-slot'
        USING ERRCODE = '23514';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS endurance_guard_iracing_registration_slot ON public.endurance_registrations;
CREATE TRIGGER endurance_guard_iracing_registration_slot
  BEFORE INSERT OR UPDATE OF event_id, slot_id
  ON public.endurance_registrations
  FOR EACH ROW EXECUTE FUNCTION public.endurance_guard_iracing_registration_slot();

-- ======================= GENERIEKE updated_at-touch =========================
CREATE TRIGGER endurance_iracing_events_touch BEFORE UPDATE ON public.endurance_iracing_events
  FOR EACH ROW EXECUTE FUNCTION public.endurance_touch_updated_at();
CREATE TRIGGER endurance_iracing_event_slots_touch BEFORE UPDATE ON public.endurance_iracing_event_slots
  FOR EACH ROW EXECUTE FUNCTION public.endurance_touch_updated_at();

COMMIT;
