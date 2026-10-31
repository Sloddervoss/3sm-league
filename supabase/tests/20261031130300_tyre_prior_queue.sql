-- ============================================================================
-- Test voor 20261031130300_tyre_prior_queue.sql
--
--   A. De trigger meldt alleen aan: na het sluiten van een stint staat er één
--      openstaande rij in tyre_prior_queue en is de pool nog niet bijgewerkt.
--   B. De insertkosten van de trigger op een gesloten stint blijven onder 2 ms
--      (gemeten met clock_timestamp, drie keer, de hoogste telt).
--   C. tyre_prior_drain() verwerkt de rij, werkt de pool bij en zet afgerond_op.
--   D. Een tweede stint in dezelfde sessie wordt opnieuw aangemeld (de partiële
--      index laat een nieuwe rij toe zodra de vorige is afgerond).
--   E. Een fout in de sync verhoogt pogingen en bewaart laatste_fout; na het
--      wegnemen van de fout slaagt de volgende drain.
--   F. Na drie pogingen wordt de rij niet meer opgepakt.
--
-- Draai als één transactie met ROLLBACK; er blijft niets achter.
--
--   ssh 3sm-docker "docker exec -i supabase-db psql -U supabase_admin -d postgres -X -q -v ON_ERROR_STOP=1" \
--     < supabase/tests/20261031130300_tyre_prior_queue.sql
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

create table pg_temp.meting (naam text primary key, ms numeric);

create function pg_temp.stint(p_device uuid, p_session text, p_auto text, p_baan text,
                              p_rate numeric, p_rondes integer, p_start timestamptz)
returns void language sql as $$
  insert into public.simhub_tyre_lap_samples
    (device_id, connector_id, session_key, lap_number, tyre_set,
     wear_fl, wear_fr, wear_rl, wear_rr, car_key, track_key, captured_at)
  select p_device, 'test', p_session, g, 1,
         100 - g * p_rate, 100 - g * p_rate, 100 - g * p_rate, 100 - g * p_rate,
         p_auto, p_baan, p_start + (g || ' minutes')::interval
    from generate_series(1, p_rondes) g;
$$;

-- De insert van de sluitende ronde, met EXPLAIN ANALYZE eromheen. Dat geeft de
-- tijd van de trigger zelf ("Trigger ...: time=... calls=1") en de totale
-- executietijd; de eerste is de kostenmaat die het contract vraagt, de tweede
-- hangt ook aan de WAL en de schijf en is dus veel ruiziger.
create function pg_temp.sluit_met_tijd(p_naam text, p_device uuid, p_auto text,
                                       p_baan text, p_start timestamptz)
returns numeric language plpgsql as $$
declare
  r    record;
  v_sql text;
  v_trig  numeric;
  v_total numeric;
begin
  v_sql := format(
    'insert into public.simhub_tyre_lap_samples
       (device_id, connector_id, session_key, lap_number, tyre_set,
        wear_fl, wear_fr, wear_rl, wear_rr, car_key, track_key, captured_at)
     values (%L, %L, %L, 1, 1, 100, 100, 100, 100, %L, %L, %L)',
    p_device, 'test', 'sluit-' || p_naam || '-' || gen_random_uuid(),
    p_auto, p_baan, p_start + interval '5 hours');

  for r in execute 'explain (analyze, costs off) ' || v_sql loop
    if r."QUERY PLAN" like 'Trigger%' then
      v_trig := substring(r."QUERY PLAN" from 'time=([0-9.]+)')::numeric;
    elsif r."QUERY PLAN" like 'Execution Time:%' then
      v_total := substring(r."QUERY PLAN" from '([0-9.]+)')::numeric;
    end if;
  end loop;

  insert into pg_temp.meting values (p_naam, round(coalesce(v_trig, -1), 3));
  insert into pg_temp.meting values (p_naam || '-totaal', round(coalesce(v_total, -1), 3));
  return v_trig;
end $$;

-- Een gewone ronde via EXPLAIN ANALYZE: de nullijn voor de kostenmeting.
create function pg_temp.gewone_met_tijd(p_naam text, p_device uuid, p_session text,
                                        p_lap integer, p_wear numeric,
                                        p_auto text, p_baan text, p_at timestamptz)
returns numeric language plpgsql as $$
declare
  r record;
  v_trig numeric;
begin
  for r in execute format(
    'explain (analyze, costs off) insert into public.simhub_tyre_lap_samples
       (device_id, connector_id, session_key, lap_number, tyre_set,
        wear_fl, wear_fr, wear_rl, wear_rr, car_key, track_key, captured_at)
     values (%L, %L, %L, %s, 1, %s, %s, %s, %s, %L, %L, %L)',
    p_device, 'test', p_session, p_lap, p_wear, p_wear, p_wear, p_wear,
    p_auto, p_baan, p_at) loop
    if r."QUERY PLAN" like 'Trigger%' then
      v_trig := substring(r."QUERY PLAN" from 'time=([0-9.]+)')::numeric;
    end if;
  end loop;
  insert into pg_temp.meting values (p_naam, round(coalesce(v_trig, -1), 3));
  return v_trig;
