-- Poort 1: alleen vastleggen. Geen oordeel, geen setgrens.
--
-- Het frame draagt het bandenblok al (wear per hoek, vier hoektellers, trigger,
-- pitstatus, brandstof). Tot nu toe bewaarden we daar alleen `sets.used` van,
-- en die staat in de praktijk stil op 1 of is leeg. Deze tabel bewaart elke
-- waarneming zoals ze binnenkomt, met volgorde en bron, zodat we later kunnen
-- beoordelen zonder opnieuw te meten.

begin;

create table public.simhub_tyre_observations (
  id                  bigint generated always as identity primary key,
  device_id           uuid not null references public.simhub_devices(id) on delete cascade,
  -- De binding zoals hij op het moment van schrijven gold. Zonder deze twee
  -- kolommen zou een device dat later aan een ander team hangt, oude data aan
  -- dat nieuwe team laten zien.
  endurance_event_id  uuid,
  endurance_team_id   uuid,
  connector_id        text,
  connector_version   text,
  session_key         text not null,
  frame_sequence      bigint not null,
  observed_at         timestamptz,
  received_at         timestamptz not null default now(),
  session_time_seconds numeric(12,3),
  lap                 integer,
  trigger             text,
  driver_name         text,
  sets_used           integer,
  sets_available      integer,
  set_fl              integer,
  set_fr              integer,
  set_rl              integer,
  set_rr              integer,
  wear_fl             numeric(6,3),
  wear_fr             numeric(6,3),
  wear_rl             numeric(6,3),
  wear_rr             numeric(6,3),
  on_pit_road         boolean,
  fuel_litres         numeric(8,3),
  fuel_capacity_litres numeric(8,3),
  -- De ruwe waarden zoals ze binnenkwamen. Zonder dit kunnen we een latere
  -- interpretatiefout niet meer herstellen.
  raw                 jsonb not null,
  constraint simhub_tyre_observations_seq_unique unique (device_id, session_key, frame_sequence),
  constraint simhub_tyre_observations_session_key_len check (char_length(session_key) between 1 and 96),
  constraint simhub_tyre_observations_seq_nonneg check (frame_sequence >= 0),
  constraint simhub_tyre_observations_lap_range check (lap is null or (lap between 0 and 100000)),
  constraint simhub_tyre_observations_wear_range check (
    coalesce(wear_fl, 0) between 0 and 100 and coalesce(wear_fr, 0) between 0 and 100 and
    coalesce(wear_rl, 0) between 0 and 100 and coalesce(wear_rr, 0) between 0 and 100),
  constraint simhub_tyre_observations_sets_range check (
    coalesce(sets_used, 0) between 0 and 255 and coalesce(sets_available, 0) between 0 and 255 and
    coalesce(set_fl, 0) between 0 and 255 and coalesce(set_fr, 0) between 0 and 255 and
    coalesce(set_rl, 0) between 0 and 255 and coalesce(set_rr, 0) between 0 and 255),
  constraint simhub_tyre_observations_fuel_nonneg check (
    coalesce(fuel_litres, 0) >= 0 and coalesce(fuel_capacity_litres, 0) >= 0)
);

create index simhub_tyre_observations_device_session_idx
  on public.simhub_tyre_observations (device_id, session_key, frame_sequence);

alter table public.simhub_tyre_observations enable row level security;

-- Het antwoord van de crew. Apart van de waarneming: dit is een menselijke
-- bevestiging, geen meting, en ze mag nooit met terugwerkende kracht "waar"
-- worden als de meting iets anders zegt.
--
-- De sleutel is het *eerste* pitframe van het bezoek, niet het frame waarop
-- geklikt is: anders kunnen twee schermen twee antwoorden op dezelfde stop
-- zetten en wint stilzwijgend de laatste.
create table public.simhub_tyre_stop_anchors (
  id              bigint generated always as identity primary key,
  device_id       uuid not null references public.simhub_devices(id) on delete cascade,
  endurance_event_id uuid,
  endurance_team_id  uuid,
  session_key     text not null,
  visit_first_seq bigint not null,
  anchor_seq      bigint not null,
  answer          text not null,
  answered_by     uuid not null,
  answered_at     timestamptz not null default now(),
  constraint simhub_tyre_stop_anchors_answer check (answer in ('tyres', 'fuel', 'both', 'none')),
  constraint simhub_tyre_stop_anchors_unique unique (device_id, session_key, visit_first_seq)
);

