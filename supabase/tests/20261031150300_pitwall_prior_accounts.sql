-- ============================================================================
-- Test voor 20261031150300_pitwall_prior_accounts.sql
--
--   A. Twee cellen in dezelfde trap met respectievelijk twee en drie eigenaren:
--      de kern faalt niet meer op ongelijke arrays (voorheen:
--      "cannot accumulate arrays of different dimensionality") en de
--      accounttelling is de som van de verschillende eigenaren (delta 5).
--   B. De gevraagde cel is exact publiceerbaar (2 accounts) en de bredere
--      trap bevat beide cellen (level = auto).
--   C. pitwall_tyre_estimate_v2 sluit alle apparaten van de eigenaar uit: met
--      twee eigen apparaten en één andere deelnemer blijft de cel niet
--      publiceerbaar (thin_pool), terwijl de oude regel (één apparaat) hem
--      wel publiceert.
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
  select p_device, 'test', p_session, p_van + g - 1, p_set,
         100 - g * p_rate, 100 - g * p_rate, 100 - g * p_rate, 100 - g * p_rate,
         p_auto, p_baan, p_start + ((p_van + g - 1) || ' minutes')::interval
    from generate_series(1, p_rondes) g;
$$;

create function pg_temp.frame(p_device uuid, p_session text, p_auto text,
                              p_baan text, p_at timestamptz)
returns void language sql as $$
  insert into public.simhub_telemetry_latest
    (device_id, owner_user_id, session_id, sequence, captured_at, connector_id,
     game, telemetry, car_id, car_name, track_name, track_config, v3_normalized)
  select p_device, d.owner_user_id, p_session, 1, p_at, 'test', 'iracing',
         '{}'::jsonb, p_auto, p_auto,
         split_part(p_baan, ':', 1), split_part(p_baan, ':', 2), '{}'::jsonb
    from public.simhub_devices d
   where d.id = p_device
  on conflict (device_id) do update set
    owner_user_id = excluded.owner_user_id,
    session_id = excluded.session_id,
    captured_at = excluded.captured_at,
    car_id = excluded.car_id,
    car_name = excluded.car_name,
    track_name = excluded.track_name,
    track_config = excluded.track_config,
    v3_normalized = excluded.v3_normalized;
$$;

-- Eén stintbijdrage met een vlakke helling in alle vier hoeken.
create function pg_temp.bijdrage(p_device uuid, p_session text, p_set integer,
                                 p_lap integer, p_auto text, p_baan text,
                                 p_rondes integer, p_rate numeric)
returns void language sql as $$
  insert into public.tyre_prior_contrib
    (device_id, session_key, set_number, lap_from, car_key, track_key, rondes,
     sum_wear_fl, sum_wear_fr, sum_wear_rl, sum_wear_rr,
     rondes_fl, rondes_fr, rondes_rl, rondes_rr, bijgewerkt_op)
  values (p_device, p_session, p_set, p_lap, p_auto, p_baan, p_rondes,
          p_rate * p_rondes, p_rate * p_rondes, p_rate * p_rondes, p_rate * p_rondes,
          p_rondes, p_rondes, p_rondes, p_rondes, now());
$$;

do $test$
declare
  -- apparaten en eigenaren uit de echte installatie
  v_pcbart  constant uuid := '8ea3fe36-c973-43ca-abcb-971420f5b81d';  -- e8626c79
  v_desktop constant uuid := '7e748fad-64a1-4fce-bc14-4f595480ff67';  -- 4ccda410
  v_ricky   constant uuid := '9da43e1d-1e06-42ac-9178-9532f842a353';  -- 3cf38c92
  v_gr4n    constant uuid := '81222914-3ad7-43db-b5eb-27c246ba1381';  -- 137e6307
  v_cat     constant uuid := '290fe152-5789-448c-8420-8deb3cf3077f';  -- 103daeb3 (leeg)
  v_cat2    constant uuid := '812d9ad3-59ac-4e0a-85dd-0b88bc663b10';  -- 103daeb3 (leeg)
  v_owner_cat constant uuid := '103daeb3-9f46-4d79-a0a1-c460e43ed3b7';
  v_t       constant timestamptz := now();
  v_base    jsonb;
  v_c       jsonb;
  v_e       jsonb;
