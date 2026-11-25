-- Pitverlies lezen — mediaan per auto/baan/layout voor de ingelogde eigenaar.
--
-- De opgeslagen pitbezoeken zijn persoonlijk (geen pooling). Deze functie
-- rapporteert daarom alleen wat de aanroeper zelf heeft gemeten, en pas als er
-- genoeg metingen zijn: onder de drie bezoeken of drie stretches blijft een
-- waarde leeg in plaats van geschat.
--
-- Formule: verlies = mediaan(pitstraattijd) − mediaan(stretch). De stilstaantijd
-- zit ín de pitstraattijd en wordt apart teruggegeven ter informatie; er wordt
-- niets bij opgeteld.
BEGIN;

DO $guard$
BEGIN
  IF to_regclass('pitwall_learning.pit_visits') IS NULL THEN
    RAISE EXCEPTION 'pit loss read requires pitwall_learning.pit_visits';
  END IF;
END
$guard$;

CREATE OR REPLACE FUNCTION public.pitwall_pit_loss_v1(
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
BEGIN
  IF v_owner IS NULL THEN
    RETURN jsonb_build_object('source', 'unauthenticated', 'samples', 0);
  END IF;
  IF p_car IS NULL OR p_track IS NULL OR btrim(p_car) = '' OR btrim(p_track) = '' THEN
    RETURN jsonb_build_object('source', 'missing_context', 'samples', 0);
  END IF;

  SELECT count(*),
         count(stretch_seconds),
         percentile_cont(0.5) WITHIN GROUP (ORDER BY lane_seconds),
         percentile_cont(0.5) WITHIN GROUP (ORDER BY standing_seconds),
         percentile_cont(0.5) WITHIN GROUP (ORDER BY stretch_seconds),
         max(observed_at)
    INTO samples, stretches, lane, standing, stretch, last_seen
    FROM pitwall_learning.pit_visits
   WHERE owner_user_id = v_owner
     AND lower(car) = lower(btrim(p_car))
     AND lower(track) = lower(btrim(p_track))
     AND lower(track_config) = lower(v_config);

  IF samples = 0 THEN
    RETURN jsonb_build_object('source', 'none', 'samples', 0);
  END IF;

  RETURN jsonb_build_object(
    'source', CASE WHEN samples >= 3 AND stretches >= 3 THEN 'personal' ELSE 'insufficient' END,
    'samples', samples,
    'stretches', stretches,
    'laneSeconds', round(lane, 3),
    'standingSeconds', round(standing, 3),
    'stretchSeconds', CASE WHEN stretches >= 3 THEN round(stretch, 3) END,
    'lossSeconds', CASE WHEN samples >= 3 AND stretches >= 3 THEN round(lane - stretch, 3) END,
    'lastObservedAt', last_seen);
END
$fn$;

COMMENT ON FUNCTION public.pitwall_pit_loss_v1(text, text, text) IS
  'Persoonlijk pitverlies voor de ingelogde eigenaar: mediaan pitstraattijd minus mediaan stretch, of leeg bij te weinig metingen.';

REVOKE ALL ON FUNCTION public.pitwall_pit_loss_v1(text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.pitwall_pit_loss_v1(text, text, text) TO authenticated, service_role;

-- Rollback: DROP FUNCTION IF EXISTS public.pitwall_pit_loss_v1(text, text, text);

COMMIT;
