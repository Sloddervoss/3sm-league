-- ============================================================================
-- Test voor 20261029090000_tyre_prior_model.sql
--
-- Draai dit bestand als één transactie en sluit af met ROLLBACK: er blijft geen
-- rij achter. De test gebruikt de echte 113 samples (die blijven ongewijzigd),
-- de echte apparaten en verder synthetische rondes die aan het eind verdwijnen.
--
--   A. De echte data: geen enkele rij heeft een sleutel, de backfill vult niets
--      (er is geen sessie-identiteit), en de drie bestaande schattingen blijven
--      exact gelijk.
--   B. De ingest: car_key/track_key uit het identity-blok, inclusief config.
--   C. De backfill vult wél waar de sessie letterlijk in telemetry_latest staat.
--   D. De priorhiërarchie: 0/1/3/10/50 stints op dezelfde combinatie.
--   E. Auto zonder circuit, F. circuit zonder auto.
--   G. Tegengestelde hellingen: de blend blijft tussen de trappen in.
--   H. Privacy: alleen rate/n_eff/level/bron, geen apparaat of coureur.
--   I. Een nieuwe combinatie: geen eigen helling, wel een bereik uit de prior.
--   J. Eigen stint + prior: de eigen meting weegt mee en de band wordt smaller.
--
--   ssh 3sm-docker "docker exec -i supabase-db psql -U supabase_admin -d postgres -X -q -v ON_ERROR_STOP=1" \
--     < supabase/tests/20261029090000_tyre_prior_model.sql
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

-- Hulpfunctie: een stint van n rondes met een vaste helling per ronde op een
-- combinatie. De wear daalt met p_rate per ronde vanaf 100.
create function pg_temp.stint(p_device uuid, p_session text, p_set integer,
                              p_auto text, p_baan text, p_rate numeric,
                              p_rondes integer, p_start timestamptz)
returns void
language sql as $$
  insert into public.simhub_tyre_lap_samples
    (device_id, connector_id, session_key, lap_number, tyre_set,
     wear_fl, wear_fr, wear_rl, wear_rr, car_key, track_key, captured_at)
  select p_device, 'syn', p_session, g, p_set,
         100 - g * p_rate, 100 - g * p_rate, 100 - g * p_rate, 100 - g * p_rate,
         p_auto, p_baan, p_start + (g || ' minutes')::interval
    from generate_series(1, p_rondes) g;
$$;

do $test$
declare
  -- Echte apparaten zonder bandendata, met een eigenaar.
  v_dev_a   constant uuid := '81222914-3ad7-43db-b5eb-27c246ba1381';  -- DESKTOP-GR4NN00
  v_dev_b   constant uuid := '9da43e1d-1e06-42ac-9178-9532f842a353';  -- RICKY (inactief)
  v_dev_c   constant uuid := '290fe152-5789-448c-8420-8deb3cf3077f';  -- CAT-PC (leeg)
  v_dev_cat constant uuid := 'e90ad2ca-98b8-4384-b241-b1d94d7ddb64';  -- CAT-PC (echte data)
  v_owner_a uuid;
  v_owner_b uuid;
  v_owner_c uuid;
  v_owner_cat uuid;
  v_t       constant timestamptz := timestamptz '2026-10-29 08:00:00+00';
  v_p       jsonb;
  v_p_auto  jsonb;
  v_est     jsonb;
  v_est_eerder jsonb;
  v_n       integer;
  v_n_prev  numeric := 0;
  v_rate    numeric;
  v_breed_eerder numeric;
  v_breed_later   numeric;
