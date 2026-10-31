-- ============================================================================
-- Test voor 20261031150400_tyre_prior_queue_status.sql
--        en 20261031160300_tyre_prior_queue_alarm.sql (retentiegrens)
--
--   A. Een gesloten stint wordt aangemeld (trigger), verwerkt en afgerond: de
--      rij krijgt status = verwerkt met afgerond_op en de bijdrage staat in
--      tyre_prior_contrib. Dat bewijst dat de synchronisatie echt werk deed.
--   B. Met een echte gesloten bijdrage én een trigger die tyre_prior_stats laat
--      stuklopen, telt de drain drie fouten en sluit de rij als mislukt af.
--      De assert op pogingen en laatste_fout bewijst dat de trigger geraakt
--      werd; zonder werk zou de drain de rij gewoon verwerken (dat was de fout
--      in de oude test, die alleen een lege sessie aanmeldde en waar de
--      row-trigger dus nooit iets raakte).
--   C. Na de dead-letter kan dezelfde sessie opnieuw worden aangemeld en
--      verwerkt; de mislukte rij blijft als spoor staan.
--   D. Retentie: verwerkt na 30 dagen, mislukt pas na 90.
--   E. De probleemview toont de mislukte rij met zijn fout.
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

-- Een echte stint: elf gemeten rondes op set 1, en een twaalfde ronde op set 2.
-- Die twaalfde ronde sluit de stint, meldt de sessie aan bij de wachtrij en
-- levert de bijdrage waarover de synchronisatie iets te doen heeft.
create function pg_temp.stint(p_device uuid, p_session text, p_auto text,
                              p_baan text, p_from timestamptz)
returns void language sql as $$
  insert into public.simhub_tyre_lap_samples
    (device_id, connector_id, session_key, lap_number, tyre_set,
     wear_fl, wear_fr, wear_rl, wear_rr, car_key, track_key, captured_at)
  select p_device, 'test', p_session, x.n,
         case when x.n <= 11 then 1 else 2 end,
         case when x.n <= 11 then 100 - x.n * 0.5 else 100 end,
         case when x.n <= 11 then 100 - x.n * 0.5 else 100 end,
         case when x.n <= 11 then 100 - x.n * 0.5 else 100 end,
         case when x.n <= 11 then 100 - x.n * 0.5 else 100 end,
         p_auto, p_baan,
         p_from + ((x.n - 1) || ' minutes')::interval
    from generate_series(1, 12) as x(n);
$$;

-- Een trigger die de synchronisatie laat stuklopen op het moment dat zij de
-- somtabel wil bijwerken.
create function pg_temp.boom() returns trigger
language plpgsql as $$
begin
  raise exception 'testfout in tyre_prior_stats';
end $$;

do $test$
declare
  v_dev constant uuid := '290fe152-5789-448c-8420-8deb3cf3077f';  -- CAT-PC (leeg)
  v_q   jsonb;
  v_n   integer;
  v_t   constant timestamptz := now() - interval '40 minutes';
