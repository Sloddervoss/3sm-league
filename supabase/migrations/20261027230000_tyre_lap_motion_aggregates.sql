-- ============================================================================
-- Endurance — wielsnelheid en remleidingdruk per ronde in de rondesamenvatting
-- Datum: 2026-10-27
--
-- De plugin krijgt een directe iRacing-SDK-lezer die per frame `wheelSpeedKph`
-- en `brakeLinePressureBar` per hoek meelevert (naast `steeringWheelAngleDeg`,
-- `latAccelG` en `longAccelG`). Die vijf velden zitten in `vehicle` en zijn
-- optioneel; de servervalidator vult null als een connector ze niet stuurt.
--
-- Wat deze migratie doet — en waarom zo:
--   * `simhub_tyre_lap_samples` (de rondesamenvatting) krijgt drie nullable
--     kolommen: `wheel_kph`, `brake_bar` (jsonb per hoek, {min, avg, max}) en
--     `motion_samples` (aantal frames met beweging in die ronde);
--   * de aggregatie hangt aan een EIGEN accumulator (`simhub_motion_lap_accum`)
--     met een EIGEN trigger op dezelfde tabel. De bestaande trigger
--     `simhub_tyre_lap_accum_trg` en zijn functies worden NIET aangeraakt: geen
--     `create or replace` van `simhub_tyre_lap_accumulate()` of
--     `simhub_tyre_lap_flush_row()`. Een tweede AFTER-trigger op dezelfde tabel
--     is additief en kan de bestaande bandenaggregatie dus niet breken;
--     terugdraaien is één `drop trigger` plus de kolommen. Deze tabel heeft al
--     drie onafhankelijke AFTER-triggers (bandenrondes, device-laps, car specs);
--     dit is de vierde en volgt dus het bestaande patroon.
--
-- Waarom jsonb en geen 24 kolommen: min/avg/max × 4 hoeken × 2 kanalen is een
-- brede, halflege tabel. Eén jsonb per kanaal met een vaste vorm
-- {"fl":{"min":..,"avg":..,"max":..}, ...} is net zo goed te lezen in SQL
-- (->'fl'->>'avg') en houdt de tabel leesbaar.
--
-- Consistentie met de bandenaggregatie:
--   * dezelfde rondelabels (completedLaps = k hoort bij ronde k+1, dus het blok
--     wordt weggeschreven bij de overgang, met het label van de zojuist
--     afgeronde ronde);
--   * dezelfde drempel (minimaal 3 frames) — minder is geen betrouwbare ronde;
--   * dezelfde sessiesleutel (`session_id`, anders 'onbekend');
--   * dezelfde unique key (device_id, session_key, lap_number), zodat beide
--     triggers dezelfde rij vullen en elkaar niet overschrijven: de bandenflush
--     schrijft alleen zijn eigen kolommen bij een conflict, deze alleen de zijne;
--   * dezelfde fouttolerantie: `exception when others` slikt een meting in en
--     blokkeert de ingest nooit.
--
-- Metingen zonder SDK-kanalen (0.7.x-connector) leveren geen rij op: de trigger
-- doet niets als het frame geen wielsnelheid of remdruk bevat. Er wordt dus nooit
-- een 0 verzonnen voor een kanaal dat de auto niet heeft.
-- ============================================================================

begin;

-- ---------------------------------------------------------------------------
-- 1. Kolommen op de rondesamenvatting
-- ---------------------------------------------------------------------------
alter table public.simhub_tyre_lap_samples
  add column if not exists brake_bar jsonb,
  add column if not exists motion_samples integer;

comment on column public.simhub_tyre_lap_samples.brake_bar is
  'Remleidingdruk per hoek in bar over deze ronde: {"fl":{"min":..,"avg":..,"max":..}, ...}. NULL als de connector geen remdruk stuurde.';
comment on column public.simhub_tyre_lap_samples.motion_samples is
  'Aantal frames met remdruk in deze ronde. NULL bij rijen van vóór deze migratie.';

