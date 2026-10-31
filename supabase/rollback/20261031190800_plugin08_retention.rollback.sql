-- Rollback van 20261031190800_plugin08_retention.sql
-- Gegevensbehoudend: er wordt geen enkele meetrij verwijderd. Wat teruggaat is
-- code en, waar nodig, een constraint. De tabellen en hun inhoud blijven staan,
-- zodat een review of een latere herkansing de gegevens niet kwijt is.
--
-- De opruimfunctie en de twee received_at-indexen gaan weg. Meetrijen blijven
-- staan; er wordt niets opgeruimd.
-- Volgorde: altijd van nieuw naar oud terugdraaien (190800 eerst).
-- Geen begin/commit: atomair te draaien met psql -1.
-- ============================================================================

drop function if exists public.simhub_prune_measurements(timestamptz, timestamptz, boolean);
drop index if exists public.simhub_measurement_events_received_idx;
drop index if exists public.simhub_lap_summaries_received_idx;

