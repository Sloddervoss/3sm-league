-- ============================================================================
-- Test voor 20261031150000_pitwall_estimate_actuele_wear_bron.sql
--
--   A. Eén wear-bron. Een apparaat met twee oude stints op oudcar/oud:gp en
--      daarna een nieuwe sessie op nieuwcar/nieuw:gp met een verse meting:
--      wear_now komt uit de nieuwste meting (80), de actualiteit is vers, maar
--      de gebruikte basis is een andere combinatie -> context_mismatch en dus
--      usable = false, graad hooguit C en geen bereik. De oude code rekende
--      hier met 92,4 (de oude combinatie) terwijl de poort naar de verse
--      meting keek: dat is precies de gescheiden bron die dit repareert.
--
--   B. Setwissel: de nieuwste wear-meting valt in de vorige set (lap 20) en de
--      auto rijdt al in set 3 (lap 21, wear nog niet gerapporteerd). Zelfde
--      sessie, toch stale_state en usable = false.
--
--   C. Positieve controle: verse meting, dezelfde auto en baan, twee eigen
--      stints -> usable = true, n_eff = 2 (Kish, geen rondetelling) en een
--      bereik dat de gerapporteerde rate omsluit.
--
--   D. Geen telemetrieframe: de sessie is onbekend -> stale_state.
--
-- Draai als één transactie met ROLLBACK; er blijft niets achter.
--
--   ssh 3sm-docker "docker exec -i supabase-db psql -U supabase_admin -d postgres -X -q -v ON_ERROR_STOP=1" \
--     < supabase/tests/20261031150000_pitwall_estimate_wear_bron.sql
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

-- Eén losse meting, bijvoorbeeld een ronde waarin de connector de wear nog
-- niet meezond (dan blijven de wear-kolommen NULL).
create function pg_temp.meting(p_device uuid, p_session text, p_lap integer,
                               p_set integer, p_wear numeric,
                               p_auto text, p_baan text, p_at timestamptz)
returns void language sql as $$
  insert into public.simhub_tyre_lap_samples
    (device_id, connector_id, session_key, lap_number, tyre_set,
     wear_fl, wear_fr, wear_rl, wear_rr, car_key, track_key, captured_at)
  values (p_device, 'test', p_session, p_lap, p_set,
          p_wear, p_wear, p_wear, p_wear, p_auto, p_baan, p_at);
$$;

-- Het nieuwste telemetrieframe: hier komt de actuele context vandaan. De baan
-- wordt als 'naam:config' aangeleverd en zo gesplitst, zodat de sleutel
-- dezelfde vorm heeft als in de samples.
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
  v_dev_a constant uuid := '290fe152-5789-448c-8420-8deb3cf3077f';  -- CAT-PC (leeg)
  v_dev_b constant uuid := '81222914-3ad7-43db-b5eb-27c246ba1381';  -- DESKTOP-GR4NN00
  v_dev_c constant uuid := '9da43e1d-1e06-42ac-9178-9532f842a353';  -- RICKY
  v_dev_d constant uuid := 'ff3412f2-0273-4533-9dfa-303d83c72219';  -- RICKY (tweede, leeg)
  v_owner_103 constant uuid := '103daeb3-9f46-4d79-a0a1-c460e43ed3b7';
  v_owner_137 constant uuid := '137e6307-d9e3-4953-b302-7ab9a4999215';
  v_owner_3cf constant uuid := '3cf38c92-5e18-4e1b-925a-4256f17354ae';
  v_t   constant timestamptz := now();
  v_e   jsonb;
