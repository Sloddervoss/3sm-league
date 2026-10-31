-- ============================================================================
-- Test voor 20261031160000_tyre_prior_variantie.sql
--
--   A. De reviewreproductie: twee gelijke eigen stints (0,5 pp per ronde) en
--      een sterk afwijkende prior (2,0 pp per ronde) waarvan de spreiding niet
--      te bepalen is. De oude code gaf hier een bereik van een paar rondes
--      (44-45 in deze fixture) omdat de prior variantie nul kreeg uit de eigen
--      tau^2. Nu: range_laps null, usable false, reden
--      prior_variatie_onbekend.
--   B. Dezelfde opzet, maar met een prior waarvan de spreiding wél te bepalen
--      is (twee meetbare stints, 2,5 en 1,5 pp per ronde). Dan is er een
--      bereik, en de breedte komt uit die spreiding: sigma = 0,25 en niet
--      0,00004.
--   C. Zonder prior blijft de band werken zoals hij werkte (de eigen tau^2).
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

create function pg_temp.frame(p_device uuid, p_session text, p_auto text,
                              p_baan text, p_at timestamptz)
returns void language sql as $$
  insert into public.simhub_telemetry_latest
    (device_id, owner_user_id, session_id, sequence, captured_at, connector_id,
     game, telemetry, car_id, car_name, track_name, track_config, v3_normalized)
  select p_device, d.owner_user_id, p_session, 1, p_at, 'test', 'IRacing',
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

do $test$
declare
  v_dev   constant uuid := '9da43e1d-1e06-42ac-9178-9532f842a353';  -- RICKY
  v_owner constant uuid := '3cf38c92-5e18-4e1b-925a-4256f17354ae';
  v_a     constant uuid := '81222914-3ad7-43db-b5eb-27c246ba1381';  -- account A
  v_b     constant uuid := '7e748fad-64a1-4fce-bc14-4f595480ff67';  -- account B
  v_t     constant timestamptz := now();
  v_e     jsonb;
  v_w     numeric;
