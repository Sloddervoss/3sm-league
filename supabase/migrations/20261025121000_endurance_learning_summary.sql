-- ============================================================================
-- Endurance — tankduur en stintlengte leren uit het archief
-- Datum: 2026-10-25
--
-- Punt 8 van "Na de race — 24 oktober 2026". De planner rekent de tankduur nu
-- uit de autospecificatie plus de gemeten pace: één getal per auto, uit de
-- fabrieksopgave. De race van 24-10 laat zien waarom dat te grof is — 104 liter,
-- 2,94 liter per ronde en 95,67 seconden per ronde is 35,4 rondes en 56,4
-- minuten, en dat is voor deze auto op deze baan gemeten, niet geschat.
--
-- Deze functie leert het per auto én baan uit endurance_telemetry_archive
-- (punt 7, 20261025120000_endurance_telemetry_archive.sql). Eisen:
--
--   * alleen goedgekeurde verbruiksmetingen — het archief zet
--     fuel_per_lap_litres al op NULL voor een afgekeurde meting;
--   * de laatste 400 rondes van deze auto op deze baan, nieuwste eerst, zodat
--     een oude compound of een verouderde setup niet blijft doorwerken;
--   * uitschieters eruit met dezelfde regels als de plausibiliteitspoort bij de
--     ingest: rondetijd niet meer dan 25% boven de snelste ronde van het venster,
--     verbruik niet onder 40% van de mediaan. Een pitronde of een ronde uit de
--     garage mag het gemiddelde niet drukken;
--   * minstens 10 bruikbare rondes. Onder die grens is er geen "geleerd" getal
--     maar de prior uit endurance_car_specs, en anders niets.
--
-- De functie geeft altijd precies één rij terug, ook zonder data: dan blijven de
-- gemiddelden leeg en zegt fuel_per_lap_source hoe ver we kwamen. De leeslaag
-- (src/features/endurance/repository/learningRepository.ts) valt dan terug op de
-- bestaande berekening in src/features/endurance/stints/tankDuration.ts.
--
-- `sample_laps` is het aantal bruikbare verbruiksmetingen in het venster (dus na
-- de poort), niet het aantal rondes in het archief.
--
-- Bekende beperking: de configuratie (Grand Prix, Chicane) zit niet in de
-- parameters. Twee configuraties van dezelfde baan delen dus één leerwaarde;
-- pas als de planner de configuratie kent, wordt dit gesplitst.
-- ============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Naamsleutel — dezelfde normalsatie als normaliseCarName in tankDuration.ts
-- ---------------------------------------------------------------------------
-- Nodig omdat de planner de catalogusnaam kent (lamborghini-huracan-gt3-evo) en
-- de telemetrie de iRacing-sleutel (lamborghinievogt3). Accenten en leestekens
-- vervallen, zodat "Huracán" en "huracan" hetzelfde zijn.
CREATE OR REPLACE FUNCTION public.endurance_normalise_key(p_value text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path TO 'pg_catalog'
AS $function$
  SELECT nullif(regexp_replace(lower(coalesce(p_value, '')), '[^a-z0-9]', '', 'g'), '');
$function$;

COMMENT ON FUNCTION public.endurance_normalise_key(text) IS
  'Normaliseert een auto- of baannaam voor vergelijking: kleine letters, alleen a-z en 0-9. Zelfde regel als normaliseCarName in de frontend.';

-- ---------------------------------------------------------------------------
-- 2. De leerwaarde
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.endurance_learning_summary(p_car_id text, p_track_id text)
RETURNS TABLE (
  car_id                 text,
  track_id               text,
  tank_capacity_litres   numeric,
  sample_laps            integer,
  avg_fuel_per_lap_litres numeric,
  avg_lap_seconds        numeric,
  laps_per_tank          numeric,
  tank_minutes           numeric,
  fuel_per_lap_source    text,
  lap_seconds_source     text,
  first_lap_at           timestamptz,
  last_lap_at            timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'auth', 'pg_temp'
AS $function$
  WITH params AS (
    SELECT nullif(btrim(coalesce(p_car_id, '')), '')   AS car_key,
           nullif(btrim(coalesce(p_track_id, '')), '') AS track_key
  ),
  -- De autosleutels zoals het archief ze kent. De specificatie heeft zowel de
  -- iRacing-sleutel (car_id) als de leesbare naam (display_name); wie de
  -- catalogusnaam doorgeeft komt via display_name alsnog bij de juiste sleutel.
  car_keys AS (
    SELECT DISTINCT s.car_id AS sleutel
      FROM public.endurance_car_specs s
      CROSS JOIN params p
     WHERE p.car_key IS NOT NULL
       AND (s.car_id = p.car_key
            OR public.endurance_normalise_key(s.car_id) = public.endurance_normalise_key(p.car_key)
            OR public.endurance_normalise_key(s.display_name) = public.endurance_normalise_key(p.car_key))
    UNION
    SELECT p.car_key FROM params p WHERE p.car_key IS NOT NULL
  ),
  -- De baan: het archief bewaart de iRacing track-id. Een numerieke parameter is
  -- die id zelf; een naam wordt via de catalogus (of het event) opgezocht.
  track_keys AS (
    SELECT DISTINCT k.sleutel
      FROM (
        SELECT p.track_key AS sleutel
          FROM params p
         WHERE p.track_key ~ '^[0-9]+$'
        UNION ALL
        SELECT cat.track_id::text
          FROM public.endurance_iracing_events cat
          CROSS JOIN params p
         WHERE p.track_key IS NOT NULL
           AND p.track_key !~ '^[0-9]+$'
           AND cat.track_id IS NOT NULL
           AND (public.endurance_normalise_key(cat.circuit) = public.endurance_normalise_key(p.track_key)
                OR public.endurance_normalise_key(cat.name) = public.endurance_normalise_key(p.track_key))
        UNION ALL
        SELECT cat.track_id::text
          FROM public.endurance_events ev
          JOIN public.endurance_iracing_events cat ON cat.id = ev.iracing_catalog_event_id
          CROSS JOIN params p
         WHERE p.track_key IS NOT NULL
           AND p.track_key !~ '^[0-9]+$'
           AND cat.track_id IS NOT NULL
           AND public.endurance_normalise_key(ev.circuit) = public.endurance_normalise_key(p.track_key)
      ) k
     WHERE k.sleutel IS NOT NULL
  ),
  -- Het venster: de nieuwste 400 rondes van deze auto op deze baan.
  recent AS (
    SELECT a.id, a.lap_time_seconds, a.fuel_per_lap_litres, a.captured_at
      FROM public.endurance_telemetry_archive a
      CROSS JOIN params p
     WHERE (p.car_key IS NULL OR a.car_id IN (SELECT sleutel FROM car_keys))
       AND (p.track_key IS NULL OR a.track_id IN (SELECT sleutel FROM track_keys))
     ORDER BY a.captured_at DESC NULLS LAST, a.id DESC
     LIMIT 400
  ),
  grenzen AS (
    SELECT min(lap_time_seconds) FILTER (WHERE lap_time_seconds >= 30) AS snelste_ronde,
           percentile_disc(0.5) WITHIN GROUP (ORDER BY fuel_per_lap_litres)
             FILTER (WHERE fuel_per_lap_litres IS NOT NULL) AS mediaan_verbruik
      FROM recent
  ),
  stats AS (
    SELECT count(*) FILTER (
             WHERE r.fuel_per_lap_litres IS NOT NULL
               AND (g.mediaan_verbruik IS NULL
                    OR r.fuel_per_lap_litres >= g.mediaan_verbruik * 0.4)
           )::integer AS fuel_laps,
           count(*) FILTER (
             WHERE r.lap_time_seconds >= 30
               AND (g.snelste_ronde IS NULL
                    OR r.lap_time_seconds <= g.snelste_ronde * 1.25)
           )::integer AS time_laps,
           round(avg(r.fuel_per_lap_litres) FILTER (
             WHERE r.fuel_per_lap_litres IS NOT NULL
               AND (g.mediaan_verbruik IS NULL
                    OR r.fuel_per_lap_litres >= g.mediaan_verbruik * 0.4)
           ), 3) AS avg_fuel,
           round(avg(r.lap_time_seconds) FILTER (
             WHERE r.lap_time_seconds >= 30
               AND (g.snelste_ronde IS NULL
                    OR r.lap_time_seconds <= g.snelste_ronde * 1.25)
           ), 3) AS avg_lap,
           min(r.captured_at) AS first_at,
           max(r.captured_at) AS last_at
      FROM recent r
      CROSS JOIN grenzen g
  ),
  spec AS (
    SELECT max(s.tank_capacity_litres)      AS tank,
           max(s.fuel_per_lap_prior_litres) AS prior
      FROM public.endurance_car_specs s
     WHERE s.car_id IN (SELECT sleutel FROM car_keys)
  ),
  gekozen AS (
    SELECT st.fuel_laps,
           st.time_laps,
           CASE WHEN st.fuel_laps >= 10 THEN st.avg_fuel END AS learned_fuel,
           CASE WHEN st.time_laps >= 10 THEN st.avg_lap END  AS learned_lap,
           spec.tank,
           spec.prior,
           st.first_at,
           st.last_at
      FROM stats st
      CROSS JOIN spec
  ),
  uitkomst AS (
    SELECT g.*,
           coalesce(g.learned_fuel, g.prior) AS fuel_per_lap,
           CASE WHEN g.learned_fuel IS NOT NULL THEN 'archive'
                WHEN g.prior IS NOT NULL        THEN 'spec_prior'
                ELSE 'unknown' END           AS fuel_source,
           CASE WHEN g.learned_lap IS NOT NULL THEN 'archive' ELSE 'unknown' END AS lap_source
      FROM gekozen g
  )
  SELECT p.car_key,
         p.track_key,
         round(u.tank, 2),
         coalesce(u.fuel_laps, 0),
         u.learned_fuel,
         u.learned_lap,
         CASE WHEN u.tank > 0 AND u.fuel_per_lap > 0
              THEN round(u.tank / u.fuel_per_lap, 1) END,
         CASE WHEN u.tank > 0 AND u.fuel_per_lap > 0 AND u.learned_lap IS NOT NULL
              THEN round((u.tank / u.fuel_per_lap) * u.learned_lap / 60.0, 1) END,
         u.fuel_source,
         u.lap_source,
         u.first_at,
         u.last_at
    FROM params p
    CROSS JOIN uitkomst u;
$function$;

COMMENT ON FUNCTION public.endurance_learning_summary(text, text) IS
  'Leert tankduur en stintlengte per auto en baan uit endurance_telemetry_archive: gemiddeld verbruik per ronde, gemiddelde rondetijd en daaruit de tankduur in minuten. Eén rij, altijd; leeg wanneer er te weinig bruikbare rondes zijn.';

-- Alleen-lezen, alleen aggregaten: geen team- of rijdergegevens in de uitvoer.
GRANT EXECUTE ON FUNCTION public.endurance_learning_summary(text, text) TO authenticated;

REVOKE ALL ON FUNCTION public.endurance_normalise_key(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.endurance_normalise_key(text) TO authenticated;

COMMIT;