begin
  --------------------------------------------------------------------------
  -- A. Nieuwe sessie/baan met een oude, passende historische wear-rij
  --------------------------------------------------------------------------
  perform set_config('request.jwt.claim.sub', v_owner_103::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);

  perform pg_temp.blok(v_dev_a, 'w-oud', 1, 1,  10, 'oudcar', 'oud:gp', 0.4,
                       v_t - interval '2 hours');
  perform pg_temp.blok(v_dev_a, 'w-oud', 2, 11, 10, 'oudcar', 'oud:gp', 0.4,
                       v_t - interval '2 hours');
  -- Nieuwe sessie, nieuwe auto en baan; de wear-meting is vijf minuten oud.
  perform pg_temp.meting(v_dev_a, 'w-nieuw', 1, 1, 80, 'nieuwcar', 'nieuw:gp',
                         v_t - interval '5 minutes');
  perform pg_temp.frame(v_dev_a, 'w-nieuw', 'nieuwcar', 'nieuw:gp',
                        v_t - interval '1 minute');

  v_e := public.pitwall_tyre_estimate_v2(v_dev_a);

  perform pg_temp.eis('A: wear_now komt uit de nieuwste meting (80)',
                      (v_e->>'wear_now')::numeric = 80);
  perform pg_temp.eis('A: de wear-rij is van de nieuwe sessie en set (vers)',
                      (v_e #>> '{basis,actualiteit,vers}')::boolean
                      and (v_e #>> '{basis,actualiteit,sessie_match}')::boolean
                      and (v_e #>> '{basis,actualiteit,set_match}')::boolean);
  perform pg_temp.eis('A: de gebruikte basis is de historische combinatie',
                      v_e #>> '{basis,car_key}' = 'oudcar'
                      and v_e #>> '{basis,track_key}' = 'oud:gp');
  perform pg_temp.eis('A: wear_now is van een andere combinatie dan de basis',
                      v_e->>'wear_now_car_key' = 'nieuwcar'
                      and v_e->>'wear_now_track_key' = 'nieuw:gp');
  perform pg_temp.eis('A: context_mismatch staat in de redenen',
                      (v_e #> '{basis,redenen}') ? 'context_mismatch');
  perform pg_temp.eis('A: ondanks een verse meting is het advies niet usable',
                      (v_e->>'usable')::boolean = false);
  perform pg_temp.eis('A: graad hooguit C', v_e->>'grade' in ('C', 'D'));
  perform pg_temp.eis('A: geen bereik bij een andere combinatie',
                      (v_e #>> '{range_laps}') is null);
  perform pg_temp.eis('A: de mismatch is geen stale_state (de stand is vers)',
                      not ((v_e #> '{basis,redenen}') ? 'stale_state'));

  --------------------------------------------------------------------------
  -- B. Setwissel: de nieuwste wear-meting hoort bij de vorige set
  --------------------------------------------------------------------------
  perform set_config('request.jwt.claim.sub', v_owner_137::text, true);
  perform pg_temp.blok(v_dev_b, 'w-set', 1, 1,  10, 'setcar', 'set:gp', 0.5,
                       v_t - interval '25 minutes');
  perform pg_temp.blok(v_dev_b, 'w-set', 2, 11, 10, 'setcar', 'set:gp', 0.5,
                       v_t - interval '25 minutes');
  -- Nieuwe set, wear nog niet gerapporteerd: de nieuwste wear-meting blijft
  -- lap 20 (95,0) uit set 2, terwijl de auto al in set 3 rijdt.
  perform pg_temp.meting(v_dev_b, 'w-set', 21, 3, null, 'setcar', 'set:gp',
                         v_t - interval '1 minute');
  perform pg_temp.frame(v_dev_b, 'w-set', 'setcar', 'set:gp',
                        v_t - interval '30 seconds');

  v_e := public.pitwall_tyre_estimate_v2(v_dev_b);

  perform pg_temp.eis('B: dezelfde sessie maar een andere set => set_match false',
                      (v_e #>> '{basis,actualiteit,sessie_match}')::boolean
                      and not (v_e #>> '{basis,actualiteit,set_match}')::boolean);
  perform pg_temp.eis('B: vers = false en stale_state in de redenen',
                      not (v_e #>> '{basis,actualiteit,vers}')::boolean
                      and (v_e #> '{basis,redenen}') ? 'stale_state');
  perform pg_temp.eis('B: wear_now is de nieuwste wear-meting (95,0)',
                      (v_e->>'wear_now')::numeric = 95.0);
  perform pg_temp.eis('B: usable = false', (v_e->>'usable')::boolean = false);

  --------------------------------------------------------------------------
  -- C. Positieve controle: verse stand op dezelfde combinatie
  --------------------------------------------------------------------------
  perform set_config('request.jwt.claim.sub', v_owner_3cf::text, true);
  perform pg_temp.blok(v_dev_c, 'w-goed', 1, 1,  10, 'goedcar', 'goed:gp', 0.5,
                       v_t - interval '25 minutes');
  perform pg_temp.blok(v_dev_c, 'w-goed', 2, 11, 10, 'goedcar', 'goed:gp', 0.5,
                       v_t - interval '25 minutes');
  perform pg_temp.blok(v_dev_c, 'w-goed', 3, 21, 1,  'goedcar', 'goed:gp', 0,
                       v_t - interval '5 minutes');
  perform pg_temp.frame(v_dev_c, 'w-goed', 'goedcar', 'goed:gp',
                        v_t - interval '1 minute');

  v_e := public.pitwall_tyre_estimate_v2(v_dev_c);

  perform pg_temp.eis('C: verse stand, dezelfde combinatie en twee stints => usable',
                      (v_e->>'usable')::boolean);
  perform pg_temp.eis('C: graad B', v_e->>'grade' = 'B');
  perform pg_temp.eis('C: n_eff is de Kish-maat over de twee stints (~2)',
                      (v_e #>> '{basis,n_eff}')::numeric between 1.9 and 2.1);
  perform pg_temp.eis('C: de eigen meetbasis blijft 18 rondes',
                      (v_e #>> '{basis,eigen,rondes}')::integer = 18);
  perform pg_temp.eis('C: het bereik omsluit de puntschatting',
                      (v_e #>> '{range_laps,low}')::numeric
                        <= floor(60 / (v_e->>'wear_per_lap')::numeric)
                      and (v_e #>> '{range_laps,high}')::numeric
                        >= ceil(60 / (v_e->>'wear_per_lap')::numeric));
  perform pg_temp.eis('C: de band is een modelmarge met twee stints',
                      v_e #>> '{basis,band,soort}' = 'modelmarge'
                      and (v_e #>> '{basis,band,stints}')::integer = 2);

  --------------------------------------------------------------------------
  -- D. Geen telemetrieframe: de sessie is onbekend
  --------------------------------------------------------------------------
  perform set_config('request.jwt.claim.sub', v_owner_3cf::text, true);
  perform pg_temp.blok(v_dev_d, 'w-geen', 1, 1,  10, 'geencar', 'geen:gp', 0.5,
                       v_t - interval '5 minutes');
  perform pg_temp.blok(v_dev_d, 'w-geen', 2, 11, 10, 'geencar', 'geen:gp', 0.5,
                       v_t - interval '5 minutes');
  perform pg_temp.blok(v_dev_d, 'w-geen', 3, 21, 1,  'geencar', 'geen:gp', 0,
                       v_t - interval '2 minutes');

  v_e := public.pitwall_tyre_estimate_v2(v_dev_d);

  perform pg_temp.eis('D: zonder frame is sessie_match false',
                      not (v_e #>> '{basis,actualiteit,sessie_match}')::boolean);
  perform pg_temp.eis('D: zonder frame geen advies, wel stale_state',
                      not (v_e->>'usable')::boolean
                      and (v_e #> '{basis,redenen}') ? 'stale_state');
end $test$;

rollback;
