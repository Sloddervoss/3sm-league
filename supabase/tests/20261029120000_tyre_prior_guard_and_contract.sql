-- ============================================================================
-- Test voor 20261029120000_tyre_prior_guard_and_contract.sql
--
-- Draai dit bestand als één transactie en sluit af met ROLLBACK: er blijft geen
-- rij achter. De test gebruikt de echte 113 samples en de echte apparaten;
-- alle synthetische rondes verdwijnen aan het eind.
--
--   A. Het truncate-gat: anon en authenticated hebben geen enkel recht, en een
--      echte poging tot TRUNCATE/SELECT als anon wordt geweigerd.
--   B. De echte data: de drie bestaande schattingen blijven exact gelijk
--      (CAT-PC 88-153, PCBART 150-169, DESKTOP 393-788) en de nieuwe velden
--      staan er met de juiste waarde.
--   C. Gesloten stints: een lopende stint telt niet, een gesloten stint wel.
--   D. De hiërarchie: 0/1/3/10/50 stints, met de echte aantallen ernaast.
--   E. De eigen stint telt één keer: alleen eigen data in de pool verandert de
--      band niet, andermans data wel. Met de oude dubbeltelling als contrast.
--   F. De trap 'exact' is andermans data en heet niet langer "eigen data".
--   G. Incrementeel onderhoud is gelijk aan een volledige herberekening, ook na
--      updates en deletes.
--   H. 20 000 rondes: een normale lap kost minder dan 50 ms.
--   I. Privacy: geen apparaat in de uitvoer van tyre_prior(), geen grants.
--
--   ssh 3sm-docker "docker exec -i supabase-db psql -U supabase_admin -d postgres -X -q -v ON_ERROR_STOP=1" \
--     < supabase/tests/20261029120000_tyre_prior_guard_and_contract.sql
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

-- Een stint van n rondes met een vaste helling per ronde, in één sessie.
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

-- Een sessie afsluiten: één ronde in een nieuwe sessie. Daarmee is de vorige
-- sessie niet meer de nieuwste van het apparaat en tellen haar stints mee. De
-- sluitsessie zelf heeft één ronde (span 0) en levert nooit een bijdrage.
create function pg_temp.sluit(p_device uuid, p_auto text, p_baan text, p_start timestamptz)
returns void
language sql as $$
  insert into public.simhub_tyre_lap_samples
    (device_id, connector_id, session_key, lap_number, tyre_set,
     wear_fl, wear_fr, wear_rl, wear_rr, car_key, track_key, captured_at)
  values (p_device, 'syn', 'sluit-' || gen_random_uuid(), 1, 1,
          100, 100, 100, 100, p_auto, p_baan, p_start + interval '2 hours');
$$;

create function pg_temp.sessie_owner(p_device uuid) returns uuid
language sql stable as $$
  select d.owner_user_id from public.simhub_devices d where d.id = p_device;
$$;

-- Een momentopname van de pool zonder tijdstempels, zodat "incrementeel" en
-- "volledig herbouwd" op inhoud vergeleken kunnen worden.
create function pg_temp.pool_snapshot() returns jsonb
language sql stable as $$
  select jsonb_build_object(
    'stats', coalesce((
      select jsonb_agg(jsonb_build_array(s.car_key, s.track_key, s.stints, s.rondes,
                                         s.sum_wear_fl, s.sum_wear_fr, s.sum_wear_rl, s.sum_wear_rr,
                                         s.rondes_fl, s.rondes_fr, s.rondes_rl, s.rondes_rr)
                       order by s.car_key, s.track_key)
        from public.tyre_prior_stats s), '[]'::jsonb),
    'contrib', coalesce((
      select jsonb_agg(jsonb_build_array(c.device_id, c.session_key, c.set_number, c.lap_from,
                                         c.car_key, c.track_key, c.rondes,
                                         c.sum_wear_fl, c.sum_wear_fr, c.sum_wear_rl, c.sum_wear_rr,
                                         c.rondes_fl, c.rondes_fr, c.rondes_rl, c.rondes_rr)
                       order by c.device_id, c.session_key, c.set_number, c.lap_from)
        from public.tyre_prior_contrib c), '[]'::jsonb));
$$;

