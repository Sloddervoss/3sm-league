-- Rondearchief per apparaat, los van events.
--
-- De pitwall kon pace, stints en coureurswissels alleen tonen als er een event
-- met team was: daar hingen de rondegegevens aan. Wie gewoon aansloot en reed,
-- zag zijn rondes langskomen en daarna verdwijnen.
--
-- Deze tabel bewaart elke afgeronde ronde van elk gekoppeld apparaat. De
-- trigger leest hem uit de frames die toch al binnenkomen, dus er verandert
-- niets aan de plugin of aan de ingest.

create table if not exists public.simhub_device_laps (
  device_id uuid not null references public.simhub_devices(id) on delete cascade,
  connector_id text not null,
  session_key text not null,
  lap_number integer not null,
  lap_seconds numeric(8, 3),
  driver_name text,
  captured_at timestamptz not null default now(),
  primary key (device_id, session_key, lap_number)
);

create index if not exists simhub_device_laps_recent_idx
  on public.simhub_device_laps (device_id, captured_at desc);

alter table public.simhub_device_laps enable row level security;
-- Geen policies: alleen via security-definer-functies leesbaar.

create or replace function public.simhub_capture_lap()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_lap integer;
  v_vorige integer;
  v_tijd numeric;
  v_sessie text;
  v_driver text;
  v_device uuid;
begin
  v_lap := nullif(new.v3_normalized->'timing'->>'completedLaps', '')::integer;
  if v_lap is null or v_lap <= 0 then
    return new;
  end if;

  if tg_op = 'UPDATE' then
    v_vorige := nullif(old.v3_normalized->'timing'->>'completedLaps', '')::integer;
    if v_vorige is not null and v_lap <= v_vorige then
      return new;
    end if;
  end if;

  v_tijd := nullif(new.v3_normalized->'timing'->>'lastLapTimeSeconds', '')::numeric;
  v_sessie := coalesce(nullif(new.v3_normalized->>'transportSessionId', ''), 'onbekend');
  v_driver := nullif(new.current_driver_name, '');

  select id into v_device from public.simhub_devices where connector_id = new.connector_id;
  if v_device is null then
    return new;
  end if;

  insert into public.simhub_device_laps
    (device_id, connector_id, session_key, lap_number, lap_seconds, driver_name, captured_at)
  values
    (v_device, new.connector_id, v_sessie, v_lap, v_tijd, v_driver, coalesce(new.captured_at, now()))
  on conflict (device_id, session_key, lap_number) do nothing;

  return new;
exception
  -- Een fout hier mag nooit de telemetrie-ingest blokkeren: de ronde gaat
  -- verloren, het frame niet.
  when others then
    return new;
end;
$$;

drop trigger if exists simhub_capture_lap_trg on public.simhub_telemetry_latest;
create trigger simhub_capture_lap_trg
  after insert or update on public.simhub_telemetry_latest
  for each row execute function public.simhub_capture_lap();

-- Sandbox: dezelfde vorm, nu met de rondes die er echt zijn.
create or replace function public.pitwall_sandbox_v1(p_device_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_dev public.simhub_devices;
  v_tel public.simhub_telemetry_latest;
  v_sessie text;
  v_laps jsonb;
  v_drivers jsonb;
  v_snelste numeric;
  v_mediaan numeric;
begin
  if v_uid is null then
    raise exception 'Authentication required';
  end if;

  select * into v_dev from public.simhub_devices where id = p_device_id;
  if v_dev.id is null then
    raise exception 'Onbekend apparaat';
  end if;

  if not (public.can_manage_simhub() or v_dev.owner_user_id = v_uid) then
    raise exception 'Geen toegang tot dit apparaat';
  end if;

  select * into v_tel
  from public.simhub_telemetry_latest
  where connector_id = v_dev.connector_id;

  v_sessie := coalesce(nullif(v_tel.v3_normalized->>'transportSessionId', ''), 'onbekend');

  select coalesce(jsonb_agg(jsonb_build_object(
           'lap', l.lap_number,
           'seconds', l.lap_seconds,
           'driver', l.driver_name,
           'at', l.captured_at
         ) order by l.lap_number), '[]'::jsonb)
    into v_laps
  from public.simhub_device_laps l
  where l.device_id = p_device_id
    and l.session_key = v_sessie
    and l.lap_seconds is not null
    and l.lap_seconds between 20 and 600;

  select coalesce(jsonb_agg(distinct jsonb_build_object('name', l.driver_name)), '[]'::jsonb)
    into v_drivers
  from public.simhub_device_laps l
  where l.device_id = p_device_id
    and l.session_key = v_sessie
    and l.driver_name is not null;

  select min(l.lap_seconds), percentile_cont(0.5) within group (order by l.lap_seconds)
    into v_snelste, v_mediaan
  from public.simhub_device_laps l
  where l.device_id = p_device_id
    and l.session_key = v_sessie
    and l.lap_seconds between 20 and 600;

  return jsonb_build_object(
    'sandbox', true,
    'device', jsonb_build_object(
      'id', v_dev.id,
      'name', v_dev.device_name,
      'connector', v_dev.connector_id,
      'status', v_dev.device_status
    ),
    'team_access', true,
    'v3_normalized', coalesce(v_tel.v3_normalized, '{}'::jsonb),
    'telemetry', jsonb_build_object(
      'captured_at', v_tel.captured_at,
      'driver_name', v_tel.current_driver_name
    ),
    'lap_samples', v_laps,
    'timeline', v_laps,
    'drivers', v_drivers,
    'pace', jsonb_build_object('fastest', v_snelste, 'median', v_mediaan, 'count', jsonb_array_length(v_laps)),
    -- Wat een event nodig heeft: bewust leeg, niet geschat.
    'strategy', null,
    'planned_stints', '[]'::jsonb,
    'pace_targets', '[]'::jsonb,
    'fuel_samples', '[]'::jsonb,
    'tyre_samples', '[]'::jsonb,
    'opponent_trends', '[]'::jsonb,
    'tyre_estimate', null,
    'pit_loss', null,
    'pit_lane_seconds', null
  );
end;
$$;

revoke all on function public.pitwall_sandbox_v1(uuid) from public, anon;
grant execute on function public.pitwall_sandbox_v1(uuid) to authenticated;
