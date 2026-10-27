-- Naamcorrectie: vehicle.<hoek>.temperature is in de praktijk de
-- karkastemperatuur (gemeten: 68,47 tegen 68,67 gemiddeld uit de drie
-- karkasmetingen, en de wear is identiek aan die in het bandenblok).
-- De officiële iRacing-documentatie markeert de loopvlakkanalen (tempL/M/R)
-- als Disk-only; die zijn dus niet live te krijgen en horen hier niet.
--
-- De waarden blijven nuttig als pitsnapshot, maar niet als per-ronde signaal.
-- Daarom hernoemen we de kolommen eerlijk en laten we de aggregatie staan tot
-- de kanaalproef op de race-pc heeft bewezen of ze binnen een stint bewegen.

alter table public.simhub_tyre_lap_samples rename column surf_fl to carc_fl;
alter table public.simhub_tyre_lap_samples rename column surf_fr to carc_fr;
alter table public.simhub_tyre_lap_samples rename column surf_rl to carc_rl;
alter table public.simhub_tyre_lap_samples rename column surf_rr to carc_rr;
alter table public.simhub_tyre_lap_samples rename column surf_max to carc_max;

create or replace function public.simhub_tyre_lap_flush_row(p_rij public.simhub_tyre_lap_accum)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_rij.n < 3 then
    return;
  end if;

  insert into public.simhub_tyre_lap_samples (
    device_id, connector_id, session_key, lap_number, lap_seconds, driver_name,
    compound_id, tyre_set, wear_fl, wear_fr, wear_rl, wear_rr,
    carc_fl, carc_fr, carc_rl, carc_rr, carc_max,
    track_temp_c, air_temp_c, rubber_state, samples, captured_at
  ) values (
    p_rij.device_id, p_rij.connector_id, p_rij.session_key, p_rij.lap_number,
    nullif(p_rij.env->>'lapSeconds', '')::numeric,
    p_rij.driver,
    nullif(p_rij.env->>'compoundId', '')::integer,
    nullif(p_rij.env->>'tyreSet', '')::integer,
    nullif(p_rij.wear->>'fl', '')::numeric,
    nullif(p_rij.wear->>'fr', '')::numeric,
    nullif(p_rij.wear->>'rl', '')::numeric,
    nullif(p_rij.wear->>'rr', '')::numeric,
    case when p_rij.n_fl > 0 then round(p_rij.sum_fl / p_rij.n_fl, 2) end,
    case when p_rij.n_fr > 0 then round(p_rij.sum_fr / p_rij.n_fr, 2) end,
    case when p_rij.n_rl > 0 then round(p_rij.sum_rl / p_rij.n_rl, 2) end,
    case when p_rij.n_rr > 0 then round(p_rij.sum_rr / p_rij.n_rr, 2) end,
    greatest(p_rij.max_fl, p_rij.max_fr, p_rij.max_rl, p_rij.max_rr),
    nullif(p_rij.env->>'trackTempC', '')::numeric,
    nullif(p_rij.env->>'airTempC', '')::numeric,
    p_rij.env->>'rubberState',
    p_rij.n, p_rij.last_frame_at
  )
  on conflict (device_id, session_key, lap_number) do update set
    lap_seconds = excluded.lap_seconds,
    driver_name = excluded.driver_name,
    compound_id = excluded.compound_id,
    tyre_set = excluded.tyre_set,
    wear_fl = excluded.wear_fl, wear_fr = excluded.wear_fr,
    wear_rl = excluded.wear_rl, wear_rr = excluded.wear_rr,
    carc_fl = excluded.carc_fl, carc_fr = excluded.carc_fr,
    carc_rl = excluded.carc_rl, carc_rr = excluded.carc_rr,
    carc_max = excluded.carc_max,
    track_temp_c = excluded.track_temp_c,
    air_temp_c = excluded.air_temp_c,
    rubber_state = excluded.rubber_state,
    samples = excluded.samples,
    captured_at = excluded.captured_at;
end;
$$;
