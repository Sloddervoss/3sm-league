-- ============================================================================
-- Test voor 20261031120000_tyre_setgrens_bij_wear_stijging.sql
--
-- Draai dit bestand als één transactie en sluit af met ROLLBACK: er blijft geen
-- rij achter. Synthetische sessies op een bestaand maar leeg testapparaat, elk
-- met een eigen session_key zodat de asserties elkaar niet raken.
--
--   syn-grens-1 — de fix zelf. De teller staat stil op 1; op ronde 4 springt de
--                 wear 0,7 pp omhoog. Vóór deze migratie was dat géén grens
--                 (vorige_set was gevuld), nu wel: vier stints in plaats van
--                 drie, met blokken 1-3, 4-6, 7 en 8-10.
--   syn-grens-2 — één grens als beide bewijzen op dezelfde rij waar zijn: op
--                 ronde 3 verandert de teller én stijgt de wear. Verwacht: één
--                 nieuwe stint, geen twee.
--   syn-grens-3 — regressie: zonder tellerhistorie blijft de wear-sprong een
--                 grens (dat deed hij al).
--   syn-grens-4 — regressie: een teller die verandert zonder wear-sprong blijft
--                 een grens.
--
-- Draaien:
--   ssh 3sm-docker "docker exec -i supabase-db psql -U supabase_admin -d postgres -X -q -v ON_ERROR_STOP=1" \
--     < supabase/tests/20261031120000_tyre_setgrens_bij_wear_stijging.sql
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
  v_dev  constant uuid := '81222914-3ad7-43db-b5eb-27c246ba1381';  -- DESKTOP-GR4NN00
  v_t    constant timestamptz := timestamptz '2026-10-31 09:00:00+00';
  v_ok   boolean;
  v_aantal integer;
