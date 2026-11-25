-- Circuit-prior: pitverlies van de community als startwaarde.
--
-- Waarom: een persoonlijk model heeft drie eigen stops nodig op die baan met die
-- auto. Met een handvol leden duurt dat lang, en op een nieuwe baan is er
-- helemaal niets. Daarom een tweede bron: de mediaan over de race-stops van alle
-- leden die daar expliciet toestemming voor gaven (`account_policy.pooling_enabled`).
--
-- Grenzen die vastliggen:
--   * alleen race-sessies, dus nooit test of practice;
--   * alleen leden met pooling_enabled = true; zonder opt-in draagt niemand bij;
--   * alleen baan + layout + sessiesoort, geen namen, geen apparaat-id's in het
--     antwoord, geen ruwe rijen — alleen medianen en aantallen;
--   * minimaal 6 stops, anders is het geen mediaan maar ruis;
--   * persoonlijk en circuit blijven altijd gescheiden in het antwoord. Een
--     circuitgetal wordt nooit als "eigen meting" gepresenteerd.
BEGIN;

DO $guard$
BEGIN
  IF to_regclass('pitwall_learning.pit_visits') IS NULL THEN
    RAISE EXCEPTION 'circuit prior requires pitwall_learning.pit_visits';
  END IF;
  IF to_regclass('pitwall_learning.account_policy') IS NULL THEN
    RAISE EXCEPTION 'circuit prior requires pitwall_learning.account_policy';
  END IF;
END
$guard$;

-- Delen staat standaard aan: het is anonieme circuitmediaan, geen namen en geen
-- ruwe data. Wie het niet wil, zet de knop uit.
--
-- Dat mag niet stilzwijgend under policy 1: de bestaande constraint
-- `account_policy_no_pooling_p1` legt vast dat beleid v1 geen deling kent. Delen
-- wordt daarom beleid **v2**, met dezelfde capture-instellingen en één extra
-- recht. De policy_version reist mee naar elke nieuwe meting (simhub_persist_v3
-- leest hem uit deze tabel, niet uit een constante), dus metingen van vóór deze
-- wijziging vallen buiten de leerketen — ze zijn toch niet toe te schrijven.
ALTER TABLE pitwall_learning.account_policy
  DROP CONSTRAINT IF EXISTS account_policy_no_pooling_p1;

UPDATE pitwall_learning.account_policy
   SET policy_version = 2,
       pooling_enabled = true,
       updated_at = clock_timestamp()
 WHERE policy_version = 1;

ALTER TABLE pitwall_learning.account_policy
  ALTER COLUMN pooling_enabled SET DEFAULT true;

ALTER TABLE pitwall_learning.account_policy
  ADD CONSTRAINT account_policy_pooling_needs_p2
  CHECK (pooling_enabled = false OR policy_version >= 2);

-- Circuitmediaan. Alleen leesbaar via SECURITY DEFINER; de aanroeper krijgt geen
-- enkele rij te zien, alleen het samengevatte blok.
CREATE OR REPLACE FUNCTION pitwall_learning.circuit_pit_loss(
  p_track text,
  p_track_config text DEFAULT ''
) RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'pitwall_learning', 'public', 'pg_temp'
AS $fn$
  WITH allowed AS (
    SELECT owner_user_id FROM pitwall_learning.account_policy WHERE pooling_enabled IS TRUE
  ), race_stops AS (
    SELECT v.lane_seconds, v.standing_seconds, v.stretch_seconds
      FROM pitwall_learning.pit_visits v
      JOIN allowed a ON a.owner_user_id = v.owner_user_id
     WHERE lower(v.track) = lower(btrim(p_track))
       AND lower(v.track_config) = lower(coalesce(p_track_config, ''))
       AND lower(coalesce(v.session_type, '')) LIKE 'race%'
  )
  SELECT jsonb_build_object(
    'samples', count(*),
    'stretches', count(stretch_seconds),
    'laneSeconds', round(percentile_cont(0.5) WITHIN GROUP (ORDER BY lane_seconds)::numeric, 3),
    'standingSeconds', round(percentile_cont(0.5) WITHIN GROUP (ORDER BY standing_seconds)::numeric, 3),
    'stretchSeconds', CASE WHEN count(stretch_seconds) >= 3
      THEN round(percentile_cont(0.5) WITHIN GROUP (ORDER BY stretch_seconds)::numeric, 3) END,
    'lossSeconds', CASE WHEN count(*) >= 6 AND count(stretch_seconds) >= 3
      THEN round((percentile_cont(0.5) WITHIN GROUP (ORDER BY lane_seconds)
               - percentile_cont(0.5) WITHIN GROUP (ORDER BY stretch_seconds))::numeric, 3) END)
  FROM race_stops;
$fn$;

