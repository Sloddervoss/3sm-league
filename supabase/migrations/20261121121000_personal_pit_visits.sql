-- 2026-11-21: persoonlijke pitduur uit twee expliciete bronflanken.
--
-- Bron zijn de meetgebeurtenissen `pit_in` en `pit_out` die de connector
-- rechtstreeks op de ruwe SDK `OnPitRoad`-flank maakt en in de duurzame
-- meet-outbox bewaart. Elk event draagt zijn eigen observed_at, sessietijd en
-- SDK-tick. Er wordt niets uit een sparse tyre-tabel afgeleid.
--
-- Wat deze migratie NIET doet:
--   * geen `simhub_tyre_observations`-trigger. Die tabel is bemonsterd en
--     houdt in de praktijk maar enkele tientallen waarnemingstijden over; een
--     exacte pitgrens is daar niet uit te bewijzen.
--   * geen backfill. De trigger loopt uitsluitend op nieuw binnengekomen
--     meetgebeurtenissen; bestaande rijen worden niet opnieuw geïnterpreteerd.
--   * geen `received_at` als duur. De duur komt uit sessietijd aan beide
--     flanken; `received_at` is alleen de opslagtijd.
--   * geen transport-sessie als identiteit. De levensduur van een pitbezoek en
--     zijn device/observed-sessie zijn de partitie; `delivered_session_id` en
--     de oude transportkolom doen niet mee.
--   * geen koppeling aan strategie of netto raceverlies. `pit_lane_seconds` is
--     bruto pitstraattijd, service inbegrepen; `computePitLoss` krijgt deze
--     waarde niet.
--
-- Ontbrekende of onbekende gegevens (geen entry, geen exit, onbekende
-- OnPitRoad, teruglopende klok, niet-monotone SDK-tick, een gat in de flank,
-- reset/tow of een duur buiten 5–900 s) leveren geen bezoek. De afgekeurde
-- flank blijft in `pitwall_personal_pit_visit_edges` zichtbaar met zijn reden,
-- zodat "geen getal" een expliciete diagnose heeft.

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Duurzame bezoeken en hun bronflanken.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.pitwall_personal_pit_visit_edges (
  id                    bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  -- Zelfde type als simhub_measurement_events.device_id: text. De waarde is
  -- in de praktijk een uuid-string, maar de bronkolom is bewust text en heeft
  -- geen FK. Een cast hier zou een bronrij kunnen laten vallen.
  device_id             text NOT NULL,
  observed_session_id   text NOT NULL,
  pit_visit_id          text NOT NULL,
  event_uid             uuid NOT NULL,
  kind                  text NOT NULL,
  observed_at           timestamptz,
  session_time_seconds  double precision,
  sdk_tick              bigint,
  confidence            double precision,
  note                  text,
  pair_status           text NOT NULL DEFAULT 'pending',
  reject_reason         text,
  created_at            timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT pitwall_personal_pit_visit_edges_unique UNIQUE (event_uid),
  CONSTRAINT pitwall_personal_pit_visit_edges_kind CHECK (kind IN ('pit_in', 'pit_out')),
  CONSTRAINT pitwall_personal_pit_visit_edges_status CHECK (pair_status IN ('pending', 'paired', 'orphan', 'rejected')),
  CONSTRAINT pitwall_personal_pit_visit_edges_session_len CHECK (char_length(observed_session_id) BETWEEN 1 AND 120),
  CONSTRAINT pitwall_personal_pit_visit_edges_visit_len CHECK (char_length(pit_visit_id) BETWEEN 1 AND 64)
);

CREATE UNIQUE INDEX IF NOT EXISTS pitwall_personal_pit_visit_edges_one_flank
  ON public.pitwall_personal_pit_visit_edges (device_id, observed_session_id, pit_visit_id, kind)
  WHERE reject_reason IS NULL;

CREATE INDEX IF NOT EXISTS pitwall_personal_pit_visit_edges_lookup
  ON public.pitwall_personal_pit_visit_edges (device_id, observed_session_id, pit_visit_id, kind);

