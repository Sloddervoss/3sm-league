-- Rollback for 20261121122000_persist_pace_identity_guard.sql
--
-- Keert uitsluitend het PACE-blok, zijn declaratie en de kanaalregex van het
-- evidence-contract terug. De basis is de definitie die de forward-migratie
-- heeft achtergelaten; een andere body wordt geweigerd. Na de rollback moeten
-- de functiedefinities en hun effectieve ACL weer exact de productiestaat zijn
-- (simhub_persist_v3 md5 e15ef4a7bde6e876e835c406696283c6, simhub_pace_merge_v1 md5 0f984dd59a233a499caa35e16a68515c,
-- simhub_evidence_v1_valid md5 1fdab6c7c46ea98dc70e5f1386284ccd).
-- De BEFORE UPDATE-guard uit 20261121120000 blijft als tweede slot actief.

BEGIN;
SET LOCAL lock_timeout='3s';
SET LOCAL statement_timeout='10s';

DO $pace_rollback$
DECLARE
  v_def text;
  v_rev text;
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
  IF md5(pg_get_functiondef('public.simhub_persist_v3(text,text,bigint,timestamp with time zone,jsonb,text,jsonb,jsonb)'::regprocedure)) IS DISTINCT FROM 'f6117484afcc3107c772c8c314e1e853' THEN
    RAISE EXCEPTION 'simhub_persist_v3 rollback preimage drift: expected f6117484afcc3107c772c8c314e1e853, found %',
      md5(pg_get_functiondef('public.simhub_persist_v3(text,text,bigint,timestamp with time zone,jsonb,text,jsonb,jsonb)'::regprocedure));
  END IF;
  IF md5(pg_get_functiondef('public.simhub_pace_merge_v1(jsonb,jsonb,text,timestamp with time zone)'::regprocedure)) IS DISTINCT FROM '0f984dd59a233a499caa35e16a68515c' THEN
    RAISE EXCEPTION 'simhub_pace_merge_v1 drift: expected 0f984dd59a233a499caa35e16a68515c, found %',
      md5(pg_get_functiondef('public.simhub_pace_merge_v1(jsonb,jsonb,text,timestamp with time zone)'::regprocedure));
  END IF;

  v_def := pg_get_functiondef('public.simhub_persist_v3(text,text,bigint,timestamp with time zone,jsonb,text,jsonb,jsonb)'::regprocedure);
  IF length(v_def) - length(replace(v_def, v_new, '')) IS DISTINCT FROM length(v_new) THEN
    RAISE EXCEPTION 'simhub_persist_v3 replacement block not found exactly once';
  END IF;
  IF position(v_old IN v_def) <> 0 THEN
    RAISE EXCEPTION 'simhub_persist_v3 still contains the original block';
  END IF;

  v_rev := replace(replace(v_def, v_new, v_old), v_decl_new, v_decl_old);
  IF replace(replace(v_rev, v_old, v_new), v_decl_old, v_decl_new) IS DISTINCT FROM v_def THEN
    RAISE EXCEPTION 'simhub_persist_v3 rollback splice is not reversible';
  END IF;

  EXECUTE v_rev;

  IF md5(pg_get_functiondef('public.simhub_persist_v3(text,text,bigint,timestamp with time zone,jsonb,text,jsonb,jsonb)'::regprocedure)) IS DISTINCT FROM 'e15ef4a7bde6e876e835c406696283c6' THEN
    RAISE EXCEPTION 'simhub_persist_v3 rollback postimage drift: expected e15ef4a7bde6e876e835c406696283c6, found %',
      md5(pg_get_functiondef('public.simhub_persist_v3(text,text,bigint,timestamp with time zone,jsonb,text,jsonb,jsonb)'::regprocedure));
  END IF;
END
$pace_rollback$;

DO $evidence_rollback$
DECLARE
  v_def text;
  v_old text := $ev_old$(c #>> '{}') !~ '^[a-z0-9._:-]{1,64}$'$ev_old$;
  v_new text := $ev_new$(c #>> '{}') !~ '^[A-Za-z0-9._:-]{1,64}$'$ev_new$;
BEGIN
  IF md5(pg_get_functiondef('public.simhub_evidence_v1_valid(jsonb)'::regprocedure)) IS DISTINCT FROM '0305699f4456814f7d65bdccfd52d3f7' THEN
    RAISE EXCEPTION 'simhub_evidence_v1_valid rollback preimage drift: expected 0305699f4456814f7d65bdccfd52d3f7, found %',
      md5(pg_get_functiondef('public.simhub_evidence_v1_valid(jsonb)'::regprocedure));
  END IF;
  v_def := pg_get_functiondef('public.simhub_evidence_v1_valid(jsonb)'::regprocedure);
  IF length(v_def) - length(replace(v_def, v_new, '')) IS DISTINCT FROM length(v_new) THEN
    RAISE EXCEPTION 'simhub_evidence_v1_valid replacement rule not found exactly once';
  END IF;
  EXECUTE replace(v_def, v_new, v_old);
  IF md5(pg_get_functiondef('public.simhub_evidence_v1_valid(jsonb)'::regprocedure)) IS DISTINCT FROM '1fdab6c7c46ea98dc70e5f1386284ccd' THEN
    RAISE EXCEPTION 'simhub_evidence_v1_valid rollback postimage drift: expected 1fdab6c7c46ea98dc70e5f1386284ccd, found %',
      md5(pg_get_functiondef('public.simhub_evidence_v1_valid(jsonb)'::regprocedure));
  END IF;
END
$evidence_rollback$;

DROP FUNCTION IF EXISTS public.simhub_pace_previous_v1(jsonb, jsonb);
DROP FUNCTION IF EXISTS public.simhub_pace_identity_fill_v1(jsonb, jsonb);

COMMIT;