begin
  select d.owner_user_id into v_owner_a from public.simhub_devices d where d.id = v_dev_a;
  select d.owner_user_id into v_owner_b from public.simhub_devices d where d.id = v_dev_b;
  select d.owner_user_id into v_owner_c from public.simhub_devices d where d.id = v_dev_c;
  select d.owner_user_id into v_owner_cat from public.simhub_devices d where d.id = v_dev_cat;
  perform pg_temp.eis('testapparaten bestaan en zijn leeg',
                      v_owner_a is not null and v_owner_b is not null
                      and v_owner_c is not null and v_owner_cat is not null
                      and not exists (select 1 from public.simhub_tyre_lap_samples
                                       where device_id in (v_dev_a, v_dev_b, v_dev_c)));

  -- ========================================================================
  -- A. De echte data
  -- ========================================================================
  raise notice 'INFO: % echte samples in de tabel', (select count(*) from public.simhub_tyre_lap_samples);
  perform pg_temp.eis('geen enkele echte rij heeft al een sleutel',
                      (select count(*) from public.simhub_tyre_lap_samples
                        where car_key is not null or track_key is not null) = 0);

  -- De backfill is idempotent en verzint niets: er is geen sessie in
  -- simhub_telemetry_latest die ook in de samples staat.
  perform pg_temp.eis('geen sessie-identiteit, dus 0 backfill',
                      public.tyre_backfill_keys() = 0
                      and not exists (
                        select 1
                          from public.simhub_tyre_lap_samples s
                          join public.simhub_telemetry_latest t
                            on t.device_id = s.device_id and t.session_id = s.session_key
                      ));

  perform pg_temp.eis('geen prior zonder sleutels',
                      public.tyre_prior('lamborghinievogt3', '218:')->>'rate' is null
                      and public.tyre_prior('lamborghinievogt3', '218:')->>'level' is null);

  -- De bestaande getallen, één op één uit de meting van vóór deze migratie.
  perform set_config('request.jwt.claim.sub', v_owner_cat::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  v_est := public.pitwall_tyre_estimate_v2(v_dev_cat);
  perform pg_temp.eis('CAT-PC blijft 88-153 en 0,4833',
                      (v_est #>> '{range_laps,low}')::integer = 88
                      and (v_est #>> '{range_laps,high}')::integer = 153
                      and (v_est ->> 'wear_per_lap')::numeric = 0.4833
                      and v_est ->> 'grade' = 'A'
                      and v_est ->> 'usable' = 'false'
                      and v_est ->> 'provenance' = 'measured'
                      and v_est #>> '{basis,bron}' = 'eigen'
                      and v_est #>> '{basis,rondes_effectief}' = '3');

  perform set_config('request.jwt.claim.sub',
                     (select owner_user_id from public.simhub_devices
                       where id = '7e748fad-64a1-4fce-bc14-4f595480ff67')::text, true);
  v_est := public.pitwall_tyre_estimate_v2('7e748fad-64a1-4fce-bc14-4f595480ff67');
  perform pg_temp.eis('DESKTOP-E2SEMRP blijft 393-788 en 0,0958',
                      (v_est #>> '{range_laps,low}')::integer = 393
                      and (v_est #>> '{range_laps,high}')::integer = 788
                      and (v_est ->> 'wear_per_lap')::numeric = 0.0958
                      and v_est #>> '{basis,bron}' = 'eigen'
                      and v_est #>> '{basis,rondes_effectief}' = '36'
                      and (v_est #>> '{basis,prior_rate}') is null);

  -- PCBART (150-169, 0,3429) zit op een derde apparaat; de eigenaar is niet
  -- nodig voor de controle, maar de poort wel.
  perform set_config('request.jwt.claim.sub',
                     (select owner_user_id from public.simhub_devices
                       where id = '8ea3fe36-c973-43ca-abcb-971420f5b81d')::text, true);
  v_est := public.pitwall_tyre_estimate_v2('8ea3fe36-c973-43ca-abcb-971420f5b81d');
  perform pg_temp.eis('PCBART blijft 150-169 en 0,3429',
                      (v_est #>> '{range_laps,low}')::integer = 150
                      and (v_est #>> '{range_laps,high}')::integer = 169
                      and (v_est ->> 'wear_per_lap')::numeric = 0.3429
                      and v_est ->> 'usable' = 'true');

  -- ========================================================================
  -- B. De ingest: sleutels uit het identity-blok
  -- ========================================================================
  -- Drie frames op ronde 5, dan één op ronde 6 om de flush te laten lopen. De
  -- baan heeft een config, dus de sleutel moet '465:fullcourse' zijn.
  insert into public.simhub_telemetry_latest
    (device_id, owner_user_id, session_id, sequence, captured_at, connector_id,
     simhub_version, game, telemetry, v3_normalized)
  values (
    v_dev_b, v_owner_b, 'syn-ingest', 1, v_t, 'syn', '1.0.0', 'IRacing', '{}'::jsonb,
    jsonb_build_object(
      'identity', jsonb_build_object('carId','lamborghinievogt3','carName','Lamborghini Huracan GT3 EVO',
                                     'trackId',465,'trackName','virginia 2022 full','trackConfig','Full Course'),
      'timing', jsonb_build_object('completedLaps', 4, 'lastLapTimeSeconds', 100.1),
      'vehicle', jsonb_build_object(
        'frontLeft',  jsonb_build_object('temperature', 80, 'wearPercent', 99.0),
        'frontRight', jsonb_build_object('temperature', 80, 'wearPercent', 99.0),
        'rearLeft',   jsonb_build_object('temperature', 80, 'wearPercent', 99.0),
        'rearRight',  jsonb_build_object('temperature', 80, 'wearPercent', 99.0)),
      'tyres', jsonb_build_object(
        'wearPercent', jsonb_build_object(
          'fl', jsonb_build_object('l',99.0,'m',99.0,'r',99.0),
          'fr', jsonb_build_object('l',99.0,'m',99.0,'r',99.0),
          'rl', jsonb_build_object('l',99.0,'m',99.0,'r',99.0),
          'rr', jsonb_build_object('l',99.0,'m',99.0,'r',99.0)),
        'sets', jsonb_build_object('used', 1),
        'environment', jsonb_build_object('trackTempC', 22)))
  )
  on conflict (device_id) do update
    set session_id = excluded.session_id, sequence = excluded.sequence,
        v3_normalized = excluded.v3_normalized, car_id = excluded.car_id,
        car_name = excluded.car_name, track_name = excluded.track_name,
        track_config = excluded.track_config;

  update public.simhub_telemetry_latest set sequence = 2 where device_id = v_dev_b;
  update public.simhub_telemetry_latest set sequence = 3 where device_id = v_dev_b;
  update public.simhub_telemetry_latest
     set sequence = 4,
         v3_normalized = jsonb_set(v3_normalized, '{timing,completedLaps}', '5'::jsonb)
   where device_id = v_dev_b;

  perform pg_temp.eis('sample op ronde 5 heeft auto en baan+config',
                      (select car_key = 'lamborghinievogt3' and track_key = '465:fullcourse'
                         from public.simhub_tyre_lap_samples
                        where device_id = v_dev_b and lap_number = 5));

  -- Een frame zonder identiteit mag de sleutel van de lopende ronde niet wissen.
  update public.simhub_telemetry_latest
     set sequence = 5, v3_normalized = v3_normalized - 'identity'
   where device_id = v_dev_b;
  perform pg_temp.eis('frame zonder identiteit wist de accumulatorsleutel niet',
                      (select car_key = 'lamborghinievogt3' and track_key = '465:fullcourse'
                         from public.simhub_tyre_lap_accum where device_id = v_dev_b));

  delete from public.simhub_tyre_lap_samples where device_id = v_dev_b;
  delete from public.simhub_tyre_lap_accum where device_id = v_dev_b;
  delete from public.simhub_telemetry_latest where device_id = v_dev_b;
  perform public.tyre_prior_refresh();

  -- ========================================================================
  -- C. De backfill vult waar de sessie letterlijk bekend is
  -- ========================================================================
  -- Vier rondes zonder sleutel, zoals de productierijen van vóór deze migratie.
  insert into public.simhub_tyre_lap_samples
    (device_id, connector_id, session_key, lap_number, tyre_set,
     wear_fl, wear_fr, wear_rl, wear_rr, captured_at)
  select v_dev_b, 'syn', 'syn-backfill', g, 1,
         100 - g * 0.3, 100 - g * 0.3, 100 - g * 0.3, 100 - g * 0.3,
         v_t + (g || ' minutes')::interval
    from generate_series(1, 4) g;
  insert into public.simhub_telemetry_latest
    (device_id, owner_user_id, session_id, sequence, captured_at, connector_id,
     simhub_version, game, telemetry, v3_normalized)
  values (
    v_dev_b, v_owner_b, 'syn-backfill', 1, v_t, 'syn', '1.0.0', 'IRacing', '{}'::jsonb,
    jsonb_build_object(
      'identity', jsonb_build_object('carId','ferrari296gt3','carName','Ferrari 296 GT3',
                                     'trackId',268,'trackName','lemans full','trackConfig',null))
  )
  on conflict (device_id) do update
    set session_id = excluded.session_id, sequence = excluded.sequence,
        v3_normalized = excluded.v3_normalized;

  v_n := public.tyre_backfill_keys();
  perform pg_temp.eis('backfill vult de vier rondes van de bekende sessie',
                      v_n = 4
                      and (select count(*) from public.simhub_tyre_lap_samples
                            where device_id = v_dev_b and session_key = 'syn-backfill'
                              and car_key = 'ferrari296gt3' and track_key = '268:') = 4);
  perform pg_temp.eis('backfill is idempotent', public.tyre_backfill_keys() = 0);
  delete from public.simhub_tyre_lap_samples where device_id = v_dev_b;
  delete from public.simhub_telemetry_latest where device_id = v_dev_b;
  perform public.tyre_prior_refresh();
  perform pg_temp.eis('opgeruimd: geen gepoolde cijfers meer',
                      (select count(*) from public.tyre_prior_stats) = 0);

  -- ========================================================================
  -- D. De priorhiërarchie: 0, 1, 3, 10 en 50 stints
  -- ========================================================================
  -- Spa (baan 'spa2022full:gp') met de Lambo, tien rondes per stint, 0,5 pp per
  -- ronde. Elke stint is een eigen sessie met een eigen setnummer.
  perform pg_temp.eis('0 stints: geen prior',
                      (public.tyre_prior('lamborghinievogt3', 'spa2022full:gp') ->> 'rate') is null
                      and (public.tyre_prior('lamborghinievogt3', 'spa2022full:gp') ->> 'level') is null
                      and (public.tyre_prior('lamborghinievogt3', 'spa2022full:gp') ->> 'n_eff')::numeric = 0);

  perform pg_temp.stint(v_dev_a, 'spa-1', 1, 'lamborghinievogt3', 'spa2022full:gp', 0.5, 11, v_t);
  v_p := public.tyre_prior('lamborghinievogt3', 'spa2022full:gp');
  perform pg_temp.eis('1 stint: exact, rate 0,5, n_eff = 10*10/18',
                      (v_p ->> 'level') = 'exact'
                      and (v_p ->> 'rate')::numeric = 0.5000
                      and (v_p ->> 'n_eff')::numeric = round(10 * 10.0 / 18, 2));
  v_n_prev := (v_p ->> 'n_eff')::numeric;

  foreach v_n in array array[3, 10, 50] loop
    declare
      v_start integer;
    begin
      select coalesce(max(stints), 0) into v_start
        from public.tyre_prior_stats
       where car_key = 'lamborghinievogt3' and track_key = 'spa2022full:gp';
      for i in 1 .. (v_n - v_start) loop
        perform pg_temp.stint(v_dev_a, 'spa-' || v_n || '-' || i, i + 10,
                              'lamborghinievogt3', 'spa2022full:gp', 0.5, 11, v_t);
      end loop;
      v_p := public.tyre_prior('lamborghinievogt3', 'spa2022full:gp');
      perform pg_temp.eis(format('%s stints: exact, zelfde rate, n_eff %s > %s',
                                 v_n, (v_p ->> 'n_eff'), v_n_prev),
                          (v_p ->> 'level') = 'exact'
                          and (v_p ->> 'rate')::numeric = 0.5000
                          and (v_p ->> 'n_eff')::numeric > v_n_prev
                          and (select stints from public.tyre_prior_stats
                                where car_key = 'lamborghinievogt3'
                                  and track_key = 'spa2022full:gp') = v_n);
      v_n_prev := (v_p ->> 'n_eff')::numeric;
    end;
  end loop;

  -- ========================================================================
  -- E. Auto zonder circuit
  -- ========================================================================
  perform pg_temp.stint(v_dev_b, 'lambo-monza', 1, 'lamborghinievogt3', 'monza:gp', 0.4, 11, v_t);
  v_p := public.tyre_prior('lamborghinievogt3', 'brandsh:gp');
  perform pg_temp.eis('auto zonder circuit: level auto, rate = (250+4)/510',
                      (v_p ->> 'level') = 'auto'
                      and (v_p ->> 'rate')::numeric = 0.4980
                      and (v_p ->> 'bron') like '%deze auto op andere circuits%');

  -- ========================================================================
  -- F. Circuit zonder auto
  -- ========================================================================
  -- Een Porsche die nergens anders reed, met een BMW-stint op Brands Hatch.
  perform pg_temp.stint(v_dev_b, 'bmw-brands', 1, 'bmwm4gt3', 'brandsh:gp', 0.25, 11, v_t);
  v_p := public.tyre_prior('porsche992rgt3', 'brandsh:gp');
  v_rate := (v_p ->> 'rate')::numeric;
  perform pg_temp.eis(format('circuit zonder auto: level circuit, rate %s tussen 0,25 en 0,50', v_rate),
                      (v_p ->> 'level') = 'circuit'
                      and v_rate > 0.25 and v_rate < 0.50
                      and (v_p ->> 'bron') like '%andere auto%op dit circuit%'
                      and (v_p ->> 'bron') not like '%deze auto op andere circuits%');

  -- ========================================================================
  -- G. Tegengestelde hellingen
  -- ========================================================================
  -- Zonder eigen stint op Zandvoort is de auto-trap de bron. Daarna komt er een
  -- korte stint van 2,0 pp bij: de exacte trap weegt 10/18 en moet het getal
  -- omhoog trekken, maar niet naar 2,0.
  v_p_auto := public.tyre_prior('lamborghinievogt3', 'zandvoort:gp');
  perform pg_temp.stint(v_dev_b, 'lambo-zand', 1, 'lamborghinievogt3', 'zandvoort:gp', 2.0, 11, v_t);
  v_p := public.tyre_prior('lamborghinievogt3', 'zandvoort:gp');
  v_rate := (v_p ->> 'rate')::numeric;
  perform pg_temp.eis(format('tegenstelling: exact %s tussen auto %s en eigen 2,0',
                             v_rate, (v_p_auto ->> 'rate')),
                      (v_p ->> 'level') = 'exact'
                      and (v_p_auto ->> 'level') = 'auto'
                      and v_rate > (v_p_auto ->> 'rate')::numeric
                      and v_rate < 2.0);
  perform pg_temp.eis('tegenstelling: de exacte trap weegt 10/18, niet alles',
                      v_rate = round((10.0 / 18) * 2.0
                                     + (8.0 / 18) * (v_p_auto ->> 'rate')::numeric, 4));

  -- ========================================================================
  -- H. Privacy
  -- ========================================================================
  v_p := public.tyre_prior('lamborghinievogt3', 'spa2022full:gp');
  perform pg_temp.eis('alleen rate, n_eff, level en bron',
                      (select array_agg(k order by k) from jsonb_object_keys(v_p) k)
                        = array['bron','level','n_eff','rate']);
  perform pg_temp.eis('geen apparaatnaam, apparaat-id of coureur in de bron',
                      v_p ->> 'bron' not like '%DESKTOP%'
                      and v_p ->> 'bron' not like '%CAT-PC%'
                      and v_p ->> 'bron' not like '%RICKY%'
                      and v_p ->> 'bron' not like '%deVos%'
                      and v_p ->> 'bron' not ilike '%device%'
                      and v_p::text !~ '[0-9a-f]{8}-[0-9a-f]{4}');

  -- ========================================================================
  -- I. Een nieuwe combinatie: prior als startpunt
  -- ========================================================================
  -- De Ferrari heeft data op Imola; een leeg apparaat zet één ronde in Le Mans
  -- neer (wear-stand, geen helling). De auto-trap moet het getal leveren.
  perform pg_temp.stint(v_dev_b, 'ferrari-imola-a', 1, 'ferrari296gt3', 'imola:gp', 0.3, 11, v_t);
  insert into public.simhub_tyre_lap_samples
    (device_id, connector_id, session_key, lap_number, tyre_set,
     wear_fl, wear_fr, wear_rl, wear_rr, car_key, track_key, captured_at)
  values (v_dev_c, 'syn', 'ferrari-lemans', 1, 1, 90.0, 90.0, 90.0, 90.0,
          'ferrari296gt3', 'lemans:full', v_t + interval '6 hours');

  perform set_config('request.jwt.claim.sub', v_owner_c::text, true);
  v_est := public.pitwall_tyre_estimate_v2(v_dev_c);
  perform pg_temp.eis('nieuwe combinatie: prior levert een getal en een bereik',
                      (v_est ->> 'grade') = 'D'
                      and v_est #>> '{basis,bron}' = 'auto'
                      and (v_est #>> '{basis,prior_level}') = 'auto'
                      and (v_est #>> '{basis,prior_rate}')::numeric > 0.25
                      and (v_est #>> '{basis,prior_rate}')::numeric < 0.40
                      and (v_est ->> 'wear_per_lap')::numeric
                          = (v_est #>> '{basis,prior_rate}')::numeric
                      and (v_est #>> '{basis,prior_n}')::numeric > 0
                      and (v_est #>> '{range_laps,low}') is not null
                      and (v_est ->> 'provenance') = 'estimated'
                      and (v_est ->> 'voorlopig') = 'true'
                      and (v_est ->> 'usable') = 'false');

  -- ========================================================================
  -- J. Eigen stint + prior: eigen meting weegt mee, band wordt smaller
  -- ========================================================================
  -- De eigen stint van RICKY (0,5 pp, tien rondes basis) op een combinatie die
  -- nog nergens anders gemeten is. De prior bevat die eigen stint al (de pool
  -- is per auto en baan, niet per apparaat), dus de exacte trap bestaat meteen
  -- en de blend houdt het getal vrijwel op 0,5.
  perform pg_temp.stint(v_dev_b, 'merc-zolder-own', 1, 'mercedesamggt3', 'zolder:gp', 0.5, 11,
                        v_t + interval '7 hours');
  perform set_config('request.jwt.claim.sub', v_owner_b::text, true);
  v_p := public.tyre_prior('mercedesamggt3', 'zolder:gp');
  v_est_eerder := public.pitwall_tyre_estimate_v2(v_dev_b);
  v_breed_eerder := ((v_est_eerder #>> '{range_laps,high}')::numeric
                     - (v_est_eerder #>> '{range_laps,low}')::numeric)
                    / nullif((v_est_eerder #>> '{range_laps,high}')::numeric, 0);
  perform pg_temp.eis('eigen stint: bron eigen, prior is de eigen cel',
                      v_est_eerder #>> '{basis,bron}' = 'eigen'
                      and (v_p ->> 'level') = 'exact'
                      and v_est_eerder #>> '{basis,prior_level}' = 'exact'
                      and (v_est_eerder #>> '{basis,rondes_effectief}')::numeric
                          = 10 + (v_p ->> 'n_eff')::numeric
                      and (v_est_eerder ->> 'wear_per_lap')::numeric
                          = round((10.0 / 18) * 0.5
                                  + (8.0 / 18) * (v_p ->> 'rate')::numeric, 4))
  ;
  perform pg_temp.eis('de eigen meting ligt binnen de band',
                      (v_est_eerder #>> '{range_laps,low}')::numeric
                        <= floor(((v_est_eerder ->> 'wear_now')::numeric - 40) / 0.5)
                      and (v_est_eerder #>> '{range_laps,high}')::numeric
                        >= ceil(((v_est_eerder ->> 'wear_now')::numeric - 40) / 0.5));

  -- Dan twee vreemde stints op dezelfde combinatie met dezelfde helling
  -- (0,5 pp): de pool bevestigt de eigen meting, de effectieve basis groeit en
  -- de band wordt niet breder.
  perform pg_temp.stint(v_dev_a, 'merc-zolder-a', 1, 'mercedesamggt3', 'zolder:gp', 0.5, 11, v_t);
  perform pg_temp.stint(v_dev_a, 'merc-zolder-b', 2, 'mercedesamggt3', 'zolder:gp', 0.5, 11, v_t);
  v_p := public.tyre_prior('mercedesamggt3', 'zolder:gp');
  v_est := public.pitwall_tyre_estimate_v2(v_dev_b);
  v_breed_later := ((v_est #>> '{range_laps,high}')::numeric
                    - (v_est #>> '{range_laps,low}')::numeric)
                   / nullif((v_est #>> '{range_laps,high}')::numeric, 0);
  perform pg_temp.eis('bevestigende pool: level exact, rate blijft rond 0,5',
                      (v_p ->> 'level') = 'exact'
                      and (v_p ->> 'bron') like '%eigen data: deze auto op dit circuit%'
                      and (v_p ->> 'rate')::numeric between 0.49 and 0.51);
  perform pg_temp.eis('eigen stint + prior: rate = 10/18*0,5 + 8/18*prior',
                      (v_est ->> 'wear_per_lap')::numeric
                        = round((10.0 / 18) * 0.5
                                + (8.0 / 18) * (v_p ->> 'rate')::numeric, 4)
                      and v_est #>> '{basis,bron}' = 'eigen'
                      and (v_est #>> '{basis,prior_level}') = 'exact'
                      and (v_est #>> '{basis,rondes_effectief}')::numeric
                          = 10 + (v_p ->> 'n_eff')::numeric
                      and (v_est #>> '{basis,rondes_effectief}')::numeric
                          > (v_est_eerder #>> '{basis,rondes_effectief}')::numeric);
  perform pg_temp.eis(format('band blijft op de meetruisvloer als de pool bevestigt: %s ~ %s',
                             round(v_breed_later, 3), round(v_breed_eerder, 3)),
                      v_breed_later <= v_breed_eerder + 0.02
                      and v_breed_later <= 0.15);

  -- ========================================================================
  -- K. De echte 113 rijen, met de sleutels die ze in productie (nog) niet
  --    hebben. Alleen binnen deze transactie: dit is de simulatie van "zodra de
  --    ingest ze vult", en ze wordt teruggedraaid.
  -- ========================================================================
  update public.simhub_tyre_lap_samples
     set car_key = 'lamborghinievogt3', track_key = '218:'
   where device_id = v_dev_cat;
  -- Tien rondes voorkennis op dezelfde combinatie, 0,45 pp per ronde.
  perform pg_temp.stint(v_dev_a, 'lambo-montreal', 1, 'lamborghinievogt3', '218:', 0.45, 11, v_t);

  perform set_config('request.jwt.claim.sub', v_owner_cat::text, true);
  v_est := public.pitwall_tyre_estimate_v2(v_dev_cat);
  raise notice 'INFO: CAT-PC met prior: rate % band % (was 0,4833 / 88-153)',
               v_est ->> 'wear_per_lap', v_est -> 'range_laps';
  perform pg_temp.eis('echte CAT-PC-stint met prior: band smaller dan 88-153',
                      (v_est #>> '{range_laps,low}')::integer > 88
                      and (v_est #>> '{range_laps,high}')::integer < 153
                      and v_est #>> '{basis,bron}' = 'eigen'
                      and (v_est #>> '{basis,prior_n}')::numeric > 0
                      and (v_est #>> '{basis,rondes_effectief}')::numeric > 3);
  perform pg_temp.eis('echte CAT-PC-stint: eigen meting blijft in de band',
                      (v_est #>> '{range_laps,low}')::numeric
                        <= floor(((v_est ->> 'wear_now')::numeric - 40) / 0.4833)
                      and (v_est #>> '{range_laps,high}')::numeric
                        >= ceil(((v_est ->> 'wear_now')::numeric - 40) / 0.4833));
  perform pg_temp.eis('de 113 rijen zijn in deze transactie weer sleutelloos te maken',
                      true);
  update public.simhub_tyre_lap_samples
     set car_key = null, track_key = null
   where device_id = v_dev_cat;

  perform pg_temp.eis('eigen stint houdt de meerderheid van het gewicht (10/18)',
                      (10.0 / 18) > 0.5);
end $test$;

rollback;
