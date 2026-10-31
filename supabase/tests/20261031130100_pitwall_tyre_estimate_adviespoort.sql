-- ============================================================================
-- Test voor 20261031130100_pitwall_tyre_estimate_adviespoort.sql
--
--   A. De adviespoort: een verouderde stand geeft usable = false, graad hooguit
--      C en range_laps = null, met stale_state in de redenen. Een verse stand
--      met twee stints op de combinatie blijft usable = true.
--   B. De graad telt alleen de gebruikte car_key + track_key: 2 stints op de
--      gebruikte combinatie plus 1 op een andere geven B, geen A. Stints zonder
--      sleutels geven D, geen A.
--   C. De band: minder dan twee stints op de combinatie geeft range_laps null;
--      twee stints geven een bereik rond de gemeten helling.
--   D. n_eff is de Kish-maat: bij twee gelijke stints van 9 rondes is hij 18,
--      niet de som van eigen rondes plus de prior.
--   E. De nieuwe sleutels staan er en de bestaande sleutels zijn niet weg.
--   F. De invariant op de echte apparaten: usable => vers + A/B + bereik, en
--      niet-vers => niet usable + geen bereik + graad hooguit C.
--
-- Draai als één transactie met ROLLBACK; er blijft niets achter.
--
--   ssh 3sm-docker "docker exec -i supabase-db psql -U supabase_admin -d postgres -X -q -v ON_ERROR_STOP=1" \
--     < supabase/tests/20261031130100_pitwall_tyre_estimate_adviespoort.sql
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

-- Rondes binnen één sessie: elk blok is een eigen bandenset (set_number), dus
-- een eigen stint. p_van is de eerste rondeteller van het blok.
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

-- Twee gelijke stints plus een lopende derde set.
create function pg_temp.twee_stints(p_device uuid, p_session text, p_auto text,
                                    p_baan text, p_rate numeric, p_start timestamptz)
returns void language sql as $$
  select pg_temp.blok(p_device, p_session, 1, 1,  10, p_auto, p_baan, p_rate, p_start);
  select pg_temp.blok(p_device, p_session, 2, 11, 10, p_auto, p_baan, p_rate, p_start);
  select pg_temp.blok(p_device, p_session, 3, 21, 1,  p_auto, p_baan, 0,    p_start);
$$;

do $test$
declare
  v_dev   constant uuid := '290fe152-5789-448c-8420-8deb3cf3077f';  -- CAT-PC (leeg)
  v_dev_b constant uuid := '81222914-3ad7-43db-b5eb-27c246ba1381';  -- DESKTOP-GR4NN00
  v_dev_c constant uuid := '9da43e1d-1e06-42ac-9178-9532f842a353';  -- RICKY
  v_dev_d constant uuid := 'fdae0b79-251d-48bc-a134-b4de9c40784f';  -- BEEST (leeg)
  v_dev_e constant uuid := 'ff3412f2-0273-4533-9dfa-303d83c72219';  -- RICKY (leeg, tweede)
  v_cat   constant uuid := 'e90ad2ca-98b8-4384-b241-b1d94d7ddb64';  -- CAT-PC (echte data, offline)
  v_owner_103 constant uuid := '103daeb3-9f46-4d79-a0a1-c460e43ed3b7';
  v_owner_137 constant uuid := '137e6307-d9e3-4953-b302-7ab9a4999215';
  v_owner_3cf constant uuid := '3cf38c92-5e18-4e1b-925a-4256f17354ae';
  v_t     constant timestamptz := now();
  v_e     jsonb;
  v_lijst text[];