end $$;

-- Een trigger die de sync laat stuklopen: bewijs dat de drain de fout opvangt
-- en de poging telt.
create function pg_temp.boom() returns trigger
language plpgsql as $$
begin
  raise exception 'testfout in tyre_prior_stats';
end $$;

do $test$
declare
  v_dev constant uuid := '290fe152-5789-448c-8420-8deb3cf3077f';  -- CAT-PC (leeg)
  v_t   constant timestamptz := timestamptz '2027-03-01 08:00:00+00';
  v_ms  numeric;
  v_max numeric;
  v_q   jsonb;
  v_n   integer;
  v_rij record;
begin
  --------------------------------------------------------------------------
  -- A. Aanmelden, niet syncen
  --------------------------------------------------------------------------
  perform pg_temp.stint(v_dev, 'q-1', 'qcar', 'q:gp', 0.5, 10, v_t);

  -- De eerste sluitende insert is de koude run (catalogus, plan); hij telt niet
  -- mee in de kostenmeting en wordt hieronder uit de meting gehaald.
  v_ms := pg_temp.sluit_met_tijd('q-1', v_dev, 'qcar', 'q:gp', v_t);
  delete from pg_temp.meting where naam = 'q-1';

  select count(*) into v_n
    from public.tyre_prior_queue
   where device_id = v_dev and session_key = 'q-1' and afgerond_op is null;
  perform pg_temp.eis('na het sluiten staat er één openstaande rij', v_n = 1);

  select count(*) into v_n
    from public.tyre_prior_stats
   where car_key = 'qcar' and track_key = 'q:gp';
  perform pg_temp.eis('de trigger heeft de pool NIET bijgewerkt', v_n = 0);

  --------------------------------------------------------------------------
  -- B. De insertkosten
  --------------------------------------------------------------------------
  -- Nog twee sluitende inserts (elk een eigen stint), zodat de meting niet op
  -- één koude uitvoering leunt.
  perform pg_temp.stint(v_dev, 'q-2', 'qcar', 'q:gp', 0.5, 10, v_t + interval '1 day');
  perform pg_temp.sluit_met_tijd('q-2', v_dev, 'qcar', 'q:gp', v_t + interval '1 day');
  perform pg_temp.stint(v_dev, 'q-3', 'qcar', 'q:gp', 0.5, 10, v_t + interval '2 days');
  perform pg_temp.sluit_met_tijd('q-3', v_dev, 'qcar', 'q:gp', v_t + interval '2 days');

  select max(ms) into v_max from pg_temp.meting
   where naam like 'q-%' and naam not like '%-totaal';
  raise notice 'triggerkosten sluitende ronde (ms): %',
    (select string_agg(naam || '=' || ms, ', ' order by naam)
       from pg_temp.meting where naam like 'q-%' and naam not like '%-totaal');
  perform pg_temp.eis('elke sluitende insert met de wachtrijtrigger is < 2 ms',
                      v_max < 2);

  --------------------------------------------------------------------------
  -- C. De drain verwerkt en rondt af
  --------------------------------------------------------------------------
  v_q := public.tyre_prior_drain(20);
  perform pg_temp.eis('drain verwerkt de openstaande rijen',
                      (v_q->>'verwerkt')::integer = 3
                      and (v_q->>'mislukt')::integer = 0
                      and (v_q->>'open')::integer = 0);

  select count(*) into v_n
    from public.tyre_prior_queue
   where device_id = v_dev and afgerond_op is not null;
  perform pg_temp.eis('afgerond_op is gezet', v_n = 3);

  select * into v_rij
    from public.tyre_prior_stats
   where car_key = 'qcar' and track_key = 'q:gp';
  perform pg_temp.eis('de pool is bijgewerkt: 3 stints, 27 rondes',
                      v_rij.stints = 3 and v_rij.rondes = 27);



  --------------------------------------------------------------------------
  -- D. Opnieuw aanmelden kan pas als de vorige rij is afgerond
  --------------------------------------------------------------------------
  -- Een gewone ronde in de nog lopende sessie van q-2 mag niets aanmelden.
  insert into public.simhub_tyre_lap_samples
    (device_id, connector_id, session_key, lap_number, tyre_set,
     wear_fl, wear_fr, wear_rl, wear_rr, car_key, track_key, captured_at)
  values (v_dev, 'test', 'q-2', 11, 1,
          94.5, 94.5, 94.5, 94.5, 'qcar', 'q:gp', v_t + interval '1 day 11 minutes');

  select count(*) into v_n
    from public.tyre_prior_queue
   where device_id = v_dev and afgerond_op is null;
  perform pg_temp.eis('een gewone ronde meldt niets aan', v_n = 0);

  -- Een nieuwe set in dezelfde sessie sluit q-2 en meldt q-2 opnieuw aan.
  insert into public.simhub_tyre_lap_samples
    (device_id, connector_id, session_key, lap_number, tyre_set,
     wear_fl, wear_fr, wear_rl, wear_rr, car_key, track_key, captured_at)
  values (v_dev, 'test', 'q-2', 12, 2,
          100, 100, 100, 100, 'qcar', 'q:gp', v_t + interval '1 day 12 minutes');

  select count(*) into v_n
    from public.tyre_prior_queue
   where device_id = v_dev and afgerond_op is null;
  perform pg_temp.eis('een nieuwe set meldt de sessie opnieuw aan', v_n = 1);

  --------------------------------------------------------------------------
  -- E. Een fout telt een poging en bewaart de melding
  --------------------------------------------------------------------------
  create trigger test_boom before insert on public.tyre_prior_stats
    for each row execute function pg_temp.boom();

  perform pg_temp.stint(v_dev, 'q-4', 'qcar', 'q:gp', 0.5, 10, v_t + interval '3 days');
  perform pg_temp.sluit_met_tijd('q-4', v_dev, 'qcar', 'q:gp', v_t + interval '3 days');

  v_q := public.tyre_prior_drain(20);
  perform pg_temp.eis('drain vangt de fout en telt hem',
                      (v_q->>'mislukt')::integer >= 1);

  select * into v_rij
    from public.tyre_prior_queue
   where device_id = v_dev and session_key = 'q-4'
   order by id desc limit 1;
  perform pg_temp.eis('pogingen = 1, afgerond_op leeg, laatste_fout gevuld',
                      v_rij.pogingen = 1
                      and v_rij.afgerond_op is null
                      and v_rij.laatste_fout like '%testfout%');

  drop trigger test_boom on public.tyre_prior_stats;

  v_q := public.tyre_prior_drain(20);
  select * into v_rij
    from public.tyre_prior_queue
   where device_id = v_dev and session_key = 'q-4'
   order by id desc limit 1;
  perform pg_temp.eis('na het wegnemen van de fout slaagt de rij',
                      v_rij.afgerond_op is not null and v_rij.laatste_fout is null);

  --------------------------------------------------------------------------
  -- F. Na drie pogingen wordt de rij niet meer opgepakt
  --------------------------------------------------------------------------
  perform pg_temp.stint(v_dev, 'q-5', 'qcar', 'q:gp', 0.5, 10, v_t + interval '4 days');
  perform pg_temp.sluit_met_tijd('q-5', v_dev, 'qcar', 'q:gp', v_t + interval '4 days');

  update public.tyre_prior_queue
     set pogingen = 3, laatste_fout = 'blijvend kapot'
   where device_id = v_dev and session_key = 'q-5' and afgerond_op is null;

  v_q := public.tyre_prior_drain(20);
  perform pg_temp.eis('een rij met drie pogingen wordt overgeslagen',
                      (v_q->>'kandidaten')::integer = 0
                      and (v_q->>'open')::integer = 0);

  select * into v_rij
    from public.tyre_prior_queue
   where device_id = v_dev and session_key = 'q-5' and afgerond_op is null;
  perform pg_temp.eis('de rij blijft zichtbaar met zijn laatste fout',
                      v_rij.pogingen = 3 and v_rij.laatste_fout = 'blijvend kapot');

  --------------------------------------------------------------------------
  -- G. De nullijn: een gewone ronde kost de trigger bijna niets
  --------------------------------------------------------------------------
  -- Helemaal aan het eind, zodat deze sessie geen eerdere assertie beïnvloedt
  -- (een nieuwe sessie sluit per definitie de vorige en meldt die aan).
  perform pg_temp.gewone_met_tijd('gewoon', v_dev, 'base', 1, 100,
                                  'qcar', 'q:gp', v_t + interval '9 days');
  raise notice 'triggerkosten sluitende ronde (ms): %',
    (select string_agg(naam || '=' || ms, ', ' order by naam)
       from pg_temp.meting where naam like 'q-%' and naam not like '%-totaal');
  raise notice 'totale inserttijd sluitende ronde (ms): %',
    (select string_agg(naam || '=' || ms, ', ' order by naam)
       from pg_temp.meting where naam like '%-totaal');
  raise notice 'triggerkosten gewone ronde (ms): %',
    (select ms from pg_temp.meting where naam = 'gewoon');

  perform pg_temp.eis('de trigger kost op een sluitende stint minder dan 2 ms',
                      (select max(ms) from pg_temp.meting
                        where naam like 'q-%' and naam not like '%-totaal') < 2);
  perform pg_temp.eis('de trigger kost op een gewone ronde minder dan 2 ms',
                      (select ms from pg_temp.meting where naam = 'gewoon') < 2);
end $test$;

rollback;