alter table public.simhub_tyre_stop_anchors enable row level security;

-- Schrijven vanaf de ingest: device komt uit het token, nooit van de client.
create or replace function public.simhub_record_tyre_observations(
  p_token_hash text,
  p_rows jsonb
) returns integer
language plpgsql
security definer
set search_path to 'pg_catalog', 'public', 'pg_temp'
as $$
declare
  d public.simhub_devices%rowtype;
  v_row jsonb;
  v_count integer := 0;
begin
  if p_token_hash is null or p_token_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'Unknown device' using errcode = '28000';
  end if;
  -- Een ingetrokken of verlopen koppeling mag niets meer schrijven.
  select * into d
    from public.simhub_devices
   where token_hash = p_token_hash
     and revoked_at is null
     and (expires_at is null or expires_at > now())
   limit 1;
  if d.id is null then
    raise exception 'Unknown device' using errcode = '28000';
  end if;

  if p_rows is null or jsonb_typeof(p_rows) <> 'array' then
    return 0;
  end if;
  if jsonb_array_length(p_rows) > 200 then
    return 0;
  end if;

  for v_row in select * from jsonb_array_elements(p_rows) loop
    -- Eén kapotte waarneming kost alleen die waarneming.
    begin
      if v_row->>'sessionKey' is null or v_row->>'frameSequence' is null then
        continue;
      end if;
      insert into public.simhub_tyre_observations (
        device_id, endurance_event_id, endurance_team_id, connector_id, connector_version,
        session_key, frame_sequence, observed_at, session_time_seconds, lap, trigger, driver_name,
        sets_used, sets_available, set_fl, set_fr, set_rl, set_rr,
        wear_fl, wear_fr, wear_rl, wear_rr, on_pit_road,
        fuel_litres, fuel_capacity_litres, raw
      ) values (
        d.id, d.endurance_event_id, d.endurance_team_id,
        nullif(v_row->>'connectorId', ''),
        nullif(v_row->>'connectorVersion', ''),
        v_row->>'sessionKey',
        (v_row->>'frameSequence')::bigint,
        nullif(v_row->>'observedAt', '')::timestamptz,
        nullif(v_row->>'sessionTimeSeconds', '')::numeric,
        nullif(v_row->>'lap', '')::integer,
        nullif(v_row->>'trigger', ''),
        nullif(v_row->>'driverName', ''),
        nullif(v_row->>'setsUsed', '')::integer,
        nullif(v_row->>'setsAvailable', '')::integer,
        nullif(v_row->>'setFl', '')::integer,
        nullif(v_row->>'setFr', '')::integer,
        nullif(v_row->>'setRl', '')::integer,
        nullif(v_row->>'setRr', '')::integer,
        nullif(v_row->>'wearFl', '')::numeric,
        nullif(v_row->>'wearFr', '')::numeric,
        nullif(v_row->>'wearRl', '')::numeric,
        nullif(v_row->>'wearRr', '')::numeric,
        (v_row->>'onPitRoad')::boolean,
        nullif(v_row->>'fuelLitres', '')::numeric,
        nullif(v_row->>'fuelCapacityLitres', '')::numeric,
        coalesce(v_row->'raw', '{}'::jsonb)
      )
      on conflict (device_id, session_key, frame_sequence) do nothing;
      v_count := v_count + 1;
    exception when others then
      continue;
    end;
  end loop;

  return v_count;
end;
$$;

revoke all on function public.simhub_record_tyre_observations(text, jsonb) from public, anon, authenticated;
grant execute on function public.simhub_record_tyre_observations(text, jsonb) to service_role;

-- Lezen vanaf de pitwall.
create or replace function public.get_pitwall_tyre_stops(
  p_device_id uuid,
  p_event_id uuid default null,
  p_team_id uuid default null,
  p_limit integer default 5
) returns jsonb
language plpgsql
stable
security definer
set search_path to 'pg_catalog', 'public', 'auth', 'pg_temp'
as $$
declare
  v_device uuid := p_device_id;
  v_event uuid := p_event_id;
  v_team uuid := p_team_id;
  v_key text;
  v_limit integer := least(greatest(coalesce(p_limit, 5), 1), 20);
  v_out jsonb;
