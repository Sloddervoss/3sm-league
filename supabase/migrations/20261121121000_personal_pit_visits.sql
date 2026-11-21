-- 2026-11-21: persoonlijke pitduur van pit-in tot pit-uit.
--
-- Bron zijn de ruwe `simhub_tyre_observations`: elk frame bewaart de echte
-- `OnPitRoad`-waarde, de sessietijd en de framevolgorde. Dat is dezelfde
-- bewezen pitflank als de bestaande pitstops, maar met een bron-tijdstempel per
-- frame in plaats van een afgeleide `captured_at`.
--
-- Wat deze migratie NIET doet:
--   * geen metadata uit `simhub_measurement_events` gebruiken. Daar staat in de
--     praktijk alleen `pit_service_completed`, `session_start`,
--     `wear_refresh_confirmed` en `wear_value_changed`; geen pit-in/pit-uit.
--     Een `pit_visit_id` is context, geen edge en geen tijd.
--   * geen `received_at` als duur. De duur komt uit sessietijd aan beide
--     flanken; `received_at` is alleen de opslagtijd.
--   * geen hele pitronde als duur. Alleen de expliciete true->false-overgang.
--   * geen backfill: de trigger loopt uitsluitend op nieuw binnengekomen
--     observaties. Bestaande rijen worden niet opnieuw geïnterpreteerd.
--   * geen koppeling aan strategie of netto raceverlies. `pit_lane_seconds`
--     is bruto pitstraattijd, service inbegrepen; `computePitLoss` krijgt deze
--     waarde niet.
--
-- De visit wordt pas vastgelegd bij een expliciete pit-uit. Een bezoek dat al
-- in de pit begint (geen expliciete `false` vóór de entry), zonder entry,
-- zonder exit, met een sessie-/teamwissel of buiten 5–900 s levert geen rij.

BEGIN;

CREATE TABLE IF NOT EXISTS public.pitwall_personal_pit_visits (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  device_id             uuid NOT NULL REFERENCES public.simhub_devices(id) ON DELETE CASCADE,
  session_key           text NOT NULL,
  endurance_event_id    uuid,
  endurance_team_id     uuid,
  visit_key             text NOT NULL,
  entry_frame_sequence  bigint NOT NULL,
  exit_frame_sequence   bigint NOT NULL,
  entry_session_seconds numeric(12,3) NOT NULL,
  exit_session_seconds  numeric(12,3) NOT NULL,
  pit_lane_seconds      numeric(8,3) NOT NULL,
  entry_lap             integer,
  exit_lap              integer,
  entry_driver_name     text,
  exit_driver_name      text,
  entry_observed_at     timestamptz,
  exit_observed_at      timestamptz,
  source                text NOT NULL DEFAULT 'tyre_observation_pit_edges',
  created_at            timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT pitwall_personal_pit_visits_unique UNIQUE (device_id, session_key, visit_key),
  CONSTRAINT pitwall_personal_pit_visits_session_len CHECK (char_length(session_key) BETWEEN 1 AND 96),
  CONSTRAINT pitwall_personal_pit_visits_visit_len CHECK (char_length(visit_key) BETWEEN 1 AND 80),
  CONSTRAINT pitwall_personal_pit_visits_frames CHECK (exit_frame_sequence > entry_frame_sequence),
  CONSTRAINT pitwall_personal_pit_visits_clock CHECK (exit_session_seconds > entry_session_seconds),
  CONSTRAINT pitwall_personal_pit_visits_duration CHECK (pit_lane_seconds BETWEEN 5 AND 900),
  CONSTRAINT pitwall_personal_pit_visits_source CHECK (source = 'tyre_observation_pit_edges')
);

CREATE INDEX IF NOT EXISTS pitwall_personal_pit_visits_device_session_idx
  ON public.pitwall_personal_pit_visits (device_id, session_key, entry_frame_sequence DESC);

ALTER TABLE public.pitwall_personal_pit_visits ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS pitwall_personal_pit_visits_service_role_all ON public.pitwall_personal_pit_visits;
CREATE POLICY pitwall_personal_pit_visits_service_role_all
  ON public.pitwall_personal_pit_visits
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

