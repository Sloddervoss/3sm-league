-- ============================================================================
-- Plugin 0.7.2.0 — DESTRUCTIEVE opruiming van de meetobjecten
-- Datum: 2026-10-31
--
-- LET OP: dit bestand is GEEN rollback. Het verwijdert gegevens die niet
-- reconstrueerbaar zijn. Het staat los van de rollbackketen (die is
-- gegevensbehoudend) en mag alleen handmatig draaien, na een export.
--
-- Wanneer
-- -------
-- Alleen als de 0.7.2.0-meetfunctie definitief niet doorgaat én de bewaarde
-- metingen niet meer nodig zijn. Niet bij een gewone terugrol naar de vorige
-- pluginversie: dan blijven de tabellen staan en schrijft niemand er meer in.
--
-- Verplichte voorstap: export
-- ---------------------------
--   pg_dump --data-only --table=public.simhub_measurement_events \
--           --table=public.simhub_lap_summaries \
--           --table=public.simhub_connector_config \
--           "$DATABASE_URL" > plugin08-meetgegevens-$(date +%F).sql
--
-- Controleer daarna dat het bestand niet leeg is en bevat wat je verwacht:
--   grep -c "COPY public.simhub_measurement_events" plugin08-meetgegevens-*.sql
--
-- Wat dit bestand verwijdert
-- --------------------------
--   1. de twee meettabellen (inclusief alle rijen),
--   2. de configuratietabel (inclusief de laatste gepubliceerde stand),
--   3. de meetfuncties, validatiehelpers, trigger en opruimfunctie.
--
-- Wat het NIET doet: simhub_telemetry_latest aanraken. Daar staan geen
-- meetreeksen meer in (zie 20261031190600).
--
-- Geen begin/commit: atomair te draaien met psql -1, zodat een halve opruiming
-- onmogelijk is.
-- ============================================================================

-- 1. Code die aan de meetfunctie hangt.
drop function if exists public.simhub_prune_measurements(timestamptz, timestamptz, boolean);
drop function if exists public.simhub_persist_measurement_batch(uuid, text, jsonb, jsonb);
drop function if exists public.simhub_persist_v3(
  text, text, bigint, timestamp with time zone, jsonb, text, jsonb, jsonb);

-- 2. Trigger en snapshothelper.
drop trigger if exists simhub_telemetry_latest_strip_measurements
  on public.simhub_telemetry_latest;
drop function if exists public.simhub_strip_measurement_snapshot();

-- 3. De meetgegevens zelf, VÓÓR de validatiefuncties. De CHECK-constraints van
--    de tabellen verwijzen naar simhub_coverage_* en simhub_wear_v1_valid;
--    zou je die functies eerst droppen, dan weigert PostgreSQL met
--    "other objects depend on it". De tabellen dragen de constraints, dus die
--    gaan eerst weg (inclusief de rijen — dit bestand is destructief).
drop table if exists public.simhub_measurement_events;
drop table if exists public.simhub_lap_summaries;

-- 4. Validatie- en contracthelpers.
drop function if exists public.simhub_coverage_group_valid(jsonb);
drop function if exists public.simhub_coverage_valid(jsonb);
drop function if exists public.simhub_coverage_has(jsonb, text);
drop function if exists public.simhub_coverage_complete(jsonb);
drop function if exists public.simhub_coverage_complete(jsonb, timestamptz, timestamptz);
drop function if exists public.simhub_coverage_reasons(jsonb, timestamptz, timestamptz);
drop function if exists public.simhub_coverage_sample_total(jsonb);
drop function if exists public.simhub_coverage_valid_duration(jsonb);
drop function if exists public.simhub_coverage_max_gap(jsonb);
drop function if exists public.simhub_wear_v1_valid(jsonb);
drop function if exists public.simhub_set_generation_valid(jsonb);
drop function if exists public.simhub_evidence_v1_valid(jsonb);
drop function if exists public.simhub_ack_reject(jsonb, text, bigint, text, integer);
drop function if exists public.simhub_jvalid(jsonb, text, double precision, double precision);
drop function if exists public.simhub_jnumeric(jsonb);
drop function if exists public.simhub_jtext(jsonb);
drop function if exists public.simhub_jdouble(jsonb);
drop function if exists public.simhub_jint(jsonb);
drop function if exists public.simhub_jbigint(jsonb);
drop function if exists public.simhub_juuid(jsonb);
drop function if exists public.simhub_jtimestamptz(jsonb);
drop function if exists public.simhub_jbool(jsonb);
drop function if exists public.simhub_jtextarray(jsonb, integer);

-- 5. Configuratie (code en de laatste stand).
drop function if exists public.simhub_connector_config_apply(jsonb, integer);
drop view if exists public.simhub_connector_config_readonly;
drop function if exists public.simhub_connector_config_public();
drop table if exists public.simhub_connector_config;

-- 6. De oude schrijver terug, zodat de ingest blijft werken.
--    (Draai daarvoor eerst supabase/rollback/20261031180300_...rollback.sql als
--    dat nog niet is gebeurd; dat bestand herstelt de zesargumentversie.)
