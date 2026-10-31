-- ============================================================================
-- Test voor 20261031160200_pitwall_context_onbekend.sql
--
--   A. Een frame met een sessie maar zonder auto- of baansleutel: de stand is
--      vers en hoort bij de lopende set, maar de identiteit is onbekend. De
--      oude code gaf hier usable = true; nu is usable false, range_laps null en
--      staat context_onbekend in basis.redenen.
--   B. Dezelfde opzet met een compleet frame: wel bruikbaar. Zo bewijst de test
--      dat de nieuwe poort blokkeert, en niet iets anders.
--
-- Draai als één transactie met ROLLBACK.
-- ============================================================================

begin;

create function pg_temp.eis(p_naam text, p_ok boolean) returns void
language plpgsql as $$
begin
  if p_ok is not true then
    raise exception 'FAIL: %', p_naam;
  end if;
  raise notice 'PASS: %', p_naam;
end $$;

create function pg_temp.blok(p_device uuid, p_session text, p_set integer,
                             p_van integer, p_rondes integer,
                             p_auto text, p_baan text, p_rate numeric,
                             p_start timestamptz)
returns void language sql as $$
  insert into public.simhub_tyre_lap_samples
    (device_id, connector_id, session_key, lap_number, tyre_set,
     wear_fl, wear_fr, wear_rl, wear_rr, car_key, track_key, captured_at)
  select p_device, 'test', p_session, p_van + n - 1, p_set,
         100 - n * p_rate, 100 - n * p_rate, 100 - n * p_rate, 100 - n * p_rate,
         p_auto, p_baan, p_start + ((p_van + n - 1) || ' minutes')::interval
    from generate_series(1, p_rondes) as x(n);
$$;

do $test$
declare
  v_dev   constant uuid := '9da43e1d-1e06-42ac-9178-9532f842a353';  -- RICKY
  v_owner constant uuid := '3cf38c92-5e18-4e1b-925a-4256f17354ae';
  v_t     constant timestamptz := now();
  v_e     jsonb;
begin
  perform set_config('request.jwt.claim.sub', v_owner::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);

  -- Twee gesloten stints op deze combinatie en een lopende stint van één ronde
  -- die de huidige set draagt.
  perform pg_temp.blok(v_dev, 'co-1', 1, 1,  9, 'cocarc', 'co:gp', 0.5, v_t - interval '25 minutes');
  perform pg_temp.blok(v_dev, 'co-1', 2, 11, 9, 'cocarc', 'co:gp', 0.5, v_t - interval '25 minutes');
  perform pg_temp.blok(v_dev, 'co-1', 3, 21, 1, 'cocarc', 'co:gp', 0,   v_t - interval '5 minutes');

  --------------------------------------------------------------------------
  -- A. Frame met sessie, zonder identiteit
  --------------------------------------------------------------------------
  insert into public.simhub_telemetry_latest
    (device_id, owner_user_id, session_id, sequence, captured_at, connector_id,
     game, telemetry, car_id, car_name, track_name, track_config, v3_normalized)
  values (v_dev, v_owner, 'co-1', 1, v_t - interval '1 minute', 'test', 'IRacing',
          '{}'::jsonb, null, null, null, null, '{}'::jsonb)
  on conflict (device_id) do update set
    session_id = excluded.session_id,
    captured_at = excluded.captured_at,
    car_id = null, car_name = null, track_name = null, track_config = null,
    v3_normalized = '{}'::jsonb;

  v_e := public.pitwall_tyre_estimate_v2(v_dev);
  raise notice 'A: %', v_e::text;

  perform pg_temp.eis('A: de context is als onbekend gemarkeerd',
                      (v_e #>> '{basis,context,onbekend}')::boolean = true
                      and v_e #>> '{basis,context,car_key}' is null
                      and v_e #>> '{basis,context,track_key}' is null);
  perform pg_temp.eis('A: niet bruikbaar zonder bekende auto en baan',
                      (v_e->>'usable')::boolean = false);
  perform pg_temp.eis('A: geen bereik in rondes', v_e->'range_laps' = 'null'::jsonb);
  perform pg_temp.eis('A: de reden noemt de onbekende context',
                      (v_e #>> '{basis,redenen}') like '%context_onbekend%');
  perform pg_temp.eis('A: de meting zelf is wel vers (de poort is de identiteit)',
                      (v_e #>> '{basis,actualiteit,vers}')::boolean = true);

  --------------------------------------------------------------------------
  -- B. Controle: met een compleet frame is hetzelfde apparaat wél bruikbaar
  --------------------------------------------------------------------------
  update public.simhub_telemetry_latest
     set car_id = 'cocarc', car_name = 'cocarc',
         track_name = 'co', track_config = 'gp',
         v3_normalized = jsonb_build_object(
           'identity', jsonb_build_object(
             'carId', 'cocarc', 'carName', 'cocarc',
             'trackId', 'co', 'trackName', 'co', 'trackConfig', 'gp'))
   where device_id = v_dev;

  v_e := public.pitwall_tyre_estimate_v2(v_dev);
  raise notice 'B: %', v_e::text;

  perform pg_temp.eis('B: de context is bekend',
                      (v_e #>> '{basis,context,onbekend}')::boolean = false
                      and v_e #>> '{basis,context,car_key}' = 'cocarc'
                      and v_e #>> '{basis,context,track_key}' = 'co:gp');
  perform pg_temp.eis('B: met een compleet frame is het advies bruikbaar',
                      (v_e->>'usable')::boolean = true and v_e->'range_laps' is not null);
  perform pg_temp.eis('B: de reden context_onbekend is weg',
                      (v_e #>> '{basis,redenen}') not like '%context_onbekend%');
end $test$;

rollback;