REVOKE ALL ON public.pitwall_personal_pit_visits FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.pitwall_personal_pit_visits TO service_role;

COMMENT ON TABLE public.pitwall_personal_pit_visits IS
  'Afgeronde persoonlijke pitbezoeken uit expliciete OnPitRoad-flanken; bruto pit-in tot pit-uit, geen netto raceverlies.';
COMMENT ON COLUMN public.pitwall_personal_pit_visits.pit_lane_seconds IS
  'Sessietijd pit-uit min sessietijd pit-in. Service is inbegrepen; niet aftrekken van een rondetijd.';

-- ---------------------------------------------------------------------------
-- 1. Vastleggen: alleen bij een expliciete pit-uit, idempotent per bezoek.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.simhub_capture_personal_pit_visit_v1()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $visit$
DECLARE
  entry public.simhub_tyre_observations%ROWTYPE;
  v_last_false bigint;
  v_seconds numeric;
  v_wall numeric;
BEGIN
  IF NEW.on_pit_road IS NOT FALSE THEN
    RETURN NEW;
  END IF;

  -- Laatste expliciete "niet in de pit" vóór deze exit. Zonder die grens is
  -- dit een bezoek dat al in de pit begon en dus niet meetbaar.
  SELECT max(frame_sequence) INTO v_last_false
    FROM public.simhub_tyre_observations
   WHERE device_id = NEW.device_id
     AND session_key = NEW.session_key
     AND frame_sequence < NEW.frame_sequence
     AND on_pit_road IS FALSE;
  IF v_last_false IS NULL THEN
    RETURN NEW;
  END IF;

  -- De entry is de EERSTE true na die false, niet de laatste: meerdere
  -- opeenvolgende pitframes zijn één bezoek en de duur begint bij de eerste.
  SELECT * INTO entry
    FROM public.simhub_tyre_observations
   WHERE device_id = NEW.device_id
     AND session_key = NEW.session_key
     AND frame_sequence > v_last_false
     AND frame_sequence < NEW.frame_sequence
     AND on_pit_road IS TRUE
   ORDER BY frame_sequence ASC
   LIMIT 1;
  IF NOT FOUND THEN
    RETURN NEW;
  END IF;

  -- Een team-/eventwissel midden in het bezoek maakt de duur onbruikbaar.
  IF NEW.endurance_event_id IS DISTINCT FROM entry.endurance_event_id
     OR NEW.endurance_team_id IS DISTINCT FROM entry.endurance_team_id THEN
    RETURN NEW;
  END IF;

  IF entry.session_time_seconds IS NULL OR NEW.session_time_seconds IS NULL THEN
    RETURN NEW;
  END IF;

  v_seconds := NEW.session_time_seconds - entry.session_time_seconds;
  IF v_seconds < 5 OR v_seconds > 900 THEN
    RETURN NEW;
  END IF;

  -- Een bron-tijdstempel die niet bij de sessieklok past is geen meting.
  IF entry.observed_at IS NOT NULL AND NEW.observed_at IS NOT NULL THEN
    v_wall := extract(epoch FROM (NEW.observed_at - entry.observed_at));
    IF v_wall < 0 OR abs(v_wall - v_seconds) > 30 THEN
      RETURN NEW;
    END IF;
  END IF;

  -- Te grote gaten in de framereeks: dan is de flank niet betrouwbaar.
  IF NEW.frame_sequence - entry.frame_sequence > 900 THEN
    RETURN NEW;
  END IF;

  INSERT INTO public.pitwall_personal_pit_visits (
    device_id, session_key, endurance_event_id, endurance_team_id, visit_key,
    entry_frame_sequence, exit_frame_sequence,
    entry_session_seconds, exit_session_seconds, pit_lane_seconds,
    entry_lap, exit_lap, entry_driver_name, exit_driver_name,
    entry_observed_at, exit_observed_at
  ) VALUES (
    NEW.device_id, NEW.session_key, NEW.endurance_event_id, NEW.endurance_team_id,
    'pit:' || entry.frame_sequence::text,
    entry.frame_sequence, NEW.frame_sequence,
    entry.session_time_seconds, NEW.session_time_seconds, round(v_seconds, 3),
    entry.lap, NEW.lap, entry.driver_name, NEW.driver_name,
    entry.observed_at, NEW.observed_at
  )
  ON CONFLICT (device_id, session_key, visit_key) DO NOTHING;

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  -- Een pitduur is bijzaak; een fout mag de ruwe observatie nooit laten vallen.
  RETURN NEW;