do $test$
declare
  v_dev_a   constant uuid := '81222914-3ad7-43db-b5eb-27c246ba1381';  -- DESKTOP-GR4NN00
  v_dev_b   constant uuid := '9da43e1d-1e06-42ac-9178-9532f842a353';  -- RICKY
  v_dev_c   constant uuid := '290fe152-5789-448c-8420-8deb3cf3077f';  -- CAT-PC (leeg)
  v_dev_cat constant uuid := 'e90ad2ca-98b8-4384-b241-b1d94d7ddb64';  -- CAT-PC (echte data)
  v_t       constant timestamptz := timestamptz '2026-10-29 08:00:00+00';
  v_bulk    constant timestamptz := timestamptz '2027-01-01 00:00:00+00';
  v_owner_a uuid;
  v_owner_b uuid;
  v_owner_c uuid;
  v_owner_cat uuid;
  v_p       jsonb;
  v_est     jsonb;
  v_est2    jsonb;
  v_n       integer;
  v_n_prev  numeric := 0;
  v_breed_eigen numeric;
  v_breed_ander numeric;
  v_oud_breed   numeric;
  v_oud_n_eff   numeric;
  v_laps        numeric;
  v_schaal      numeric;
  v_oud_low     numeric;
  v_oud_high    numeric;
  v_voor    jsonb;
  v_na      jsonb;
  v_t0      timestamptz;
  v_ms      numeric;
  v_best    numeric := 999999;
  v_select_ok boolean;
  v_trunc_ok  boolean;
