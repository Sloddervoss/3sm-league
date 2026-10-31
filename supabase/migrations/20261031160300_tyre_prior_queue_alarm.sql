-- ============================================================================
-- Endurance — de wachtrij krijgt een alarm dat de cronrun laat falen
-- Datum: 2026-10-31
-- Vorige migratie: 20261031160200_pitwall_context_onbekend.sql
--
-- Repareert reviewpunt D (MIDDEL): de drain vangt verwerkingsfouten af en geeft
-- JSON terug, dus een dead-letter maakte de cronrun niet mislukt. De historie
-- bleef "succeeded / 1 row" melden terwijl er een rij om een mens vroeg. De
-- probleemview was zicht, geen bewaking.
--
-- Nu:
--   1. tyre_prior_queue_alarm() werpt een exception zolang er mislukte rijen
--      zijn of open rijen te lang blijven liggen. Een pg_cron-run die dit
--      aanroept verschijnt daardoor als failed in cron.job_run_details, met de
--      tellingen in return_message.
--   2. Een tweede cronjob (elke vijf minuten) roept dat alarm aan. De bestaande
--      drain-job blijft ongemoeid: die verwerkt, dit bewaakt.
--   3. Retentie bewaart mislukte rijen minstens 90 dagen in plaats van 30.
--      Een mislukte rij is bewijs dat er iets stuk was; die mag niet stil
--      verdwijnen voordat iemand hem heeft gezien of hersteld.
--   4. tyre_prior_queue_herstel(id) zet één mislukte rij terug op open met
--      pogingen = 0, zodat herstel een expliciete handeling is en niet een
--      handmatige update op de tabel.
--
-- Wat niet verandert: de drain zelf, de statuswaarden, de unieke open-index en
-- de probleemview.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Het alarm
-- ---------------------------------------------------------------------------
create or replace function public.tyre_prior_queue_alarm(
  p_max_open_minuten integer default 30)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_mislukt   integer := 0;
  v_te_oud    integer := 0;
  v_met_fout  integer := 0;
  v_oudste    timestamptz;
  v_minuten   integer := greatest(coalesce(p_max_open_minuten, 30), 1);
begin
  select count(*) filter (where q.status = 'mislukt'),
         count(*) filter (where q.status = 'open' and q.pogingen > 0),
         count(*) filter (where q.status = 'open'
                            and q.gevraagd_op < now() - make_interval(mins => v_minuten)),
         min(q.gevraagd_op) filter (where q.status = 'open'
                                      and q.gevraagd_op < now() - make_interval(mins => v_minuten))
    into v_mislukt, v_met_fout, v_te_oud, v_oudste
    from public.tyre_prior_queue q;

  -- Een mislukte rij of een rij die te lang blijft liggen is een storing, geen
  -- ruis: de onderhoudslus komt er kennelijk niet uit. De exception is het
  -- signaal — pg_cron bewaart hem als failed met deze tekst.
  if v_mislukt > 0 or v_te_oud > 0 then
    raise exception
      'tyre_prior_queue_alarm: % mislukt, % langer dan % minuten open (oudste %), % open met eerdere fouten',
      v_mislukt, v_te_oud, v_minuten, coalesce(v_oudste::text, '-'), v_met_fout
      using errcode = 'P0001',
            hint = 'Bekijk public.tyre_prior_queue_problemen; herstel een rij met public.tyre_prior_queue_herstel(id).';
  end if;

  return jsonb_build_object(
    'mislukt', v_mislukt,
    'te_lang_open', v_te_oud,
    'open_met_fouten', v_met_fout,
    'grens_minuten', v_minuten
  );
end;
$$;

comment on function public.tyre_prior_queue_alarm(integer) is
  'Bewaking van de onderhoudswachtrij: werpt een exception zolang er mislukte rijen zijn of open rijen langer dan p_max_open_minuten (standaard 30) op hun verwerking wachten, zodat een pg_cron-run als failed verschijnt in cron.job_run_details. Zonder problemen geeft hij de tellingen als jsonb terug. Alleen voor onderhoud (service_role of psql).';

revoke all on function public.tyre_prior_queue_alarm(integer) from public, anon, authenticated;
grant execute on function public.tyre_prior_queue_alarm(integer) to service_role;

-- ---------------------------------------------------------------------------
-- 2. Herstel van één mislukte rij
-- ---------------------------------------------------------------------------
create or replace function public.tyre_prior_queue_herstel(p_id bigint)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_rij integer := 0;
begin
  if p_id is null then
    return false;
  end if;

  -- Alleen een mislukte rij komt terug. Een rij die al open staat hoeft geen
  -- herstel, en een verwerkte rij opnieuw aanmelden zou dubbel werk doen.
  update public.tyre_prior_queue q
     set status = 'open',
         pogingen = 0,
         afgerond_op = null,
         gevraagd_op = now()
   where q.id = p_id
     and q.status = 'mislukt';

  get diagnostics v_rij = row_count;
  return v_rij > 0;
