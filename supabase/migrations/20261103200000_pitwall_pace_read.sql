-- 0.7.4.0 — leeskant voor het PACE-paneel
--
-- Het paneel vroeg om get_pitwall_pace, maar die functie bestond niet in productie: de
-- migratie van 1 november is nooit toegepast. Daardoor zei het paneel "Pace storage is
-- unavailable" en deed de hele PACE-tab niets.
--
-- Deze functie levert alleen wat er echt is:
--   * rondetijden uit simhub_lap_times (bewezen paren van de connector);
--   * geen snelheidsspoor en geen delta zolang die reeksen niet bestaan.
-- Niets wordt aangevuld, geschat of uit een andere bron geleend.

begin;

create or replace function public.get_pitwall_pace(
  p_device_id uuid,
  p_reference_id text default null,
  p_event_id uuid default null,
  p_team_id uuid default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'pg_catalog', 'public', 'auth', 'pg_temp'
as $pace$
declare
  v_device uuid := p_device_id;
  v_snapshot jsonb;
  v_updated timestamptz;
  v_session text;
  v_key text;
  v_cars jsonb;
begin
  if auth.uid() is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;

  if v_device is not null then
    -- Zelfde poort als de testpagina: alleen wie het device mag beheren.
    perform public.get_simhub_device_details(v_device);
    select v3_normalized, received_at into v_snapshot, v_updated
      from public.simhub_telemetry_latest where device_id = v_device;
  else
    -- Zelfde poort als de echte pitwall.
    perform public.get_pitwall_data(p_event_id, p_team_id);
    select device_id, v3_normalized, received_at into v_device, v_snapshot, v_updated
      from public.simhub_telemetry_latest
     where endurance_event_id = p_event_id and endurance_team_id = p_team_id
     order by received_at desc limit 1;
  end if;

  if v_snapshot is null then return null; end if;
  v_session := nullif(v_snapshot->>'transportSessionId', '');
  if v_session is null then return null; end if;

  -- Precies één sessiesleutel: de meest recente onder deze transportsessie. Twee
  -- observed-sessies onder dezelfde transport-id mogen elkaars rondes niet aanvullen.
  select t.session_key into v_key
    from public.simhub_lap_times t
   where t.device_id = v_device and t.session_key like v_session || ':%'
   order by t.captured_at desc limit 1;
  if v_key is null then
    return jsonb_build_object(
      'schemaRevision', 1, 'observedSessionId', v_session, 'segmentId', v_device::text,
      'transportSessionId', v_session, 'updatedAt', v_updated, 'cars', '[]'::jsonb);
  end if;

  select jsonb_agg(car order by car->>'id')
    into v_cars
    from (
      select jsonb_build_object(
               'id', t.car_id,
               'laps', coalesce((
                 select jsonb_agg(jsonb_build_object(
                          'id', t2.car_id || ':' || t2.lap_number,
                          'lap', t2.lap_number,
                          'seconds', t2.lap_seconds,
                          'observedSessionTimeSeconds', null,
                          'quality', 'sampled',
                          'observationId', t2.car_id || ':' || t2.session_key || ':' || t2.lap_number
                        ) order by t2.lap_number)
                   from (
                     select * from public.simhub_lap_times x
                      where x.device_id = t.device_id and x.car_id = t.car_id
                        and x.session_key = v_key
                      order by x.lap_number desc limit 20
                   ) t2
               ), '[]'::jsonb),
               'traces', '[]'::jsonb
             ) as car
        from public.simhub_lap_times t
       where t.device_id = v_device
         and t.session_key = v_key
       group by t.device_id, t.car_id
       order by t.car_id
       limit 40
    ) cars;

  return jsonb_build_object(
    'schemaRevision', 1,
    'observedSessionId', v_session,
    'segmentId', v_device::text,
    'transportSessionId', v_session,
    'updatedAt', v_updated,
    'cars', coalesce(v_cars, '[]'::jsonb)
  );
end;
$pace$;

revoke all on function public.get_pitwall_pace(uuid, text, uuid, uuid) from public;
revoke all on function public.get_pitwall_pace(uuid, text, uuid, uuid) from anon;
grant execute on function public.get_pitwall_pace(uuid, text, uuid, uuid) to authenticated;
grant execute on function public.get_pitwall_pace(uuid, text, uuid, uuid) to service_role;

commit;
