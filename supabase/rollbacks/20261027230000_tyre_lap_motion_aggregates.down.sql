-- ============================================================================
-- TERUGROL voor 20261027230000_tyre_lap_motion_aggregates.sql
--
-- Verwijdert de eigen trigger, accumulator en kolommen van de directe-SDK-
-- aggregatie. De bestaande bandenaggregatie (simhub_tyre_lap_accum_trg,
-- simhub_tyre_lap_accumulate, simhub_tyre_lap_flush_row) is door de migratie
-- nooit aangeraakt en blijft dus werken; deze rollback hoeft die niet te
-- herstellen.
--
-- Rijen in simhub_tyre_lap_samples van vóór de rollback verliezen alleen de
-- drie nieuwe kolommen; de bandengegevens in dezelfde rijen blijven staan.
-- ============================================================================

begin;

drop trigger if exists simhub_motion_lap_accum_trg on public.simhub_telemetry_latest;

drop function if exists public.simhub_motion_lap_flush_row(public.simhub_motion_lap_accum);
drop function if exists public.simhub_motion_lap_accumulate();
drop function if exists public.simhub_motion_stat_summary(jsonb);
drop function if exists public.simhub_motion_stat_merge(jsonb, jsonb);

drop table if exists public.simhub_motion_lap_accum;

alter table public.simhub_tyre_lap_samples
  drop column if exists motion_samples,
  drop column if exists brake_bar,
  drop column if exists wheel_kph;

commit;
