-- ============================================================================
-- Test voor 20261028140000_tyre_stint_model_span_and_context.sql
--
-- Draai dit bestand als één transactie en sluit af met ROLLBACK: er blijft geen
-- rij achter. Twee synthetische scenario's op twee echte maar lege apparaten:
--
--   A. DESKTOP-GR4NN00 — de meetbasis van de gebruikte hoek.
--      Een stint waarin FR 5 pp zakt tussen ronde 1 en 2 en daarna niet meer
--      gemeten wordt (eigen span 1), terwijl FL/RL/RR negen rondes meten
--      (stintspan 9). Vóór de fix: basis.rondes_in_basis 9 en usable true.
--      Nu: rondes_in_basis 1, rondes_in_stint 9, usable false, voorlopig true.
--      Daarnaast de grens: een hoek over 7 rondes is niet bruikbaar, over 8 wel.
--
--   B. RICKY — het last_known-pad (geen enkele stint met een helling).
--      Basisauto A met de nieuwste wear-meting uit auto B: de herkomst moet
--      estimated worden, niet last_known. Past de wear-meting wel bij de basis,
--      dan blijft het last_known. Wijkt alleen de context af (nieuwere rijen van
--      een andere auto zonder wear), dan ook estimated.
--
--   ssh 3sm-docker "docker exec -i supabase-db psql -U supabase_admin -d postgres -X -q -v ON_ERROR_STOP=1" \
--     < supabase/tests/20261028140000_tyre_stint_model_span_and_context.sql
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
  v_dev_a   constant uuid := '81222914-3ad7-43db-b5eb-27c246ba1381';  -- DESKTOP-GR4NN00
  v_dev_b   constant uuid := '9da43e1d-1e06-42ac-9178-9532f842a353';  -- RICKY (inactief)
  v_owner_a uuid;
  v_owner_b uuid;
  v_t       constant timestamptz := timestamptz '2026-10-29 08:00:00+00';
  v_view    record;
  v_est     jsonb;
