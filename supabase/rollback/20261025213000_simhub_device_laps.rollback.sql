drop trigger if exists simhub_capture_lap_trg on public.simhub_telemetry_latest;
drop function if exists public.simhub_capture_lap();
drop table if exists public.simhub_device_laps;