begin
  if auth.uid() is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;

  if v_device is not null then
    perform public.get_simhub_device_details(v_device);
  else
    perform public.get_pitwall_data(v_event, v_team);
    select device_id, endurance_event_id, endurance_team_id
      into v_device, v_event, v_team
      from public.simhub_telemetry_latest
     where endurance_event_id = v_event and endurance_team_id = v_team
     order by received_at desc limit 1;
  end if;
  if v_device is null then
    return jsonb_build_object('sessionKey', null, 'stops', '[]'::jsonb);
  end if;

  select session_key into v_key
    from public.simhub_tyre_observations
   where device_id = v_device
     and (v_event is null or endurance_event_id = v_event)
     and (v_team is null or endurance_team_id = v_team)
   order by received_at desc limit 1;
  if v_key is null then
    return jsonb_build_object('sessionKey', null, 'stops', '[]'::jsonb);
  end if;

  with obs as (
    select frame_sequence, lap, session_time_seconds, on_pit_road, fuel_litres
      from public.simhub_tyre_observations
     where device_id = v_device and session_key = v_key
       and (v_event is null or endurance_event_id = v_event)
       and (v_team is null or endurance_team_id = v_team)
  ),
  marks as (
    -- Alleen een expliciete `false` sluit een pitbezoek. Een onbekende pitstatus
    -- (NULL) mag een bezoek niet in tweeën knippen.
    select *, sum(case when on_pit_road is false then 1 else 0 end)
                 over (order by frame_sequence) as grp
      from obs
  ),
  stops as (
    select grp,
           min(frame_sequence) as first_seq,
           max(frame_sequence) as last_seq,
           min(lap) as lap,
           min(session_time_seconds) filter (where on_pit_road) as started_at_s,
           max(session_time_seconds) filter (where on_pit_road) as ended_at_s
      from marks
     where on_pit_road
     group by grp
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'visitKey', 'seq:' || s.first_seq,
           -- Het anker valt op het eerste pitframe: dat bestaat altijd en het
           -- verandert niet als er later nog een frame bij komt.
           'anchorSeq', s.first_seq,
           'lap', s.lap,
           'sessionTimeSeconds', s.started_at_s,
           -- Alleen een niveauverschil als beide metingen dichtbij liggen (binnen
           -- drie minuten simtijd). Anders is het verschil geen tankbeurt maar het
           -- verbruik van een lange onderbreking.
           'fuelBeforeLitres', case when fb.session_time_seconds is not null
                                      and fa.session_time_seconds is not null
                                      and fa.session_time_seconds - fb.session_time_seconds <= 180
                                    then fb.fuel_litres end,
           'fuelAfterLitres', case when fb.session_time_seconds is not null
                                     and fa.session_time_seconds is not null
                                     and fa.session_time_seconds - fb.session_time_seconds <= 180
                                   then fa.fuel_litres end,
           'answer', (select a.answer from public.simhub_tyre_stop_anchors a
                       where a.device_id = v_device and a.session_key = v_key
                         and a.visit_first_seq = s.first_seq
                         and (v_event is null or a.endurance_event_id = v_event)
                         and (v_team is null or a.endurance_team_id = v_team)
                       order by a.answered_at desc limit 1)
         ) order by s.first_seq desc), '[]'::jsonb)
    into v_out
    from (select * from stops order by first_seq desc limit v_limit) s
    left join lateral (
      select m.fuel_litres, m.session_time_seconds from marks m
       where m.frame_sequence < s.first_seq
         and m.on_pit_road is false and m.fuel_litres is not null
       order by m.frame_sequence desc limit 1) fb on true
    left join lateral (
      select m.fuel_litres, m.session_time_seconds from marks m
       where m.frame_sequence > s.last_seq
         and m.on_pit_road is false and m.fuel_litres is not null
       order by m.frame_sequence asc limit 1) fa on true;

  return jsonb_build_object('sessionKey', v_key, 'stops', v_out);
end;
$$;