begin
  perform set_config('request.jwt.claim.sub', v_owner::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);

  -- Twee gelijke eigen stints van negen rondes op 0,5 pp per ronde.
  perform pg_temp.blok(v_dev, 'pv-1', 1, 1,  9, 'pvcarc', 'pv:gp', 0.5, v_t - interval '25 minutes');
  perform pg_temp.blok(v_dev, 'pv-1', 2, 11, 9, 'pvcarc', 'pv:gp', 0.5, v_t - interval '25 minutes');
  perform pg_temp.frame(v_dev, 'pv-1', 'pvcarc', 'pv:gp', v_t - interval '1 minute');

  --------------------------------------------------------------------------
  -- A. Sterk afwijkende prior zonder bepaalbare spreiding
  --------------------------------------------------------------------------
  -- De auto-trap (deze auto, ander circuit) heeft twee stints van twee
  -- accounts. Alleen stint A meet de hoek die de trap kiest (fl); stint B heeft
  -- daar geen data. De spreiding over de priorstints is dus niet te bepalen.
  insert into public.tyre_prior_contrib
    (device_id, session_key, set_number, lap_from, car_key, track_key, rondes,
     sum_wear_fl, sum_wear_fr, sum_wear_rl, sum_wear_rr,
     rondes_fl, rondes_fr, rondes_rl, rondes_rr)
  values
    (v_a, 'pv-prior-a', 1, 1, 'pvcarc', 'ander:gp', 9, 18.0, 0, 0, 0, 9, 0, 0, 0),
    (v_b, 'pv-prior-b', 1, 1, 'pvcarc', 'ander:gp', 9, 0, 9.0, 0, 0, 0, 9, 0, 0);
  insert into public.tyre_prior_stats
    (car_key, track_key, stints, rondes, sum_wear_fl, sum_wear_fr, sum_wear_rl, sum_wear_rr,
     rondes_fl, rondes_fr, rondes_rl, rondes_rr)
  values ('pvcarc', 'ander:gp', 2, 18, 18.0, 9.0, 0, 0, 9, 9, 0, 0);

  v_e := public.pitwall_tyre_estimate_v2(v_dev);
  raise notice 'A: %', v_e::text;

  perform pg_temp.eis('A: de prior is gebruikt (2,0 pp per ronde naast 0,5 eigen)',
                      (v_e #>> '{basis,gedeeld,rate}')::numeric = 2.0
                      and (v_e #>> '{basis,eigen,rate}')::numeric = 0.5);
  perform pg_temp.eis('A: de spread van de prior is niet te bepalen',
                      (v_e #>> '{basis,gedeeld,spreiding_bekend}')::boolean = false
                      and v_e #>> '{basis,gedeeld,spreiding}' is null);
  perform pg_temp.eis('A: geen bereik in rondes', v_e->'range_laps' = 'null'::jsonb);
  perform pg_temp.eis('A: niet bruikbaar', (v_e->>'usable')::boolean = false);
  perform pg_temp.eis('A: de reden noemt de onbekende priorvariatie',
                      (v_e #>> '{basis,redenen}') like '%prior_variatie_onbekend%');
  perform pg_temp.eis('A: geen bandbreedte gerapporteerd',
                      v_e #>> '{basis,band,sigma}' is null);

  --------------------------------------------------------------------------
  -- B. Dezelfde opzet, maar de spreiding van de prior is wél te bepalen
  --------------------------------------------------------------------------
  -- Beide priorstints meten fl: 2,5 en 1,5 pp per ronde. De trap komt op 2,0
  -- uit, de spreiding op 0,7071. Dan hoort de band die spreiding te gebruiken:
  -- sigma = (1-w) * sd/sqrt(2) = 0,5 * 0,5 = 0,25 in plaats van 0,00004.
  update public.tyre_prior_contrib
     set sum_wear_fl = 22.5, rondes_fl = 9
   where device_id = v_a and session_key = 'pv-prior-a';
  update public.tyre_prior_contrib
     set sum_wear_fl = 13.5, rondes_fl = 9
   where device_id = v_b and session_key = 'pv-prior-b';
  update public.tyre_prior_stats
     set sum_wear_fl = 36.0, rondes_fl = 18
   where car_key = 'pvcarc' and track_key = 'ander:gp';

  v_e := public.pitwall_tyre_estimate_v2(v_dev);
  raise notice 'B: %', v_e::text;
  v_w := (v_e #>> '{basis,rondes_in_basis}')::numeric
         / ((v_e #>> '{basis,rondes_in_basis}')::numeric + 8);

  perform pg_temp.eis('B: de spread van de prior is nu bekend (~0,7071)',
                      round((v_e #>> '{basis,gedeeld,spreiding}')::numeric, 4) = 0.7071);
  perform pg_temp.eis('B: de band gebruikt die spread (sigma ~0,25)',
                      round((v_e #>> '{basis,band,sigma}')::numeric, 4) = 0.25);
  perform pg_temp.eis('B: sigma = (1-w) * spreiding/sqrt(2)',
                      round((v_e #>> '{basis,band,sigma}')::numeric, 4)
                      = round(((1 - v_w) * 0.7071 / sqrt(2))::numeric, 4));
  perform pg_temp.eis('B: er is weer een bereik', v_e->'range_laps' is not null);
  perform pg_temp.eis('B: het bereik is breed, niet 44-45',
                      (v_e #>> '{range_laps,low}')::integer <= 40
                      and (v_e #>> '{range_laps,high}')::integer >= 50);
  perform pg_temp.eis('B: bruikbaar', (v_e->>'usable')::boolean = true);
  perform pg_temp.eis('B: de reden prior_variatie_onbekend is weg',
                      (v_e #>> '{basis,redenen}') not like '%prior_variatie_onbekend%');
  perform pg_temp.eis('B: prior_n is de Kish-maat, niet het aantal stints',
                      (v_e #>> '{basis,prior_n}')::numeric between 1.9 and 2.1);
end $test$;

rollback;
