-- ============================================================================
-- Test voor 20261031130200_tyre_prior_session_move.sql
--
--   A. Een gesloten stint boekt zijn bijdrage op zijn cel.
--   B. Verandert alleen de IDENTITEIT (auto of baan) en blijven rondes en wear
--      gelijk, dan gaat de oude cel exact naar nul en krijgt de nieuwe cel de
--      volledige bijdrage. Niets blijft achter, niets wordt dubbel geteld.
--   C. Dezelfde verhuizing, maar dan over de baan in plaats van de auto.
--   D. Een stint die maar één keer verhuist en daarna weer terug, eindigt weer
--      op de oorspronkelijke cel (de boekhouding is een som, geen spoor).
--
-- Draai als één transactie met ROLLBACK; er blijft niets achter.
--
--   ssh 3sm-docker "docker exec -i supabase-db psql -U supabase_admin -d postgres -X -q -v ON_ERROR_STOP=1" \
--     < supabase/tests/20261031130200_tyre_prior_session_move.sql
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

create function pg_temp.sluit(p_device uuid, p_auto text, p_baan text, p_start timestamptz)
returns void language sql as $$
  insert into public.simhub_tyre_lap_samples
    (device_id, connector_id, session_key, lap_number, tyre_set,
     wear_fl, wear_fr, wear_rl, wear_rr, car_key, track_key, captured_at)
  values (p_device, 'test', 'sluit-' || gen_random_uuid(), 1, 1,
          100, 100, 100, 100, p_auto, p_baan, p_start + interval '5 hours');
$$;

create function pg_temp.cel(p_auto text, p_baan text)
returns table (stints integer, rondes integer, sum_fl numeric)
language sql stable as $$
  select s.stints, s.rondes, s.sum_wear_fl
    from public.tyre_prior_stats s
   where s.car_key = p_auto and s.track_key = p_baan;
$$;

do $test$
declare
  v_dev constant uuid := '290fe152-5789-448c-8420-8deb3cf3077f';  -- CAT-PC (leeg)
  v_t   constant timestamptz := timestamptz '2027-02-01 08:00:00+00';
  v_rij record;
  v_oud record;
  v_n   integer;
begin
  --------------------------------------------------------------------------
  -- A. De stint staat op zijn cel
  --------------------------------------------------------------------------
  perform pg_temp.stint(v_dev, 'mv-1', 'movecar', 'move:gp', 0.5, 10, v_t);
  perform pg_temp.sluit(v_dev, 'movecar', 'move:gp', v_t);
  perform public.tyre_prior_sync_session(v_dev, 'mv-1');

  select * into v_rij from pg_temp.cel('movecar', 'move:gp');
  perform pg_temp.eis('na sluiten: één stint op movecar/move:gp',
                      v_rij.stints = 1 and v_rij.rondes = 9);
  select * into v_oud from pg_temp.cel('movecar', 'move:gp');

  --------------------------------------------------------------------------
  -- B. Alleen de auto verandert (rondes en wear blijven gelijk)
  --------------------------------------------------------------------------
  update public.simhub_tyre_lap_samples
     set car_key = 'movecar2'
   where device_id = v_dev and session_key = 'mv-1';

  perform public.tyre_prior_sync_session(v_dev, 'mv-1');

  -- De oude cel is leeg en hoort niet te blijven staan.
  select count(*) into v_n from pg_temp.cel('movecar', 'move:gp');
  perform pg_temp.eis('oude cel is verdwenen (geen rij met stints > 0)',
                      v_n = 0
                      or (select stints from pg_temp.cel('movecar', 'move:gp')) <= 0);

  select * into v_rij from pg_temp.cel('movecar2', 'move:gp');
  perform pg_temp.eis('nieuwe cel heeft de volledige bijdrage',
                      v_rij.stints = 1 and v_rij.rondes = 9
                      and v_rij.sum_fl = v_oud.sum_fl);
  perform pg_temp.eis('de som van beide cellen is nog steeds één stint',
                      (select coalesce(sum(stints), 0)::integer
                         from public.tyre_prior_stats
                        where (car_key, track_key) in (('movecar', 'move:gp'),
                                                       ('movecar2', 'move:gp'))) = 1);
  perform pg_temp.eis('de contributie staat op de nieuwe cel',
                      (select count(*) from public.tyre_prior_contrib
                        where device_id = v_dev and session_key = 'mv-1'
                          and car_key = 'movecar2'
                          and track_key = 'move:gp') = 1);

  --------------------------------------------------------------------------
  -- C. Alleen de baan verandert
  --------------------------------------------------------------------------
  update public.simhub_tyre_lap_samples
     set track_key = 'move:gp2'
   where device_id = v_dev and session_key = 'mv-1';

  perform public.tyre_prior_sync_session(v_dev, 'mv-1');

  select count(*) into v_n from pg_temp.cel('movecar2', 'move:gp');
  perform pg_temp.eis('oude baan is leeg',
                      v_n = 0
                      or (select stints from pg_temp.cel('movecar2', 'move:gp')) <= 0);
  select * into v_rij from pg_temp.cel('movecar2', 'move:gp2');
  perform pg_temp.eis('nieuwe baan heeft de volledige bijdrage',
                      v_rij.stints = 1 and v_rij.rondes = 9
                      and v_rij.sum_fl = v_oud.sum_fl);

  --------------------------------------------------------------------------
  -- D. Terug naar de oorspronkelijke cel
  --------------------------------------------------------------------------
  update public.simhub_tyre_lap_samples
     set car_key = 'movecar', track_key = 'move:gp'
   where device_id = v_dev and session_key = 'mv-1';

  perform public.tyre_prior_sync_session(v_dev, 'mv-1');

  select * into v_rij from pg_temp.cel('movecar', 'move:gp');
  perform pg_temp.eis('terug op de oorspronkelijke cel, met dezelfde cijfers',
                      v_rij.stints = 1 and v_rij.rondes = 9
                      and v_rij.sum_fl = v_oud.sum_fl);
  perform pg_temp.eis('de tussenliggende cel is leeg',
                      (select coalesce(sum(stints), 0)::integer
                         from public.tyre_prior_stats
                        where (car_key, track_key) in (('movecar2', 'move:gp'),
                                                       ('movecar2', 'move:gp2'))) = 0);
end $test$;

rollback;
