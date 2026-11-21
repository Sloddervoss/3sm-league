-- 2026-11-21: de PACE-merge-beslissing zelf respecteert ontbrekende identiteit
-- en de meetbatch accepteert de kanalen die de connector werkelijk serialiseert.
--
-- De vorige laag beschermde alleen de laatst weggeschreven snapshot met een
-- BEFORE UPDATE-trigger. Deze migratie vervangt de eigenlijke beslissing in
-- `simhub_persist_v3`: een ontbrekende trackId/carId is onbekend, geen
-- bevestigde wissel. De trigger blijft als tweede slot.
--
-- De productiedefinities zijn read-only opgehaald met pg_get_functiondef. Die
-- tekst is de enige bron van waarheid; de body die 20261115201044 achterlaat
-- is byte-voor-byte gelijk aan de productiebody. Deze migratie kopieert de
-- productiebody daarom NIET opnieuw, maar vervangt exact één PACE-blok en één
-- declaratie in de definitie die zij aantreft. Alles buiten die twee
-- fragmenten blijft ongewijzigd, inclusief de meetbatch, de policy-leesroute,
-- de pitflanken en de grants.
--
-- Tweede, even kleine fragment: `simhub_evidence_v1_valid` eist voor
-- evidence.channels een lowercase token. De echte connector serialiseert
-- `["OnPitRoad"]` (zie supabase/tests/fixtures/pit-edges-connector.json), dus
-- `simhub_persist_measurement_batch` keurde elke pitflank af met
-- `evidence_contract` vóór de trigger hem ooit zag. Alleen de kanaalregex
-- wordt hoofdlettertolerant; `source` blijft lowercase en er is geen leesroute
-- die kanaalcase als betekenis gebruikt.
--
-- Geen signature-, owner-, grant- of leesroutewijziging. Geen productieapply.

BEGIN;
SET LOCAL lock_timeout='3s';
SET LOCAL statement_timeout='10s';

-- ---------------------------------------------------------------------------
-- Helper: identiteitsvelden aanvullen zonder een echte wissel te verbergen.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.simhub_pace_identity_fill_v1(p_new_v3 jsonb, p_previous_v3 jsonb)
RETURNS jsonb
LANGUAGE plpgsql
IMMUTABLE
SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $fill$
DECLARE
  v_new jsonb := p_new_v3;
  v_old_track text;
  v_new_track text;
  v_old_car text;
  v_new_car text;
BEGIN
  IF p_new_v3 IS NULL OR jsonb_typeof(p_new_v3) IS DISTINCT FROM 'object'
     OR p_previous_v3 IS NULL OR jsonb_typeof(p_previous_v3) IS DISTINCT FROM 'object' THEN
    RETURN p_new_v3;
  END IF;
  -- Een aanwezig maar niet-object identity-blok is malformed; laat het frame
  -- ongemoeid in plaats van er een object aan vast te plakken.
  IF p_new_v3 ? 'identity' AND jsonb_typeof(p_new_v3 -> 'identity') IS DISTINCT FROM 'object' THEN
    RETURN p_new_v3;
  END IF;
  v_old_track := p_previous_v3 #>> '{identity,trackId}';
  v_new_track := p_new_v3 #>> '{identity,trackId}';
  v_old_car := p_previous_v3 #>> '{identity,carId}';
  v_new_car := p_new_v3 #>> '{identity,carId}';
  IF v_new_track IS NULL AND v_old_track IS NOT NULL THEN
    v_new := jsonb_set(v_new, '{identity}',
      coalesce(v_new -> 'identity', '{}'::jsonb) || jsonb_build_object('trackId',
        CASE WHEN v_old_track ~ '^[0-9]+$' THEN to_jsonb(v_old_track::bigint) ELSE to_jsonb(v_old_track) END), true);
  END IF;
  IF v_new_car IS NULL AND v_old_car IS NOT NULL THEN
    v_new := jsonb_set(v_new, '{identity}',
      coalesce(v_new -> 'identity', '{}'::jsonb) || jsonb_build_object('carId', v_old_car), true);
  END IF;
  RETURN v_new;
END;
$fill$;