begin
  select d.owner_user_id into v_owner_a from public.simhub_devices d where d.id = v_dev_a;
  select d.owner_user_id into v_owner_b from public.simhub_devices d where d.id = v_dev_b;
  perform pg_temp.eis('testapparaten bestaan', v_owner_a is not null and v_owner_b is not null);
  perform pg_temp.eis('testapparaten zijn leeg',
                      not exists (select 1 from public.simhub_tyre_lap_samples
                                   where device_id in (v_dev_a, v_dev_b)));

  -- ========================================================================
  -- A. De meetbasis van de gebruikte hoek
  -- ========================================================================
  perform set_config('request.jwt.claim.sub', v_owner_a::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);

  -- Twee gewone stints met een helling over alle vier hoeken, zodat de graad A
  -- is en usable dus alleen nog door de basislengte kan worden tegengehouden.
  insert into public.simhub_tyre_lap_samples
    (device_id, connector_id, session_key, lap_number, tyre_set,
     wear_fl, wear_fr, wear_rl, wear_rr, captured_at)
  select v_dev_a, 'syn', 'syn-a-1', g, 1,
         100 - g * 0.4, 100 - g * 0.4, 100 - g * 0.4, 100 - g * 0.4,
         v_t + (g || ' minutes')::interval
    from generate_series(1, 11) g;

  insert into public.simhub_tyre_lap_samples
    (device_id, connector_id, session_key, lap_number, tyre_set,
     wear_fl, wear_fr, wear_rl, wear_rr, captured_at)
  select v_dev_a, 'syn', 'syn-a-2', g, 2,
         100 - g * 0.4, 100 - g * 0.4, 100 - g * 0.4, 100 - g * 0.4,
         v_t + (interval '20 minutes') + (g || ' minutes')::interval
    from generate_series(1, 11) g;

  -- Het gat: FR zakt 5 pp in één ronde en wordt daarna niet meer gemeten;
  -- FL/RL/RR meten negen rondes. De steilste hoek is dus FR, met span 1.
  insert into public.simhub_tyre_lap_samples
    (device_id, connector_id, session_key, lap_number, tyre_set,
     wear_fl, wear_fr, wear_rl, wear_rr, captured_at)
  values
    (v_dev_a, 'syn', 'syn-span-1',  1, 3, 100.0, 100.0, 100.0, 100.0, v_t + interval '40 minutes'),
    (v_dev_a, 'syn', 'syn-span-1',  2, 3,  99.5,  95.0,  99.5,  99.5, v_t + interval '41 minutes'),
    (v_dev_a, 'syn', 'syn-span-1',  3, 3,  99.0,  null,  99.0,  99.0, v_t + interval '42 minutes'),
    (v_dev_a, 'syn', 'syn-span-1',  4, 3,  98.5,  null,  98.5,  98.5, v_t + interval '43 minutes'),
    (v_dev_a, 'syn', 'syn-span-1',  5, 3,  98.0,  null,  98.0,  98.0, v_t + interval '44 minutes'),
    (v_dev_a, 'syn', 'syn-span-1',  6, 3,  97.5,  null,  97.5,  97.5, v_t + interval '45 minutes'),
    (v_dev_a, 'syn', 'syn-span-1',  7, 3,  97.0,  null,  97.0,  97.0, v_t + interval '46 minutes'),
    (v_dev_a, 'syn', 'syn-span-1',  8, 3,  96.5,  null,  96.5,  96.5, v_t + interval '47 minutes'),
    (v_dev_a, 'syn', 'syn-span-1',  9, 3,  96.0,  null,  96.0,  96.0, v_t + interval '48 minutes'),
    (v_dev_a, 'syn', 'syn-span-1', 10, 3,  95.5,  null,  95.5,  95.5, v_t + interval '49 minutes');

  select * into v_view from public.tyre_stint_deltas
   where device_id = v_dev_a and session_key = 'syn-span-1';
  perform pg_temp.eis('stintspan 9, hoekspan FR 1',
                      v_view.wear_span = 9 and v_view.wear_span_fr = 1
                      and v_view.wear_span_fl = 9);
  perform pg_temp.eis('steilste hoek is FR over zijn eigen ronde',
                      v_view.zwakste_hoek = 'fr' and v_view.wear_per_lap_fr = -5.0000
                      and v_view.wear_per_lap_fl = -0.5000);

  v_est := public.pitwall_tyre_estimate_v2(v_dev_a);
  perform pg_temp.eis('graad A uit drie stints met helling',
                      v_est ->> 'grade' = 'A'
                      and (v_est ->> 'stints')::integer = 3
                      and (v_est ->> 'stints_totaal')::integer = 3);
  perform pg_temp.eis('basis is de hoek, niet de stint: 1 versus 9',
                      (v_est #>> '{basis,rondes_in_basis}')::integer = 1
                      and (v_est #>> '{basis,rondes_in_stint}')::integer = 9
                      and v_est #>> '{basis,zwakste_hoek}' = 'fr');
  perform pg_temp.eis('helling van één ronde maakt de schatting onbruikbaar',
                      (v_est ->> 'wear_per_lap')::numeric = 5.0000
                      and v_est ->> 'usable' = 'false'
                      and v_est ->> 'voorlopig' = 'true');
  perform pg_temp.eis('wear_now is de nieuwste wear-stand (95,5)',
                      (v_est ->> 'wear_now')::numeric = 95.5);

  -- Een stint waarin elke hoek twaalf rondes meeloopt en FL het steilst is:
  -- de basis is dan 11 en de schatting is wel bruikbaar.
  insert into public.simhub_tyre_lap_samples
    (device_id, connector_id, session_key, lap_number, tyre_set,
     wear_fl, wear_fr, wear_rl, wear_rr, captured_at)
  select v_dev_a, 'syn', 'syn-goed', g, 4,
         100 - g * 0.6, 100 - g * 0.4, 100 - g * 0.4, 100 - g * 0.4,
         v_t + (interval '60 minutes') + (g || ' minutes')::interval
    from generate_series(1, 12) g;

  v_est := public.pitwall_tyre_estimate_v2(v_dev_a);
  perform pg_temp.eis('basis 11 over de gebruikte hoek is bruikbaar',
                      v_est ->> 'zwakste_hoek' = 'fl'
                      and (v_est ->> 'wear_per_lap')::numeric = 0.6000
                      and (v_est #>> '{basis,rondes_in_basis}')::integer = 11
                      and (v_est #>> '{basis,rondes_in_stint}')::integer = 11
                      and v_est ->> 'usable' = 'true'
                      and v_est #>> '{range_laps,low}' is not null
                      and (v_est #>> '{range_laps,high}')::integer
                          > (v_est #>> '{range_laps,low}')::integer);

  -- De grens zelf: zeven rondes is te kort, acht is genoeg.
  insert into public.simhub_tyre_lap_samples
    (device_id, connector_id, session_key, lap_number, tyre_set,
     wear_fl, wear_fr, wear_rl, wear_rr, captured_at)
  select v_dev_a, 'syn', 'syn-zeven', g, 5,
         100 - g * 0.5, null, null, null,
         v_t + (interval '80 minutes') + (g || ' minutes')::interval
    from generate_series(1, 8) g;

  v_est := public.pitwall_tyre_estimate_v2(v_dev_a);
  perform pg_temp.eis('zeven rondes: niet bruikbaar, wel voorlopig',
                      (v_est #>> '{basis,rondes_in_basis}')::integer = 7
                      and (v_est #>> '{basis,rondes_in_stint}')::integer = 7
                      and v_est ->> 'usable' = 'false'
                      and v_est ->> 'voorlopig' = 'true');

  insert into public.simhub_tyre_lap_samples
    (device_id, connector_id, session_key, lap_number, tyre_set,
     wear_fl, wear_fr, wear_rl, wear_rr, captured_at)
  select v_dev_a, 'syn', 'syn-acht', g, 6,
         100 - g * 0.4, null, null, null,
         v_t + (interval '100 minutes') + (g || ' minutes')::interval
    from generate_series(1, 9) g;

  v_est := public.pitwall_tyre_estimate_v2(v_dev_a);
  perform pg_temp.eis('acht rondes: bruikbaar en niet meer voorlopig',
                      (v_est #>> '{basis,rondes_in_basis}')::integer = 8
                      and (v_est #>> '{basis,rondes_in_stint}')::integer = 8
                      and v_est ->> 'usable' = 'true'
                      and v_est ->> 'voorlopig' = 'false');

  -- ========================================================================
  -- B. Het last_known-pad: wear_now tegen de context
  -- ========================================================================
  perform set_config('request.jwt.claim.sub', v_owner_b::text, true);

  -- Eén stint met precies één wear-meting (dus geen helling). De laatste rij
  -- met een auto zet de basis op auto A, terwijl de wear-meting zelf uit auto B
  -- komt: zonder contextcheck bleef de herkomst hier last_known.
  insert into public.simhub_tyre_lap_samples
    (device_id, connector_id, session_key, lap_number, tyre_set,
     wear_fl, wear_fr, wear_rl, wear_rr, car_key, track_key, captured_at)
  values
    (v_dev_b, 'syn', 'syn-ll', 1, 1, 85, 85, 85, 85,
     'syn-car-b', 'syn-track-b', v_t + interval '1 minute'),
    (v_dev_b, 'syn', 'syn-ll', 2, 1, null, null, null, null,
     'syn-car-b', 'syn-track-b', v_t + interval '2 minutes'),
    (v_dev_b, 'syn', 'syn-ll', 3, 1, null, null, null, null,
     'syn-car-a', 'syn-track-a', v_t + interval '3 minutes');

  select * into v_view from public.tyre_stint_deltas
   where device_id = v_dev_b and session_key = 'syn-ll';
  perform pg_temp.eis('last_known-scenario heeft geen helling',
                      v_view.heeft_helling = false
                      and v_view.wear_metingen = 1
                      and v_view.car_key = 'syn-car-a');

  v_est := public.pitwall_tyre_estimate_v2(v_dev_b);
  perform pg_temp.eis('basis op auto A, wear-stand uit auto B',
                      v_est #>> '{basis,car_key}' = 'syn-car-a'
                      and v_est ->> 'wear_now_car_key' = 'syn-car-b'
                      and (v_est ->> 'wear_now')::numeric = 85);
  perform pg_temp.eis('wear-stand van een andere auto -> estimated, niet last_known',
                      v_est ->> 'provenance' = 'estimated'
                      and v_est ->> 'wear_per_lap' is null
                      and v_est ->> 'range_laps' is null);

  -- Past de wear-meting wel bij de basisauto, dan blijft het last_known.
  insert into public.simhub_tyre_lap_samples
    (device_id, connector_id, session_key, lap_number, tyre_set,
     wear_fl, wear_fr, wear_rl, wear_rr, car_key, track_key, captured_at)
  values
    (v_dev_b, 'syn', 'syn-ll2', 1, 1, 78, 78, 78, 78,
     'syn-car-a', 'syn-track-a', v_t + interval '10 minutes');

  v_est := public.pitwall_tyre_estimate_v2(v_dev_b);
  perform pg_temp.eis('passende wear-stand blijft last_known',
                      v_est #>> '{basis,car_key}' = 'syn-car-a'
                      and v_est ->> 'wear_now_car_key' = 'syn-car-a'
                      and (v_est ->> 'wear_now')::numeric = 78
                      and v_est ->> 'provenance' = 'last_known');

  -- Nieuwere rijen van een andere auto zonder wear: de context wijkt af, dus de
  -- stand van auto A is niet de stand van de huidige combinatie.
  insert into public.simhub_tyre_lap_samples
    (device_id, connector_id, session_key, lap_number, tyre_set,
     wear_fl, wear_fr, wear_rl, wear_rr, car_key, track_key, captured_at)
  values
    (v_dev_b, 'syn', 'syn-ll3', 1, 1, null, null, null, null,
     'syn-car-b', 'syn-track-b', v_t + interval '20 minutes');

  v_est := public.pitwall_tyre_estimate_v2(v_dev_b);
  perform pg_temp.eis('afwijkende context -> estimated in het last_known-pad',
                      v_est #>> '{basis,car_key}' = 'syn-car-a'
                      and v_est ->> 'wear_now_car_key' = 'syn-car-a'
                      and (v_est ->> 'wear_now')::numeric = 78
                      and v_est ->> 'provenance' = 'estimated');

  perform pg_temp.eis('last_known-pad geeft nog steeds geen getal of bereik',
                      v_est ->> 'grade' = 'D'
                      and v_est ->> 'wear_per_lap' is null
                      and v_est ->> 'range_laps' is null
                      and v_est ->> 'usable' = 'false');
end
$test$;

rollback;
