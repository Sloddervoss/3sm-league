-- ============================================================================
-- Test voor de rollback van 20261031150400_tyre_prior_queue_status.sql
--
-- Reviewpunt G: de nieuwe, geldige toestand (mislukt + open voor dezelfde
-- sessie) paste niet in de rollback. Die maakte de mislukte rij weer open en
-- herstelde daarna een unieke index op (device_id, session_key) waar
-- afgerond_op null is — twee rijen voor dezelfde sessie, dus de indexaanmaak
-- faalde op een toestand die de vooruitmigratie zelf accepteert.
--
-- Deze test zet die toestand klaar, draait de ECHTE rollback (via \ir, in
-- dezelfde transactie) en toetst dat de rijen eerst zijn samengevoegd: de
-- oudste opdracht blijft, met de hoogste pogingen en de laatst bekende fout.
--
-- Draai als één transactie met ROLLBACK. De rollback heeft zelf geen
-- begin/commit, juist zodat hij hierbinnen past.
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
  v_dev constant uuid := '290fe152-5789-448c-8420-8deb3cf3077f';  -- CAT-PC
begin
  delete from public.tyre_prior_queue where device_id = v_dev;

  -- Sessie A: dead-letter van 20 minuten oud plus een nieuwe open opdracht van
  -- 5 minuten oud. Precies de toestand die de migratie toestaat.
  insert into public.tyre_prior_queue
    (device_id, session_key, gevraagd_op, pogingen, afgerond_op, status, laatste_fout)
  values (v_dev, 'qr-botsing', now() - interval '20 minutes', 3, now() - interval '10 minutes',
          'mislukt', 'fout A');
  insert into public.tyre_prior_queue
    (device_id, session_key, gevraagd_op, pogingen, afgerond_op, status)
  values (v_dev, 'qr-botsing', now() - interval '5 minutes', 0, null, 'open');

  -- Sessie B: één gewone open rij, die moet ongemoeid blijven.
  insert into public.tyre_prior_queue
    (device_id, session_key, gevraagd_op, pogingen, afgerond_op, status)
  values (v_dev, 'qr-enkel', now() - interval '1 minute', 1, null, 'open');

  raise notice 'voor de rollback: %',
    (select string_agg(session_key || '=' || status || '/' || pogingen, ', ' order by id)
       from public.tyre_prior_queue where device_id = v_dev);
end $test$;

-- De echte rollback, in deze transactie.
\ir ../rollback/20261031150400_tyre_prior_queue_status.rollback.sql

do $test$
declare
  v_dev constant uuid := '290fe152-5789-448c-8420-8deb3cf3077f';
  v_n   integer;
begin
  perform pg_temp.eis('G: de statuskolom is weg',
                      not exists (select 1 from information_schema.columns
                                   where table_schema = 'public'
                                     and table_name = 'tyre_prior_queue'
                                     and column_name = 'status'));

  perform pg_temp.eis('G: de oude unieke index staat weer op afgerond_op is null',
                      exists (select 1 from pg_indexes
                               where schemaname = 'public'
                                 and indexname = 'tyre_prior_queue_open_idx'
                                 and indexdef like '%UNIQUE%'
                                 and indexdef like '%afgerond_op IS NULL%'));

  select count(*) into v_n
    from public.tyre_prior_queue
   where device_id = v_dev and session_key = 'qr-botsing';
  perform pg_temp.eis('G: de dubbele rijen zijn samengevoegd tot één', v_n = 1);

  perform pg_temp.eis('G: de oudste opdracht is behouden (tijd van 20 minuten terug)',
                      (select gevraagd_op < now() - interval '15 minutes'
                         from public.tyre_prior_queue
                        where device_id = v_dev and session_key = 'qr-botsing'));

  perform pg_temp.eis('G: de hoogste pogingen zijn overgenomen',
                      (select pogingen = 3
                         from public.tyre_prior_queue
                        where device_id = v_dev and session_key = 'qr-botsing'));

  perform pg_temp.eis('G: de laatst bekende fout is bewaard',
                      (select laatste_fout = 'fout A'
                         from public.tyre_prior_queue
                        where device_id = v_dev and session_key = 'qr-botsing'));

  perform pg_temp.eis('G: de rij staat weer open (afgerond_op null)',
                      (select afgerond_op is null
                         from public.tyre_prior_queue
                        where device_id = v_dev and session_key = 'qr-botsing'));

  perform pg_temp.eis('G: een sessie met één rij is ongemoeid gebleven',
                      (select count(*) = 1 and min(pogingen) = 1
                         from public.tyre_prior_queue
                        where device_id = v_dev and session_key = 'qr-enkel'));

  -- De oude uniciteit geldt nu echt: een tweede open rij voor dezelfde sessie
  -- mag niet meer.
  begin
    insert into public.tyre_prior_queue (device_id, session_key)
    values (v_dev, 'qr-enkel');
    perform pg_temp.eis('G: de oude uniciteit blokkeert een tweede open rij', false);
  exception when unique_violation then
    perform pg_temp.eis('G: de oude uniciteit blokkeert een tweede open rij', true);
  end;
end $test$;

rollback;