begin
  perform set_config('request.jwt.claim.sub', v_owner_103::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);

  --------------------------------------------------------------------------
  -- A + D. Twee gelijke, verse stints: bruikbaar, met een bereik
  --------------------------------------------------------------------------
  perform pg_temp.twee_stints(v_dev, 'adv-a', 'adviescar', 'advies:gp', 0.5, v_t);
  v_e := public.pitwall_tyre_estimate_v2(v_dev);

  perform pg_temp.eis('verse stand: actualiteit.vers = true',
                      (v_e #>> '{basis,actualiteit,vers}')::boolean);
  perform pg_temp.eis('verse stand: wear_ouderheid_min = 0',
                      (v_e #>> '{basis,actualiteit,wear_ouderheid_min}')::integer = 0);
  perform pg_temp.eis('verse stand: sessie_match en set_match',
                      (v_e #>> '{basis,actualiteit,sessie_match}')::boolean
                      and (v_e #>> '{basis,actualiteit,set_match}')::boolean);
  perform pg_temp.eis('twee stints: graad B', v_e->>'grade' = 'B');
  perform pg_temp.eis('twee stints op de combinatie: stints = 2',
                      (v_e->>'stints')::integer = 2);
  perform pg_temp.eis('verse stand met 2 stints: usable = true',
                      (v_e->>'usable')::boolean);
  perform pg_temp.eis('band is gemeten: range_laps is niet null',
                      v_e->'range_laps' is not null);
  perform pg_temp.eis('het bereik omsluit het puntsschatting (60 / wear_per_lap)',
                      (v_e #>> '{range_laps,low}')::numeric
                        <= floor(60 / (v_e->>'wear_per_lap')::numeric)
                      and (v_e #>> '{range_laps,high}')::numeric
                        >= ceil(60 / (v_e->>'wear_per_lap')::numeric));
  perform pg_temp.eis('twee gelijke stints geven een smalle band (<= 5 rondes breed)',
                      (v_e #>> '{range_laps,high}')::numeric
                      - (v_e #>> '{range_laps,low}')::numeric <= 5);
  perform pg_temp.eis('n_eff is de Kish-maat over 2 x 9 rondes = 18',
                      (v_e #>> '{basis,n_eff}')::numeric = 18);
  perform pg_temp.eis('rondes_effectief is dezelfde Kish-maat',
                      (v_e #>> '{basis,rondes_effectief}')::numeric = 18);
  perform pg_temp.eis('n_eff is niet de oude som van eigen rondes plus de prior',
                      (v_e #>> '{basis,n_eff}')::numeric
                        <> (v_e #>> '{basis,rondes_in_basis}')::numeric
                           + coalesce((v_e #>> '{basis,prior_n}')::numeric, 0));
  perform pg_temp.eis('eigen: 2 stints, 18 rondes op deze combinatie',
                      (v_e #>> '{basis,eigen,stints}')::integer = 2
                      and (v_e #>> '{basis,eigen,rondes}')::integer = 18);

  --------------------------------------------------------------------------
  -- B. Graad op de combinatie; stints zonder sleutels tellen niet
  --------------------------------------------------------------------------
  -- Drie stints zonder sleutels: nooit A.
  perform pg_temp.blok(v_dev_b, 'adv-b1', 1, 1,  10, null, null, 0.5, v_t);
  perform pg_temp.blok(v_dev_b, 'adv-b1', 2, 11, 10, null, null, 0.5, v_t);
  perform pg_temp.blok(v_dev_b, 'adv-b1', 3, 21, 10, null, null, 0.5, v_t);
  perform pg_temp.blok(v_dev_b, 'adv-b1', 4, 31, 1,  null, null, 0,   v_t);
  perform set_config('request.jwt.claim.sub', v_owner_137::text, true);
  v_e := public.pitwall_tyre_estimate_v2(v_dev_b);

  perform pg_temp.eis('drie keyless stints: graad D, geen A',
                      v_e->>'grade' = 'D');
  perform pg_temp.eis('drie keyless stints: stints = 0 (geen combinatie)',
                      (v_e->>'stints')::integer = 0);
  perform pg_temp.eis('drie keyless stints: geen bereik',
                      (v_e #>> '{range_laps}') is null);
  perform pg_temp.eis('keyless: stints_totaal blijft het echte aantal',
                      (v_e->>'stints_totaal')::integer >= 3);

  -- Eén stint op een andere baan, twee op de gebruikte baan: B, geen A.
  perform pg_temp.blok(v_dev_c, 'adv-c', 1, 1,  10, 'combocar', 'comboy:gp', 0.5, v_t);
  perform pg_temp.blok(v_dev_c, 'adv-c', 2, 11, 10, 'combocar', 'combox:gp', 0.5, v_t);
  perform pg_temp.blok(v_dev_c, 'adv-c', 3, 21, 10, 'combocar', 'combox:gp', 0.5, v_t);
  perform pg_temp.blok(v_dev_c, 'adv-c', 4, 31, 1,  'combocar', 'combox:gp', 0,   v_t);
  perform set_config('request.jwt.claim.sub', v_owner_3cf::text, true);
  v_e := public.pitwall_tyre_estimate_v2(v_dev_c);

  perform pg_temp.eis('2 stints op de gebruikte baan + 1 elders: graad B',
                      v_e->>'grade' = 'B');
  perform pg_temp.eis('de graad telt alleen de gebruikte combinatie',
                      (v_e->>'stints')::integer = 2);
  perform pg_temp.eis('de gebruikte combinatie is de nieuwste met een helling',
                      v_e #>> '{basis,track_key}' = 'combox:gp');

  --------------------------------------------------------------------------
  -- A. Een verouderde stand: geen advies
  --------------------------------------------------------------------------
  perform pg_temp.twee_stints(v_dev_d, 'adv-d', 'oudcar', 'oud:gp', 0.5,
                              v_t - interval '60 minutes');
  perform set_config('request.jwt.claim.sub', v_owner_103::text, true);
  v_e := public.pitwall_tyre_estimate_v2(v_dev_d);

  perform pg_temp.eis('oude stand: vers = false',
                      (v_e #>> '{basis,actualiteit,vers}')::boolean = false);
  perform pg_temp.eis('oude stand: wear_ouderheid_min >= 10',
                      (v_e #>> '{basis,actualiteit,wear_ouderheid_min}')::integer >= 10);
  perform pg_temp.eis('oude stand: usable = false', (v_e->>'usable')::boolean = false);
  perform pg_temp.eis('oude stand: graad hooguit C', v_e->>'grade' in ('C', 'D'));
  perform pg_temp.eis('oude stand: range_laps = null', (v_e #>> '{range_laps}') is null);
  perform pg_temp.eis('oude stand: stale_state staat in de redenen',
                      (v_e #> '{basis,redenen}') ? 'stale_state');

  --------------------------------------------------------------------------
  -- C. Eén stint: de band is onbekend, niet kunstmatig smal
  --------------------------------------------------------------------------
  perform pg_temp.blok(v_dev_e, 'adv-e', 1, 1,  10, 'eencar', 'een:gp', 0.5, v_t);
  perform pg_temp.blok(v_dev_e, 'adv-e', 2, 11, 1,  'eencar', 'een:gp', 0,   v_t);
  perform set_config('request.jwt.claim.sub', v_owner_3cf::text, true);
  v_e := public.pitwall_tyre_estimate_v2(v_dev_e);

  perform pg_temp.eis('één stint: graad C', v_e->>'grade' = 'C');
  perform pg_temp.eis('één stint: range_laps = null', (v_e #>> '{range_laps}') is null);
  perform pg_temp.eis('één stint: usable = false', (v_e->>'usable')::boolean = false);

  --------------------------------------------------------------------------
  -- E. Sleutels: bestaand blijft, nieuw staat erbij, redenen gesorteerd
  --------------------------------------------------------------------------
  perform set_config('request.jwt.claim.sub', v_owner_103::text, true);
  v_e := public.pitwall_tyre_estimate_v2(v_dev);
  perform pg_temp.eis('bestaande sleutels zijn niet verdwenen',
                      v_e ?& array['grade','grade_label','usable','voorlopig',
                                   'stints','stints_totaal','wear_per_lap',
                                   'zwakste_hoek','range_laps','wear_now',
                                   'wear_now_car_key','wear_now_track_key',
                                   'threshold_pct','basis','provenance']);
  perform pg_temp.eis('nieuwe sleutels staan in basis',
                      (v_e->'basis') ?& array['actualiteit','gedeeld','eigen',
                                              'redenen','n_eff']);
  perform pg_temp.eis('actualiteit heeft de vier contractvelden',
                      (v_e #> '{basis,actualiteit}') ?&
                      array['wear_ouderheid_min','sessie_match','set_match','vers']);
  perform pg_temp.eis('gedeeld heeft rate, rondes, stints en accounts',
                      (v_e #> '{basis,gedeeld}') ?&
                      array['rate','rondes','stints','accounts']);
  perform pg_temp.eis('eigen heeft rate, rondes en stints',
                      (v_e #> '{basis,eigen}') ?& array['rate','rondes','stints']);

  -- Op het apparaat met een oude stand staan er echt redenen in.
  perform set_config('request.jwt.claim.sub', v_owner_103::text, true);
  v_e := public.pitwall_tyre_estimate_v2(v_dev_d);
  v_lijst := array(select jsonb_array_elements_text(v_e #> '{basis,redenen}'));
  perform pg_temp.eis('redenen zijn gevuld bij een twijfelgeval',
                      coalesce(array_length(v_lijst, 1), 0) > 0);
  perform pg_temp.eis('redenen zijn gesorteerd en uniek',
                      v_lijst = (select array_agg(distinct y order by y)
                                   from unnest(v_lijst) y));

  --------------------------------------------------------------------------
  -- F. De invariant op de echte apparaten
  --------------------------------------------------------------------------
  perform set_config('request.jwt.claim.sub', v_owner_103::text, true);
  v_e := public.pitwall_tyre_estimate_v2(v_cat);
  perform pg_temp.eis('CAT-PC (offline): niet vers => niet usable, geen bereik, graad <= C',
                      (v_e #>> '{basis,actualiteit,vers}')::boolean
                      or ((v_e->>'usable')::boolean = false
                          and (v_e #>> '{range_laps}') is null
                          and v_e->>'grade' in ('C', 'D')));
  perform pg_temp.eis('CAT-PC: als de stand oud is, staat stale_state in de redenen',
                      (v_e #>> '{basis,actualiteit,vers}')::boolean
                      or (v_e #> '{basis,redenen}') ? 'stale_state');
end $test$;

rollback;