begin
  delete from public.tyre_prior_queue where device_id = v_dev;
  delete from public.simhub_tyre_lap_samples where device_id = v_dev and session_key like 'qs-%';
  delete from public.tyre_prior_contrib where device_id = v_dev and session_key like 'qs-%';
  delete from public.tyre_prior_stats where car_key = 'qscar';

  --------------------------------------------------------------------------
  -- A. Werk, aanmelding en verwerking
  --------------------------------------------------------------------------
  perform pg_temp.stint(v_dev, 'qs-goed', 'qscar', 'qs:gp', v_t);

  perform pg_temp.eis('A: de fixture heeft twaalf samples van deze sessie',
                      (select count(*) from public.simhub_tyre_lap_samples
                        where device_id = v_dev and session_key = 'qs-goed') = 12);
  perform pg_temp.eis('A: de gesloten stint is aangemeld bij de wachtrij',
                      exists (select 1 from public.tyre_prior_queue
                               where device_id = v_dev and session_key = 'qs-goed'
                                 and status = 'open'));

  v_q := public.tyre_prior_drain(200);
  raise notice 'drain succes: %', v_q;

  perform pg_temp.eis('A: de rij is verwerkt met status en afrondingstijd',
                      (select status = 'verwerkt' and afgerond_op is not null
                         from public.tyre_prior_queue
                        where device_id = v_dev and session_key = 'qs-goed'
                        order by id desc limit 1));
  perform pg_temp.eis('A: de drain meldt minstens één verwerking',
                      (v_q->>'verwerkt')::integer >= 1);
  perform pg_temp.eis('A: de bijdrage staat in tyre_prior_contrib (het werk is echt gedaan)',
                      (select count(*) from public.tyre_prior_contrib
                        where device_id = v_dev and session_key = 'qs-goed') = 1);
  perform pg_temp.eis('A: de somtabel kent de stint',
                      (select stints from public.tyre_prior_stats
                        where car_key = 'qscar' and track_key = 'qs:gp') = 1);

  --------------------------------------------------------------------------
  -- B. Drie fouten op ECHT werk -> mislukt
  --------------------------------------------------------------------------
  perform pg_temp.stint(v_dev, 'qs-kapot', 'qscar', 'qs:gp', v_t + interval '1 hour');

  perform pg_temp.eis('B: ook deze stint is gesloten en aangemeld',
                      (select count(*) from public.simhub_tyre_lap_samples
                        where device_id = v_dev and session_key = 'qs-kapot') = 12
                      and exists (select 1 from public.tyre_prior_queue
                                   where device_id = v_dev and session_key = 'qs-kapot'
                                     and status = 'open'));

  create trigger test_boom before insert on public.tyre_prior_stats
    for each row execute function pg_temp.boom();

  v_q := public.tyre_prior_drain(200);
  raise notice 'drain eerste fout: %', v_q;

  perform pg_temp.eis('B: eerste fout: pogingen = 1 en status open',
                      (select pogingen = 1 and status = 'open' and afgerond_op is null
                         from public.tyre_prior_queue
                        where device_id = v_dev and session_key = 'qs-kapot'
                        order by id desc limit 1));
  perform pg_temp.eis('B: de trigger is geraakt: laatste_fout bewaard',
                      (select laatste_fout like '%testfout%'
                         from public.tyre_prior_queue
                        where device_id = v_dev and session_key = 'qs-kapot'
                        order by id desc limit 1));

  v_q := public.tyre_prior_drain(200);
  perform pg_temp.eis('B: tweede fout: pogingen = 2 en status open',
                      (select pogingen = 2 and status = 'open'
                         from public.tyre_prior_queue
                        where device_id = v_dev and session_key = 'qs-kapot'
                        order by id desc limit 1));

  v_q := public.tyre_prior_drain(200);
  raise notice 'drain derde fout: %', v_q;
  perform pg_temp.eis('B: derde fout: status = mislukt met afrondingstijd',
                      (select status = 'mislukt' and afgerond_op is not null and pogingen = 3
                         from public.tyre_prior_queue
                        where device_id = v_dev and session_key = 'qs-kapot'
                        order by id desc limit 1));
  perform pg_temp.eis('B: de drain meldt de rij als mislukt, niet als open',
                      (v_q->>'mislukt')::integer >= 1);

  drop trigger test_boom on public.tyre_prior_stats;

  --------------------------------------------------------------------------
  -- C. Opnieuw aanmelden na een mislukte rij
  --------------------------------------------------------------------------
  insert into public.tyre_prior_queue (device_id, session_key)
  values (v_dev, 'qs-kapot');

  select count(*) into v_n
    from public.tyre_prior_queue
   where device_id = v_dev and session_key = 'qs-kapot' and status = 'open';
  perform pg_temp.eis('C: een nieuwe opdracht voor dezelfde sessie kan weer open staan', v_n = 1);

  v_q := public.tyre_prior_drain(200);
  perform pg_temp.eis('C: de nieuwe opdracht wordt verwerkt',
                      (v_q->>'verwerkt')::integer >= 1
                      and (select status = 'verwerkt'
                             from public.tyre_prior_queue
                            where device_id = v_dev and session_key = 'qs-kapot'
                            order by id desc limit 1));
  perform pg_temp.eis('C: de mislukte rij blijft als spoor staan',
                      (select count(*) from public.tyre_prior_queue
                        where device_id = v_dev and session_key = 'qs-kapot'
                          and status = 'mislukt') = 1);

  --------------------------------------------------------------------------
  -- D. Retentie
  --------------------------------------------------------------------------
  insert into public.tyre_prior_queue
    (device_id, session_key, gevraagd_op, pogingen, afgerond_op, status)
  values
    (v_dev, 'qs-oud-verwerkt', now() - interval '40 days', 0, now() - interval '40 days', 'verwerkt'),
    -- Een mislukte rij van 40 dagen moet blijven staan: sinds
    -- 20261031160300 bewaart de retentie die minstens 90 dagen.
    (v_dev, 'qs-oud-mislukt',  now() - interval '40 days', 3, now() - interval '40 days', 'mislukt'),
    (v_dev, 'qs-oud-dood',     now() - interval '100 days', 3, now() - interval '100 days', 'mislukt'),
    (v_dev, 'qs-oud-open',     now() - interval '40 days', 0, null, 'open');

  v_n := public.tyre_prior_queue_retention(30);
  raise notice 'retentie verwijderde % rijen', v_n;

  perform pg_temp.eis('D: retentie ruimt verwerkte rijen ouder dan 30 dagen op',
                      v_n >= 2
                      and not exists (select 1 from public.tyre_prior_queue
                                       where device_id = v_dev
                                         and session_key = 'qs-oud-verwerkt'));
  perform pg_temp.eis('D: een mislukte rij van 40 dagen blijft staan (90-dagengrens)',
                      exists (select 1 from public.tyre_prior_queue
                               where device_id = v_dev and session_key = 'qs-oud-mislukt'));
  perform pg_temp.eis('D: een mislukte rij van 100 dagen is wel opgeruimd',
                      not exists (select 1 from public.tyre_prior_queue
                                   where device_id = v_dev and session_key = 'qs-oud-dood'));
  perform pg_temp.eis('D: een oude open rij blijft staan',
                      exists (select 1 from public.tyre_prior_queue
                               where device_id = v_dev and session_key = 'qs-oud-open'));

  --------------------------------------------------------------------------
  -- E. De probleemview
  --------------------------------------------------------------------------
  perform pg_temp.eis('E: de probleemview toont de mislukte rij met zijn fout',
                      exists (select 1 from public.tyre_prior_queue_problemen p
                               where p.device_id = v_dev
                                 and p.session_key = 'qs-kapot'
                                 and p.status = 'mislukt'
                                 and p.laatste_fout like '%testfout%'
                                 and p.wacht_minuten >= 0));

  delete from public.tyre_prior_queue where device_id = v_dev;
end $test$;

rollback;