CREATE TABLE IF NOT EXISTS public.pitwall_personal_pit_visits (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  device_id             text NOT NULL,
  observed_session_id   text NOT NULL,
  pit_visit_id          text NOT NULL,
  entry_event_uid       uuid NOT NULL,
  exit_event_uid        uuid NOT NULL,
  entry_observed_at     timestamptz NOT NULL,
  exit_observed_at      timestamptz NOT NULL,
  entry_session_seconds double precision NOT NULL,
  exit_session_seconds  double precision NOT NULL,
  pit_lane_seconds      numeric(8,3) NOT NULL,
  entry_sdk_tick        bigint NOT NULL,
  exit_sdk_tick         bigint NOT NULL,
  source                text NOT NULL DEFAULT 'measurement_event_pit_edges',
  created_at            timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT pitwall_personal_pit_visits_unique UNIQUE (device_id, observed_session_id, pit_visit_id),
  CONSTRAINT pitwall_personal_pit_visits_session_len CHECK (char_length(observed_session_id) BETWEEN 1 AND 120),
  CONSTRAINT pitwall_personal_pit_visits_visit_len CHECK (char_length(pit_visit_id) BETWEEN 1 AND 64),
  CONSTRAINT pitwall_personal_pit_visits_edges CHECK (entry_event_uid <> exit_event_uid),
  CONSTRAINT pitwall_personal_pit_visits_clock CHECK (exit_session_seconds > entry_session_seconds),
  CONSTRAINT pitwall_personal_pit_visits_wall CHECK (exit_observed_at > entry_observed_at),
  CONSTRAINT pitwall_personal_pit_visits_ticks CHECK (exit_sdk_tick > entry_sdk_tick),
  CONSTRAINT pitwall_personal_pit_visits_duration CHECK (pit_lane_seconds BETWEEN 5 AND 900),
  CONSTRAINT pitwall_personal_pit_visits_source CHECK (source = 'measurement_event_pit_edges')
);

CREATE INDEX IF NOT EXISTS pitwall_personal_pit_visits_device_session_idx
  ON public.pitwall_personal_pit_visits (device_id, observed_session_id, entry_observed_at DESC);

ALTER TABLE public.pitwall_personal_pit_visit_edges ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pitwall_personal_pit_visits ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS pitwall_personal_pit_visit_edges_service_role_all ON public.pitwall_personal_pit_visit_edges;
CREATE POLICY pitwall_personal_pit_visit_edges_service_role_all
  ON public.pitwall_personal_pit_visit_edges
  FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS pitwall_personal_pit_visits_service_role_all ON public.pitwall_personal_pit_visits;
CREATE POLICY pitwall_personal_pit_visits_service_role_all
  ON public.pitwall_personal_pit_visits
  FOR ALL TO service_role USING (true) WITH CHECK (true);

REVOKE ALL ON public.pitwall_personal_pit_visit_edges FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.pitwall_personal_pit_visits FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.pitwall_personal_pit_visit_edges TO service_role;
GRANT ALL ON public.pitwall_personal_pit_visits TO service_role;

COMMENT ON TABLE public.pitwall_personal_pit_visits IS
  'Afgeronde persoonlijke pitbezoeken uit twee expliciete connectorflanken; bruto pit-in tot pit-uit, geen netto raceverlies.';
COMMENT ON COLUMN public.pitwall_personal_pit_visits.pit_lane_seconds IS
  'Sessietijd pit-uit min sessietijd pit-in. Service is inbegrepen; niet aftrekken van een rondetijd.';
COMMENT ON TABLE public.pitwall_personal_pit_visit_edges IS
  'Iedere ontvangen pit_in/pit_out-flank met zijn bron-tijdstempel en de expliciete afkeurreden; nooit een geschatte flank.';

-- ---------------------------------------------------------------------------
-- 2. Paren: alleen twee echte, elkaar bevestigende flanken.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.simhub_capture_personal_pit_visit_v2()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $visit$
DECLARE
  v_entry public.pitwall_personal_pit_visit_edges%ROWTYPE;
  v_exit public.pitwall_personal_pit_visit_edges%ROWTYPE;
  v_entries integer;
  v_exits integer;
  v_reason text;
  v_seconds double precision;
  v_wall double precision;
