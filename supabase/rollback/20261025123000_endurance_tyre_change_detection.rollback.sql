-- Terugdraaien van 20261025123000_endurance_tyre_change_detection.sql.
--
-- Eerst de klok-taak weg, dan de functies, dan de index en de kolommen. De
-- kolommen bevatten alleen afgeleide markeringen; de metingen zelf blijven
-- staan, dus het verlies is beperkt tot de herberekening.

select cron.unschedule('endurance-tyre-detection')
 where exists (select 1 from cron.job where jobname = 'endurance-tyre-detection');

drop function if exists public.endurance_tick_tyre_changes();
drop function if exists public.endurance_detect_tyre_changes(uuid, uuid);

drop index if exists public.endurance_strategy_lap_samples_tyre_scan_idx;

alter table public.endurance_strategy_lap_samples
  drop column if exists wear_frozen_laps,
  drop column if exists wear_frozen,
  drop column if exists tyre_change_detected,
  drop column if exists wear_delta_rr,
  drop column if exists wear_delta_rl,
  drop column if exists wear_delta_fr,
  drop column if exists wear_delta_fl;
