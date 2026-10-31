-- ============================================================================
-- Endurance — onderhoud buiten het ingestpad: een wachtrij in plaats van een sync
-- Datum: 2026-10-31
-- Vorige migratie: 20261031130200_tyre_prior_session_move.sql
--
-- Contractpunt 7. De statement-triggers op simhub_tyre_lap_samples deden zelf
-- het onderhoud: per gesloten stint werd tyre_prior_sync_session() aangeroepen,
-- en die scande de sessie, vergeleek met de boekhouding en schreef de cellen
-- bij. Dat is werk dat de ingest niet hoort te dragen — de ingest schrijft een
-- meting, meer niet. Bij een lange sessie. bij een lock, of bij een backfill
-- werd de flush daardoor mede afhankelijk van het model.
--
-- Nu:
--   * de trigger schrijft alleen een rij in tyre_prior_queue met
--     (device_id, session_key, gevraagd_op, pogingen, laatste_fout, afgerond_op)
--     en `on conflict do nothing`;
--   * tyre_prior_drain(p_limit) verwerkt de wachtrij met `for update skip
--     locked`, maximaal drie pogingen per rij, en zet afgerond_op bij succes.
--
-- Waarom `on conflict do nothing` zonder conflictdoel
-- ---------------------------------------------------
-- Er is een partiële unieke index op (device_id, session_key) WHERE
-- afgerond_op IS NULL. Die zorgt dat een sessie hooguit één openstaande
-- opdracht heeft — een flush van twintig rondes levert één rij op, niet twintig.
-- Zodra de drain de rij afrondt, vervalt hij uit de index en kan een volgende
-- stint in dezelfde sessie opnieuw worden aangemeld. Precies wat je wilt: één
-- wachtrij, geen dubbele opdrachten, en geen historie die de wachtrij laat
-- groeien. De afgeronde rijen blijven staan als spoor (met hun laatste_fout);
-- ze zijn klein en ze maken "wat is er gebeurd" achteraf leesbaar.
--
-- Waarom een id-kolom en niet (device_id, session_key) als primaire sleutel
-- ----------------------------------------------------------------------
-- Een partiële unieke index kan geen primaire sleutel zijn, en de wachtrij
-- moet ook afgeronde rijen kunnen bewaren. Het id is de volgorde waarin de
-- drain werkt (oudste eerst) en de rij-identiteit voor `for update skip locked`.
-- De trigger schrijft hem niet: hij is `generated always as identity`.
--
-- Gevolg voor de bedrijfsvoering (bewust, hier vastgelegd)
-- -------------------------------------------------------
-- Na deze migratie doet de ingest zelf niets meer aan de pool. Wie de pool
-- actueel wil houden, moet tyre_prior_drain() periodiek aanroepen (cron of een
-- korte job) — of tyre_prior_refresh() voor een volledige herbouw. Zonder
-- drain loopt de pool achter; hij wordt niet fout, want elke bijdrage is nog
-- steeds de som van wat er in tyre_prior_contrib staat.
-- ============================================================================

begin;

-- ---------------------------------------------------------------------------
-- 1. De wachtrij
-- ---------------------------------------------------------------------------
create table if not exists public.tyre_prior_queue (
  id           bigint generated always as identity primary key,
  device_id    uuid not null,
  session_key  text not null,
  gevraagd_op  timestamptz not null default now(),
  pogingen     smallint not null default 0,
  laatste_fout text,
  afgerond_op  timestamptz
);

comment on table public.tyre_prior_queue is
  'Onderhoudswachtrij voor de bandenpool: één openstaande opdracht per (apparaat, sessie) die nog niet verwerkt is. De trigger op simhub_tyre_lap_samples schrijft hier alleen een rij in; tyre_prior_drain() verwerkt de rij en zet afgerond_op. Afgeronde rijen blijven als spoor staan. Niet leesbaar of schrijfbaar voor clientrollen.';
comment on column public.tyre_prior_queue.pogingen is
  'Aantal mislukte verwerkingen. Bij 3 wordt de rij niet meer opgepakt; laatste_fout zegt waarom.';
comment on column public.tyre_prior_queue.afgerond_op is
  'Tijdstip waarop tyre_prior_sync_session() voor deze sessie slaagde. NULL = nog open.';

-- Eén openstaande opdracht per apparaat en sessie. Dit is de index waar
-- `on conflict do nothing` op leunt; zonder hem zou elke flush een nieuwe rij
-- toevoegen en zou de drain hetzelfde werk steeds opnieuw doen.
create unique index if not exists tyre_prior_queue_open_idx
  on public.tyre_prior_queue (device_id, session_key)
  where afgerond_op is null;