END;
$visit$;

DROP TRIGGER IF EXISTS simhub_tyre_observations_pit_visit ON public.simhub_tyre_observations;
CREATE TRIGGER simhub_tyre_observations_pit_visit
  AFTER INSERT ON public.simhub_tyre_observations
  FOR EACH ROW
  WHEN (NEW.on_pit_road IS FALSE)
  EXECUTE FUNCTION public.simhub_capture_personal_pit_visit_v1();

COMMENT ON FUNCTION public.simhub_capture_personal_pit_visit_v1() IS
  'Legt één afgerond pitbezoek vast uit de laatste true en de expliciete false in dezelfde device/sessie; faalt gesloten bij ontbrekende entry/exit, reset of duur buiten 5–900 s.';

-- ---------------------------------------------------------------------------
-- 2. Lezen: alleen de eigenaar (of SimHub-beheer), alleen de huidige sessie.
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
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501';
  END IF;

  SELECT owner_user_id INTO v_owner FROM public.simhub_devices WHERE id = p_device_id;
  IF v_owner IS NULL THEN
    RETURN jsonb_build_object('available', false, 'reason', 'unknown_device', 'sessionKey', null, 'visits', '[]'::jsonb);
  END IF;
  IF v_owner <> v_uid AND NOT public.can_manage_simhub() THEN
    RAISE EXCEPTION 'Permission denied' USING ERRCODE = '42501';
  END IF;

  SELECT session_id INTO v_session
    FROM public.simhub_telemetry_latest
   WHERE device_id = p_device_id
   ORDER BY received_at DESC
   LIMIT 1;

  IF v_session IS NULL THEN
    RETURN jsonb_build_object('available', false, 'reason', 'no_session', 'sessionKey', null, 'visits', '[]'::jsonb);
  END IF;

  SELECT coalesce(jsonb_agg(jsonb_build_object(
           'visitKey', v.visit_key,
           'entryFrameSequence', v.entry_frame_sequence,
           'exitFrameSequence', v.exit_frame_sequence,
           'entrySessionSeconds', v.entry_session_seconds,
           'exitSessionSeconds', v.exit_session_seconds,
           'pitLaneSeconds', v.pit_lane_seconds,
           'entryLap', v.entry_lap,
           'exitLap', v.exit_lap,
           'driver', v.entry_driver_name,
           'source', v.source
         ) ORDER BY v.entry_frame_sequence DESC), '[]'::jsonb),
         count(*)
    INTO v_visits, v_count
    FROM (
      SELECT *
        FROM public.pitwall_personal_pit_visits
       WHERE device_id = p_device_id
         AND session_key = v_session
       ORDER BY entry_frame_sequence DESC
       LIMIT v_limit
    ) v;

  RETURN jsonb_build_object(
    'available', v_count > 0,
    'reason', CASE WHEN v_count > 0 THEN NULL ELSE 'no_completed_visit' END,
    'sessionKey', v_session,
    'visits', v_visits
  );
END;
$read$;

REVOKE ALL ON FUNCTION public.pitwall_personal_pit_visits_v1(uuid, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.pitwall_personal_pit_visits_v1(uuid, integer) TO authenticated, service_role;

COMMENT ON FUNCTION public.pitwall_personal_pit_visits_v1(uuid, integer) IS
  'Laatste afgeronde pitbezoeken van één device in de huidige sessie; bruto pit-in tot pit-uit, nooit een schatting.';

COMMIT;