BEGIN
  IF NEW.kind IS NULL OR NEW.kind NOT IN ('pit_in', 'pit_out') THEN
    RETURN NEW;
  END IF;

  -- Alleen de bron-tijdstempel van de client telt. Zonder observed-sessie of
  -- pitVisitId is dit geen paarbaar bezoek, ook al is het event verder geldig.
  IF NEW.observed_session_id IS NULL OR NEW.pit_visit_id IS NULL
     OR NEW.observed_at IS NULL OR NEW.session_time_seconds IS NULL OR NEW.sdk_tick IS NULL THEN
    RETURN NEW;
  END IF;

  INSERT INTO public.pitwall_personal_pit_visit_edges (
    device_id, observed_session_id, pit_visit_id, event_uid, kind,
    observed_at, session_time_seconds, sdk_tick, confidence, note
  ) VALUES (
    NEW.device_id, NEW.observed_session_id, NEW.pit_visit_id, NEW.event_uid, NEW.kind,
    NEW.observed_at, NEW.session_time_seconds, NEW.sdk_tick, NEW.confidence,
    left(coalesce(NEW.evidence ->> 'note', ''), 120)
  )
  ON CONFLICT DO NOTHING;

  -- Alleen een nieuw ingevoegde flank mag paren; een retry is idempotent.
  IF NOT FOUND THEN
    RETURN NEW;
  END IF;

  -- Een flank die de connector zelf al afkeurt (gat, reset/tow, onbekende
  -- vlag, ontbrekende entry) is geen halve meting om op te wachten.
  IF NEW.confidence IS NULL OR NEW.confidence <> 1 THEN
    UPDATE public.pitwall_personal_pit_visit_edges
       SET pair_status = 'rejected',
           reject_reason = left(coalesce(nullif(NEW.evidence ->> 'note', ''), 'edge_not_confident'), 80)
     WHERE event_uid = NEW.event_uid;
    RETURN NEW;
  END IF;

  SELECT count(*) INTO v_entries
    FROM public.pitwall_personal_pit_visit_edges
   WHERE device_id = NEW.device_id
     AND observed_session_id = NEW.observed_session_id
     AND pit_visit_id = NEW.pit_visit_id
     AND kind = 'pit_in'
     AND reject_reason IS NULL;

  SELECT count(*) INTO v_exits
    FROM public.pitwall_personal_pit_visit_edges
   WHERE device_id = NEW.device_id
     AND observed_session_id = NEW.observed_session_id
     AND pit_visit_id = NEW.pit_visit_id
     AND kind = 'pit_out'
     AND reject_reason IS NULL;

  -- Nog maar één kant binnen: blijft expliciet pending. Er wordt niets
  -- geschat en er verschijnt geen rij met een halve tijd.
  IF v_entries = 0 OR v_exits = 0 THEN
    RETURN NEW;
  END IF;

  SELECT * INTO v_entry
    FROM public.pitwall_personal_pit_visit_edges
   WHERE device_id = NEW.device_id
     AND observed_session_id = NEW.observed_session_id
     AND pit_visit_id = NEW.pit_visit_id
     AND kind = 'pit_in'
     AND reject_reason IS NULL
   ORDER BY observed_at ASC, event_uid ASC
   LIMIT 1;

  SELECT * INTO v_exit
    FROM public.pitwall_personal_pit_visit_edges
   WHERE device_id = NEW.device_id
     AND observed_session_id = NEW.observed_session_id
     AND pit_visit_id = NEW.pit_visit_id
     AND kind = 'pit_out'
     AND reject_reason IS NULL
   ORDER BY observed_at DESC, event_uid DESC
   LIMIT 1;

  v_reason := NULL;
  IF v_entries <> 1 THEN
    v_reason := 'multiple_entries';
  ELSIF v_exits <> 1 THEN
    v_reason := 'multiple_exits';
  ELSIF v_entry.confidence IS NULL OR v_entry.confidence <> 1 THEN
    v_reason := coalesce(v_entry.note, 'entry_not_confident');
  ELSIF v_exit.confidence IS NULL OR v_exit.confidence <> 1 THEN
    v_reason := coalesce(v_exit.note, 'exit_not_confident');
  ELSIF v_exit.session_time_seconds <= v_entry.session_time_seconds THEN
    v_reason := 'clock_not_monotone';
  ELSIF v_exit.observed_at <= v_entry.observed_at THEN
    v_reason := 'wall_clock_not_monotone';
  ELSIF v_exit.sdk_tick <= v_entry.sdk_tick THEN
    v_reason := 'sdk_tick_not_monotone';
  ELSIF v_exit.pit_visit_id <> v_entry.pit_visit_id
        OR v_exit.observed_session_id <> v_entry.observed_session_id
        OR v_exit.device_id <> v_entry.device_id THEN
    v_reason := 'identity_mismatch';
  ELSE
    v_seconds := v_exit.session_time_seconds - v_entry.session_time_seconds;
    v_wall := extract(epoch FROM (v_exit.observed_at - v_entry.observed_at));
    IF v_seconds < 5 OR v_seconds > 900 THEN
      v_reason := 'duration_out_of_bounds';
    ELSIF v_wall < 0 OR abs(v_wall - v_seconds) > 30 THEN
      -- De bronklok en de sessieklok vertellen een verschillend verhaal: een
      -- gat, een pause of een reset. Geen duur.
      v_reason := 'clock_telemetry_gap';
    END IF;
  END IF;

  IF v_reason IS NOT NULL THEN
    UPDATE public.pitwall_personal_pit_visit_edges
       SET pair_status = 'rejected', reject_reason = left(v_reason, 80)
     WHERE id IN (v_entry.id, v_exit.id);
    RETURN NEW;
  END IF;

  INSERT INTO public.pitwall_personal_pit_visits (
    device_id, observed_session_id, pit_visit_id,
    entry_event_uid, exit_event_uid,
    entry_observed_at, exit_observed_at,
    entry_session_seconds, exit_session_seconds, pit_lane_seconds,
    entry_sdk_tick, exit_sdk_tick
  ) VALUES (
    v_entry.device_id, v_entry.observed_session_id, v_entry.pit_visit_id,
    v_entry.event_uid, v_exit.event_uid,
    v_entry.observed_at, v_exit.observed_at,
    v_entry.session_time_seconds, v_exit.session_time_seconds, round(v_seconds::numeric, 3),
    v_entry.sdk_tick, v_exit.sdk_tick
  )
  ON CONFLICT (device_id, observed_session_id, pit_visit_id) DO NOTHING;

  UPDATE public.pitwall_personal_pit_visit_edges
     SET pair_status = 'paired', reject_reason = NULL
   WHERE id IN (v_entry.id, v_exit.id);

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  -- Een pitduur is bijzaak; een fout mag de ruwe meetgebeurtenis nooit laten
  -- vallen. De flank blijft dan pending en is later diagnosticeerbaar.
  RETURN NEW;
