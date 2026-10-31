-- Rollback van 20261031190600_plugin08_snapshot_strip.sql
-- Gegevensbehoudend: er wordt geen enkele meetrij verwijderd. Wat teruggaat is
-- code en, waar nodig, een constraint. De tabellen en hun inhoud blijven staan,
-- zodat een review of een latere herkansing de gegevens niet kwijt is.
--
-- De trigger gaat weg. De Edge blijft de meetserie sowieso uit de DTO houden
-- (snapshotDto); deze rollback haalt alleen de tweede wachter weg. Bestaande
-- snapshots zijn al opgeschoond en blijven dat.
-- Volgorde: altijd van nieuw naar oud terugdraaien (190800 eerst).
-- Geen begin/commit: atomair te draaien met psql -1.
-- ============================================================================

drop trigger if exists simhub_telemetry_latest_strip_measurements
  on public.simhub_telemetry_latest;
drop function if exists public.simhub_strip_measurement_snapshot();