-- De drain leest oudste-eerst en slaat rijen met drie pogingen over.
create index if not exists tyre_prior_queue_wacht_idx
  on public.tyre_prior_queue (gevraagd_op, id)
  where afgerond_op is null and pogingen < 3;

alter table public.tyre_prior_queue enable row level security;
revoke all on table public.tyre_prior_queue from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 2. De trigger: alleen aanmelden
-- ---------------------------------------------------------------------------
-- De poortwachter blijft: een gewone ronde (zelfde bandenset, geen wear-sprong)
-- meldt niets aan. Dat is één functieaanroep met twee indexzoekacties, en het
-- houdt de wachtrij leeg tijdens normaal rijden. Bij een bulk-insert (backfill,
-- import) wordt de poortwachter overgeslagen: per rij twee zoekacties zou de
-- import duur maken, en de drain herberekent een sessie toch volledig en
-- idempotent. Dubbel aanmelden is dan alleen wat extra werk, geen fout.
create or replace function public.tyre_prior_enqueue_on_insert()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_aantal integer;
  v_rij    public.simhub_tyre_lap_samples%rowtype;
  v_sess   text;
begin
  select count(*) into v_aantal from changed;
  if v_aantal = 0 then
    return null;
  end if;

  if v_aantal = 1 then
    select * into v_rij from changed;
    if v_rij.device_id is null then
      return null;
    end if;
    v_sess := public.tyre_prior_closed_session(
      v_rij.device_id, v_rij.session_key, v_rij.lap_number, v_rij.captured_at,
      v_rij.tyre_set,
      greatest(nullif(v_rij.wear_fl, 'NaN'::numeric),
               nullif(v_rij.wear_fr, 'NaN'::numeric),
               nullif(v_rij.wear_rl, 'NaN'::numeric),
               nullif(v_rij.wear_rr, 'NaN'::numeric)));
    if v_sess is not null then
      insert into public.tyre_prior_queue (device_id, session_key)
      values (v_rij.device_id, v_sess)
      on conflict do nothing;
    end if;
  else
    insert into public.tyre_prior_queue (device_id, session_key)
    select distinct c.device_id, c.session_key
      from changed c
     where c.device_id is not null
    on conflict do nothing;
  end if;

  return null;
exception
  when others then
    -- Een wachtrij mag nooit een meting blokkeren. De ingest gaat door; het
    -- signaal staat in het PG-log en tyre_prior_refresh() herstelt desnoods.
    raise warning 'tyre_prior_queue: aanmelden overgeslagen (%)', sqlerrm;
    return null;
end;
$$;

create or replace function public.tyre_prior_enqueue_on_update()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  -- Een bijgewerkte ronde kan een al gesloten stint veranderen (herstel van een
  -- meting), dus hier geen poortwachter: alle geraakte sessies worden aangemeld.
  insert into public.tyre_prior_queue (device_id, session_key)
  select distinct u.device_id, u.session_key
    from (select * from changed union all select * from oud) u
   where u.device_id is not null
  on conflict do nothing;
  return null;
exception
  when others then
    raise warning 'tyre_prior_queue: aanmelden overgeslagen (%)', sqlerrm;
    return null;
end;
$$;

create or replace function public.tyre_prior_enqueue_on_delete()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into public.tyre_prior_queue (device_id, session_key)
  select distinct c.device_id, c.session_key
    from changed c
   where c.device_id is not null
  on conflict do nothing;
  return null;
exception
  when others then
    raise warning 'tyre_prior_queue: aanmelden overgeslagen (%)', sqlerrm;
    return null;
end;
$$;

revoke all on function public.tyre_prior_enqueue_on_insert() from public, anon, authenticated;
revoke all on function public.tyre_prior_enqueue_on_update() from public, anon, authenticated;
revoke all on function public.tyre_prior_enqueue_on_delete() from public, anon, authenticated;

-- De oude triggers deden de sync zelf. Weg ermee, en de nieuwe namen erin. De
-- `if exists` houdt de migratie herhaalbaar na een rollback.
drop trigger if exists simhub_tyre_lap_samples_prior_ins on public.simhub_tyre_lap_samples;
drop trigger if exists simhub_tyre_lap_samples_prior_upd on public.simhub_tyre_lap_samples;
drop trigger if exists simhub_tyre_lap_samples_prior_del on public.simhub_tyre_lap_samples;
drop trigger if exists simhub_tyre_lap_samples_queue_ins on public.simhub_tyre_lap_samples;
drop trigger if exists simhub_tyre_lap_samples_queue_upd on public.simhub_tyre_lap_samples;
drop trigger if exists simhub_tyre_lap_samples_queue_del on public.simhub_tyre_lap_samples;

create trigger simhub_tyre_lap_samples_queue_ins
  after insert on public.simhub_tyre_lap_samples
  referencing new table as changed
  for each statement execute function public.tyre_prior_enqueue_on_insert();

