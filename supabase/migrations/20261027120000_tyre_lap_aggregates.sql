-- Rondesamenvattingen van banden, opgebouwd uit de frames die al binnenkomen.
--
-- Ruwe 1 Hz-data is te groot om te bewaren en te versturen. Wat je nodig hebt
-- om bandenslijtage te leren, is per ronde een handvol getallen: temperatuur,
-- slijtage, compound, baantemperatuur. Deze migratie laat de server dat zelf
-- berekenen terwijl de frames binnenkomen — geen pluginwijziging, geen upload.
--
-- De trigger mag de ingest nooit blokkeren: bij een fout gaat het frame door
-- en verliest hooguit één meting.

create table if not exists public.simhub_tyre_lap_accum (
  connector_id text primary key,
  session_key  text not null,
  lap_number   integer not null,
  n            integer not null default 0,
  sum_fl numeric not null default 0, max_fl numeric not null default 0,
  sum_fr numeric not null default 0, max_fr numeric not null default 0,
  sum_rl numeric not null default 0, max_rl numeric not null default 0,
  sum_rr numeric not null default 0, max_rr numeric not null default 0,
  wear jsonb,
  env  jsonb,
  driver text,
  updated_at timestamptz not null default now()
);

create table if not exists public.simhub_tyre_lap_samples (
  id bigserial primary key,
  device_id uuid references public.simhub_devices(id) on delete cascade,
  connector_id text not null,
  session_key text not null,
  lap_number integer not null,
  lap_seconds numeric(8,3),
  driver_name text,
  compound_id integer,
  tyre_set integer,
  wear_fl numeric(6,3), wear_fr numeric(6,3), wear_rl numeric(6,3), wear_rr numeric(6,3),
  carc_fl numeric(6,2), carc_fr numeric(6,2), carc_rl numeric(6,2), carc_rr numeric(6,2),
  carc_max numeric(6,2),
  track_temp_c numeric(5,2),
  air_temp_c numeric(5,2),
  rubber_state text,
  samples integer not null default 0,
  captured_at timestamptz not null default now(),
  unique (device_id, session_key, lap_number)
);

create index if not exists simhub_tyre_lap_samples_recent_idx
  on public.simhub_tyre_lap_samples (device_id, captured_at desc);

alter table public.simhub_tyre_lap_accum enable row level security;
alter table public.simhub_tyre_lap_samples enable row level security;
-- Geen policies: alleen leesbaar via security-definer-functies.

create or replace function public.simhub_tyre_lap_accumulate()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tyres jsonb;
  v_lap integer;
  v_sessie text;
  v_fl numeric; v_fr numeric; v_rl numeric; v_rr numeric;
  v_wear jsonb;
  v_env jsonb;
  v_rij public.simhub_tyre_lap_accum;
