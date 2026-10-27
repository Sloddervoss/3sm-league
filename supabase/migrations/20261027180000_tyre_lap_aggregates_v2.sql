-- Correctie op 20261027120000: de eerste versie middelde karkastemperaturen
-- die alleen bij een pitstop verversen, deelde door een vaste 3 ook als zones
-- ontbraken, en hing samples aan een willekeurige apparaatrij.
--
-- Wat echt live is (bevestigd op de payload): vehicle.<hoek>.temperature is de
-- oppervlaktetemperatuur, 1 Hz. wearPercent en carcassTempC verversen alleen in
-- de pitstraat. Daarom aggregeert deze versie temperatuur per ronde en bewaart
-- slijtage als snapshot, niet als gemiddelde.
--
-- De telling loopt over de ronde die nog bezig is: bij completedLaps = k zijn we
-- in ronde k+1. Het blok wordt weggeschreven bij de overgang, met het label van
-- de zojuist afgeronde ronde en de bijbehorende rondetijd.

drop trigger if exists simhub_tyre_lap_accum_trg on public.simhub_telemetry_latest;
drop function if exists public.tyre_data_coverage();
drop function if exists public.tyre_rounds_for_device(uuid, integer);
drop function if exists public.simhub_tyre_lap_flush_row(public.simhub_tyre_lap_accum);
drop function if exists public.simhub_tyre_lap_accumulate();
drop table if exists public.simhub_tyre_lap_samples;
drop table if exists public.simhub_tyre_lap_accum;

create table public.simhub_tyre_lap_samples (
  id bigserial primary key,
  device_id uuid not null references public.simhub_devices(id) on delete cascade,
  connector_id text not null,
  session_key text not null,
  lap_number integer not null,
  lap_seconds numeric(8,3),
  driver_name text,
  compound_id integer,
  tyre_set integer,
  wear_fl numeric(6,3), wear_fr numeric(6,3), wear_rl numeric(6,3), wear_rr numeric(6,3),
  surf_fl numeric(6,2), surf_fr numeric(6,2), surf_rl numeric(6,2), surf_rr numeric(6,2),
  surf_max numeric(6,2),
  track_temp_c numeric(5,2),
  air_temp_c numeric(5,2),
  rubber_state text,
  samples integer not null default 0,
  captured_at timestamptz not null,
  constraint simhub_tyre_lap_samples_uniq unique (device_id, session_key, lap_number)
);

create index simhub_tyre_lap_samples_recent_idx
  on public.simhub_tyre_lap_samples (device_id, captured_at desc);

alter table public.simhub_tyre_lap_samples enable row level security;
-- Geen policies: leesbaar via tyre_rounds_for_device().

create table public.simhub_tyre_lap_accum (
  device_id uuid primary key,
  connector_id text not null,
  session_key text not null,
  lap_number integer not null,
  n integer not null default 0,
  n_fl integer not null default 0, sum_fl numeric not null default 0, max_fl numeric not null default 0,
  n_fr integer not null default 0, sum_fr numeric not null default 0, max_fr numeric not null default 0,
  n_rl integer not null default 0, sum_rl numeric not null default 0, max_rl numeric not null default 0,
  n_rr integer not null default 0, sum_rr numeric not null default 0, max_rr numeric not null default 0,
  wear jsonb,
  env jsonb,
  driver text,
  last_frame_at timestamptz not null default now()
);

alter table public.simhub_tyre_lap_accum enable row level security;