-- ---------------------------------------------------------------------------
-- 2. Eigen accumulator, los van simhub_tyre_lap_accum
-- ---------------------------------------------------------------------------
create table if not exists public.simhub_motion_lap_accum (
  device_id uuid primary key references public.simhub_devices(id) on delete cascade,
  connector_id text not null,
  session_key text not null,
  lap_number integer not null,
  n integer not null default 0,
  -- Per hoek: {"n":..,"sum":..,"min":..,"max":..}. Ruw, zodat de flush avg kan
  -- uitrekenen; de som wordt nooit als gemiddelde gepresenteerd.
  wheel jsonb,
  brake jsonb,
  last_frame_at timestamptz not null default now()
);

alter table public.simhub_motion_lap_accum enable row level security;
-- Geen policies: alleen via de trigger en de rondesamenvatting leesbaar.

-- ---------------------------------------------------------------------------
-- 3. Hulpfuncties: één meting toevoegen en de ronde samenvatten
-- ---------------------------------------------------------------------------

-- Voegt de per-frame-statistiek (n=1 per hoek) samen met wat al in de
-- accumulator staat. least()/greatest() negeren NULL, dus een ontbrekende hoek
-- in één frame wist de min/max van de andere frames niet.
create or replace function public.simhub_motion_stat_merge(p_oud jsonb, p_nieuw jsonb)
returns jsonb
language sql
immutable
set search_path = public
as $$
  select coalesce(p_oud, '{}'::jsonb) || coalesce(
    (
      select jsonb_object_agg(
        s.sleutel,
        case
          when coalesce(p_oud, '{}'::jsonb) ? s.sleutel then jsonb_build_object(
            'n',   coalesce((p_oud->s.sleutel->>'n')::numeric, 0) + coalesce((s.waarde->>'n')::numeric, 0),
            'sum', coalesce((p_oud->s.sleutel->>'sum')::numeric, 0) + coalesce((s.waarde->>'sum')::numeric, 0),
            'min', least((p_oud->s.sleutel->>'min')::numeric, (s.waarde->>'min')::numeric),
            'max', greatest((p_oud->s.sleutel->>'max')::numeric, (s.waarde->>'max')::numeric)
          )
          else s.waarde
        end
      )
      from jsonb_each(coalesce(p_nieuw, '{}'::jsonb)) as s(sleutel, waarde)
    ),
    '{}'::jsonb
  );
$$;

-- Rauwe accumulator -> presenteerbare samenvatting {min, avg, max} per hoek.
-- Hoeken zonder meting vallen weg; een leeg kanaal wordt NULL, geen leeg object.
create or replace function public.simhub_motion_stat_summary(p_stats jsonb)
returns jsonb
language sql
immutable
set search_path = public
as $$
  select jsonb_object_agg(
    s.sleutel,
    jsonb_build_object(
      'min', round((s.waarde->>'min')::numeric, 1),
      'avg', round((s.waarde->>'sum')::numeric / nullif((s.waarde->>'n')::numeric, 0), 1),
      'max', round((s.waarde->>'max')::numeric, 1)
    )
  )
  from jsonb_each(coalesce(p_stats, '{}'::jsonb)) as s(sleutel, waarde)
  where coalesce((s.waarde->>'n')::numeric, 0) > 0;
$$;

-- Schrijft de samengevatte ronde in de rondesamenvatting. Alleen de eigen
-- kolommen worden gezet, ook bij een conflict: een rij die de bandentrigger al
-- heeft aangemaakt (of andersom) blijft intact.
create or replace function public.simhub_motion_lap_flush_row(p_rij public.simhub_motion_lap_accum)
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
    device_id, connector_id, session_key, lap_number,
    brake_bar, motion_samples, captured_at
  ) values (
    p_rij.device_id, p_rij.connector_id, p_rij.session_key, p_rij.lap_number,
    public.simhub_motion_stat_summary(p_rij.brake),
    p_rij.n, p_rij.last_frame_at
  )
  on conflict (device_id, session_key, lap_number) do update set
    brake_bar = excluded.brake_bar,
    motion_samples = excluded.motion_samples;
end;
$$;