begin
  v_tyres := new.v3_normalized->'tyres';
  if v_tyres is null or jsonb_typeof(v_tyres) <> 'object' then
    return new;
  end if;

  v_lap := nullif(new.v3_normalized->'timing'->>'completedLaps', '')::integer;
  if v_lap is null or v_lap <= 0 then
    return new;
  end if;

  v_sessie := coalesce(nullif(new.v3_normalized->>'transportSessionId', ''), 'onbekend');

  -- Gemiddelde van de drie zones per hoek; ontbrekende zones tellen niet mee.
  v_fl := nullif(coalesce((v_tyres->'carcassTempC'->'fl'->>'l')::numeric,0)
               + coalesce((v_tyres->'carcassTempC'->'fl'->>'m')::numeric,0)
               + coalesce((v_tyres->'carcassTempC'->'fl'->>'r')::numeric,0), 0) / 3;
  v_fr := nullif(coalesce((v_tyres->'carcassTempC'->'fr'->>'l')::numeric,0)
               + coalesce((v_tyres->'carcassTempC'->'fr'->>'m')::numeric,0)
               + coalesce((v_tyres->'carcassTempC'->'fr'->>'r')::numeric,0), 0) / 3;
  v_rl := nullif(coalesce((v_tyres->'carcassTempC'->'rl'->>'l')::numeric,0)
               + coalesce((v_tyres->'carcassTempC'->'rl'->>'m')::numeric,0)
               + coalesce((v_tyres->'carcassTempC'->'rl'->>'r')::numeric,0), 0) / 3;
  v_rr := nullif(coalesce((v_tyres->'carcassTempC'->'rr'->>'l')::numeric,0)
               + coalesce((v_tyres->'carcassTempC'->'rr'->>'m')::numeric,0)
               + coalesce((v_tyres->'carcassTempC'->'rr'->>'r')::numeric,0), 0) / 3;

  -- Zwakste zone per hoek bepaalt de slijtage.
  v_wear := jsonb_build_object(
    'fl', least(coalesce((v_tyres->'wearPercent'->'fl'->>'l')::numeric, 100),
                coalesce((v_tyres->'wearPercent'->'fl'->>'m')::numeric, 100),
                coalesce((v_tyres->'wearPercent'->'fl'->>'r')::numeric, 100)),
    'fr', least(coalesce((v_tyres->'wearPercent'->'fr'->>'l')::numeric, 100),
                coalesce((v_tyres->'wearPercent'->'fr'->>'m')::numeric, 100),
                coalesce((v_tyres->'wearPercent'->'fr'->>'r')::numeric, 100)),
    'rl', least(coalesce((v_tyres->'wearPercent'->'rl'->>'l')::numeric, 100),
                coalesce((v_tyres->'wearPercent'->'rl'->>'m')::numeric, 100),
                coalesce((v_tyres->'wearPercent'->'rl'->>'r')::numeric, 100)),
    'rr', least(coalesce((v_tyres->'wearPercent'->'rr'->>'l')::numeric, 100),
                coalesce((v_tyres->'wearPercent'->'rr'->>'m')::numeric, 100),
                coalesce((v_tyres->'wearPercent'->'rr'->>'r')::numeric, 100)));

  v_env := jsonb_build_object(
    'trackTempC', v_tyres->'environment'->>'trackTempC',
    'airTempC', v_tyres->'environment'->>'airTempC',
    'rubberState', v_tyres->'environment'->>'rubberState',
    'compoundId', v_tyres->>'compoundId',
    'tyreSet', v_tyres->'sets'->>'used',
    'lapSeconds', new.v3_normalized->'timing'->>'lastLapTimeSeconds');

  select * into v_rij from public.simhub_tyre_lap_accum where connector_id = new.connector_id;

  if found and (v_rij.session_key <> v_sessie or v_rij.lap_number <> v_lap) then
    perform public.simhub_tyre_lap_flush_row(v_rij);
    delete from public.simhub_tyre_lap_accum where connector_id = new.connector_id;
    v_rij := null;
  end if;

  insert into public.simhub_tyre_lap_accum as a (
    connector_id, session_key, lap_number, n,
    sum_fl, max_fl, sum_fr, max_fr, sum_rl, max_rl, sum_rr, max_rr,
    wear, env, driver, updated_at)
  values (
    new.connector_id, v_sessie, v_lap, 1,
    coalesce(v_fl,0), coalesce(v_fl,0), coalesce(v_fr,0), coalesce(v_fr,0),
    coalesce(v_rl,0), coalesce(v_rl,0), coalesce(v_rr,0), coalesce(v_rr,0),
    v_wear, v_env, new.current_driver_name, now())
  on conflict (connector_id) do update set
    session_key = excluded.session_key,
    lap_number  = excluded.lap_number,
    n           = a.n + 1,
    sum_fl = a.sum_fl + excluded.sum_fl, max_fl = greatest(a.max_fl, excluded.max_fl),
    sum_fr = a.sum_fr + excluded.sum_fr, max_fr = greatest(a.max_fr, excluded.max_fr),
    sum_rl = a.sum_rl + excluded.sum_rl, max_rl = greatest(a.max_rl, excluded.max_rl),
    sum_rr = a.sum_rr + excluded.sum_rr, max_rr = greatest(a.max_rr, excluded.max_rr),
    wear = excluded.wear,
    env  = excluded.env,
    driver = coalesce(excluded.driver, a.driver),
    updated_at = now();

  return new;
