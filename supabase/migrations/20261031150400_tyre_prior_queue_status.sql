-- ============================================================================
-- Endurance — de wachtrij krijgt een echte status, retentie en zicht op
-- vastgelopen rijen
-- Datum: 2026-10-31
-- Vorige migratie: 20261031150300_pitwall_prior_accounts.sql
--
-- Repareert reviewpunt 2.6 (MIDDEL): de wachtrij kon duurzaam vastlopen
-- zonder dat "open" dat meldde.
--
-- Voorheen bleef na drie mislukte pogingen afgerond_op leeg. Daardoor:
--   * bleef de rij onder de partiële unieke index vallen;
--   * werden nieuwe verzoeken voor dezelfde sessie door ON CONFLICT DO NOTHING
--     genegeerd;
--   * sloeg de drain de rij over;
--   * telde de drain haar niet mee in het geretourneerde open-aantal.
-- "open = 0" kon dus betekenen: niets meer automatisch herstelbaar, in plaats
-- van: alles verwerkt.
--
-- Nu:
--   1. Elke rij heeft een status: open, verwerkt of mislukt. De partiële unieke
--      index staat alleen nog op status = 'open'; een mislukte rij blokkeert
--      een nieuw verzoek dus niet meer, en een nieuwe stint in dezelfde sessie
--      maakt weer een open opdracht aan.
--   2. Na drie mislukte pogingen wordt de rij 'mislukt' met afgerond_op en
--      laatste_fout. De drain rapporteert open en mislukt apart, zodat een
--      rij die handmatig herstel nodig heeft zichtbaar blijft als mislukt en
--      niet als "niets open".
--   3. tyre_prior_queue_retention(dagen) ruimt afgeronde rijen ouder dan 30
--      dagen op; de drain roept hem aan en meldt het aantal opgeruimde rijen.
--   4. De view tyre_prior_queue_problemen maakt vastgelopen rijen zichtbaar
--      (mislukt, of open met eerdere fouten, of open en te lang ongewijzigd).
--
-- Wat niet verandert: de trigger meldt alleen aan (statement-level, ON CONFLICT
-- DO NOTHING), de drain gebruikt FOR UPDATE SKIP LOCKED en pakt nooit meer dan
-- p_limit rijen per run. De wachtrij blijft onleesbaar voor clientrollen.
-- ============================================================================

begin;

-- ---------------------------------------------------------------------------
-- 1. Statuskolom en de bestaande rijen
-- ---------------------------------------------------------------------------
alter table public.tyre_prior_queue
  add column if not exists status text;

-- Bestaande rijen: een afgeronde rij is verwerkt; een rij met drie pogingen en
-- zonder afronding is de oude dead-letter (die werd voorheen stil als "open"
-- geteld); de rest is open.
update public.tyre_prior_queue
   set status = case when afgerond_op is not null then 'verwerkt'
                     when pogingen >= 3 then 'mislukt'
                     else 'open' end
 where status is null;

-- Een dead-letter van vóór deze migratie heeft geen afrondingstijd; hij is nu
-- wel afgerond (uit de wachtrij), dus krijgt hij het migratiemoment. Dat maakt
-- de retentie eenduidig: elke rij die de wachtrij verliet heeft afgerond_op.
update public.tyre_prior_queue
   set afgerond_op = now()
 where status = 'mislukt' and afgerond_op is null;

alter table public.tyre_prior_queue
  alter column status set default 'open',
  alter column status set not null;

alter table public.tyre_prior_queue
  drop constraint if exists tyre_prior_queue_status_check;
alter table public.tyre_prior_queue
  add constraint tyre_prior_queue_status_check
  check (status in ('open', 'verwerkt', 'mislukt'));

comment on column public.tyre_prior_queue.status is
  'open = wacht op verwerking; verwerkt = tyre_prior_sync_session() slaagde; mislukt = na 3 pogingen uit de wachtrij, handmatig herstel nodig.';
comment on column public.tyre_prior_queue.afgerond_op is
  'Tijdstip waarop de rij de wachtrij verliet (verwerkt of mislukt). NULL zolang status open is.';
comment on column public.tyre_prior_queue.pogingen is
  'Aantal mislukte verwerkingen. Bij 3 wordt de rij status = mislukt en pakt de drain hem niet meer op; laatste_fout zegt waarom.';

