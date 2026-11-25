-- Pitverlies leren — pitbezoeken van de connector bewaren.
--
-- De connector (0.7.6.6+) stuurt per frame een additief `pitVisits`-blok met de
-- bezoeken die sinds het vorige frame zijn afgerond: entry/exit-positie, tijd in
-- de pitstraat, stilstaan, de stretch en de reden als een bezoek niet telt.
-- Dat blok komt één keer voorbij (de connector maakt zijn lijst daarna leeg),
-- dus het moet bij binnkomst worden vastgelegd en niet alleen in de laatste
-- telemetrie-snapshot blijven staan.
--
-- Waarom een trigger en geen wijziging in simhub_persist_v3: die functie is de
-- bestaande, gevoelige schrijfroute van alle frames. Een AFTER-trigger op
-- simhub_telemetry_latest doet hetzelfde werk in dezelfde transactie, raakt de
-- bestaande kolommen niet en kan geen frame laten mislukken: fouten in de
-- extractie worden ingeslikt en het frame blijft staan.
--
-- Wat er niet in komt: bezoeken zonder volledige identiteit (auto/baan/layout/
-- rijder/owner) en bezoeken die de connector zelf al afkeurde (tow, verkeerde
-- pitlane-uiteinden, te langzaam, te lang). Er wordt niets aangevuld of geraden.
BEGIN;

DO $guard$
BEGIN
  IF to_regclass('public.simhub_telemetry_latest') IS NULL THEN
    RAISE EXCEPTION 'pit visits require public.simhub_telemetry_latest';
  END IF;
  IF to_regclass('pitwall_learning.account_policy') IS NULL THEN
    RAISE EXCEPTION 'pit visits require pitwall_learning.account_policy';
  END IF;
END
$guard$;

CREATE TABLE IF NOT EXISTS pitwall_learning.pit_visits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  device_id uuid NOT NULL,
  transport_session_id text NOT NULL,
  driver text NOT NULL,
  car text NOT NULL,
  track text NOT NULL,
  track_config text NOT NULL DEFAULT '',
  session_type text,
  entry_pct numeric(7,5) NOT NULL,
  exit_pct numeric(7,5) NOT NULL,
  lane_seconds numeric(7,3) NOT NULL,
  standing_seconds numeric(7,3) NOT NULL,
  stretch_seconds numeric(7,3),
  observed_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT pit_visits_lane_check CHECK (lane_seconds >= 3 AND lane_seconds <= 300),
  CONSTRAINT pit_visits_standing_check CHECK (standing_seconds >= 0 AND standing_seconds <= 180),
  CONSTRAINT pit_visits_stretch_check CHECK (stretch_seconds IS NULL OR (stretch_seconds > 0 AND stretch_seconds <= 300)),
  CONSTRAINT pit_visits_pct_check CHECK (entry_pct >= 0 AND entry_pct < 1 AND exit_pct >= 0 AND exit_pct < 1),
  CONSTRAINT pit_visits_label_check CHECK (char_length(driver) BETWEEN 1 AND 120
    AND char_length(car) BETWEEN 1 AND 120 AND char_length(track) BETWEEN 1 AND 120
    AND char_length(track_config) <= 120)
);

-- Eén bezoek per apparaat, sessie en pitpassage. Een replay van hetzelfde frame
-- levert dus geen tweede rij op.
CREATE UNIQUE INDEX IF NOT EXISTS pit_visits_identity_idx
  ON pitwall_learning.pit_visits (device_id, transport_session_id, entry_pct, exit_pct, lane_seconds);
CREATE INDEX IF NOT EXISTS pit_visits_context_idx
  ON pitwall_learning.pit_visits (owner_user_id, car, track, track_config, observed_at DESC);

COMMENT ON TABLE pitwall_learning.pit_visits IS
  'Afgeronde, door de connector geaccepteerde pitbezoeken. Basis voor pitverlies (lane - stretch; standing zit in lane).';

-- Vastleggen van het pitVisits-blok van één frame. Retourneert het aantal nieuwe
-- rijen; bestaande rijen blijven ongemoeid (ON CONFLICT DO NOTHING).
CREATE OR REPLACE FUNCTION pitwall_learning.ingest_pit_visits(
  p_owner uuid,
  p_device uuid,
  p_transport text,
  p_identity jsonb,
  p_session_type text,
  p_observed_at timestamptz,
  p_visits jsonb
) RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'pitwall_learning', 'pg_temp'
AS $fn$
DECLARE
  driver text;
  car text;
  track text;
  config text;
  inserted integer := 0;
  visit jsonb;
