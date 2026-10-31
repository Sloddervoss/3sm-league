-- ============================================================================
-- Test voor 20261031150400_tyre_prior_queue_status.sql
--
--   A. Een geslaagde rij krijgt status = verwerkt en afgerond_op, en de drain
--      meldt open = 0 en mislukt = 0.
--   B. Een fout telt pogingen en houdt de rij open; na de derde fout wordt de
--      rij status = mislukt met afgerond_op. De drain meldt die rij apart als
--      mislukt in plaats van hem als "niets open" te laten verdwijnen.
--   C. Een nieuwe opdracht voor dezelfde sessie kan daarna weer worden
--      aangemeld (de unieke index kijkt alleen naar status = open).
--   D. Retentie ruimt afgeronde rijen ouder dan 30 dagen op en laat open rijen
--      staan.
--   E. De probleemview toont de mislukte rij.
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

-- Een trigger die de sync laat stuklopen: bewijs dat de drain de fout opvangt,
-- de poging telt en de rij na drie pogingen als mislukt afsluit.
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
begin
  --------------------------------------------------------------------------
  -- A. Succes
  --------------------------------------------------------------------------
  insert into public.tyre_prior_queue (device_id, session_key)
  values (v_dev, 'qs-goed');

  v_q := public.tyre_prior_drain(200);
  raise notice 'drain succes: %', v_q;

  perform pg_temp.eis('A: de rij is verwerkt met status en afrondingstijd',
                      (select status = 'verwerkt' and afgerond_op is not null
                         from public.tyre_prior_queue
                        where device_id = v_dev and session_key = 'qs-goed'
                        order by id desc limit 1));
  perform pg_temp.eis('A: de drain meldt minstens één verwerking',
                      (v_q->>'verwerkt')::integer >= 1);

  --------------------------------------------------------------------------
  -- B. Drie fouten -> mislukt
  --------------------------------------------------------------------------
  create trigger test_boom before insert on public.tyre_prior_stats
    for each row execute function pg_temp.boom();

  insert into public.tyre_prior_queue (device_id, session_key)
  values (v_dev, 'qs-kapot');

  v_q := public.tyre_prior_drain(200);
  perform pg_temp.eis('B: eerste fout: pogingen = 1 en status open',
                      (select pogingen = 1 and status = 'open' and afgerond_op is null
                         from public.tyre_prior_queue
                        where device_id = v_dev and session_key = 'qs-kapot'
                        order by id desc limit 1));
  perform pg_temp.eis('B: laatste_fout is bewaard',
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
    (v_dev, 'qs-oud-mislukt',  now() - interval '40 days', 3, now() - interval '40 days', 'mislukt'),
    (v_dev, 'qs-oud-open',     now() - interval '40 days', 0, null, 'open');

  v_n := public.tyre_prior_queue_retention(30);
  raise notice 'retentie verwijderde % rijen', v_n;

  perform pg_temp.eis('D: retentie ruimt afgeronde rijen ouder dan 30 dagen op',
                      v_n >= 2
                      and not exists (select 1 from public.tyre_prior_queue
                                       where device_id = v_dev
                                         and session_key like 'qs-oud-%'
                                         and status in ('verwerkt', 'mislukt')));
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
end $test$;

rollback;
