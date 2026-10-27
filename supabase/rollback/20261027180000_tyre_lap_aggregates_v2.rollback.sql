drop trigger if exists simhub_tyre_lap_accum_trg on public.simhub_telemetry_latest;
drop function if exists public.tyre_rounds_for_device(uuid, integer);
drop function if exists public.tyre_data_coverage();
drop function if exists public.simhub_tyre_lap_flush_row(public.simhub_tyre_lap_accum);
drop function if exists public.simhub_tyre_lap_accumulate();
drop table if exists public.simhub_tyre_lap_samples;
drop table if exists public.simhub_tyre_lap_accum;
