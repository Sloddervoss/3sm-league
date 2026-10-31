-- ============================================================================
-- Test voor 20261031160100_tyre_prior_n_eindgewichten.sql
--
-- Het tegenvoorbeeld uit de review: twee exacte stints van negen rondes en
-- twintig autotrappstints van negen rondes, van andere accounts.
--
--   oude code (w_trap x rondes):        21,854248
--   Kish van de eindgewichten:           4,092010
--
-- De test toetst de nieuwe waarde zelf (4,09), niet alleen een bovengrens.
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

do $test$
declare
  v_dev   constant uuid := '9da43e1d-1e06-42ac-9178-9532f842a353';  -- RICKY (vraagt)
  v_owner constant uuid := '3cf38c92-5e18-4e1b-925a-4256f17354ae';
  v_a     constant uuid := '81222914-3ad7-43db-b5eb-27c246ba1381';  -- account A
  v_b     constant uuid := '7e748fad-64a1-4fce-bc14-4f595480ff67';  -- account B
  v_t     constant timestamptz := now();
  v_prior jsonb;
  v_e     jsonb;
begin
  perform set_config('request.jwt.claim.sub', v_owner::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);

  -- De prior van twee andere accounts: 2 exacte stints + 20 autotrappstints,
  -- alle van negen rondes en alle met dezelfde helling (0,5 pp per ronde).
  insert into public.tyre_prior_contrib
    (device_id, session_key, set_number, lap_from, car_key, track_key, rondes,
     sum_wear_fl, sum_wear_fr, sum_wear_rl, sum_wear_rr,
     rondes_fl, rondes_fr, rondes_rl, rondes_rr)
  values
    (v_a, 'pn-exact-a', 1, 1,  'pncarc', 'pn:gp', 9, 4.5, 4.0, 3.0, 3.0, 9, 9, 9, 9),
    (v_b, 'pn-exact-b', 1, 11, 'pncarc', 'pn:gp', 9, 4.5, 4.0, 3.0, 3.0, 9, 9, 9, 9);

  insert into public.tyre_prior_contrib
    (device_id, session_key, set_number, lap_from, car_key, track_key, rondes,
     sum_wear_fl, sum_wear_fr, sum_wear_rl, sum_wear_rr,
     rondes_fl, rondes_fr, rondes_rl, rondes_rr)
  select case when x.n % 2 = 1 then v_a else v_b end,
         'pn-auto-' || x.n, 1, 1, 'pncarc', 'pn:baan' || ((x.n + 1) / 2), 9,
         4.5, 4.0, 3.0, 3.0, 9, 9, 9, 9
    from generate_series(1, 20) as x(n);

  insert into public.tyre_prior_stats
    (car_key, track_key, stints, rondes, sum_wear_fl, sum_wear_fr, sum_wear_rl, sum_wear_rr,
     rondes_fl, rondes_fr, rondes_rl, rondes_rr)
  values ('pncarc', 'pn:gp', 2, 18, 9.0, 8.0, 6.0, 6.0, 18, 18, 18, 18);

  insert into public.tyre_prior_stats
    (car_key, track_key, stints, rondes, sum_wear_fl, sum_wear_fr, sum_wear_rl, sum_wear_rr,
     rondes_fl, rondes_fr, rondes_rl, rondes_rr)
  select 'pncarc', 'pn:baan' || x.n, 2, 18, 9.0, 8.0, 6.0, 6.0, 18, 18, 18, 18
    from generate_series(1, 10) as x(n);

  v_prior := public.tyre_prior_core('pncarc', 'pn:gp', array[v_dev]);
  raise notice 'kern: %', v_prior::text;

  perform pg_temp.eis('A: prior_n is 4,09 (Kish van de eindgewichten)',
                      (v_prior->>'n_eff')::numeric between 4.05 and 4.13);
  perform pg_temp.eis('A: prior_n is niet de oude 21,85',
                      (v_prior->>'n_eff')::numeric < 5);
  perform pg_temp.eis('A: de gewichten zijn 0,6923 exact en 0,3077 auto',
                      round((v_prior #>> '{gewichten,exact}')::numeric, 4) = 0.6923
                      and round((v_prior #>> '{gewichten,auto}')::numeric, 4) = 0.3077);
  perform pg_temp.eis('A: de gewichten tellen op tot 1',
                      round(((v_prior #>> '{gewichten,exact}')::numeric
                             + (v_prior #>> '{gewichten,auto}')::numeric)::numeric, 6) = 1);
  perform pg_temp.eis('A: prior_n is niet groter dan het aantal stints',
                      (v_prior->>'n_eff')::numeric <= (v_prior->>'stints')::numeric);
  perform pg_temp.eis('A: prior_n is niet groter dan het aantal rondes',
                      (v_prior->>'n_eff')::numeric <= (v_prior->>'rondes')::numeric);

  --------------------------------------------------------------------------
  -- B. Dezelfde prior, nu via de schattings-RPC (basis.prior_n)
  --------------------------------------------------------------------------
  insert into public.simhub_tyre_lap_samples
    (device_id, connector_id, session_key, lap_number, tyre_set,
     wear_fl, wear_fr, wear_rl, wear_rr, car_key, track_key, captured_at)
  select v_dev, 'test', 'pn-1', s.van + x.n - 1, s.setn,
         100 - x.n * 0.5, 100 - x.n * 0.5, 100 - x.n * 0.5, 100 - x.n * 0.5,
         'pncarc', 'pn:gp', v_t - interval '25 minutes' + ((s.van + x.n - 1) || ' minutes')::interval
    from (values (1, 1), (2, 11)) as s(setn, van)
   cross join lateral generate_series(1, 9) as x(n);

  insert into public.simhub_telemetry_latest
    (device_id, owner_user_id, session_id, sequence, captured_at, connector_id,
     game, telemetry, car_id, car_name, track_name, track_config, v3_normalized)
  select v_dev, v_owner, 'pn-1', 1, v_t - interval '1 minute', 'test', 'IRacing',
         '{}'::jsonb, 'pncarc', 'pncarc', 'pn', 'gp', '{}'::jsonb
  on conflict (device_id) do update set
    session_id = excluded.session_id,
    captured_at = excluded.captured_at,
    car_id = excluded.car_id,
    car_name = excluded.car_name,
    track_name = excluded.track_name,
    track_config = excluded.track_config,
    v3_normalized = excluded.v3_normalized;

  v_e := public.pitwall_tyre_estimate_v2(v_dev);
  raise notice 'rpc: %', v_e::text;

  perform pg_temp.eis('B: de RPC meldt prior_n 4,09 bij 22 priorstints',
                      (v_e #>> '{basis,prior_n}')::numeric between 4.05 and 4.13
                      and (v_e #>> '{basis,prior_stints}')::integer = 22);
  perform pg_temp.eis('B: prior_n past bij de gerapporteerde blend (niet 21,85)',
                      (v_e #>> '{basis,prior_n}')::numeric < 5);
end $test$;

rollback;
