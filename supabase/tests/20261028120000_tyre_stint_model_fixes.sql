-- ============================================================================
-- Test voor 20261028120000_tyre_stint_model_fixes.sql
--
-- Draai dit bestand als één transactie en sluit af met ROLLBACK: er blijft geen
-- rij achter. Het script controleert de acht correcties op een echt, leeg
-- apparaat (DESKTOP-GR4NN00) met synthetische randen:
--
--   * NaN in een wear-kolom (ook als het de nieuwste meting is);
--   * een stint waarin maar één hoek gemeten is;
--   * een teller die 1 → NULL → 2 loopt (pitstop naast een lege rij);
--   * een NULL-rij direct vóór en na de setwissel;
--   * dalende wear (helling) en stijgende wear binnen één payload-set (geen
--     helling, geen extra stint);
--   * een blok zonder helling dat de graad niet mag opkrikken;
--   * een basis op auto A terwijl de nieuwste meting auto B is.
--
--   ssh 3sm-docker "docker exec -i supabase-db psql -U supabase_admin -d postgres -X -q -v ON_ERROR_STOP=1" \
--     < supabase/tests/20261028120000_tyre_stint_model_fixes.sql
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
  v_device  constant uuid := '81222914-3ad7-43db-b5eb-27c246ba1381';
  v_owner   uuid;
  v_t       constant timestamptz := timestamptz '2026-10-29 08:00:00+00';
  v_n       integer;
  v_graded  integer;
  v_ok      boolean;
  v_view    record;
  v_est     jsonb;
  v_cov     record;