create or replace function public.simhub_tyre_lap_flush_row(p_rij public.simhub_tyre_lap_accum)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_rij.n < 3 then
    return;  -- te weinig frames: geen betrouwbare ronde
  end if;

  insert into public.simhub_tyre_lap_samples (
    device_id, connector_id, session_key, lap_number, lap_seconds, driver_name,
    compound_id, tyre_set, wear_fl, wear_fr, wear_rl, wear_rr,
    surf_fl, surf_fr, surf_rl, surf_rr, surf_max,
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
    surf_fl = excluded.surf_fl, surf_fr = excluded.surf_fr,
    surf_rl = excluded.surf_rl, surf_rr = excluded.surf_rr,
    surf_max = excluded.surf_max,
    track_temp_c = excluded.track_temp_c,
    air_temp_c = excluded.air_temp_c,
    rubber_state = excluded.rubber_state,
    samples = excluded.samples,
    captured_at = excluded.captured_at;
end;
$$;

create or replace function public.simhub_tyre_lap_accumulate()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_vehicle jsonb;
  v_tyres jsonb;
  v_lap integer;
  v_sessie text;
  v_rij public.simhub_tyre_lap_accum;
begin
  -- Zonder voertuigblok valt er niets te middelen; slijtage alleen is te weinig.
  v_vehicle := new.v3_normalized->'vehicle';
  if v_vehicle is null or jsonb_typeof(v_vehicle) <> 'object' then
    return new;
  end if;

  if new.device_id is null then
    return new;
  end if;

  v_lap := nullif(new.v3_normalized->'timing'->>'completedLaps', '')::integer;
  if v_lap is null or v_lap < 1 then
    return new;
  end if;

  v_sessie := coalesce(nullif(new.session_id, ''), 'onbekend');

  -- Frames met completedLaps = k horen bij ronde k+1.
  v_lap := v_lap + 1;

  select * into v_rij from public.simhub_tyre_lap_accum where device_id = new.device_id;

  if found and (v_rij.session_key <> v_sessie or v_rij.lap_number <> v_lap) then
    -- De rondetijd van de zojuist afgeronde ronde zit in dit frame, niet in het
    -- laatste frame van die ronde (dat nog de tijd van de vorige ronde droeg).
    v_rij.env := jsonb_set(coalesce(v_rij.env, '{}'::jsonb), '{lapSeconds}',
                 to_jsonb(new.v3_normalized->'timing'->>'lastLapTimeSeconds'));
    perform public.simhub_tyre_lap_flush_row(v_rij);
    delete from public.simhub_tyre_lap_accum where device_id = new.device_id;
    v_rij := null;
  end if;

  v_tyres := new.v3_normalized->'tyres';

  insert into public.simhub_tyre_lap_accum as a (
    device_id, connector_id, session_key, lap_number, n,
    n_fl, sum_fl, max_fl, n_fr, sum_fr, max_fr,
    n_rl, sum_rl, max_rl, n_rr, sum_rr, max_rr,
    wear, env, driver, last_frame_at)
  values (
    new.device_id, new.connector_id, v_sessie, v_lap, 1,
    case when (v_vehicle->'frontLeft'->>'temperature') is not null then 1 else 0 end,
    coalesce((v_vehicle->'frontLeft'->>'temperature')::numeric, 0),
    coalesce((v_vehicle->'frontLeft'->>'temperature')::numeric, 0),
    case when (v_vehicle->'frontRight'->>'temperature') is not null then 1 else 0 end,
    coalesce((v_vehicle->'frontRight'->>'temperature')::numeric, 0),
    coalesce((v_vehicle->'frontRight'->>'temperature')::numeric, 0),
    case when (v_vehicle->'rearLeft'->>'temperature') is not null then 1 else 0 end,
    coalesce((v_vehicle->'rearLeft'->>'temperature')::numeric, 0),
    coalesce((v_vehicle->'rearLeft'->>'temperature')::numeric, 0),
    case when (v_vehicle->'rearRight'->>'temperature') is not null then 1 else 0 end,
    coalesce((v_vehicle->'rearRight'->>'temperature')::numeric, 0),
    coalesce((v_vehicle->'rearRight'->>'temperature')::numeric, 0),
    jsonb_build_object(
      'fl', least((v_tyres->'wearPercent'->'fl'->>'l')::numeric,
                  (v_tyres->'wearPercent'->'fl'->>'m')::numeric,
                  (v_tyres->'wearPercent'->'fl'->>'r')::numeric,
                  (v_vehicle->'frontLeft'->>'wearPercent')::numeric),
      'fr', least((v_tyres->'wearPercent'->'fr'->>'l')::numeric,
                  (v_tyres->'wearPercent'->'fr'->>'m')::numeric,
                  (v_tyres->'wearPercent'->'fr'->>'r')::numeric,
                  (v_vehicle->'frontRight'->>'wearPercent')::numeric),
      'rl', least((v_tyres->'wearPercent'->'rl'->>'l')::numeric,
                  (v_tyres->'wearPercent'->'rl'->>'m')::numeric,
                  (v_tyres->'wearPercent'->'rl'->>'r')::numeric,
                  (v_vehicle->'rearLeft'->>'wearPercent')::numeric),
      'rr', least((v_tyres->'wearPercent'->'rr'->>'l')::numeric,
                  (v_tyres->'wearPercent'->'rr'->>'m')::numeric,
                  (v_tyres->'wearPercent'->'rr'->>'r')::numeric,
                  (v_vehicle->'rearRight'->>'wearPercent')::numeric)),
    jsonb_build_object(
      'trackTempC', v_tyres->'environment'->>'trackTempC',
      'airTempC', v_tyres->'environment'->>'airTempC',
      'rubberState', v_tyres->'environment'->>'rubberState',
      'compoundId', v_tyres->>'compoundId',
      'tyreSet', v_tyres->'sets'->>'used',
      'lapSeconds', new.v3_normalized->'timing'->>'lastLapTimeSeconds'),
    new.current_driver_name, new.captured_at)
  on conflict (device_id) do update set
    session_key = excluded.session_key,
    lap_number  = excluded.lap_number,
    connector_id = excluded.connector_id,
    n = a.n + 1,
    n_fl = a.n_fl + excluded.n_fl,
    sum_fl = a.sum_fl + excluded.sum_fl, max_fl = greatest(a.max_fl, excluded.max_fl),
    n_fr = a.n_fr + excluded.n_fr,
    sum_fr = a.sum_fr + excluded.sum_fr, max_fr = greatest(a.max_fr, excluded.max_fr),
    n_rl = a.n_rl + excluded.n_rl,
    sum_rl = a.sum_rl + excluded.sum_rl, max_rl = greatest(a.max_rl, excluded.max_rl),
    n_rr = a.n_rr + excluded.n_rr,
    sum_rr = a.sum_rr + excluded.sum_rr, max_rr = greatest(a.max_rr, excluded.max_rr),
    wear = coalesce(excluded.wear, a.wear),
    env  = coalesce(excluded.env, a.env),
    driver = coalesce(excluded.driver, a.driver),
    last_frame_at = greatest(a.last_frame_at, excluded.last_frame_at);

  return new;
exception
  when others then
    return new;  -- nooit de ingest blokkeren om een meting
end;
$$;

create trigger simhub_tyre_lap_accum_trg
  after insert or update on public.simhub_telemetry_latest
  for each row execute function public.simhub_tyre_lap_accumulate();

revoke all on function public.simhub_tyre_lap_flush_row(public.simhub_tyre_lap_accum) from public, anon, authenticated;

-- Alleen eigen (of beheerde) apparaten: geen apparaatnamen van andere teams.
create or replace function public.tyre_data_coverage()
returns table (
  device_id uuid,
  device_name text,
  sessions bigint,
  laps bigint,
  met_wear bigint,
  laatste timestamptz
)
language sql
security definer
set search_path = public
stable
as $$
  select s.device_id,
         d.device_name,
         count(distinct s.session_key),
         count(*),
         count(*) filter (where s.wear_fl is not null),
         max(s.captured_at)
  from public.simhub_tyre_lap_samples s
  join public.simhub_devices d on d.id = s.device_id
  where d.owner_user_id = auth.uid() or public.can_manage_simhub()
  group by s.device_id, d.device_name
  order by max(s.captured_at) desc;
$$;

revoke all on function public.tyre_data_coverage() from public, anon;
grant execute on function public.tyre_data_coverage() to authenticated;

-- Rondes van één apparaat, met dezelfde eigendomscheck.
create or replace function public.tyre_rounds_for_device(p_device_id uuid, p_limit integer default 200)
returns setof public.simhub_tyre_lap_samples
language sql
security definer
set search_path = public
stable
as $$
  select s.*
  from public.simhub_tyre_lap_samples s
  join public.simhub_devices d on d.id = s.device_id
  where s.device_id = p_device_id
    and (d.owner_user_id = auth.uid() or public.can_manage_simhub())
  order by s.captured_at desc
  limit least(coalesce(p_limit, 200), 1000);
$$;

revoke all on function public.tyre_rounds_for_device(uuid, integer) from public, anon;
grant execute on function public.tyre_rounds_for_device(uuid, integer) to authenticated;
