-- Terugdraaien van 20261025123000_endurance_tyre_change_detection.sql.
--
-- Eerst de klok-taak weg, dan de functies, dan de index en de kolommen. De
-- kolommen bevatten alleen afgeleide markeringen; de metingen zelf blijven
-- staan, dus het verlies is beperkt tot de herberekening.

select cron.unschedule('endurance-tyre-detection')
 where exists (select 1 from cron.job where jobname = 'endurance-tyre-detection');

drop function if exists public.endurance_tick_tyre_changes();
drop function if exists public.endurance_detect_tyre_changes(uuid, uuid);

-- De detectie schreef echte rijen in de tijdlijn; die horen bij de functie en
-- gaan mee terug, anders blijft er een wissel staan die niemand kan onderbouwen.
delete from public.endurance_telemetry_events where event_type = 'tyre_change';

-- De check weer op de oude lijst zetten (zonder 'tyre_change').
do $$
begin
  if exists (
    select 1 from pg_constraint
     where conname = 'endurance_telemetry_events_event_type_check'
       and conrelid = 'public.endurance_telemetry_events'::regclass
  ) then
    alter table public.endurance_telemetry_events
      drop constraint endurance_telemetry_events_event_type_check;
  end if;

  alter table public.endurance_telemetry_events
    add constraint endurance_telemetry_events_event_type_check
    check (event_type = any (array[
      'sample', 'lap_completed', 'pit_entry', 'pit_exit', 'fuel_added',
      'driver_change', 'stint_start', 'stint_end', 'flag_change',
      'car_state_change', 'incident_count_changed'
    ]));
end $$;

drop index if exists public.endurance_strategy_lap_samples_tyre_scan_idx;

alter table public.endurance_strategy_lap_samples
  drop column if exists wear_frozen_laps,
  drop column if exists wear_frozen,
  drop column if exists tyre_change_detected,
  drop column if exists wear_delta_rr,
  drop column if exists wear_delta_rl,
  drop column if exists wear_delta_fr,
  drop column if exists wear_delta_fl;