-- ---------------------------------------------------------------------------
-- 4. Trigger: per frame bijwerken, bij een rondeovergang wegschrijven
-- ---------------------------------------------------------------------------
create or replace function public.simhub_motion_lap_accumulate()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_vehicle jsonb;
  v_lap integer;
  v_sessie text;
  v_rij public.simhub_motion_lap_accum;
  v_wheel jsonb := '{}'::jsonb;
  v_brake jsonb := '{}'::jsonb;
  v_kort text;
  v_lang text;
  v_waarde jsonb;
  v_getal numeric;
begin
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

  -- Eerst de vorige ronde afronden: dit frame draagt de nieuwe ronde, en dus is
  -- dit het moment waarop de oude ronde compleet is.
  select * into v_rij from public.simhub_motion_lap_accum where device_id = new.device_id;

  if found and (v_rij.session_key <> v_sessie or v_rij.lap_number <> v_lap) then
    perform public.simhub_motion_lap_flush_row(v_rij);
    delete from public.simhub_motion_lap_accum where device_id = new.device_id;
    v_rij := null;
  end if;

  -- Per hoek de meting van dit frame klaarzetten. Zowel `frontLeft` als `fl`
  -- wordt geaccepteerd, net als in het `tyres`- en `brakes`-blok.
  for v_kort, v_lang in
    select * from (values ('fl', 'frontLeft'), ('fr', 'frontRight'), ('rl', 'rearLeft'), ('rr', 'rearRight')) as t(kort, lang)
  loop
    v_waarde := coalesce(v_vehicle#>array['wheelSpeedKph', v_lang], v_vehicle#>array['wheelSpeedKph', v_kort]);
    if jsonb_typeof(v_waarde) = 'number' then
      v_getal := (v_waarde #>> '{}')::numeric;
      v_wheel := v_wheel || jsonb_build_object(v_kort, jsonb_build_object(
        'n', 1, 'sum', v_getal, 'min', v_getal, 'max', v_getal));
    end if;

    v_waarde := coalesce(v_vehicle#>array['brakeLinePressureBar', v_lang], v_vehicle#>array['brakeLinePressureBar', v_kort]);
    if jsonb_typeof(v_waarde) = 'number' then
      v_getal := (v_waarde #>> '{}')::numeric;
      v_brake := v_brake || jsonb_build_object(v_kort, jsonb_build_object(
        'n', 1, 'sum', v_getal, 'min', v_getal, 'max', v_getal));
    end if;
  end loop;

  -- Geen SDK-kanalen in dit frame: niets optellen. Zo krijgt een 0.7.x-connector
  -- geen kunstmatige ronde met alleen nullen.
  if v_wheel = '{}'::jsonb and v_brake = '{}'::jsonb then
    return new;
  end if;

  insert into public.simhub_motion_lap_accum as a (
    device_id, connector_id, session_key, lap_number, n, wheel, brake, last_frame_at)
  values (
    new.device_id, new.connector_id, v_sessie, v_lap, 1, v_wheel, v_brake, new.captured_at)
  on conflict (device_id) do update set
    session_key = excluded.session_key,
    lap_number = excluded.lap_number,
    connector_id = excluded.connector_id,
    n = a.n + 1,
    wheel = public.simhub_motion_stat_merge(a.wheel, excluded.wheel),
    brake = public.simhub_motion_stat_merge(a.brake, excluded.brake),
    last_frame_at = greatest(a.last_frame_at, excluded.last_frame_at);

  return new;
exception
  when others then
    return new;  -- nooit de ingest blokkeren om een meting
end;
$$;

drop trigger if exists simhub_motion_lap_accum_trg on public.simhub_telemetry_latest;
create trigger simhub_motion_lap_accum_trg
  after insert or update on public.simhub_telemetry_latest
  for each row execute function public.simhub_motion_lap_accumulate();

revoke all on function public.simhub_motion_lap_flush_row(public.simhub_motion_lap_accum) from public, anon, authenticated;
revoke all on function public.simhub_motion_stat_summary(jsonb) from public, anon, authenticated;
revoke all on function public.simhub_motion_stat_merge(jsonb, jsonb) from public, anon, authenticated;

commit;