begin
  select pg_temp.sessie_owner(v_dev_a), pg_temp.sessie_owner(v_dev_b),
         pg_temp.sessie_owner(v_dev_c), pg_temp.sessie_owner(v_dev_cat)
    into v_owner_a, v_owner_b, v_owner_c, v_owner_cat;
  perform pg_temp.eis('testapparaten bestaan en zijn leeg',
                      v_owner_a is not null and v_owner_b is not null
                      and v_owner_c is not null and v_owner_cat is not null
                      and not exists (select 1 from public.simhub_tyre_lap_samples
                                       where device_id in (v_dev_a, v_dev_b, v_dev_c)));

  -- ========================================================================
  -- A. Het truncate-gat
  -- ========================================================================
  perform pg_temp.eis('anon en authenticated hebben geen enkel recht op de pool',
    not exists (
      select 1
        from unnest(array['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']) p
       where has_table_privilege('anon', 'public.tyre_prior_stats', p)
          or has_table_privilege('authenticated', 'public.tyre_prior_stats', p)
          or has_table_privilege('anon', 'public.tyre_prior_contrib', p)
          or has_table_privilege('authenticated', 'public.tyre_prior_contrib', p)
          or has_table_privilege('service_role', 'public.tyre_prior_stats', p)
          or has_table_privilege('service_role', 'public.tyre_prior_contrib', p)));

  perform pg_temp.eis('RLS staat aan en er zijn geen policies',
                      (select relrowsecurity from pg_class where oid = 'public.tyre_prior_stats'::regclass)
                      and (select relrowsecurity from pg_class where oid = 'public.tyre_prior_contrib'::regclass)
                      and not exists (select 1 from pg_policies
                                       where schemaname = 'public'
                                         and tablename in ('tyre_prior_stats','tyre_prior_contrib')));

  -- De echte aanval: als anon de tabel leegmaken.
  v_trunc_ok := false;
  begin
    set local role anon;
    begin
      truncate public.tyre_prior_stats;
      v_trunc_ok := true;
    exception when insufficient_privilege then
      v_trunc_ok := false;
    end;
    reset role;
  end;
  perform pg_temp.eis('anon kan de pool niet truncaten', v_trunc_ok = false);

  v_select_ok := false;
  begin
    set local role anon;
    begin
      perform 1 from public.tyre_prior_stats limit 1;
      v_select_ok := true;
    exception when insufficient_privilege then
      v_select_ok := false;
    end;
    reset role;
  end;
  perform pg_temp.eis('anon kan de pool niet lezen', v_select_ok = false);

  perform pg_temp.eis('de triggerfuncties zijn niet uitvoerbaar voor een clientrol',
                      not has_function_privilege('authenticated',
                            'public.tyre_prior_sync_session(uuid, text)', 'EXECUTE')
                      and not has_function_privilege('anon',
                            'public.tyre_prior_sync_session(uuid, text)', 'EXECUTE')
                      and not has_function_privilege('authenticated',
                            'public.tyre_prior_refresh(text, text)', 'EXECUTE'));

  -- ========================================================================
  -- B. De echte data: de bestaande getallen mogen niet verschuiven
  -- ========================================================================
  raise notice 'INFO: % echte samples in de tabel', (select count(*) from public.simhub_tyre_lap_samples);

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
  perform pg_temp.eis('CAT-PC: lege pool, dus prior_rate null en prior_rondes 0',
                      v_est #>> '{basis,prior_rate}' is null
                      and (v_est #>> '{basis,prior_n}')::numeric = 0
                      and (v_est #>> '{basis,prior_rondes}')::integer = 0
                      and (v_est #>> '{basis,prior_stints}')::integer = 0);

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

  perform set_config('request.jwt.claim.sub',
                     (select owner_user_id from public.simhub_devices
                       where id = '8ea3fe36-c973-43ca-abcb-971420f5b81d')::text, true);
  v_est := public.pitwall_tyre_estimate_v2('8ea3fe36-c973-43ca-abcb-971420f5b81d');
  perform pg_temp.eis('PCBART blijft 150-169 en 0,3429',
                      (v_est #>> '{range_laps,low}')::integer = 150
                      and (v_est #>> '{range_laps,high}')::integer = 169
                      and (v_est ->> 'wear_per_lap')::numeric = 0.3429
                      and v_est ->> 'usable' = 'true');

  perform pg_temp.eis('de pool is nog leeg',
                      (select count(*) from public.tyre_prior_stats) = 0
                      and (select count(*) from public.tyre_prior_contrib) = 0);

  -- ========================================================================
  -- E1. De eigen stint telt één keer: zonder andere data is er geen prior
  -- ========================================================================
  -- RICKY rijdt één stint van 11 rondes op een combinatie waar verder niemand
  -- reed, en sluit die af. De pool bestaat daarna uit precies die stint. De
  -- prior sluit hem uit, dus er is geen nieuwe informatie en de band mag niet
  -- smaller worden. Met de oude dubbeltelling (pool inclusief eigen stint, en
  -- die er in v2 nog eens bij opgeteld) werd de band 38 % smaller.
  perform pg_temp.stint(v_dev_b, 'audi-own', 1, 'audir8gt3', 'zolder:gp', 0.5, 11, v_t);
  perform pg_temp.sluit(v_dev_b, 'audir8gt3', 'zolder:gp', v_t);
  v_p := public.tyre_prior('audir8gt3', 'zolder:gp', v_dev_b);

  perform pg_temp.eis('de eigen stint staat wel in de pool, met 10 rondes',
                      (select rondes from public.tyre_prior_stats
                        where car_key = 'audir8gt3' and track_key = 'zolder:gp') = 10);
  perform pg_temp.eis('maar de prior van dat apparaat is leeg',
                      (v_p ->> 'rate') is null
                      and (v_p ->> 'rondes')::integer = 0
                      and (v_p ->> 'stints')::integer = 0);

  perform set_config('request.jwt.claim.sub', v_owner_b::text, true);
  v_est := public.pitwall_tyre_estimate_v2(v_dev_b);
  perform pg_temp.eis('eigen data alleen: prior_rate null, rondes_effectief = eigen basis',
                      v_est #>> '{basis,bron}' = 'eigen'
                      and (v_est #>> '{basis,prior_rate}') is null
                      and (v_est #>> '{basis,prior_rondes}')::integer = 0
                      and (v_est #>> '{basis,prior_stints}')::integer = 0
                      and (v_est #>> '{basis,rondes_effectief}')::numeric
                          = (v_est #>> '{basis,rondes_in_basis}')::numeric);

  -- Het contrast met de oude, dubbeltellende rekenwijze: dezelfde eigen stint,
  -- maar de pool (die de eigen stint bevat) telde er nog eens bij op. De
  -- bandformule is dezelfde als in de RPC: schaal = clamp(8/n_eff, 0,5; 4).
  v_oud_n_eff := (v_est #>> '{basis,rondes_in_basis}')::numeric
                 + round(10 * 10.0 / 18, 2);
  v_laps := ((v_est ->> 'wear_now')::numeric - 40) / 0.5;
  v_schaal := least(greatest(8.0 / v_oud_n_eff, 0.5), 4.0);
  v_oud_low := floor(v_laps / (1 + (2.00 - 1) * v_schaal));
  v_oud_high := ceil(v_laps / greatest(1 - (1 - 0.50) * v_schaal, 0.20));
  v_oud_breed := (v_oud_high - v_oud_low) / nullif(v_oud_high, 0);
  v_breed_eigen := ((v_est #>> '{range_laps,high}')::numeric
                    - (v_est #>> '{range_laps,low}')::numeric)
                   / nullif((v_est #>> '{range_laps,high}')::numeric, 0);
  raise notice 'INFO: bandbreedte eigen data: nu % (was met dubbeltelling %)',
               round(v_breed_eigen, 3), round(v_oud_breed, 3);
  perform pg_temp.eis(format('zonder nieuwe informatie is de band niet smaller (nu %s, oud %s)',
                             round(v_breed_eigen, 3), round(v_oud_breed, 3)),
                      v_breed_eigen > v_oud_breed * 1.20);

  -- Schoon achterlaten: de audi-stint diende alleen voor deze vergelijking, en
  -- de volgende secties rekenen met een lege pool.
  delete from public.simhub_tyre_lap_samples where device_id = v_dev_b;
  perform pg_temp.eis('opgeruimd na E1: pool weer leeg',
                      (select count(*) from public.tyre_prior_stats) = 0
                      and (select count(*) from public.tyre_prior_contrib) = 0);

  -- ========================================================================
  -- C. Een lopende stint telt niet, een gesloten stint wel
  -- ========================================================================
  perform pg_temp.eis('0 stints: geen prior, n_eff 0, rondes 0',
                      (public.tyre_prior('lamborghinievogt3', 'spa2022full:gp') ->> 'rate') is null
                      and (public.tyre_prior('lamborghinievogt3', 'spa2022full:gp') ->> 'level') is null
                      and (public.tyre_prior('lamborghinievogt3', 'spa2022full:gp') ->> 'n_eff')::numeric = 0
                      and (public.tyre_prior('lamborghinievogt3', 'spa2022full:gp') ->> 'rondes')::integer = 0
                      and (public.tyre_prior('lamborghinievogt3', 'spa2022full:gp') ->> 'stints')::integer = 0);

  perform pg_temp.stint(v_dev_a, 'spa-1', 1, 'lamborghinievogt3', 'spa2022full:gp', 0.5, 11, v_t);
  perform pg_temp.eis('lopende stint: nog niet in de pool',
                      (select count(*) from public.tyre_prior_stats
                        where car_key = 'lamborghinievogt3'
                          and track_key = 'spa2022full:gp') = 0
                      and (public.tyre_prior('lamborghinievogt3', 'spa2022full:gp', v_dev_a) ->> 'rate') is null);

  perform pg_temp.sluit(v_dev_a, 'lamborghinievogt3', 'spa2022full:gp', v_t);
  v_p := public.tyre_prior('lamborghinievogt3', 'spa2022full:gp');
  perform pg_temp.eis('gesloten stint: exact, 0,5, n_eff 10*10/18, rondes 10, stints 1',
                      (v_p ->> 'level') = 'exact'
                      and (v_p ->> 'rate')::numeric = 0.5000
                      and (v_p ->> 'n_eff')::numeric = round(10 * 10.0 / 18, 2)
                      and (v_p ->> 'rondes')::integer = 10
                      and (v_p ->> 'stints')::integer = 1
                      and (select stints from public.tyre_prior_stats
                            where car_key = 'lamborghinievogt3'
                              and track_key = 'spa2022full:gp') = 1);
  v_n_prev := (v_p ->> 'n_eff')::numeric;

  perform pg_temp.eis('de eigen stint is uitgesloten: prior voor dat apparaat is leeg',
                      (public.tyre_prior('lamborghinievogt3', 'spa2022full:gp', v_dev_a) ->> 'rate') is null
                      and (public.tyre_prior('lamborghinievogt3', 'spa2022full:gp', v_dev_a) ->> 'rondes')::integer = 0
                      and (public.tyre_prior('lamborghinievogt3', 'spa2022full:gp', v_dev_a) ->> 'stints')::integer = 0);

  -- ========================================================================
  -- D. De hiërarchie: 3, 10 en 50 stints
  -- ========================================================================
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
        perform pg_temp.sluit(v_dev_a, 'lamborghinievogt3', 'spa2022full:gp', v_t);
      end loop;
      v_p := public.tyre_prior('lamborghinievogt3', 'spa2022full:gp');
      perform pg_temp.eis(format('%s stints: exact, zelfde rate, n_eff %s > %s, rondes %s',
                                 v_n, (v_p ->> 'n_eff'), v_n_prev, v_p ->> 'rondes'),
                          (v_p ->> 'level') = 'exact'
                          and (v_p ->> 'rate')::numeric = 0.5000
                          and (v_p ->> 'n_eff')::numeric > v_n_prev
                          and (v_p ->> 'stints')::integer = v_n
                          and (v_p ->> 'rondes')::integer = v_n * 10
                          and (v_p ->> 'rondes')::integer > (v_p ->> 'n_eff')::numeric
                          and (select stints from public.tyre_prior_stats
                                where car_key = 'lamborghinievogt3'
                                  and track_key = 'spa2022full:gp') = v_n);
      v_n_prev := (v_p ->> 'n_eff')::numeric;
    end;
  end loop;

  -- ========================================================================
  -- E2. Iemand anders rijdt dezelfde combinatie: dat is wél nieuwe informatie
  -- ========================================================================
  perform pg_temp.stint(v_dev_b, 'audi-own', 1, 'audir8gt3', 'zolder:gp', 0.5, 11, v_t);
  perform pg_temp.sluit(v_dev_b, 'audir8gt3', 'zolder:gp', v_t);
  perform pg_temp.stint(v_dev_a, 'audi-ander', 1, 'audir8gt3', 'zolder:gp', 0.5, 11, v_t + interval '1 day');
  perform pg_temp.sluit(v_dev_a, 'audir8gt3', 'zolder:gp', v_t + interval '1 day');
  v_p := public.tyre_prior('audir8gt3', 'zolder:gp', v_dev_b);
  v_est2 := public.pitwall_tyre_estimate_v2(v_dev_b);
  v_breed_ander := ((v_est2 #>> '{range_laps,high}')::numeric
                    - (v_est2 #>> '{range_laps,low}')::numeric)
                   / nullif((v_est2 #>> '{range_laps,high}')::numeric, 0);
  -- De pool heeft 20 rondes op deze combinatie (twee stints); de prior van
  -- RICKY ziet er 10 (de andere) plus de 500 rondes van de Lambo in de
  -- algemene trap. 520 - 10 = 510: de eigen stint is er echt af.
  perform pg_temp.eis('andermans stint: prior exact, eigen 10 rondes eraf, n_eff = eigen + prior',
                      (v_p ->> 'level') = 'exact'
                      and (v_p ->> 'rate')::numeric = 0.5000
                      and (v_p ->> 'stints')::integer = 51
                      and (v_p ->> 'rondes')::integer = 510
                      and (select sum(rondes) from public.tyre_prior_stats) = 520
                      and (v_est2 #>> '{basis,prior_rondes}')::integer = 510
                      and (v_est2 #>> '{basis,prior_stints}')::integer = 51
                      and (v_est2 #>> '{basis,rondes_effectief}')::numeric
                          = (v_est2 #>> '{basis,rondes_in_basis}')::numeric
                            + (v_est2 #>> '{basis,prior_n}')::numeric);
  perform pg_temp.eis(format('met andermans data wordt de band smaller (%s < %s)',
                             round(v_breed_ander, 3), round(v_breed_eigen, 3)),
                      v_breed_ander < v_breed_eigen);

  -- ========================================================================
  -- F. De trap 'exact' is andermans data, geen "eigen data"
  -- ========================================================================
  v_p := public.tyre_prior('audir8gt3', 'zolder:gp', v_dev_b);
  perform pg_temp.eis('bron exact noemt geen eigen data',
                      v_p ->> 'bron' not like '%eigen data%'
                      and v_p ->> 'bron' like '%deze auto op dit circuit%'
                      and v_p ->> 'bron' like '%andere apparaten%');
  perform pg_temp.eis('zonder uitsluiting zegt de bron niets over apparaten',
                      (public.tyre_prior('audir8gt3', 'zolder:gp') ->> 'bron') not like '%eigen data%'
                      and (public.tyre_prior('audir8gt3', 'zolder:gp') ->> 'bron') not like '%andere apparaten%');
  perform pg_temp.eis('v2 levert prior_bron zonder eigen data',
                      v_est2 #>> '{basis,prior_bron}' not like '%eigen data%'
                      and v_est2 #>> '{basis,prior_level}' = 'exact'
                      and v_est2 #>> '{basis,bron}' = 'eigen');

  -- Een auto op andere circuits (trap auto), zodat de hiërarchie oneffen blijft.
  v_p := public.tyre_prior('lamborghinievogt3', 'brandsh:gp', v_dev_c);
  perform pg_temp.eis('auto zonder circuit: level auto, bron zegt andere circuits',
                      (v_p ->> 'level') = 'auto'
                      and (v_p ->> 'rate')::numeric > 0
                      and (v_p ->> 'rondes')::integer > 0
                      and (v_p ->> 'bron') like '%deze auto op andere circuits%');

  -- ========================================================================
  -- G. Incrementeel onderhoud == volledige herberekening
  -- ========================================================================
  perform pg_temp.stint(v_dev_c, 'porsche-1', 1, 'porsche992rgt3', 'imola:gp', 0.3, 11, v_t);
  perform pg_temp.sluit(v_dev_c, 'porsche992rgt3', 'imola:gp', v_t);
  -- Correctie van de laatste meting van de stint: de helling verandert, dus de
  -- bijdrage en de cel moeten via het verschil mee.
  update public.simhub_tyre_lap_samples
     set wear_fl = wear_fl - 0.5, wear_fr = wear_fr - 0.5,
         wear_rl = wear_rl - 0.5, wear_rr = wear_rr - 0.5
   where device_id = v_dev_c and session_key = 'porsche-1' and lap_number = 11;

  v_voor := pg_temp.pool_snapshot();
  perform public.tyre_prior_refresh();
  v_na := pg_temp.pool_snapshot();
  perform pg_temp.eis('incrementeel == volledige herberekening (na insert + update)',
                      v_voor is not distinct from v_na);

  perform pg_temp.eis('de gecorrigeerde stint zit in de som',
                      (select sum_wear_fl from public.tyre_prior_stats
                        where car_key = 'porsche992rgt3' and track_key = 'imola:gp') between 3.4 and 3.6);

  -- Een sessie weggooien: de bijdrage moet uit de pool verdwijnen.
  delete from public.simhub_tyre_lap_samples
   where device_id = v_dev_c and session_key = 'porsche-1';
  perform pg_temp.eis('verwijderde sessie verdwijnt uit de pool',
                      not exists (select 1 from public.tyre_prior_stats
                                   where car_key = 'porsche992rgt3'
                                     and track_key = 'imola:gp')
                      and not exists (select 1 from public.tyre_prior_contrib
                                       where car_key = 'porsche992rgt3'));

  -- ========================================================================
  -- H. 20 000 rondes: een normale lap kost minder dan 50 ms
  -- ========================================================================
  -- 200 sessies van 100 rondes op hetzelfde apparaat, in de toekomst zodat de
  -- laatste sessie de lopende is. De eerste 199 zijn daarmee gesloten.
  insert into public.simhub_tyre_lap_samples
    (device_id, connector_id, session_key, lap_number, tyre_set,
     wear_fl, wear_fr, wear_rl, wear_rr, car_key, track_key, captured_at)
  select v_dev_c, 'syn', 'bulk-' || s, g, 1,
         100 - g * 0.4, 100 - g * 0.4, 100 - g * 0.4, 100 - g * 0.4,
         'mercedesamggt3', 'spa2022full:gp',
         v_bulk + (s || ' hours')::interval + (g || ' minutes')::interval
    from generate_series(1, 200) s
   cross join generate_series(1, 100) g;
  perform public.tyre_prior_refresh();
  raise notice 'INFO: % samples, % bijdragen, % cellen',
               (select count(*) from public.simhub_tyre_lap_samples),
               (select count(*) from public.tyre_prior_contrib),
               (select count(*) from public.tyre_prior_stats);
  perform pg_temp.eis('199 van de 200 sessies zijn gesloten en tellen mee',
                      (select stints from public.tyre_prior_stats
                        where car_key = 'mercedesamggt3'
                          and track_key = 'spa2022full:gp') = 199);

  -- De normale lap: dezelfde sessie, dezelfde bandenset, wear loopt door.
  -- Vijf keer meten en de beste nemen.
  for i in 1 .. 5 loop
    v_t0 := clock_timestamp();
    insert into public.simhub_tyre_lap_samples
      (device_id, connector_id, session_key, lap_number, tyre_set,
       wear_fl, wear_fr, wear_rl, wear_rr, car_key, track_key, captured_at)
    values (v_dev_c, 'syn', 'bulk-200', 100 + i, 1,
            100 - (100 + i) * 0.4, 100 - (100 + i) * 0.4,
            100 - (100 + i) * 0.4, 100 - (100 + i) * 0.4,
            'mercedesamggt3', 'spa2022full:gp',
            v_bulk + interval '200 hours' + ((100 + i) || ' minutes')::interval);
    v_ms := extract(epoch from (clock_timestamp() - v_t0)) * 1000;
    v_best := least(v_best, v_ms);
  end loop;
  raise notice 'INFO: normale lap bij % samples: % ms (beste van 5)',
               (select count(*) from public.simhub_tyre_lap_samples), round(v_best, 2);
  perform pg_temp.eis(format('normale lap < 50 ms (gemeten %s ms)', round(v_best, 2)),
                      v_best < 50);

  -- De lap die de lopende stint sluit (nieuwe bandenset): één sessiescan.
  v_t0 := clock_timestamp();
  insert into public.simhub_tyre_lap_samples
    (device_id, connector_id, session_key, lap_number, tyre_set,
     wear_fl, wear_fr, wear_rl, wear_rr, car_key, track_key, captured_at)
  values (v_dev_c, 'syn', 'bulk-200', 106, 2,
          100, 100, 100, 100, 'mercedesamggt3', 'spa2022full:gp',
          v_bulk + interval '200 hours' + interval '106 minutes');
  v_ms := extract(epoch from (clock_timestamp() - v_t0)) * 1000;
  raise notice 'INFO: stint-sluitende lap: % ms', round(v_ms, 2);
  perform pg_temp.eis(format('stint-sluitende lap < 250 ms (gemeten %s ms)', round(v_ms, 2)),
                      v_ms < 250);
  perform pg_temp.eis('de gesloten stint telt mee, de nieuwe lopende niet',
                      (select stints from public.tyre_prior_stats
                        where car_key = 'mercedesamggt3'
                          and track_key = 'spa2022full:gp') = 200);

  -- ========================================================================
  -- I. Privacy
  -- ========================================================================
  v_p := public.tyre_prior('lamborghinievogt3', 'spa2022full:gp', v_dev_c);
  perform pg_temp.eis('alleen rate, n_eff, rondes, stints, level en bron',
                      (select array_agg(k order by k) from jsonb_object_keys(v_p) k)
                        = array['bron','level','n_eff','rate','rondes','stints']);
  perform pg_temp.eis('geen apparaatnaam, apparaat-id of coureur in de bron',
                      v_p ->> 'bron' not like '%DESKTOP%'
                      and v_p ->> 'bron' not like '%CAT-PC%'
                      and v_p ->> 'bron' not like '%RICKY%'
                      and v_p ->> 'bron' not ilike '%device%'
                      and v_p::text !~ '[0-9a-f]{8}-[0-9a-f]{4}');

  -- ========================================================================
  -- Opruimen binnen de transactie (de rollback doet de rest)
  -- ========================================================================
  delete from public.simhub_tyre_lap_samples where device_id in (v_dev_a, v_dev_b, v_dev_c);
  perform pg_temp.eis('opgeruimd: pool weer leeg',
                      (select count(*) from public.tyre_prior_stats) = 0
                      and (select count(*) from public.tyre_prior_contrib) = 0);
  perform pg_temp.eis('de echte 113 rijen zijn onaangeroerd',
                      (select count(*) from public.simhub_tyre_lap_samples) = 113);
end $test$;

rollback;