REVOKE ALL ON FUNCTION public.simhub_pace_identity_fill_v1(jsonb, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.simhub_pace_identity_fill_v1(jsonb, jsonb) TO service_role;

-- ---------------------------------------------------------------------------
-- Helper: welke vorige PACE-historie mag deze capture erven?
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.simhub_pace_previous_v1(p_previous_v3 jsonb, p_new_v3 jsonb)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $previous$
DECLARE
  old_h jsonb;
  new_h jsonb;
  old_track text; new_track text;
  old_car text; new_car text;
  old_segment text; new_segment text;
  old_observed text; new_observed text;
  old_clock numeric; new_clock numeric;
  old_updated timestamptz; new_updated timestamptz;
  old_cars integer; new_cars integer;
BEGIN
  IF p_previous_v3 IS NULL THEN RETURN NULL; END IF;
  old_h := p_previous_v3 -> 'paceHistory';
  new_h := p_new_v3 -> 'paceHistory';
  IF old_h IS NULL OR jsonb_typeof(old_h) IS DISTINCT FROM 'object'
     OR jsonb_typeof(old_h -> 'cars') IS DISTINCT FROM 'array' THEN
    RETURN NULL;
  END IF;

  -- De 24-uursonderhoudsroute mag een verlopen blok verwijderen.
  BEGIN
    old_updated := (old_h ->> 'updatedAt')::timestamptz;
  EXCEPTION WHEN OTHERS THEN
    old_updated := NULL;
  END;
  IF old_updated IS NOT NULL AND old_updated < now() - interval '24 hours' THEN
    RETURN NULL;
  END IF;

  -- Een teruglopende sessieklok is een reset, geen voortzetting.
  BEGIN
    old_clock := (p_previous_v3 #>> '{session,sessionTimeSeconds}')::numeric;
    new_clock := (p_new_v3 #>> '{session,sessionTimeSeconds}')::numeric;
  EXCEPTION WHEN OTHERS THEN
    old_clock := NULL;
    new_clock := NULL;
  END;
  IF old_clock IS NOT NULL AND new_clock IS NOT NULL AND new_clock < old_clock - 0.001 THEN
    RETURN NULL;
  END IF;

  old_track := p_previous_v3 #>> '{identity,trackId}';
  new_track := p_new_v3 #>> '{identity,trackId}';
  old_car := p_previous_v3 #>> '{identity,carId}';
  new_car := p_new_v3 #>> '{identity,carId}';
  IF old_track IS NOT NULL AND new_track IS NOT NULL AND old_track IS DISTINCT FROM new_track THEN
    RETURN NULL;
  END IF;
  IF old_car IS NOT NULL AND new_car IS NOT NULL AND old_car IS DISTINCT FROM new_car THEN
    RETURN NULL;
  END IF;

  old_segment := old_h ->> 'segmentId';
  new_segment := new_h ->> 'segmentId';
  old_observed := old_h ->> 'observedSessionId';
  new_observed := new_h ->> 'observedSessionId';
  IF old_segment IS NOT NULL AND new_segment IS NOT NULL AND old_segment IS DISTINCT FROM new_segment THEN
    RETURN NULL;
  END IF;
  IF old_observed IS NOT NULL AND new_observed IS NOT NULL AND old_observed IS DISTINCT FROM new_observed THEN
    RETURN NULL;
  END IF;

  IF new_h IS NULL OR jsonb_typeof(new_h) IS DISTINCT FROM 'object'
     OR jsonb_typeof(new_h -> 'cars') IS DISTINCT FROM 'array' THEN
    RETURN old_h;
  END IF;

  old_cars := jsonb_array_length(old_h -> 'cars');
  new_cars := jsonb_array_length(new_h -> 'cars');
  BEGIN
    new_updated := (new_h ->> 'updatedAt')::timestamptz;
  EXCEPTION WHEN OTHERS THEN
    new_updated := NULL;
  END;
  IF new_cars < old_cars OR (old_updated IS NOT NULL AND new_updated IS NOT NULL AND new_updated < old_updated) THEN
    RETURN old_h;
  END IF;

  RETURN new_h;
END;
$previous$;

REVOKE ALL ON FUNCTION public.simhub_pace_previous_v1(jsonb, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.simhub_pace_previous_v1(jsonb, jsonb) TO service_role;

-- ---------------------------------------------------------------------------
-- De PACE-wijziging: exact dit blok plus zijn declaratie. De guard weigert een
-- andere productiebody, een dubbele treffer en een niet-omkeerbare vervanging.
-- ---------------------------------------------------------------------------
DO $pace_guard$
DECLARE
  v_def text;
  v_mut text;
  v_old text := $pace_old$  SELECT CASE
      WHEN v3_normalized IS NULL THEN NULL
      WHEN (v3_normalized#>>'{session,sessionTimeSeconds}') ~ '^[0-9]+([.][0-9]+)?$'
       AND (p_v3_normalized#>>'{session,sessionTimeSeconds}') ~ '^[0-9]+([.][0-9]+)?$'
       AND (v3_normalized#>>'{session,sessionTimeSeconds}')::numeric
           > (p_v3_normalized#>>'{session,sessionTimeSeconds}')::numeric THEN NULL
      WHEN v3_normalized#>'{identity,carId}' IS DISTINCT FROM p_v3_normalized#>'{identity,carId}' THEN NULL
      WHEN v3_normalized#>'{identity,trackId}' IS DISTINCT FROM p_v3_normalized#>'{identity,trackId}' THEN NULL
      ELSE v3_normalized->'paceHistory' END INTO v_pace_previous
    FROM public.simhub_telemetry_latest WHERE device_id = d.id;$pace_old$;
  v_new text := $pace_new$  SELECT v3_normalized INTO v_previous_v3
    FROM public.simhub_telemetry_latest WHERE device_id = d.id;

  -- Een ontbrekend identity-veld is onbekend, geen bevestigde wissel. Draag de
  -- laatst bekende track/car-door alleen over als dit frame ze niet meezendt,
  -- zodat een volgend frame een echte wissel nog kan bewijzen.
  p_v3_normalized := public.simhub_pace_identity_fill_v1(p_v3_normalized, v_previous_v3);

  -- Alleen twee bekende, verschillende waarden resetten; een sparse of
  -- identiteitsloos frame houdt de bewezen historie. Een te oude historie of
  -- een teruglopende sessieklok reset wel.
  v_pace_previous := public.simhub_pace_previous_v1(v_previous_v3, p_v3_normalized);$pace_new$;
  v_decl_old text := $pace_decl_old$DECLARE
  -- PACE: optionele, begrensde historie in het bestaande JSONB-veld.
  v_pace_previous jsonb;
  v_pace_snapshot jsonb;$pace_decl_old$;
  v_decl_new text := $pace_decl_new$DECLARE
  -- PACE: optionele, begrensde historie in het bestaande JSONB-veld.
  v_pace_previous jsonb;
  v_previous_v3 jsonb;
  v_pace_snapshot jsonb;$pace_decl_new$;
BEGIN
  IF md5(pg_get_functiondef('public.simhub_persist_v3(text,text,bigint,timestamp with time zone,jsonb,text,jsonb,jsonb)'::regprocedure)) IS DISTINCT FROM 'e15ef4a7bde6e876e835c406696283c6' THEN
    RAISE EXCEPTION 'simhub_persist_v3 preimage drift: expected e15ef4a7bde6e876e835c406696283c6, found %',
      md5(pg_get_functiondef('public.simhub_persist_v3(text,text,bigint,timestamp with time zone,jsonb,text,jsonb,jsonb)'::regprocedure));
  END IF;
  IF md5(pg_get_functiondef('public.simhub_pace_merge_v1(jsonb,jsonb,text,timestamp with time zone)'::regprocedure)) IS DISTINCT FROM '0f984dd59a233a499caa35e16a68515c' THEN
    RAISE EXCEPTION 'simhub_pace_merge_v1 drift: expected 0f984dd59a233a499caa35e16a68515c, found %',
      md5(pg_get_functiondef('public.simhub_pace_merge_v1(jsonb,jsonb,text,timestamp with time zone)'::regprocedure));
  END IF;

  v_def := pg_get_functiondef('public.simhub_persist_v3(text,text,bigint,timestamp with time zone,jsonb,text,jsonb,jsonb)'::regprocedure);
  IF length(v_def) - length(replace(v_def, v_old, '')) IS DISTINCT FROM length(v_old) THEN
    RAISE EXCEPTION 'simhub_persist_v3 PACE block not found exactly once';
  END IF;
  IF position(v_new IN v_def) <> 0 THEN
    RAISE EXCEPTION 'simhub_persist_v3 already carries the replacement block';
  END IF;
  IF length(v_def) - length(replace(v_def, v_decl_old, '')) IS DISTINCT FROM length(v_decl_old) THEN
    RAISE EXCEPTION 'simhub_persist_v3 PACE declaration not found exactly once';
  END IF;

  v_mut := replace(replace(v_def, v_old, v_new), v_decl_old, v_decl_new);
  IF replace(replace(v_mut, v_new, v_old), v_decl_new, v_decl_old) IS DISTINCT FROM v_def THEN
    RAISE EXCEPTION 'simhub_persist_v3 splice is not reversible';
  END IF;

  EXECUTE v_mut;

  IF md5(pg_get_functiondef('public.simhub_persist_v3(text,text,bigint,timestamp with time zone,jsonb,text,jsonb,jsonb)'::regprocedure)) IS DISTINCT FROM 'f6117484afcc3107c772c8c314e1e853' THEN
    RAISE EXCEPTION 'simhub_persist_v3 postimage drift: expected f6117484afcc3107c772c8c314e1e853, found %',
      md5(pg_get_functiondef('public.simhub_persist_v3(text,text,bigint,timestamp with time zone,jsonb,text,jsonb,jsonb)'::regprocedure));
  END IF;
  IF position(v_old IN pg_get_functiondef('public.simhub_persist_v3(text,text,bigint,timestamp with time zone,jsonb,text,jsonb,jsonb)'::regprocedure)) <> 0 THEN
    RAISE EXCEPTION 'simhub_persist_v3 still contains the old PACE block';
  END IF;
END
$pace_guard$;

-- ---------------------------------------------------------------------------
-- De meetbatch-wijziging: alleen de kanaalregex van het evidence-contract.
-- ---------------------------------------------------------------------------
DO $evidence_guard$
DECLARE
  v_def text;
  v_old text := $ev_old$(c #>> '{}') !~ '^[a-z0-9._:-]{1,64}$'$ev_old$;
  v_new text := $ev_new$(c #>> '{}') !~ '^[A-Za-z0-9._:-]{1,64}$'$ev_new$;
BEGIN
  IF md5(pg_get_functiondef('public.simhub_evidence_v1_valid(jsonb)'::regprocedure)) IS DISTINCT FROM '1fdab6c7c46ea98dc70e5f1386284ccd' THEN
    RAISE EXCEPTION 'simhub_evidence_v1_valid preimage drift: expected 1fdab6c7c46ea98dc70e5f1386284ccd, found %',
      md5(pg_get_functiondef('public.simhub_evidence_v1_valid(jsonb)'::regprocedure));
  END IF;
  v_def := pg_get_functiondef('public.simhub_evidence_v1_valid(jsonb)'::regprocedure);
  IF length(v_def) - length(replace(v_def, v_old, '')) IS DISTINCT FROM length(v_old) THEN
    RAISE EXCEPTION 'simhub_evidence_v1_valid channel rule not found exactly once';
  END IF;
  EXECUTE replace(v_def, v_old, v_new);
  IF md5(pg_get_functiondef('public.simhub_evidence_v1_valid(jsonb)'::regprocedure)) IS DISTINCT FROM '0305699f4456814f7d65bdccfd52d3f7' THEN
    RAISE EXCEPTION 'simhub_evidence_v1_valid postimage drift: expected 0305699f4456814f7d65bdccfd52d3f7, found %',
      md5(pg_get_functiondef('public.simhub_evidence_v1_valid(jsonb)'::regprocedure));
  END IF;
END
$evidence_guard$;

COMMIT;