end;
$$;

comment on function public.tyre_prior_queue_herstel(bigint) is
  'Zet één mislukte wachtrijrij terug op open met pogingen = 0 en een nieuwe vraagtijd, zodat de drain hem opnieuw probeert. Geeft false als de rij niet bestaat of niet mislukt was. Alleen voor onderhoud (service_role of psql).';

revoke all on function public.tyre_prior_queue_herstel(bigint) from public, anon, authenticated;
grant execute on function public.tyre_prior_queue_herstel(bigint) to service_role;

-- ---------------------------------------------------------------------------
-- 3. Retentie: verwerkt na 30 dagen, mislukt pas na 90
-- ---------------------------------------------------------------------------
create or replace function public.tyre_prior_queue_retention(p_dagen integer default 30)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_weg        integer := 0;
  v_weg_ok     integer := 0;
  v_weg_dood   integer := 0;
  v_dood_dagen integer;
begin
  if p_dagen is null or p_dagen < 1 then
    return 0;
  end if;

  -- Een mislukte rij is een spoor van een storing: die blijft minstens 90 dagen
  -- staan, ook als de retentie voor verwerkte rijen korter is. Stil opruimen
  -- zou het alarm en het herstel betekenisloos maken.
  v_dood_dagen := greatest(p_dagen, 90);

  -- Verwerkte rijen: de gewone retentie. Een open rij blijft altijd staan tot
  -- de drain of een mens hem afrondt: stilte is geen opruimargument.
  delete from public.tyre_prior_queue q
   where q.status = 'verwerkt'
     and coalesce(q.afgerond_op, q.gevraagd_op) < now() - make_interval(days => p_dagen);
  get diagnostics v_weg_ok = row_count;

  delete from public.tyre_prior_queue q
   where q.status = 'mislukt'
     and coalesce(q.afgerond_op, q.gevraagd_op) < now() - make_interval(days => v_dood_dagen);
  get diagnostics v_weg_dood = row_count;

  v_weg := v_weg_ok + v_weg_dood;
  return v_weg;
end;
$$;

comment on function public.tyre_prior_queue_retention(integer) is
  'Ruimt afgeronde wachtrijrijen op: verwerkte rijen ouder dan p_dagen (standaard 30) en mislukte rijen ouder dan max(p_dagen, 90). Een mislukte rij is het bewijs van een storing en blijft dus minstens 90 dagen staan, of tot hij met tyre_prior_queue_herstel() is hersteld. Open rijen blijven altijd staan. Geeft het aantal verwijderde rijen terug.';

revoke all on function public.tyre_prior_queue_retention(integer) from public, anon, authenticated;
grant execute on function public.tyre_prior_queue_retention(integer) to service_role;

-- ---------------------------------------------------------------------------
-- 4. De bewakingsjob naast de bestaande drainjob
-- ---------------------------------------------------------------------------
do $$
begin
  -- Zonder pg_cron (bijvoorbeeld een lokale testdatabase) is er niets te
  -- plannen; het alarm zelf blijft dan gewoon bestaan.
  if to_regprocedure('cron.schedule(text,text,text)') is null then
    raise notice 'pg_cron niet aanwezig: tyre-prior-alarm niet gepland';
    return;
  end if;

  if exists (select 1 from cron.job j where j.jobname = 'tyre-prior-alarm') then
    perform cron.unschedule('tyre-prior-alarm');
  end if;

  perform cron.schedule(
    'tyre-prior-alarm',
    '*/5 * * * *',
    'select public.tyre_prior_queue_alarm(30)');
end $$;

-- ---------------------------------------------------------------------------
-- 5. Controle
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_proc p
                   join pg_namespace n on n.oid = p.pronamespace
                  where n.nspname = 'public'
                    and p.proname = 'tyre_prior_queue_alarm') then
    raise exception 'tyre_prior_queue_alarm ontbreekt';
  end if;

  -- De retentiegrens voor mislukte rijen moet 90 dagen zijn; een kortere
  -- retentie zou het bewijs van een storing stil opruimen.
  if position('greatest(p_dagen, 90)' in
              pg_get_functiondef('public.tyre_prior_queue_retention(integer)'::regprocedure)) = 0 then
    raise exception 'de retentie bewaart mislukte rijen niet minstens 90 dagen';
  end if;

  if has_function_privilege('authenticated', 'public.tyre_prior_queue_alarm(integer)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.tyre_prior_queue_herstel(bigint)', 'EXECUTE') then
    raise exception 'authenticated kan het alarm of het herstel aanroepen';
  end if;
end $$;