begin
  perform pg_temp.eis('testapparaat bestaat',
                      exists (select 1 from public.simhub_devices where id = v_dev));
  perform pg_temp.eis('testsessies zijn leeg',
                      not exists (select 1 from public.simhub_tyre_lap_samples
                                   where device_id = v_dev
                                     and session_key like 'syn-grens-%'));

  -- ========================================================================
  -- 1. Wear-sprong met een gevulde, niet veranderende teller
  -- ========================================================================
  insert into public.simhub_tyre_lap_samples
      (device_id, connector_id, session_key, lap_number, tyre_set,
       wear_fl, wear_fr, wear_rl, wear_rr, captured_at)
  values
    (v_dev, 'syn', 'syn-grens-1',  1, 1, 100.0, 100.0, 100.0, 100.0, v_t + interval ' 1 minute'),
    (v_dev, 'syn', 'syn-grens-1',  2, 1,  99.6,  99.6,  99.6,  99.6, v_t + interval ' 2 minutes'),
    (v_dev, 'syn', 'syn-grens-1',  3, 1,  99.2,  99.2,  99.2,  99.2, v_t + interval ' 3 minutes'),
    -- hier is een set gemonteerd: wear omhoog, teller blijft 1
    (v_dev, 'syn', 'syn-grens-1',  4, 1,  99.9,  99.9,  99.9,  99.9, v_t + interval ' 4 minutes'),
    (v_dev, 'syn', 'syn-grens-1',  5, 1,  99.5,  99.5,  99.5,  99.5, v_t + interval ' 5 minutes'),
    (v_dev, 'syn', 'syn-grens-1',  6, 1,  99.1,  99.1,  99.1,  99.1, v_t + interval ' 6 minutes'),
    -- teller verandert, wear daalt: ook een grens
    (v_dev, 'syn', 'syn-grens-1',  7, 2,  98.7,  98.7,  98.7,  98.7, v_t + interval ' 7 minutes'),
    -- teller verandert ÉN wear stijgt: precies één grens
    (v_dev, 'syn', 'syn-grens-1',  8, 3,  99.5,  99.5,  99.5,  99.5, v_t + interval ' 8 minutes'),
    (v_dev, 'syn', 'syn-grens-1',  9, 3,  99.1,  99.1,  99.1,  99.1, v_t + interval ' 9 minutes'),
    (v_dev, 'syn', 'syn-grens-1', 10, 3,  98.7,  98.7,  98.7,  98.7, v_t + interval '10 minutes');

  select count(*) into v_aantal
    from public.tyre_stint_deltas where device_id = v_dev and session_key = 'syn-grens-1';
  perform pg_temp.eis('wear-sprong met gevulde teller splitst: 4 stints', v_aantal = 4);

  select count(*) = 4 into v_ok
    from (select lap_from, lap_to, rondes
            from public.tyre_stint_deltas
           where device_id = v_dev and session_key = 'syn-grens-1'
             and (lap_from, lap_to, rondes) in ((1,3,3),(4,6,3),(7,7,1),(8,10,3))) x;
  perform pg_temp.eis('de blokken zijn 1-3, 4-6, 7 en 8-10', v_ok);

  -- ========================================================================
  -- 2. Beide bewijzen op dezelfde rij = één grens
  -- ========================================================================
  insert into public.simhub_tyre_lap_samples
      (device_id, connector_id, session_key, lap_number, tyre_set,
       wear_fl, wear_fr, wear_rl, wear_rr, captured_at)
  values
    (v_dev, 'syn', 'syn-grens-2', 1, 1, 99.0, 99.0, 99.0, 99.0, v_t + interval '20 minutes'),
    (v_dev, 'syn', 'syn-grens-2', 2, 1, 98.6, 98.6, 98.6, 98.6, v_t + interval '21 minutes'),
    -- teller 1 -> 2 én wear 98,6 -> 99,8
    (v_dev, 'syn', 'syn-grens-2', 3, 2, 99.8, 99.8, 99.8, 99.8, v_t + interval '22 minutes'),
    (v_dev, 'syn', 'syn-grens-2', 4, 2, 99.4, 99.4, 99.4, 99.4, v_t + interval '23 minutes');

  select count(*) into v_aantal
    from public.tyre_stint_deltas where device_id = v_dev and session_key = 'syn-grens-2';
  perform pg_temp.eis('twee bewijzen op één rij geven twee stints, niet drie', v_aantal = 2);

  select bool_and(rondes = 2) into v_ok
    from public.tyre_stint_deltas where device_id = v_dev and session_key = 'syn-grens-2';
  perform pg_temp.eis('geen lege tussenstint van één rij', v_ok);

  -- ========================================================================
  -- 3. Regressie: zonder tellerhistorie blijft de wear-sprong een grens
  -- ========================================================================
  insert into public.simhub_tyre_lap_samples
      (device_id, connector_id, session_key, lap_number, tyre_set,
       wear_fl, wear_fr, wear_rl, wear_rr, captured_at)
  values
    (v_dev, 'syn', 'syn-grens-3', 1, null, 99.0, 99.0, 99.0, 99.0, v_t + interval '30 minutes'),
    (v_dev, 'syn', 'syn-grens-3', 2, null, 98.5, 98.5, 98.5, 98.5, v_t + interval '31 minutes'),
    (v_dev, 'syn', 'syn-grens-3', 3, null, 99.6, 99.6, 99.6, 99.6, v_t + interval '32 minutes'),
    (v_dev, 'syn', 'syn-grens-3', 4, null, 99.2, 99.2, 99.2, 99.2, v_t + interval '33 minutes');

  select count(*) into v_aantal
    from public.tyre_stint_deltas where device_id = v_dev and session_key = 'syn-grens-3';
  perform pg_temp.eis('zonder teller splitst de wear-sprong nog steeds', v_aantal = 2);

  -- ========================================================================
  -- 4. Regressie: teller verandert zonder wear-sprong = grens
  -- ========================================================================
  insert into public.simhub_tyre_lap_samples
      (device_id, connector_id, session_key, lap_number, tyre_set,
       wear_fl, wear_fr, wear_rl, wear_rr, captured_at)
  values
    (v_dev, 'syn', 'syn-grens-4', 1, 4, 99.0, 99.0, 99.0, 99.0, v_t + interval '40 minutes'),
    (v_dev, 'syn', 'syn-grens-4', 2, 4, 98.6, 98.6, 98.6, 98.6, v_t + interval '41 minutes'),
    (v_dev, 'syn', 'syn-grens-4', 3, 5, 98.2, 98.2, 98.2, 98.2, v_t + interval '42 minutes'),
    (v_dev, 'syn', 'syn-grens-4', 4, 5, 97.8, 97.8, 97.8, 97.8, v_t + interval '43 minutes');

  select count(*) into v_aantal
    from public.tyre_stint_deltas where device_id = v_dev and session_key = 'syn-grens-4';
  perform pg_temp.eis('een tellerwissel zonder wear-sprong blijft een grens', v_aantal = 2);

  select bool_and(set_bron = 'payload') into v_ok
    from public.tyre_stint_deltas where device_id = v_dev and session_key = 'syn-grens-4';
  perform pg_temp.eis('set_bron blijft payload als de teller meet', v_ok);

  -- De kolomlijst van de view is niet veranderd: 31 kolommen, zelfde volgorde.
  select count(*) = 31 and min(ordinal_position) = 1 and max(ordinal_position) = 31 into v_ok
    from information_schema.columns
   where table_schema = 'public' and table_name = 'tyre_stint_deltas';
  perform pg_temp.eis('view heeft nog 31 kolommen', v_ok);

  select bool_and(column_name = expected) into v_ok
    from (select ordinal_position, column_name,
                 (array['device_id','session_key','set_number','set_bron','lap_from','lap_to','rondes',
                        'wear_span','wear_metingen','wear_begin_fl','wear_begin_fr','wear_begin_rl',
                        'wear_begin_rr','wear_end_fl','wear_end_fr','wear_end_rl','wear_end_rr',
                        'wear_per_lap_fl','wear_per_lap_fr','wear_per_lap_rl','wear_per_lap_rr',
                        'zwakste_hoek','track_temp_c','car_key','track_key','laatste_meting',
                        'wear_span_fl','wear_span_fr','wear_span_rl','wear_span_rr','heeft_helling'])[ordinal_position]
                 as expected
            from information_schema.columns
           where table_schema = 'public' and table_name = 'tyre_stint_deltas') x;
  perform pg_temp.eis('kolomnamen en volgorde zijn gelijk gebleven', v_ok);
end $test$;

rollback;