BEGIN
  IF p_owner IS NULL OR p_device IS NULL OR p_transport IS NULL OR p_observed_at IS NULL THEN
    RETURN 0;
  END IF;
  IF p_visits IS NULL OR jsonb_typeof(p_visits) <> 'array' THEN
    RETURN 0;
  END IF;

  driver := coalesce(nullif(btrim(coalesce(p_identity ->> 'currentDriverName', '')), ''),
                     nullif(btrim(coalesce(p_identity ->> 'currentDriverId', '')), ''));
  car := nullif(btrim(coalesce(p_identity ->> 'carId', '')), '');
  track := nullif(btrim(coalesce(p_identity ->> 'trackName', '')), '');
  IF track IS NULL AND (p_identity ->> 'trackId') ~ '^[0-9]+$' THEN
    track := p_identity ->> 'trackId';
  END IF;
  config := coalesce(nullif(btrim(coalesce(p_identity ->> 'trackConfig', '')), ''), '');

  IF driver IS NULL OR car IS NULL OR track IS NULL THEN
    RETURN 0;
  END IF;

  FOR visit IN SELECT * FROM jsonb_array_elements(p_visits) LOOP
    -- Alleen bezoeken die de connector zelf goedkeurde, met een volledige meting.
    CONTINUE WHEN visit ->> 'skipped' IS NOT NULL;
    CONTINUE WHEN coalesce((visit ->> 'jumped')::boolean, false);
    CONTINUE WHEN (visit ->> 'entryPct') IS NULL OR (visit ->> 'exitPct') IS NULL;
    CONTINUE WHEN (visit ->> 'laneSeconds') IS NULL OR (visit ->> 'standingSeconds') IS NULL;

    BEGIN
      INSERT INTO pitwall_learning.pit_visits (
        owner_user_id, device_id, transport_session_id, driver, car, track, track_config,
        session_type, entry_pct, exit_pct, lane_seconds, standing_seconds, stretch_seconds, observed_at)
      VALUES (
        p_owner, p_device, p_transport, driver, car, track, config,
        nullif(btrim(coalesce(p_session_type, '')), ''),
        (visit ->> 'entryPct')::numeric, (visit ->> 'exitPct')::numeric,
        (visit ->> 'laneSeconds')::numeric, (visit ->> 'standingSeconds')::numeric,
        (visit ->> 'stretchSeconds')::numeric, p_observed_at)
      ON CONFLICT (device_id, transport_session_id, entry_pct, exit_pct, lane_seconds) DO NOTHING;
      IF FOUND THEN inserted := inserted + 1; END IF;
    EXCEPTION WHEN others THEN
      -- Een onbruikbaar bezoek mag het frame nooit laten mislukken.
      CONTINUE;
    END;
  END LOOP;

  RETURN inserted;
END
$fn$;

-- Trigger: elk frame dat pitbezoeken meebrengt, legt ze vast. Zonder blok doet
-- de trigger niets (één goedkope check op de jsonb-sleutel).
CREATE OR REPLACE FUNCTION pitwall_learning.capture_pit_visits()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'pitwall_learning', 'pg_temp'
AS $trg$
DECLARE
  visits jsonb;
BEGIN
  visits := NEW.v3_normalized -> 'pitVisits';
  IF visits IS NULL OR jsonb_typeof(visits) <> 'array' OR jsonb_array_length(visits) = 0 THEN
    RETURN NEW;
  END IF;
  BEGIN
    PERFORM pitwall_learning.ingest_pit_visits(
      NEW.owner_user_id,
      NEW.device_id,
      NEW.v3_normalized ->> 'transportSessionId',
      NEW.v3_normalized -> 'identity',
      NEW.v3_normalized #>> '{session,sessionType}',
      coalesce((NEW.v3_normalized ->> 'capturedAt')::timestamptz, clock_timestamp()),
      visits);
  EXCEPTION WHEN others THEN
    -- Nooit de telemetrie-schrijfroute blokkeren.
    NULL;
  END;
  RETURN NEW;
END
$trg$;

DROP TRIGGER IF EXISTS capture_pit_visits ON public.simhub_telemetry_latest;
CREATE TRIGGER capture_pit_visits
  AFTER INSERT OR UPDATE OF v3_normalized ON public.simhub_telemetry_latest
  FOR EACH ROW EXECUTE FUNCTION pitwall_learning.capture_pit_visits();

REVOKE ALL ON FUNCTION pitwall_learning.ingest_pit_visits(uuid, uuid, text, jsonb, text, timestamptz, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION pitwall_learning.ingest_pit_visits(uuid, uuid, text, jsonb, text, timestamptz, jsonb) TO service_role;

-- Rollback:
--   DROP TRIGGER IF EXISTS capture_pit_visits ON public.simhub_telemetry_latest;
--   DROP FUNCTION IF EXISTS pitwall_learning.capture_pit_visits();
--   DROP FUNCTION IF EXISTS pitwall_learning.ingest_pit_visits(uuid, uuid, text, jsonb, text, timestamptz, jsonb);
--   DROP TABLE IF EXISTS pitwall_learning.pit_visits;

COMMIT;