REVOKE ALL ON FUNCTION pitwall_learning.circuit_pit_loss(text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION pitwall_learning.circuit_pit_loss(text, text) TO authenticated, service_role;

-- Leesfunctie: persoonlijk én circuit, nooit gemengd.
CREATE OR REPLACE FUNCTION public.pitwall_pit_loss_learned_v1(
  p_car text,
  p_track text,
  p_track_config text DEFAULT ''
) RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'pitwall_learning', 'pg_temp'
AS $fn$
DECLARE
  v_owner uuid := auth.uid();
  v_config text := coalesce(p_track_config, '');
  samples integer;
  stretches integer;
  lane numeric;
  standing numeric;
  stretch numeric;
  last_seen timestamptz;
  circuit jsonb;
BEGIN
  IF v_owner IS NULL THEN
    RETURN jsonb_build_object('source', 'unauthenticated', 'samples', 0);
  END IF;
  IF p_car IS NULL OR p_track IS NULL OR btrim(p_car) = '' OR btrim(p_track) = '' THEN
    RETURN jsonb_build_object('source', 'missing_context', 'samples', 0);
  END IF;

  SELECT count(*), count(stretch_seconds),
         percentile_cont(0.5) WITHIN GROUP (ORDER BY lane_seconds),
         percentile_cont(0.5) WITHIN GROUP (ORDER BY standing_seconds),
         percentile_cont(0.5) WITHIN GROUP (ORDER BY stretch_seconds),
         max(observed_at)
    INTO samples, stretches, lane, standing, stretch, last_seen
    FROM pitwall_learning.pit_visits
   WHERE owner_user_id = v_owner
     AND lower(car) = lower(btrim(p_car))
     AND lower(track) = lower(btrim(p_track))
     AND lower(track_config) = lower(v_config)
     AND lower(coalesce(session_type, '')) LIKE 'race%';

  circuit := pitwall_learning.circuit_pit_loss(p_track, p_track_config);
  IF circuit IS NULL THEN
    circuit := jsonb_build_object('samples', 0);
  END IF;
  circuit := circuit || jsonb_build_object(
    'source', CASE WHEN (circuit ->> 'lossSeconds') IS NOT NULL THEN 'circuit' ELSE 'none' END);

  IF samples = 0 THEN
    RETURN jsonb_build_object('source', 'none', 'samples', 0, 'circuit', circuit);
  END IF;

  RETURN jsonb_build_object(
    'source', CASE WHEN samples >= 3 AND stretches >= 3 THEN 'personal' ELSE 'insufficient' END,
    'samples', samples,
    'stretches', stretches,
    'laneSeconds', round(lane, 3),
    'standingSeconds', round(standing, 3),
    'stretchSeconds', CASE WHEN stretches >= 3 THEN round(stretch, 3) END,
    'lossSeconds', CASE WHEN samples >= 3 AND stretches >= 3 THEN round(lane - stretch, 3) END,
    'lastObservedAt', last_seen,
    'circuit', circuit);
END
$fn$;

-- Deelknop. Bewust zonder policy_version-bump en zonder updated_at: delen is geen
-- wijziging van de meettoestemming, en updated_at bepaalt hoe ver terug de
-- leerketen kijkt (een knop omzetten mag geen historie weggooien).
CREATE OR REPLACE FUNCTION public.pitwall_set_pooling(p_enabled boolean)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'pitwall_learning', 'pg_temp'
AS $fn$
DECLARE
  v_owner uuid := auth.uid();
  v_value boolean;
BEGIN
  IF v_owner IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'unauthenticated');
  END IF;
  IF p_enabled IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'missing_value');
  END IF;

  UPDATE pitwall_learning.account_policy
     SET pooling_enabled = p_enabled,
         updated_by = v_owner
   WHERE owner_user_id = v_owner
  RETURNING pooling_enabled INTO v_value;

  IF v_value IS NULL THEN
    INSERT INTO pitwall_learning.account_policy (owner_user_id, pooling_enabled, updated_by)
    VALUES (v_owner, p_enabled, v_owner)
    ON CONFLICT (owner_user_id) DO UPDATE
      SET pooling_enabled = EXCLUDED.pooling_enabled, updated_by = EXCLUDED.updated_by
    RETURNING pooling_enabled INTO v_value;
  END IF;

  RETURN jsonb_build_object('ok', true, 'poolingEnabled', v_value);
END
$fn$;

CREATE OR REPLACE FUNCTION public.pitwall_pooling_state()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'pitwall_learning', 'pg_temp'
AS $fn$
DECLARE
  v_owner uuid := auth.uid();
  v_value boolean;
BEGIN
  IF v_owner IS NULL THEN
    RETURN jsonb_build_object('source', 'unauthenticated', 'poolingEnabled', false);
  END IF;
  SELECT pooling_enabled INTO v_value
    FROM pitwall_learning.account_policy WHERE owner_user_id = v_owner;
  RETURN jsonb_build_object(
    'source', CASE WHEN v_value IS NULL THEN 'default' ELSE 'policy' END,
    'poolingEnabled', coalesce(v_value, true));
END
$fn$;

REVOKE ALL ON FUNCTION public.pitwall_set_pooling(boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.pitwall_set_pooling(boolean) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.pitwall_pooling_state() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.pitwall_pooling_state() TO authenticated, service_role;

COMMENT ON FUNCTION public.pitwall_set_pooling(boolean) IS
  'Zet het delen van race-pitstops voor het circuitgemiddelde aan of uit voor de ingelogde eigenaar.';
COMMENT ON FUNCTION pitwall_learning.circuit_pit_loss(text, text) IS
  'Mediaan pitstraattijd/stilstaan/stretch over race-stops van leden met pooling_enabled, per baan en layout.';

-- Rollback:
--   ALTER TABLE pitwall_learning.account_policy ALTER COLUMN pooling_enabled SET DEFAULT false;
--   DROP FUNCTION IF EXISTS public.pitwall_pit_loss_learned_v1(text, text, text);
--   DROP FUNCTION IF EXISTS public.pitwall_set_pooling(boolean);
--   DROP FUNCTION IF EXISTS public.pitwall_pooling_state();
--   DROP FUNCTION IF EXISTS pitwall_learning.circuit_pit_loss(text, text);

COMMIT;