revoke all on function public.get_pitwall_tyre_stops(uuid, uuid, uuid, integer) from public, anon;
grant execute on function public.get_pitwall_tyre_stops(uuid, uuid, uuid, integer) to authenticated, service_role;

-- Eén antwoord per pitbezoek. Het bezoek wordt bij het schrijven bepaald (de
-- aaneengesloten pitframes rond dit frame), zodat de sleutel niet afhangt van
-- welk frame de client toevallig zag.
create or replace function public.pitwall_tyre_stop_answer(
  p_device_id uuid,
  p_session_key text,
  p_anchor_seq bigint,
  p_answer text,
  p_event_id uuid default null,
  p_team_id uuid default null
) returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog', 'public', 'auth', 'pg_temp'
as $$
declare
  v_device uuid := p_device_id;
  v_event uuid := p_event_id;
  v_team uuid := p_team_id;
  v_uid uuid := auth.uid();
  v_first bigint;
begin
  if v_uid is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;
  if p_answer not in ('tyres', 'fuel', 'both', 'none') then
    raise exception 'Invalid answer' using errcode = '22023';
  end if;
  if p_session_key is null or p_anchor_seq is null then
    raise exception 'Missing visit' using errcode = '22023';
  end if;

  if v_device is not null then
    perform public.get_simhub_device_details(v_device);
  else
    perform public.get_pitwall_data(v_event, v_team);
    select device_id, endurance_event_id, endurance_team_id
      into v_device, v_event, v_team
      from public.simhub_telemetry_latest
     where endurance_event_id = v_event and endurance_team_id = v_team
     order by received_at desc limit 1;
    if v_device is null then
      raise exception 'No device for this pitwall' using errcode = '22023';
    end if;
  end if;

  -- Het ankerframe moet van dit device zijn, in deze sessie, een pitframe zijn,
  -- en bij een event/team-poort ook bij die binding horen.
  if not exists (
       select 1 from public.simhub_tyre_observations o
        where o.device_id = v_device
          and o.session_key = p_session_key
          and o.frame_sequence = p_anchor_seq
          and o.on_pit_road
          and (v_event is null or o.endurance_event_id = v_event)
          and (v_team is null or o.endurance_team_id = v_team)) then
    raise exception 'Unknown pit visit' using errcode = '22023';
  end if;

  -- Begin van het bezoek: het eerste pitframe sinds de laatste bewezen
  -- niet-pitwaarneming vóór dit frame.
  select min(o.frame_sequence) into v_first
    from public.simhub_tyre_observations o
   where o.device_id = v_device
     and o.session_key = p_session_key
     and o.on_pit_road
     and (v_event is null or o.endurance_event_id = v_event)
     and (v_team is null or o.endurance_team_id = v_team)
     and o.frame_sequence >= coalesce((
           select max(x.frame_sequence) from public.simhub_tyre_observations x
            where x.device_id = v_device and x.session_key = p_session_key
              and x.frame_sequence < p_anchor_seq and x.on_pit_road is false
              and (v_event is null or x.endurance_event_id = v_event)
              and (v_team is null or x.endurance_team_id = v_team)), 0)
     and o.frame_sequence <= p_anchor_seq;
  if v_first is null then
    raise exception 'Unknown pit visit' using errcode = '22023';
  end if;

  insert into public.simhub_tyre_stop_anchors
    (device_id, endurance_event_id, endurance_team_id, session_key, visit_first_seq, anchor_seq, answer, answered_by)
  values (v_device, v_event, v_team, p_session_key, v_first, p_anchor_seq, p_answer, v_uid)
  on conflict (device_id, session_key, visit_first_seq)
  do update set answer = excluded.answer, anchor_seq = excluded.anchor_seq,
                endurance_event_id = excluded.endurance_event_id,
                endurance_team_id = excluded.endurance_team_id,
                answered_by = excluded.answered_by, answered_at = now();

  return jsonb_build_object('ok', true, 'answer', p_answer);
end;
$$;

revoke all on function public.pitwall_tyre_stop_answer(uuid, text, bigint, text, uuid, uuid) from public, anon;
grant execute on function public.pitwall_tyre_stop_answer(uuid, text, bigint, text, uuid, uuid) to authenticated, service_role;

commit;