begin
  perform set_config('request.jwt.claim.sub', v_owner_cat::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);

  -- De nulmeting: dezelfde vraag zonder de testcellen. Zo is de deltatoets
  -- onafhankelijk van wat er verder in de echte pool staat.
  v_base := public.tyre_prior_core('testcar', 'tx:gp', '{}'::uuid[]);
  raise notice 'nulmeting: %', v_base->>'accounts';

  --------------------------------------------------------------------------
  -- A. Twee cellen met 2 en 3 eigenaren in dezelfde trap
  --------------------------------------------------------------------------
  perform pg_temp.bijdrage(v_desktop, 'tp1', 1, 1, 'testcar', 't1:gp', 9, 0.40);
  perform pg_temp.bijdrage(v_pcbart,  'tp2', 1, 1, 'testcar', 't1:gp', 9, 0.40);
  perform pg_temp.bijdrage(v_ricky,   'tp3', 1, 1, 'testcar', 't2:gp', 9, 0.35);
  perform pg_temp.bijdrage(v_gr4n,    'tp4', 1, 1, 'testcar', 't2:gp', 9, 0.35);
  perform pg_temp.bijdrage(v_cat,     'tp5', 1, 1, 'testcar', 't2:gp', 9, 0.35);

  insert into public.tyre_prior_stats
    (car_key, track_key, stints, rondes, sum_wear_fl, sum_wear_fr, sum_wear_rl,
     sum_wear_rr, rondes_fl, rondes_fr, rondes_rl, rondes_rr, bijgewerkt_op)
  values
    ('testcar', 't1:gp', 2, 18, 7.2, 7.2, 7.2, 7.2, 18, 18, 18, 18, now()),
    ('testcar', 't2:gp', 3, 27, 9.45, 9.45, 9.45, 9.45, 27, 27, 27, 27, now());

  -- Beide cellen vallen bij deze vraag in dezelfde trap (auto).
  v_c := public.tyre_prior_core('testcar', 'tx:gp', '{}'::uuid[]);
  raise notice 'na testcellen: %', v_c;

  perform pg_temp.eis('A: twee cellen met 2 en 3 eigenaren falen niet meer',
                      v_c is not null and (v_c->>'rate') is not null);
  perform pg_temp.eis('A: de accounttelling is relationeel en telt beide cellen',
                      (v_c->>'accounts')::integer >= 5
                      and (v_c->>'accounts')::integer
                          <= coalesce((v_base->>'accounts')::integer, 0) + 5);
  perform pg_temp.eis('A: beide cellen dragen vijf stints en 45 rondes bij',
                      (v_c->>'stints')::integer >= 5
                      and (v_c->>'rondes')::integer >= 45);
  perform pg_temp.eis('A: de trap is auto (beide cellen op andere circuits)',
                      v_c->>'level' = 'auto');

  --------------------------------------------------------------------------
  -- B. De exacte cel met twee eigenaren is publiceerbaar
  --------------------------------------------------------------------------
  v_c := public.tyre_prior_core('testcar', 't1:gp', '{}'::uuid[]);
  perform pg_temp.eis('B: de exacte cel met 2 eigenaren is publiceerbaar',
                      (v_c->>'publicatie')::boolean and v_c->>'level' = 'exact');
  perform pg_temp.eis('B: de exacte trap weegt het zwaarst in de blend (0,40 boven 0,35)',
                      (v_c->>'rate')::numeric between 0.38 and 0.39);

  --------------------------------------------------------------------------
  -- C. v2 sluit alle apparaten van de eigenaar uit
  --------------------------------------------------------------------------
  perform pg_temp.blok(v_cat, 'pv', 1, 1,  10, 'privx', 'p:gp', 0.4, v_t - interval '25 minutes');
  perform pg_temp.blok(v_cat, 'pv', 2, 11, 1,  'privx', 'p:gp', 0,   v_t - interval '5 minutes');
  perform pg_temp.frame(v_cat, 'pv', 'privx', 'p:gp', v_t - interval '1 minute');

  perform pg_temp.bijdrage(v_cat,      'pv',  1, 1, 'privx', 'p:gp', 9, 0.40);
  perform pg_temp.bijdrage(v_cat2,     'pv2', 1, 1, 'privx', 'p:gp', 9, 0.40);
  perform pg_temp.bijdrage(v_desktop,  'pv3', 1, 1, 'privx', 'p:gp', 9, 0.40);

  insert into public.tyre_prior_stats
    (car_key, track_key, stints, rondes, sum_wear_fl, sum_wear_fr, sum_wear_rl,
     sum_wear_rr, rondes_fl, rondes_fr, rondes_rl, rondes_rr, bijgewerkt_op)
  values ('privx', 'p:gp', 3, 27, 10.8, 10.8, 10.8, 10.8, 27, 27, 27, 27, now());

  -- De oude regel: alleen het gevraagde apparaat eraf -> twee accounts over.
  v_c := public.tyre_prior_core('privx', 'p:gp',
                                array[v_cat]::uuid[]);
  perform pg_temp.eis('C: met alleen het eigen apparaat uitgesloten is de cel publiceerbaar (2 accounts)',
                      (v_c->>'publicatie')::boolean);

  -- De nieuwe regel: alle apparaten van de eigenaar eraf -> één account.
  v_c := public.tyre_prior_core('privx', 'p:gp',
                                array[v_cat, v_cat2]::uuid[]);
  perform pg_temp.eis('C: met beide eigen apparaten uitgesloten is de cel niet publiceerbaar',
                      not (v_c->>'publicatie')::boolean
                      and (v_c->>'thin_pool')::boolean);

  v_e := public.pitwall_tyre_estimate_v2(v_cat);
  perform pg_temp.eis('C: v2 sluit alle eigen apparaten uit en meldt thin_pool',
                      (v_e #> '{basis,redenen}') ? 'thin_pool');
end $test$;

rollback;