-- ---------------------------------------------------------------------------
-- 2. Indexen: alleen een OPEN rij blokkeert een nieuwe opdracht
-- ---------------------------------------------------------------------------
drop index if exists public.tyre_prior_queue_open_idx;
create unique index tyre_prior_queue_open_idx
  on public.tyre_prior_queue (device_id, session_key)
  where status = 'open';

drop index if exists public.tyre_prior_queue_wacht_idx;
create index tyre_prior_queue_wacht_idx
  on public.tyre_prior_queue (gevraagd_op, id)
  where status = 'open' and pogingen < 3;

-- Retentie en de probleemview zoeken op status + afrondingstijd.
create index if not exists tyre_prior_queue_status_idx
  on public.tyre_prior_queue (status, afgerond_op);

-- ---------------------------------------------------------------------------
-- 3. Retentie: afgeronde rijen verdwijnen na 30 dagen
-- ---------------------------------------------------------------------------
create or replace function public.tyre_prior_queue_retention(p_dagen integer default 30)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_weg integer := 0;
begin
  if p_dagen is null or p_dagen < 1 then
    return 0;
  end if;

  -- Alleen rijen die de wachtrij al verlaten hebben (verwerkt of mislukt).
  -- Een open rij blijft staan tot de drain of een mens hem afrondt: stilte is
  -- hier geen opruimargument. Een mislukte rij blijft dertig dagen zichtbaar
  -- in tyre_prior_queue_problemen en verdwijnt daarna met dezelfde retentie.
  delete from public.tyre_prior_queue q
   where q.status in ('verwerkt', 'mislukt')
     and coalesce(q.afgerond_op, q.gevraagd_op) < now() - make_interval(days => p_dagen);

  get diagnostics v_weg = row_count;
  return v_weg;
end;
$$;

comment on function public.tyre_prior_queue_retention(integer) is
  'Ruimt afgeronde wachtrijrijen (verwerkt of mislukt) ouder dan p_dagen (standaard 30) op en geeft het aantal verwijderde rijen terug. Open rijen blijven staan: die wachten nog op de drain of op een blik.';

revoke all on function public.tyre_prior_queue_retention(integer) from public, anon, authenticated;
grant execute on function public.tyre_prior_queue_retention(integer) to service_role;

-- ---------------------------------------------------------------------------
-- 4. De drain: status, aparte tellingen, retentie
-- ---------------------------------------------------------------------------
create or replace function public.tyre_prior_drain(p_limit integer default 20)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
set lock_timeout = '2s'
as $$
declare
  v_max     constant integer := 3;
  v_dagen   constant integer := 30;
  v_ids     bigint[];
  v_id      bigint;
  v_dev     uuid;
  v_sess    text;
  v_ok      integer := 0;
  v_fout    integer := 0;
  v_open    integer := 0;
  v_dood    integer := 0;
  v_opgeruimd integer := 0;
begin
  if p_limit is null or p_limit < 1 then
    return jsonb_build_object('verwerkt', 0, 'fouten', 0, 'kandidaten', 0,
                              'open', 0, 'mislukt', 0, 'opgeruimd', 0);
  end if;

  -- Retentie eerst: een klein delete met een index, en de wachtrij groeit niet
  -- onbeperkt door afgeronde herhaalrijen.
  v_opgeruimd := public.tyre_prior_queue_retention(v_dagen);

  select array_agg(k.id order by k.gevraagd_op, k.id)
    into v_ids
    from (
      select q.id, q.gevraagd_op
        from public.tyre_prior_queue q
       where q.status = 'open'
         and q.pogingen < v_max
       order by q.gevraagd_op, q.id
       limit p_limit
       for update skip locked
    ) k;

  foreach v_id in array coalesce(v_ids, '{}'::bigint[]) loop
    select q.device_id, q.session_key
      into v_dev, v_sess
      from public.tyre_prior_queue q
     where q.id = v_id;

    begin
      perform public.tyre_prior_sync_session(v_dev, v_sess);
      update public.tyre_prior_queue
         set afgerond_op = now(),
             status = 'verwerkt',
             laatste_fout = null
       where id = v_id;
      v_ok := v_ok + 1;
    exception
      when others then
        -- De derde fout is definitief: de rij verlaat de wachtrij als
        -- 'mislukt' met een afrondingstijd. Zo blokkeert hij geen nieuw
        -- verzoek meer (de unieke index kijkt alleen naar 'open') en telt hij
        -- in de drain als mislukt in plaats van als "niets open".
        update public.tyre_prior_queue
           set pogingen = pogingen + 1,
               laatste_fout = left(sqlerrm, 500),
               status = case when pogingen + 1 >= v_max then 'mislukt' else 'open' end,
               afgerond_op = case when pogingen + 1 >= v_max then now() else null end
         where id = v_id;
        v_fout := v_fout + 1;
    end;
  end loop;

  select count(*) filter (where status = 'open' and pogingen < v_max),
         count(*) filter (where status = 'mislukt')
    into v_open, v_dood
    from public.tyre_prior_queue;

  return jsonb_build_object(
    'verwerkt', v_ok,
    'fouten', v_fout,
    'kandidaten', coalesce(array_length(v_ids, 1), 0),
    'open', v_open,
    'mislukt', v_dood,
    'opgeruimd', v_opgeruimd
  );