exception
  when others then
    -- Nooit de ingest blokkeren om een meting.
    return new;
end;
$$;

-- Hulp voor het wegschrijven van een accumulator-regel; los van de trigger
-- zodat de flush ook handmatig of bij een sessiewissel kan worden aangeroepen.
create or replace function public.simhub_tyre_lap_flush_row(p_rij public.simhub_tyre_lap_accum)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_device uuid;
begin
  if p_rij.n <= 0 then
    return;
  end if;

  select id into v_device from public.simhub_devices where connector_id = p_rij.connector_id;

  insert into public.simhub_tyre_lap_samples (
    device_id, connector_id, session_key, lap_number, lap_seconds, driver_name,
    compound_id, tyre_set,
    wear_fl, wear_fr, wear_rl, wear_rr,
    carc_fl, carc_fr, carc_rl, carc_rr, carc_max,
    track_temp_c, air_temp_c, rubber_state, samples, captured_at
  ) values (
    v_device, p_rij.connector_id, p_rij.session_key, p_rij.lap_number,
    nullif(p_rij.env->>'lapSeconds', '')::numeric,
    p_rij.driver,
    nullif(p_rij.env->>'compoundId', '')::integer,
    nullif(p_rij.env->>'tyreSet', '')::integer,
    nullif(p_rij.wear->>'fl', '')::numeric,
    nullif(p_rij.wear->>'fr', '')::numeric,
    nullif(p_rij.wear->>'rl', '')::numeric,
    nullif(p_rij.wear->>'rr', '')::numeric,
    round(p_rij.sum_fl / p_rij.n, 2), round(p_rij.sum_fr / p_rij.n, 2),
    round(p_rij.sum_rl / p_rij.n, 2), round(p_rij.sum_rr / p_rij.n, 2),
    greatest(p_rij.max_fl, p_rij.max_fr, p_rij.max_rl, p_rij.max_rr),
    nullif(p_rij.env->>'trackTempC', '')::numeric,
    nullif(p_rij.env->>'airTempC', '')::numeric,
    p_rij.env->>'rubberState',
    p_rij.n, now()
  )
  on conflict (device_id, session_key, lap_number) do update set
    lap_seconds = excluded.lap_seconds,
    wear_fl = excluded.wear_fl, wear_fr = excluded.wear_fr,
    wear_rl = excluded.wear_rl, wear_rr = excluded.wear_rr,
    carc_fl = excluded.carc_fl, carc_fr = excluded.carc_fr,
    carc_rl = excluded.carc_rl, carc_rr = excluded.carc_rr,
    carc_max = excluded.carc_max,
    samples = excluded.samples;
end;
$$;

drop trigger if exists simhub_tyre_lap_accum_trg on public.simhub_telemetry_latest;
create trigger simhub_tyre_lap_accum_trg
  after insert or update on public.simhub_telemetry_latest
  for each row execute function public.simhub_tyre_lap_accumulate();

revoke all on function public.simhub_tyre_lap_flush_row(public.simhub_tyre_lap_accum) from public, anon, authenticated;

-- Dekking per apparaat: hoeveel rondes met bandendata zijn er al.
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
  left join public.simhub_devices d on d.id = s.device_id
  group by s.device_id, d.device_name
  order by max(s.captured_at) desc;
$$;

revoke all on function public.tyre_data_coverage() from public, anon;
grant execute on function public.tyre_data_coverage() to authenticated;