begin
  select d.owner_user_id into v_owner
    from public.simhub_devices d where d.id = v_device;
  perform pg_temp.eis('testapparaat bestaat', v_owner is not null);
  perform pg_temp.eis('testapparaat is leeg',
                      not exists (select 1 from public.simhub_tyre_lap_samples
                                   where device_id = v_device));

  -- Eigenaarcontext: de RPC's hangen aan auth.uid().
  perform set_config('request.jwt.claim.sub', v_owner::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);

  -- ------------------------------------------------------------------------
  -- 1. Drie blokken zonder bruikbare helling mogen de graad niet opkrikken.
  -- ------------------------------------------------------------------------
  -- Stijgende wear binnen één payload-set: geen helling, en de teller
  -- voorkomt dat de sprong als setwissel wordt gelezen.
  insert into public.simhub_tyre_lap_samples
    (device_id, connector_id, session_key, lap_number, tyre_set,
     wear_fl, wear_fr, wear_rl, wear_rr, captured_at)
  values
    (v_device, 'syn', 'syn-stijgt', 1, 6, 90, 90, 90, 90, v_t + interval '1 minute'),
    (v_device, 'syn', 'syn-stijgt', 2, 6, 91, 91, 91, 91, v_t + interval '2 minutes'),
    (v_device, 'syn', 'syn-stijgt', 3, 6, 92, 92, 92, 92, v_t + interval '3 minutes'),
    (v_device, 'syn', 'syn-stijgt', 4, 6, 93, 93, 93, 93, v_t + interval '4 minutes');

  -- Eén meting in een blok: geen tweede meting, dus geen helling.
  insert into public.simhub_tyre_lap_samples
    (device_id, connector_id, session_key, lap_number, tyre_set,
     wear_fl, wear_fr, wear_rl, wear_rr, captured_at)
  values
    (v_device, 'syn', 'syn-eenmalig', 1, 1, 100, 100, 100, 100, v_t + interval '5 minutes');

  -- Twee rondes, maar alleen de eerste heeft wear.
  insert into public.simhub_tyre_lap_samples
    (device_id, connector_id, session_key, lap_number, tyre_set,
     wear_fl, wear_fr, wear_rl, wear_rr, captured_at)
  values
    (v_device, 'syn', 'syn-half', 1, 1, null, null, null, null, v_t + interval '6 minutes'),
    (v_device, 'syn', 'syn-half', 2, 1, 99, 99, 99, 99, v_t + interval '7 minutes');

  select count(*), count(*) filter (where heeft_helling) into v_n, v_graded
    from public.tyre_stint_deltas where device_id = v_device;
  perform pg_temp.eis('drie blokken, nul met een helling', v_n = 3 and v_graded = 0);

  select * into v_cov from public.tyre_coverage(50) limit 1;
  perform pg_temp.eis('dekking: graad D op nul wear_labels', v_cov.grade = 'D' and v_cov.wear_labels = 0 and v_cov.stints = 3);

  v_est := public.pitwall_tyre_estimate_v2(v_device);
  perform pg_temp.eis('schatting: graad D, geen getal',
                      v_est ->> 'grade' = 'D'
                      and (v_est ->> 'stints')::integer = 0
                      and (v_est ->> 'stints_totaal')::integer = 3
                      and v_est ->> 'wear_per_lap' is null
                      and v_est ->> 'range_laps' is null);
  perform pg_temp.eis('schatting: wel een wear-stand (last_known)',
                      v_est ->> 'provenance' = 'last_known'
                      and (v_est ->> 'wear_now')::numeric = 99);

  -- Eén stint met precies één gemeten hoek: dat is wél een helling (C, geen A).
  insert into public.simhub_tyre_lap_samples
    (device_id, connector_id, session_key, lap_number, tyre_set,
     wear_fl, wear_fr, wear_rl, wear_rr, captured_at)
  values
    (v_device, 'syn', 'syn-hoek', 1, 8, 100, null, null, null, v_t + interval '10 minutes'),
    (v_device, 'syn', 'syn-hoek', 2, 8,  99, null, null, null, v_t + interval '11 minutes'),
    (v_device, 'syn', 'syn-hoek', 3, 8,  98, null, null, null, v_t + interval '12 minutes'),
    (v_device, 'syn', 'syn-hoek', 4, 8,  97, null, null, null, v_t + interval '13 minutes'),
    (v_device, 'syn', 'syn-hoek', 5, 8,  96, null, null, null, v_t + interval '14 minutes');

  select * into v_view from public.tyre_stint_deltas
   where device_id = v_device and session_key = 'syn-hoek';
  perform pg_temp.eis('één hoek: helling over eigen span 4',
                      v_view.wear_span = 4 and v_view.wear_span_fl = 4
                      and v_view.wear_per_lap_fl = -1.0000
                      and v_view.wear_per_lap_fr is null
                      and v_view.wear_per_lap_rl is null
                      and v_view.wear_per_lap_rr is null);
  perform pg_temp.eis('één hoek: zwakste hoek is die ene hoek',
                      v_view.zwakste_hoek = 'fl' and v_view.heeft_helling);

  select * into v_cov from public.tyre_coverage(50) limit 1;
  perform pg_temp.eis('dekking telt alleen de stint met helling',
                      v_cov.stints = 4 and v_cov.wear_labels = 1 and v_cov.grade = 'C');

  v_est := public.pitwall_tyre_estimate_v2(v_device);
  perform pg_temp.eis('graad C uit één helling, niet uit vier blokken',
                      v_est ->> 'grade' = 'C'
                      and (v_est ->> 'stints')::integer = 1
                      and (v_est ->> 'stints_totaal')::integer = 4
                      and v_est ->> 'usable' = 'false'
                      and v_est ->> 'zwakste_hoek' = 'fl'
                      and (v_est ->> 'wear_per_lap')::numeric = 1.0000);

  -- ------------------------------------------------------------------------
  -- 2. NaN in de nieuwste meting: geen crash, geen NaN in het antwoord.
  -- ------------------------------------------------------------------------
  insert into public.simhub_tyre_lap_samples
    (device_id, connector_id, session_key, lap_number, tyre_set,
     wear_fl, wear_fr, wear_rl, wear_rr, captured_at)
  values
    (v_device, 'syn', 'syn-nan', 1, 9, 100, 100, 100, 100, v_t + interval '20 minutes'),
    (v_device, 'syn', 'syn-nan', 2, 9,  99,  99,  99,  99, v_t + interval '21 minutes'),
    (v_device, 'syn', 'syn-nan', 3, 9,  98,  98,  98,  98, v_t + interval '22 minutes'),
    (v_device, 'syn', 'syn-nan', 4, 9, 'NaN', 97, 97,  97, v_t + interval '23 minutes'),
    (v_device, 'syn', 'syn-nan', 5, 9,  96,  96,  96,  96, v_t + interval '24 minutes'),
    (v_device, 'syn', 'syn-nan', 6, 9, 'NaN', 'NaN', 'NaN', 'NaN', v_t + interval '25 minutes');

  select * into v_view from public.tyre_stint_deltas
   where device_id = v_device and session_key = 'syn-nan';
  perform pg_temp.eis('NaN is NULL, geen meting',
                      v_view.wear_span = 4
                      and v_view.wear_per_lap_fl = -1.0000
                      and v_view.wear_per_lap_fr = -1.0000);

  v_est := public.pitwall_tyre_estimate_v2(v_device);
  perform pg_temp.eis('NaN-crash weg: wear_now uit de laatste echte meting',
                      (v_est ->> 'wear_now')::numeric = 96
                      and v_est ->> 'wear_now' not like '%NaN%');

  -- De oude functie klapte hier op de cast; bewijs dat de cast nog steeds
  -- weigert en dat de guard hem dus moet tegenhouden.
  v_ok := false;
  begin
    perform ('NaN'::numeric)::integer;
  exception when others then
    v_ok := sqlstate in ('0A000', '22003', '22P02');
  end;
  perform pg_temp.eis('cast van NaN naar integer faalt (grond van de crash)', v_ok);

  -- ------------------------------------------------------------------------
  -- 3. Teller 1 → NULL → 2: de pitstop naast een lege rij mag niet verdwijnen.
  -- ------------------------------------------------------------------------
  insert into public.simhub_tyre_lap_samples
    (device_id, connector_id, session_key, lap_number, tyre_set,
     wear_fl, wear_fr, wear_rl, wear_rr, captured_at)
  values
    (v_device, 'syn', 'syn-teller', 1, 1,    95.0, 95.0, 95.0, 95.0, v_t + interval '30 minutes'),
    (v_device, 'syn', 'syn-teller', 2, 1,    94.8, 94.8, 94.8, 94.8, v_t + interval '31 minutes'),
    (v_device, 'syn', 'syn-teller', 3, null, 94.6, 94.6, 94.6, 94.6, v_t + interval '32 minutes'),
    (v_device, 'syn', 'syn-teller', 4, 2,    94.4, 94.4, 94.4, 94.4, v_t + interval '33 minutes'),
    (v_device, 'syn', 'syn-teller', 5, 2,    94.2, 94.2, 94.2, 94.2, v_t + interval '34 minutes'),
    (v_device, 'syn', 'syn-teller', 6, null, 94.0, 94.0, 94.0, 94.0, v_t + interval '35 minutes');

  select count(*) into v_n from public.tyre_stint_deltas
   where device_id = v_device and session_key = 'syn-teller';
  perform pg_temp.eis('teller 1-NULL-2 geeft twee stints', v_n = 2);

  select * into v_view from public.tyre_stint_deltas
   where device_id = v_device and session_key = 'syn-teller' and lap_from = 1;
  perform pg_temp.eis('eerste stint is 1..3 met teller 1',
                      v_view.lap_to = 3 and v_view.set_number = 1 and v_view.set_bron = 'payload');
  select * into v_view from public.tyre_stint_deltas
   where device_id = v_device and session_key = 'syn-teller' and lap_from = 4;
  perform pg_temp.eis('tweede stint begint bij de nieuwe teller',
                      v_view.lap_from = 4 and v_view.lap_to = 6 and v_view.set_number = 2);

  -- NULL direct vóór én na de wissel.
  insert into public.simhub_tyre_lap_samples
    (device_id, connector_id, session_key, lap_number, tyre_set,
     wear_fl, wear_fr, wear_rl, wear_rr, captured_at)
  values
    (v_device, 'syn', 'syn-nul', 1, 1,    90.0, 90.0, 90.0, 90.0, v_t + interval '40 minutes'),
    (v_device, 'syn', 'syn-nul', 2, null, 89.9, 89.9, 89.9, 89.9, v_t + interval '41 minutes'),
    (v_device, 'syn', 'syn-nul', 3, 2,    89.8, 89.8, 89.8, 89.8, v_t + interval '42 minutes'),
    (v_device, 'syn', 'syn-nul', 4, null, 89.7, 89.7, 89.7, 89.7, v_t + interval '43 minutes'),
    (v_device, 'syn', 'syn-nul', 5, 2,    89.6, 89.6, 89.6, 89.6, v_t + interval '44 minutes');

  select count(*) into v_n from public.tyre_stint_deltas
   where device_id = v_device and session_key = 'syn-nul';
  perform pg_temp.eis('NULL naast de teller geeft twee stints', v_n = 2);

  -- ------------------------------------------------------------------------
  -- 4. Dalende wear: eigen helling per hoek over de eigen span.
  -- ------------------------------------------------------------------------
  insert into public.simhub_tyre_lap_samples
    (device_id, connector_id, session_key, lap_number, tyre_set,
     wear_fl, wear_fr, wear_rl, wear_rr, captured_at)
  select v_device, 'syn', 'syn-dalend', g, 5,
         100 - g * 0.4, 100 - g * 0.3, 100 - g * 0.5, 100 - g * 0.2,
         v_t + (interval '50 minutes') + (g || ' minutes')::interval
    from generate_series(1, 12) g;

  select * into v_view from public.tyre_stint_deltas
   where device_id = v_device and session_key = 'syn-dalend';
  perform pg_temp.eis('dalende wear: één stint, eigen helling per hoek',
                      v_view.rondes = 12 and v_view.wear_span = 11
                      and v_view.wear_per_lap_fl = -0.4000
                      and v_view.wear_per_lap_rl = -0.5000
                      and v_view.zwakste_hoek = 'rl');


  -- Haken met verschillende meetvensters: elke hoek zijn eigen noemer.
  insert into public.simhub_tyre_lap_samples
    (device_id, connector_id, session_key, lap_number, tyre_set,
     wear_fl, wear_fr, wear_rl, wear_rr, captured_at)
  values
    (v_device, 'syn', 'syn-span', 1, 10, 100, 100, null, null, v_t + interval '70 minutes'),
    (v_device, 'syn', 'syn-span', 2, 10,  99,  99, null, null, v_t + interval '71 minutes'),
    (v_device, 'syn', 'syn-span', 3, 10,  98,  97, null, null, v_t + interval '72 minutes'),
    (v_device, 'syn', 'syn-span', 4, 10,  97, null, null, null, v_t + interval '73 minutes'),
    (v_device, 'syn', 'syn-span', 5, 10,  96, null, null, null, v_t + interval '74 minutes'),
    (v_device, 'syn', 'syn-span', 6, 10,  95, null, null, null, v_t + interval '75 minutes');

  select * into v_view from public.tyre_stint_deltas
   where device_id = v_device and session_key = 'syn-span';
  perform pg_temp.eis('helling per hoek over de eigen span (FL 5, FR 2)',
                      v_view.wear_span = 5
                      and v_view.wear_span_fl = 5 and v_view.wear_span_fr = 2
                      and v_view.wear_per_lap_fl = -1.0000
                      and v_view.wear_per_lap_fr = -1.5000
                      and v_view.zwakste_hoek = 'fr');

  -- ------------------------------------------------------------------------
  -- 5. Basis op auto A, nieuwste meting op auto B.
  -- ------------------------------------------------------------------------
  insert into public.simhub_tyre_lap_samples
    (device_id, connector_id, session_key, lap_number, tyre_set,
     wear_fl, wear_fr, wear_rl, wear_rr, car_key, track_key, captured_at)
  select v_device, 'syn', 'syn-auto-a', g, 7,
         100 - g * 0.4444, 100 - g * 0.4444, 100 - g * 0.4444, 100 - g * 0.4444,
         'syn-car-a', 'syn-track-a',
         v_t + (interval '100 minutes') + (g || ' minutes')::interval
    from generate_series(1, 10) g;

  insert into public.simhub_tyre_lap_samples
    (device_id, connector_id, session_key, lap_number, tyre_set,
     wear_fl, wear_fr, wear_rl, wear_rr, car_key, track_key, captured_at)
  values
    (v_device, 'syn', 'syn-auto-b', 1, 1, 80, 80, 80, 80,
     'syn-car-b', 'syn-track-b', v_t + interval '200 minutes');

  v_est := public.pitwall_tyre_estimate_v2(v_device);
  perform pg_temp.eis('basis is de stint van auto A',
                      v_est #>> '{basis,car_key}' = 'syn-car-a'
                      and (v_est #>> '{basis,rondes_in_basis}')::integer = 9);
  perform pg_temp.eis('wear_now komt niet uit auto B',
                      (v_est ->> 'wear_now')::numeric = 95.556
                      and v_est ->> 'wear_now_car_key' = 'syn-car-a');
  perform pg_temp.eis('auto/baan wijkt af -> herkomst estimated',
                      v_est ->> 'provenance' = 'estimated'
                      and v_est ->> 'voorlopig' = 'true');

  -- ------------------------------------------------------------------------
  -- 6. Eindstand van het testapparaat: 13 blokken, 9 met een helling.
  -- ------------------------------------------------------------------------
  select count(*), count(*) filter (where heeft_helling) into v_n, v_graded
    from public.tyre_stint_deltas where device_id = v_device;
  perform pg_temp.eis('dertien blokken, negen met helling', v_n = 13 and v_graded = 9);

  v_est := public.pitwall_tyre_estimate_v2(v_device);
  perform pg_temp.eis('graad A op negen hellingen',
                      v_est ->> 'grade' = 'A'
                      and (v_est ->> 'stints')::integer = 9
                      and (v_est ->> 'stints_totaal')::integer = 13);

  select * into v_cov from public.tyre_coverage(50)
   where car_key = 'syn-car-a';
  perform pg_temp.eis('dekking per auto: labels zijn hellingen, geen blokken',
                      v_cov.wear_labels = 1 and v_cov.grade = 'C');
end
$test$;

rollback;
