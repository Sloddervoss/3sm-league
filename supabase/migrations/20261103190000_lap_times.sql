-- 0.7.4.0 — bewezen rondetijden
--
-- De connector stuurt sinds 0.7.4.0 alleen paren die hij kan bewijzen: een ronde die hij zag
-- afsluiten en een tijd die daarna binnenkwam. Deze tabel bewaart precies die paren, zonder
-- samenvoegen en zonder gokken.
--
-- Bewust een eigen tabel en niet een kolom op simhub_device_laps: die tabel heeft een sleutel
-- op (device, sessie, ronde) en is gevuld door de oude trigger, die de tijd op het
-- overgangssample schreef. Dezelfde sleutel zou een ronde van een tweede auto laten botsen en
-- de bewezen rij stil laten verliezen.

begin;

create table if not exists public.simhub_lap_times (
  device_id    uuid        not null references public.simhub_devices(id) on delete cascade,
  connector_id text        not null,
  session_key  text        not null,
  car_id       text        not null,
  lap_number   integer     not null,
  lap_seconds  numeric(9,3) not null,
  source       text        not null default 'sdk',
  captured_at  timestamptz not null default now(),
  constraint simhub_lap_times_pkey primary key (device_id, session_key, car_id, lap_number),
  constraint simhub_lap_times_lap_check check (lap_number between 1 and 100000),
  constraint simhub_lap_times_seconds_check check (lap_seconds > 0 and lap_seconds <= 86400),
  constraint simhub_lap_times_source_check check (source = 'sdk'),
  constraint simhub_lap_times_car_check check (char_length(car_id) between 1 and 64),
  constraint simhub_lap_times_session_check check (char_length(session_key) between 1 and 96)
);

create index if not exists simhub_lap_times_recent_idx
  on public.simhub_lap_times (device_id, captured_at desc);

alter table public.simhub_lap_times enable row level security;

/**
 * Neemt de bewezen paren van één frame op. De sleutel is het token: het device wordt hier
 * opgezocht, nooit door de client meegestuurd. Een rij die niet klopt kost alleen die rij.
 *
 * on conflict do nothing: de eerste bewezen waarde blijft staan. Een tweede frame met dezelfde
 * ronde is geen tweede meting en mag de eerste niet stilzwijgend overschrijven.
 */
create or replace function public.simhub_record_lap_times(p_token_hash text, p_rows jsonb)
returns integer
language plpgsql
security definer
set search_path to 'pg_catalog', 'public', 'pg_temp'
as $function$
declare
  d public.simhub_devices%rowtype;
  v_row jsonb;
  v_lap integer;
  v_seconds numeric;
  v_car text;
  v_session text;
  v_written integer := 0;
begin
  if p_token_hash is null or p_token_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'lap_times_token';
  end if;
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' then
    return 0;
  end if;
  if jsonb_array_length(p_rows) > 200 then
    raise exception 'lap_times_count';
  end if;

  select * into d from public.simhub_devices where token_hash = p_token_hash;
  if d.id is null then
    raise exception 'lap_times_device';
  end if;

  for v_row in select * from jsonb_array_elements(p_rows) loop
    begin
      if jsonb_typeof(v_row) <> 'object' then continue; end if;
      if not (v_row ? 'carId' and v_row ? 'sessionKey' and v_row ? 'lap' and v_row ? 'seconds' and v_row ? 'source') then continue; end if;
      -- NULL is geen geldige bron: `NULL <> 'sdk'` is zelf NULL en zou de rij doorlaten.
      if v_row->>'source' is distinct from 'sdk' then continue; end if;

      v_car := v_row->>'carId';
      v_session := v_row->>'sessionKey';
      if char_length(coalesce(v_car, '')) not between 1 and 64 then continue; end if;
      if char_length(coalesce(v_session, '')) not between 1 and 96 then continue; end if;

      v_lap := (v_row->>'lap')::integer;
      v_seconds := (v_row->>'seconds')::numeric;
      if v_lap is null or v_lap < 1 or v_lap > 100000 then continue; end if;
      if v_seconds is null or v_seconds <= 0 or v_seconds > 86400 then continue; end if;

      insert into public.simhub_lap_times
        (device_id, connector_id, session_key, car_id, lap_number, lap_seconds, source)
      values
        (d.id, d.connector_id, v_session, v_car, v_lap, round(v_seconds, 3), 'sdk')
      on conflict (device_id, session_key, car_id, lap_number) do nothing;

      if found then v_written := v_written + 1; end if;
    exception
      when others then
        -- Eén onbruikbare rij kost alleen die rij; het frame blijft staan.
        null;
    end;
  end loop;

  return v_written;
end;
$function$;

revoke all on function public.simhub_record_lap_times(text, jsonb) from public;
revoke all on function public.simhub_record_lap_times(text, jsonb) from anon;
revoke all on function public.simhub_record_lap_times(text, jsonb) from authenticated;
grant execute on function public.simhub_record_lap_times(text, jsonb) to service_role;

commit;