END;
$visit$;

DROP TRIGGER IF EXISTS simhub_measurement_events_personal_pit_visit ON public.simhub_measurement_events;
CREATE TRIGGER simhub_measurement_events_personal_pit_visit
  AFTER INSERT ON public.simhub_measurement_events
  FOR EACH ROW
  WHEN (NEW.kind IN ('pit_in', 'pit_out'))
  EXECUTE FUNCTION public.simhub_capture_personal_pit_visit_v2();

COMMENT ON FUNCTION public.simhub_capture_personal_pit_visit_v2() IS
  'Paart twee expliciete pitflanken met dezelfde device/observed-sessie/pitVisitId; weigert onbekende, niet-monotone, onderbroken of niet-bronbevestigde flanken met een expliciete reden.';

-- ---------------------------------------------------------------------------
-- 3. Lezen: alleen de eigenaar (of SimHub-beheer), alleen de nieuwste
--    waargenomen sessie van dat device.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.pitwall_personal_pit_visits_v1(
  p_device_id uuid,
  p_limit integer DEFAULT 5
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'auth', 'pg_temp'
AS $read$
DECLARE
  v_uid uuid := auth.uid();
  v_owner uuid;
  v_session text;
  v_limit integer := least(greatest(coalesce(p_limit, 5), 1), 10);
  v_visits jsonb;
  v_count integer;
  v_pending integer;
  v_rejected integer;
  v_reason text;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501';
  END IF;

  SELECT owner_user_id INTO v_owner FROM public.simhub_devices WHERE id = p_device_id;
  IF v_owner IS NULL THEN
    RETURN jsonb_build_object('available', false, 'reason', 'unknown_device', 'sessionKey', null, 'visits', '[]'::jsonb,
                              'diagnostics', jsonb_build_object('pendingEdges', 0, 'rejectedEdges', 0, 'lastRejectReason', null));
  END IF;
  IF v_owner <> v_uid AND NOT public.can_manage_simhub() THEN
    RAISE EXCEPTION 'Permission denied' USING ERRCODE = '42501';
  END IF;

  -- De bron-sessie is de observed sessie van de meetgebeurtenissen, niet de
  -- herbruikbare transport-sessie. Een latere transportverbinding verandert
  -- deze waarde niet.
  SELECT observed_session_id INTO v_session
    FROM public.simhub_measurement_events
   WHERE device_id = p_device_id::text
     AND observed_session_id IS NOT NULL
   ORDER BY observed_at DESC NULLS LAST, received_at DESC
   LIMIT 1;

  IF v_session IS NULL THEN
    RETURN jsonb_build_object('available', false, 'reason', 'no_session', 'sessionKey', null, 'visits', '[]'::jsonb,
                              'diagnostics', jsonb_build_object('pendingEdges', 0, 'rejectedEdges', 0, 'lastRejectReason', null));
  END IF;

  SELECT coalesce(jsonb_agg(jsonb_build_object(
           'visitKey', v.pit_visit_id,
           'entryFrameSequence', v.entry_sdk_tick,
           'exitFrameSequence', v.exit_sdk_tick,
           'entrySessionSeconds', v.entry_session_seconds,
           'exitSessionSeconds', v.exit_session_seconds,
           'pitLaneSeconds', v.pit_lane_seconds,
           'entryObservedAt', v.entry_observed_at,
           'exitObservedAt', v.exit_observed_at,
           'source', v.source
         ) ORDER BY v.entry_observed_at DESC), '[]'::jsonb),
         count(*)
    INTO v_visits, v_count
    FROM (
      SELECT *
        FROM public.pitwall_personal_pit_visits
       WHERE device_id = p_device_id::text
         AND observed_session_id = v_session
       ORDER BY entry_observed_at DESC
       LIMIT v_limit
    ) v;

  SELECT count(*) FILTER (WHERE pair_status = 'pending'),
         count(*) FILTER (WHERE pair_status = 'rejected')
    INTO v_pending, v_rejected
    FROM public.pitwall_personal_pit_visit_edges
   WHERE device_id = p_device_id::text
     AND observed_session_id = v_session;

  SELECT reject_reason INTO v_reason
    FROM public.pitwall_personal_pit_visit_edges
   WHERE device_id = p_device_id::text
     AND observed_session_id = v_session
     AND pair_status = 'rejected'
   ORDER BY created_at DESC
   LIMIT 1;

  RETURN jsonb_build_object(
    'available', v_count > 0,
    'reason', CASE WHEN v_count > 0 THEN NULL ELSE 'no_completed_visit' END,
    'sessionKey', v_session,
    'visits', v_visits,
    'diagnostics', jsonb_build_object(
      'pendingEdges', v_pending,
      'rejectedEdges', v_rejected,
      'lastRejectReason', v_reason
    )
  );
END;
$read$;

REVOKE ALL ON FUNCTION public.pitwall_personal_pit_visits_v1(uuid, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.pitwall_personal_pit_visits_v1(uuid, integer) TO authenticated, service_role;

COMMENT ON FUNCTION public.pitwall_personal_pit_visits_v1(uuid, integer) IS
  'Laatste afgeronde pitbezoeken van één device in de nieuwste observed sessie; bruto pit-in tot pit-uit, nooit een schatting.';

COMMIT;