end;
$$;

comment on function public.tyre_prior_drain(integer) is
  'Verwerkt de onderhoudswachtrij: pakt tot p_limit openstaande rijen met for update skip locked, roept tyre_prior_sync_session() per rij aan, zet status=verwerkt en afgerond_op bij succes, en verhoogt pogingen bij een fout. Na 3 fouten wordt de rij status=mislukt met afgerond_op en laatste_fout. Rapporteert verwerkt/fouten/kandidaten, de stand van de wachtrij (open en mislukt apart) en het aantal opgeruimde rijen (retentie 30 dagen). Alleen voor onderhoud (service_role of psql), niet voor de pitwall.';

revoke all on function public.tyre_prior_drain(integer) from public, anon, authenticated;
grant execute on function public.tyre_prior_drain(integer) to service_role;

-- ---------------------------------------------------------------------------
-- 5. Zicht op vastgelopen rijen
-- ---------------------------------------------------------------------------
-- Wat hier in staat vraagt om een blik:
--   * status = mislukt: drie pogingen gehad, geen automatisch herstel meer;
--   * status = open met pogingen > 0: al eens mislukt, kan alsnog aflopen;
--   * status = open en langer dan 30 minuten ongewijzigd: de drain heeft hem
--     kennelijk niet bereikt (scheduler stuk, of de rij is blijven hangen).
create or replace view public.tyre_prior_queue_problemen as
select q.id,
       q.device_id,
       q.session_key,
       q.status,
       q.pogingen,
       q.laatste_fout,
       q.gevraagd_op,
       q.afgerond_op,
       floor(extract(epoch from (now() - q.gevraagd_op)) / 60)::integer as wacht_minuten
  from public.tyre_prior_queue q
 where q.status = 'mislukt'
    or (q.status = 'open' and q.pogingen > 0)
    or (q.status = 'open' and q.gevraagd_op < now() - interval '30 minutes');

comment on view public.tyre_prior_queue_problemen is
  'Wachtrijrijen die aandacht vragen: mislukt (na 3 pogingen), open met eerdere fouten, of open en langer dan 30 minuten onaangeroerd. wacht_minuten is de leeftijd van het verzoek. Niet leesbaar voor clientrollen.';

revoke all on public.tyre_prior_queue_problemen from public, anon, authenticated;
grant select on public.tyre_prior_queue_problemen to service_role;

-- ---------------------------------------------------------------------------
-- 6. Controle
-- ---------------------------------------------------------------------------
do $$
begin
  if exists (select 1 from public.tyre_prior_queue q
              where q.status = 'open' and q.afgerond_op is not null) then
    raise exception 'een open rij heeft een afrondingstijd';
  end if;

  if exists (select 1 from public.tyre_prior_queue q
              where q.status = 'mislukt' and q.pogingen < 3) then
    raise exception 'een mislukte rij heeft minder dan drie pogingen';
  end if;

  if not exists (select 1 from pg_indexes
                  where schemaname = 'public'
                    and indexname = 'tyre_prior_queue_open_idx'
                    and indexdef like '%status = ''open''%') then
    raise exception 'de unieke open-index staat niet op status = open';
  end if;

  if has_table_privilege('authenticated', 'public.tyre_prior_queue', 'SELECT')
     or has_table_privilege('authenticated', 'public.tyre_prior_queue_problemen', 'SELECT') then
    raise exception 'authenticated kan de wachtrij of de probleemview lezen';
  end if;
end $$;

commit;