create trigger simhub_tyre_lap_samples_queue_upd
  after update on public.simhub_tyre_lap_samples
  referencing old table as oud new table as changed
  for each statement execute function public.tyre_prior_enqueue_on_update();

create trigger simhub_tyre_lap_samples_queue_del
  after delete on public.simhub_tyre_lap_samples
  referencing old table as changed
  for each statement execute function public.tyre_prior_enqueue_on_delete();

-- ---------------------------------------------------------------------------
-- 3. De drain
-- ---------------------------------------------------------------------------
-- `for update skip locked` in de kandidatenquery: twee drains die tegelijk
-- lopen pakken nooit dezelfde rij. De rij-lock wordt pas aan het eind van de
-- transactie vrijgegeven, dus de update hieronder valt binnen dezelfde lock.
--
-- Maximaal drie pogingen: een rij die drie keer faalt is geen tijdelijk
-- probleem meer (een kapotte sessie, een ontbrekende tabel, een blijvende
-- lock) en hoort uit de wachtrij te blijven tot iemand kijkt. laatste_fout
-- bewaart de melding van de laatste poging.
--
-- De verwerking van één rij zit in een eigen blok met exception: een fout in
-- sessie A mag sessie B niet tegenhouden. De teller wordt in de buitenste
-- transactie bijgewerkt, dus de poging is ook geteld als de sync halverwege
-- faalde.
create or replace function public.tyre_prior_drain(p_limit integer default 20)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
set lock_timeout = '2s'
as $$
declare
  v_max   constant integer := 3;
  v_ids   bigint[];
  v_id    bigint;
  v_dev   uuid;
  v_sess  text;
  v_ok    integer := 0;
  v_fout  integer := 0;
  v_open  integer := 0;
begin
  if p_limit is null or p_limit < 1 then
    return jsonb_build_object('verwerkt', 0, 'mislukt', 0, 'kandidaten', 0, 'open', 0);
  end if;

  select array_agg(k.id order by k.gevraagd_op, k.id)
    into v_ids
    from (
      select q.id, q.gevraagd_op
        from public.tyre_prior_queue q
       where q.afgerond_op is null
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
             laatste_fout = null
       where id = v_id;
      v_ok := v_ok + 1;
    exception
      when others then
        update public.tyre_prior_queue
           set pogingen = pogingen + 1,
               laatste_fout = left(sqlerrm, 500)
         where id = v_id;
        v_fout := v_fout + 1;
    end;
  end loop;

  select count(*) into v_open
    from public.tyre_prior_queue q
   where q.afgerond_op is null
     and q.pogingen < v_max;

  return jsonb_build_object(
    'verwerkt', v_ok,
    'mislukt', v_fout,
    'kandidaten', coalesce(array_length(v_ids, 1), 0),
    'open', v_open
  );
end;
$$;

comment on function public.tyre_prior_drain(integer) is
  'Verwerkt de onderhoudswachtrij: pakt tot p_limit openstaande rijen met for update skip locked, roept tyre_prior_sync_session() per rij aan, zet afgerond_op bij succes en verhoogt pogingen (max 3) met laatste_fout bij een fout. Geeft verwerkt/mislukt/kandidaten/open terug. Alleen voor onderhoud (service_role of psql), niet voor de pitwall.';

revoke all on function public.tyre_prior_drain(integer) from public, anon, authenticated;
grant execute on function public.tyre_prior_drain(integer) to service_role;

-- ---------------------------------------------------------------------------
-- 4. Controle: één trigger per bewerking, en geen sync meer in de trigger
-- ---------------------------------------------------------------------------
do $$
declare
  v_trg text;
begin
  foreach v_trg in array array[
    'simhub_tyre_lap_samples_prior_ins',
    'simhub_tyre_lap_samples_prior_upd',
    'simhub_tyre_lap_samples_prior_del'
  ] loop
    if exists (select 1 from pg_trigger
                where tgname = v_trg
                  and tgrelid = 'public.simhub_tyre_lap_samples'::regclass) then
      raise exception 'de oude sync-trigger % bestaat nog', v_trg;
    end if;
  end loop;

  if not exists (select 1 from pg_trigger
                  where tgname = 'simhub_tyre_lap_samples_queue_ins'
                    and tgrelid = 'public.simhub_tyre_lap_samples'::regclass) then
    raise exception 'de wachtrijtrigger voor inserts ontbreekt';
  end if;

  if has_table_privilege('authenticated', 'public.tyre_prior_queue', 'SELECT')
     or has_table_privilege('authenticated', 'public.tyre_prior_queue', 'INSERT') then
    raise exception 'authenticated heeft rechten op tyre_prior_queue';
  end if;
end $$;

commit;
