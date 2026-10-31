-- ============================================================================
-- Test voor 20261031160300_tyre_prior_queue_alarm.sql
--
--   A. Het alarm werpt een exception zolang er een mislukte rij is. Dat is wat
--      een pg_cron-run laat falen; een JSON-retour zou "succeeded" blijven
--      melden.
--   B. Het alarm werpt ook bij een open rij die te lang blijft liggen, en zegt
--      met hoeveel.
--   C. Zonder problemen geeft het alarm de tellingen terug in plaats van een
--      exception.
--   D. Retentie bewaart een mislukte rij van 40 dagen (de oude retentie van 30
--      dagen ruimde hem op) en ruimt een verwerkte rij van 40 dagen wel op.
--   E. Herstel zet één mislukte rij terug op open met pogingen = 0, en weigert
--      een rij die niet mislukt is.
--   F. De bewakingsjob staat naast de drainjob in cron.job.
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

do $test$
declare
  v_dev    constant uuid := '290fe152-5789-448c-8420-8deb3cf3077f';  -- CAT-PC
  v_id     bigint;
  v_ok     boolean;
  v_json   jsonb;
  v_fout   text;
  v_weg    integer;
begin
  delete from public.tyre_prior_queue where device_id = v_dev;

  --------------------------------------------------------------------------
  -- A. Een mislukte rij laat het alarm afgaan
  --------------------------------------------------------------------------
  insert into public.tyre_prior_queue
    (device_id, session_key, gevraagd_op, pogingen, afgerond_op, status, laatste_fout)
  values (v_dev, 'qa-mislukt', now() - interval '2 minutes', 3, now(), 'mislukt', 'testfout')
  returning id into v_id;

  v_fout := null;
  begin
    perform public.tyre_prior_queue_alarm(30);
  exception when others then
    v_fout := sqlstate || ': ' || sqlerrm;
  end;

  raise notice 'A: %', v_fout;
  perform pg_temp.eis('A: het alarm werpt een exception bij een mislukte rij',
                      v_fout is not null and v_fout like 'P0001:%');
  perform pg_temp.eis('A: de melding zegt hoeveel er mislukt zijn',
                      v_fout like '%1 mislukt%');

  --------------------------------------------------------------------------
  -- B. Een te lang open rij laat het alarm ook afgaan
  --------------------------------------------------------------------------
  update public.tyre_prior_queue set status = 'verwerkt', afgerond_op = now() where id = v_id;
  insert into public.tyre_prior_queue
    (device_id, session_key, gevraagd_op, pogingen, status)
  values (v_dev, 'qa-oud', now() - interval '45 minutes', 0, 'open');

  v_fout := null;
  begin
    perform public.tyre_prior_queue_alarm(30);
  exception when others then
    v_fout := sqlerrm;
  end;

  raise notice 'B: %', v_fout;
  perform pg_temp.eis('B: het alarm noemt de rij die te lang open staat',
                      v_fout is not null and v_fout like '%langer dan 30 minuten open%');

  --------------------------------------------------------------------------
  -- C. Zonder problemen: tellingen, geen exception
  --------------------------------------------------------------------------
  update public.tyre_prior_queue set status = 'verwerkt', afgerond_op = now()
   where device_id = v_dev;

  v_json := public.tyre_prior_queue_alarm(30);
  raise notice 'C: %', v_json;
  perform pg_temp.eis('C: zonder problemen komt er een telling terug',
                      (v_json->>'mislukt')::integer = 0
                      and (v_json->>'te_lang_open')::integer = 0);

  --------------------------------------------------------------------------
  -- D. Retentie bewaart mislukte rijen 90 dagen
  --------------------------------------------------------------------------
  insert into public.tyre_prior_queue
    (device_id, session_key, gevraagd_op, pogingen, afgerond_op, status)
  values
    (v_dev, 'qa-40-mislukt', now() - interval '40 days', 3, now() - interval '40 days', 'mislukt'),
    (v_dev, 'qa-40-verwerkt', now() - interval '40 days', 0, now() - interval '40 days', 'verwerkt'),
    (v_dev, 'qa-100-mislukt', now() - interval '100 days', 3, now() - interval '100 days', 'mislukt');

  v_weg := public.tyre_prior_queue_retention(30);
  raise notice 'D: retentie verwijderde % rijen', v_weg;

  perform pg_temp.eis('D: een mislukte rij van 40 dagen blijft staan',
                      exists (select 1 from public.tyre_prior_queue
                               where device_id = v_dev and session_key = 'qa-40-mislukt'));
  perform pg_temp.eis('D: een verwerkte rij van 40 dagen is opgeruimd',
                      not exists (select 1 from public.tyre_prior_queue
                                   where device_id = v_dev and session_key = 'qa-40-verwerkt'));
  perform pg_temp.eis('D: een mislukte rij van 100 dagen is wel opgeruimd',
                      not exists (select 1 from public.tyre_prior_queue
                                   where device_id = v_dev and session_key = 'qa-100-mislukt'));

  --------------------------------------------------------------------------
  -- E. Herstel van één mislukte rij
  --------------------------------------------------------------------------
  select id into v_id from public.tyre_prior_queue
   where device_id = v_dev and session_key = 'qa-40-mislukt';

  v_ok := public.tyre_prior_queue_herstel(v_id);
  perform pg_temp.eis('E: herstel zet de rij terug op open met pogingen 0',
                      v_ok
                      and (select status = 'open' and pogingen = 0 and afgerond_op is null
                             from public.tyre_prior_queue where id = v_id));

  v_ok := public.tyre_prior_queue_herstel(v_id);
  perform pg_temp.eis('E: een tweede herstel op een open rij doet niets', v_ok = false);

  update public.tyre_prior_queue set status = 'verwerkt', afgerond_op = now() where id = v_id;
  perform pg_temp.eis('E: een verwerkte rij is niet te herstellen',
                      public.tyre_prior_queue_herstel(v_id) = false);

  --------------------------------------------------------------------------
  -- F. De bewakingsjob
  --------------------------------------------------------------------------
  if to_regclass('cron.job') is not null then
    perform pg_temp.eis('F: de bewakingsjob staat in cron.job',
                        exists (select 1 from cron.job j
                                 where j.jobname = 'tyre-prior-alarm'
                                   and j.command like '%tyre_prior_queue_alarm%'
                                   and j.active));
  else
    raise notice 'F: geen pg_cron in deze database; de job is hier niet te toetsen';
  end if;

  delete from public.tyre_prior_queue where device_id = v_dev;
end $test$;

rollback;
