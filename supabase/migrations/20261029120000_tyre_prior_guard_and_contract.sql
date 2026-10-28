-- ============================================================================
-- Endurance — bandenprior: dichtgezet, incrementeel en met een eerlijk contract
-- Datum: 2026-10-29
-- Vorige migratie: 20261029090000_tyre_prior_model.sql
--
-- De keuring van 20261029090000 vond vier echte fouten. Ze worden hier één voor
-- één gerepareerd, met de motivering erbij:
--
--   1. TRUNCATE voor anon en authenticated. Supabase's default privileges geven
--      elke nieuwe tabel alle rechten aan anon en authenticated; RLS houdt
--      SELECT tegen, maar TRUNCATE gaat buiten RLS om. Anon kon de hele pool in
--      één statement wissen. Alle rechten gaan eraf (public, anon,
--      authenticated, service_role); RLS blijft aan en er blijven geen policies:
--      alleen de SECURITY DEFINER-trigger schrijft nog.
--
--   2. De trigger rekende bij ELKE afgeronde ronde de hele pool opnieuw door.
--      Bij 20 000 rondes was dat 0,5-1 s per ronde, en een insert wachtte 11,57 s
--      op een lock. Nu:
--        * per stint een bijdrage in public.tyre_prior_contrib (som + telling);
--        * alleen de gesloten stints van de geraakte sessie worden herzien;
--        * de cel in tyre_prior_stats wordt bijgewerkt met het VERSCHIL van die
--          stint, niet met een herberekening van de hele tabel;
--        * de trigger doet niets als er geen stint dichtgaat (het normale rondje);
--        * lock_timeout 2 s en statement_timeout 8 s op de triggerfunctie, met
--          alleen een warning bij een timeout: de ingest gaat altijd door.
--
--   3. Dubbeltelling. De pool bevatte de eigen stint van het opgevraagde
--      apparaat, en v2 telde die er met n_eigen nog eens bij op: de band werd
--      smaller zonder dat er nieuwe informatie was (38 % in de keuring). De
--      eigen stints worden nu bij de bron uitgesloten: tyre_prior() krijgt het
--      apparaat mee en telt de bijdragen van dat apparaat niet mee. Gekozen voor
--      uitsluiten en niet voor aftrekken — zie de toelichting bij tyre_prior().
--
--   4. Het contract. prior_n was n_eff (een gewogen getal) maar werd als aantal
--      rondes gepresenteerd, en de brontekst zei "eigen data" terwijl de eigen
--      stint inmiddels is uitgesloten. tyre_prior() geeft nu naast n_eff ook
--      rondes (echte rondes in de pool) en stints; v2 exposeert die als
--      basis.prior_rondes en basis.prior_stints. De trap 'exact' heet niet langer
--      "eigen data".
--
-- Wat NIET verandert: de hiërarchie (exact -> auto -> circuit -> algemeen), de
-- disjuncte traps, w = n/(n+8), de drempel van drie rondes, de kolommen van
-- tyre_prior_stats en de bestaande velden van pitwall_tyre_estimate_v2. De echte
-- 113 rijen hebben geen sleutel, dus de pool is leeg en de drie bestaande
-- schattingen blijven exact gelijk (CAT-PC 88-153, PCBART 150-169,
-- DESKTOP-E2SEMRP 393-788).
-- ============================================================================

begin;

-- ---------------------------------------------------------------------------
-- 1. De pool dichtzetten: geen enkel recht voor een clientrol
-- ---------------------------------------------------------------------------
-- Wat er misging: `create table` in de public-schema geeft via de default
-- privileges van Supabase INSERT/SELECT/UPDATE/DELETE/TRUNCATE aan anon en
-- authenticated. RLS zonder policies blokkeert SELECT/INSERT/UPDATE/DELETE,
-- maar TRUNCATE valt buiten RLS: `truncate public.tyre_prior_stats` als anon
-- wist de hele pool. RLS beschermt hier dus niet; het recht zelf moet weg.
--
-- Daarom: alle rechten eraf voor public, anon, authenticated én service_role.
-- De tabel is boekhouding van de definer-functies, geen API-oppervlak. Wie als
-- beheerder wil kijken, gebruikt psql (supabase_admin) of de SECURITY
-- DEFINER-functies. RLS blijft aan en er komen geen policies: dat is de tweede
-- laag, voor het geval iemand later per ongeluk weer een grant toevoegt.
revoke all on table public.tyre_prior_stats from public, anon, authenticated, service_role;
alter table public.tyre_prior_stats enable row level security;

-- ---------------------------------------------------------------------------
-- 2. Per stint een bijdrage: de boekhouding achter de pool
-- ---------------------------------------------------------------------------
-- Waarom deze tabel er moet komen, en waarom er een apparaat in staat:
--
--   * zonder per-stint-bijdragen is "alleen de gesloten stint bijwerken" niet
--     mogelijk: je kunt een som niet met een verschil ophogen als je niet weet
--     wat die stint eerder bijdroeg;
--   * zonder apparaat is de eigen stint niet uit te sluiten (fout 3). De vorige
--     migratie koos daar bewust voor "geen apparaat"; dat besluit kostte de
--     dubbeltelling en is hier herzien. De prijs wordt betaald aan de
--     leeskant: dit is een privétabel (RLS aan, geen grants) die alleen door
--     SECURITY DEFINER-functies wordt aangeraakt, en tyre_prior() geeft nooit
--     een apparaat terug. De afweging staat in de operations-doc.
--
-- De bijdrage is dezelfde eenheid als de oude herberekening: één stint die
-- minstens drie rondes liep en minstens één hoek met een helling heeft. De
-- sleutel bevat lap_from, zodat een gecorrigeerde stint (andere eerste ronde)
-- als verwijderen + toevoegen wordt verwerkt en niet als een spookrij.
create table if not exists public.tyre_prior_contrib (
  device_id     uuid not null,
  session_key   text not null,
  set_number    integer not null,
  lap_from      integer not null,
  car_key       text not null,
  track_key     text not null,
  rondes        integer not null default 0,
  sum_wear_fl   numeric not null default 0,
  sum_wear_fr   numeric not null default 0,
  sum_wear_rl   numeric not null default 0,
  sum_wear_rr   numeric not null default 0,
  rondes_fl     integer not null default 0,
  rondes_fr     integer not null default 0,
  rondes_rl     integer not null default 0,
  rondes_rr     integer not null default 0,
  bijgewerkt_op timestamptz not null default now(),
  primary key (device_id, session_key, set_number, lap_from)
);

-- De leeslaag telt per cel op (en trekt de eigen bijdragen eraf); zonder deze
-- index is dat een seq scan over alle stints van de league.
create index if not exists tyre_prior_contrib_cel_idx
  on public.tyre_prior_contrib (car_key, track_key);

create index if not exists tyre_prior_contrib_device_idx
  on public.tyre_prior_contrib (device_id);

comment on table public.tyre_prior_contrib is
  'Per gesloten stint de bijdrage aan de gepoolde cijfers: rondes, wear-daling en meetbasis per hoek. Boekhouding voor incrementeel onderhoud en voor het uitsluiten van de eigen stints; nooit rechtstreeks leesbaar (RLS aan, geen grants) en nooit met een apparaat in de uitvoer van tyre_prior().';
comment on column public.tyre_prior_contrib.rondes is
  'De stintspan (wear_span), dezelfde eenheid als tyre_prior_stats.rondes.';
comment on column public.tyre_prior_contrib.rondes_fl is
  'De meetbasis van deze hoek in deze stint; de noemer van sum_wear_fl.';

alter table public.tyre_prior_contrib enable row level security;
revoke all on table public.tyre_prior_contrib from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 3. De trigger: alleen als een stint sluit, en dan met een verschil
-- ---------------------------------------------------------------------------
-- Eén sessie van één apparaat is de eenheid van werk. Een sessie heeft enkele
-- tientallen tot honderden rondes; de view wordt dus nooit meer over de hele
-- tabel berekend. Binnen die sessie telt alleen wat DICHT is: de stint die nog
-- loopt (de stint met de nieuwste sample van het apparaat) telt niet mee. Dat
-- is precies "herbereken als een stint echt sluit".
--
-- De vorige bijdrage wordt uit tyre_prior_contrib gelezen en het verschil gaat
-- naar tyre_prior_stats. Ongewijzigde stints leveren een verschil van nul en
-- worden overgeslagen, dus een sessie waar niets sluit kost één scan van die
-- sessie en geen enkele schrijfactie.
create or replace function public.tyre_prior_sync_session(p_device_id uuid, p_session_key text)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
set lock_timeout = '2s'
set statement_timeout = '8s'
as $$
declare
  v_open_sess text;
  v_open_lap  integer;
  v_gewijzigd integer := 0;
begin
  if p_device_id is null or p_session_key is null then
    return 0;
  end if;

  -- De stint die nog loopt: die van de nieuwste sample van dit apparaat. Eén
  -- indexzoekactie; geen view over de hele tabel.
  select s.session_key, s.lap_number
    into v_open_sess, v_open_lap
    from public.simhub_tyre_lap_samples s
   where s.device_id = p_device_id
   order by s.captured_at desc, s.lap_number desc
   limit 1;

  with stint as (
    select x.set_number, x.lap_from, x.lap_to, x.session_key,
           x.car_key, x.track_key, x.wear_span,
           x.wear_span_fl, x.wear_span_fr, x.wear_span_rl, x.wear_span_rr,
           -- Dezelfde drempel en dezelfde hoekdefinitie als de oude
           -- herberekening: een hoek telt mee vanaf drie rondes en alleen als
           -- er een helling is.
           case when x.wear_span_fl >= 3 and x.wear_per_lap_fl is not null
                then x.wear_begin_fl - x.wear_end_fl end as d_fl,
           case when x.wear_span_fr >= 3 and x.wear_per_lap_fr is not null
                then x.wear_begin_fr - x.wear_end_fr end as d_fr,
           case when x.wear_span_rl >= 3 and x.wear_per_lap_rl is not null
                then x.wear_begin_rl - x.wear_end_rl end as d_rl,
           case when x.wear_span_rr >= 3 and x.wear_per_lap_rr is not null
                then x.wear_begin_rr - x.wear_end_rr end as d_rr
      from public.tyre_stint_deltas x
     where x.device_id = p_device_id
       and x.session_key = p_session_key
       and x.car_key is not null
       and x.track_key is not null
       and x.heeft_helling
       and x.wear_span >= 3
  ),
  nieuw as (
    select p_device_id  as device_id,
           s.session_key,
           s.set_number,
           s.lap_from,
           s.car_key,
           s.track_key,
           1            as stints,
           s.wear_span  as rondes,
           coalesce(s.d_fl, 0) as sum_wear_fl,
           coalesce(s.d_fr, 0) as sum_wear_fr,
           coalesce(s.d_rl, 0) as sum_wear_rl,
           coalesce(s.d_rr, 0) as sum_wear_rr,
           case when s.d_fl is not null then s.wear_span_fl else 0 end as rondes_fl,
           case when s.d_fr is not null then s.wear_span_fr else 0 end as rondes_fr,
           case when s.d_rl is not null then s.wear_span_rl else 0 end as rondes_rl,
           case when s.d_rr is not null then s.wear_span_rr else 0 end as rondes_rr
      from stint s
     where (s.d_fl is not null or s.d_fr is not null
            or s.d_rl is not null or s.d_rr is not null)
       -- De lopende stint telt niet mee: pas als hij sluit is hij kennis.
       and not (v_open_sess is not null
                and s.session_key = v_open_sess
                and s.lap_from <= v_open_lap
                and s.lap_to   >= v_open_lap)
  ),
  oud as (
    select c.set_number, c.lap_from,
           1 as stints,
           c.car_key, c.track_key, c.rondes,
           c.sum_wear_fl, c.sum_wear_fr, c.sum_wear_rl, c.sum_wear_rr,
           c.rondes_fl, c.rondes_fr, c.rondes_rl, c.rondes_rr
      from public.tyre_prior_contrib c
     where c.device_id = p_device_id
       and c.session_key = p_session_key
  ),
  -- Het verschil per stint. Een stint die van cel verhuist (auto of baan
  -- gecorrigeerd) levert twee regels: min de oude cel, plus de nieuwe.
  delta as (
    select coalesce(n.car_key, o.car_key)     as car_key,
           coalesce(n.track_key, o.track_key) as track_key,
           coalesce(n.stints, 0) - coalesce(o.stints, 0) as stints,
           coalesce(n.rondes, 0) - coalesce(o.rondes, 0) as rondes,
           coalesce(n.sum_wear_fl, 0) - coalesce(o.sum_wear_fl, 0) as sum_wear_fl,
           coalesce(n.sum_wear_fr, 0) - coalesce(o.sum_wear_fr, 0) as sum_wear_fr,
           coalesce(n.sum_wear_rl, 0) - coalesce(o.sum_wear_rl, 0) as sum_wear_rl,
           coalesce(n.sum_wear_rr, 0) - coalesce(o.sum_wear_rr, 0) as sum_wear_rr,
           coalesce(n.rondes_fl, 0) - coalesce(o.rondes_fl, 0) as rondes_fl,
           coalesce(n.rondes_fr, 0) - coalesce(o.rondes_fr, 0) as rondes_fr,
           coalesce(n.rondes_rl, 0) - coalesce(o.rondes_rl, 0) as rondes_rl,
           coalesce(n.rondes_rr, 0) - coalesce(o.rondes_rr, 0) as rondes_rr
      from nieuw n
      full join oud o using (set_number, lap_from)
     where n.car_key     is distinct from o.car_key
        or n.track_key   is distinct from o.track_key
        or n.rondes      is distinct from o.rondes
        or n.sum_wear_fl is distinct from o.sum_wear_fl
        or n.sum_wear_fr is distinct from o.sum_wear_fr
        or n.sum_wear_rl is distinct from o.sum_wear_rl
        or n.sum_wear_rr is distinct from o.sum_wear_rr
        or n.rondes_fl   is distinct from o.rondes_fl
        or n.rondes_fr   is distinct from o.rondes_fr
        or n.rondes_rl   is distinct from o.rondes_rl
        or n.rondes_rr   is distinct from o.rondes_rr
        or (n.set_number is null) <> (o.set_number is null)
  ),
  -- De cel bijwerken met het verschil. Eén rij per cel per aanroep, gesorteerd
  -- zodat twee apparaten die tegelijk dezelfde cellen raken dezelfde volgorde
  -- aanhouden (minder kans op een deadlock).
  bijwerken as (
    insert into public.tyre_prior_stats as s (
      car_key, track_key, stints, rondes,
      sum_wear_fl, sum_wear_fr, sum_wear_rl, sum_wear_rr,
      rondes_fl, rondes_fr, rondes_rl, rondes_rr, bijgewerkt_op)
    select d.car_key, d.track_key,
           sum(d.stints)::integer, sum(d.rondes)::integer,
           sum(d.sum_wear_fl), sum(d.sum_wear_fr), sum(d.sum_wear_rl), sum(d.sum_wear_rr),
           sum(d.rondes_fl)::integer, sum(d.rondes_fr)::integer,
           sum(d.rondes_rl)::integer, sum(d.rondes_rr)::integer,
           now()
      from delta d
     group by d.car_key, d.track_key
     order by d.car_key, d.track_key
    on conflict (car_key, track_key) do update set
      stints      = s.stints + excluded.stints,
      rondes      = s.rondes + excluded.rondes,
      sum_wear_fl = s.sum_wear_fl + excluded.sum_wear_fl,
      sum_wear_fr = s.sum_wear_fr + excluded.sum_wear_fr,
      sum_wear_rl = s.sum_wear_rl + excluded.sum_wear_rl,
      sum_wear_rr = s.sum_wear_rr + excluded.sum_wear_rr,
      rondes_fl   = s.rondes_fl + excluded.rondes_fl,
      rondes_fr   = s.rondes_fr + excluded.rondes_fr,
      rondes_rl   = s.rondes_rl + excluded.rondes_rl,
      rondes_rr   = s.rondes_rr + excluded.rondes_rr,
      bijgewerkt_op = now()
  ),
  -- De bijdrage zelf bewaren (of bijwerken als de stint later is gecorrigeerd).
  bewaren as (
    insert into public.tyre_prior_contrib as c (
      device_id, session_key, set_number, lap_from, car_key, track_key, rondes,
      sum_wear_fl, sum_wear_fr, sum_wear_rl, sum_wear_rr,
      rondes_fl, rondes_fr, rondes_rl, rondes_rr, bijgewerkt_op)
    select n.device_id, n.session_key, n.set_number, n.lap_from,
           n.car_key, n.track_key, n.rondes,
           n.sum_wear_fl, n.sum_wear_fr, n.sum_wear_rl, n.sum_wear_rr,
           n.rondes_fl, n.rondes_fr, n.rondes_rl, n.rondes_rr, now()
      from nieuw n
    on conflict (device_id, session_key, set_number, lap_from) do update set
      car_key     = excluded.car_key,
      track_key   = excluded.track_key,
      rondes      = excluded.rondes,
      sum_wear_fl = excluded.sum_wear_fl,
      sum_wear_fr = excluded.sum_wear_fr,
      sum_wear_rl = excluded.sum_wear_rl,
      sum_wear_rr = excluded.sum_wear_rr,
      rondes_fl   = excluded.rondes_fl,
      rondes_fr   = excluded.rondes_fr,
      rondes_rl   = excluded.rondes_rl,
      rondes_rr   = excluded.rondes_rr,
      bijgewerkt_op = now()
    where (c.car_key, c.track_key, c.rondes,
           c.sum_wear_fl, c.sum_wear_fr, c.sum_wear_rl, c.sum_wear_rr,
           c.rondes_fl, c.rondes_fr, c.rondes_rl, c.rondes_rr)
          is distinct from
          (excluded.car_key, excluded.track_key, excluded.rondes,
           excluded.sum_wear_fl, excluded.sum_wear_fr, excluded.sum_wear_rl, excluded.sum_wear_rr,
           excluded.rondes_fl, excluded.rondes_fr, excluded.rondes_rl, excluded.rondes_rr)
  ),
  -- Stints die niet meer bestaan (of niet meer dicht zijn) verdwijnen; hun
  -- verschil is hierboven al van de cel afgetrokken.
  opruimen as (
    delete from public.tyre_prior_contrib c
     where c.device_id = p_device_id
       and c.session_key = p_session_key
       and not exists (
         select 1
           from nieuw n
          where n.set_number = c.set_number
            and n.lap_from   = c.lap_from
       )
  )
  select count(*) into v_gewijzigd from delta;

  -- Een cel die leegloopt (laatste stint verwijderd) hoort niet te blijven
  -- staan: een rij met nul stints is geen kennis en zou de traps vervuilen.
  if v_gewijzigd > 0 then
    delete from public.tyre_prior_stats s
     where s.stints <= 0;
  end if;

  return v_gewijzigd;
end;
$$;

comment on function public.tyre_prior_sync_session(uuid, text) is
  'Werkt de gepoolde cijfers bij voor één sessie van één apparaat: alleen de gesloten stints, alleen het verschil met de vorige bijdrage. Geen herberekening van de hele pool; doet niets als er geen stint gesloten is.';

revoke all on function public.tyre_prior_sync_session(uuid, text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4. De poortwachter: is er echt een stint gesloten?
-- ---------------------------------------------------------------------------
-- Het normale rondje (een nieuwe rij met dezelfde bandenset) mag niets kosten.
-- Daarom eerst deze vraag, met twee indexzoekacties: is de bandenset anders dan
-- die van de vorige ronde, of is de wear omhoog gesprongen, of is dit de eerste
-- ronde van een nieuwe sessie (dan is de vorige sessie gesloten)?
--
-- De regel is bewust conservatief: alleen als beide tellers bekend en gelijk
-- zijn én de wear niet stijgt, is er zeker geen grens. In alle andere gevallen
-- wordt de sessie herzien — dan kost het één sessiescan, en dat is hooguit eens
-- per stint.
create or replace function public.tyre_prior_closed_session(
  p_device_id uuid,
  p_session_key text,
  p_lap integer,
  p_captured_at timestamptz,
  p_set integer,
  p_wear numeric)
returns text
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_vorig_set  integer;
  v_vorig_wear numeric;
  v_vorig_sess text;
begin
  if p_device_id is null or p_session_key is null then
    return null;
  end if;

  -- Stond er al iets van deze sessie vóór deze ronde?
  if not exists (
    select 1
      from public.simhub_tyre_lap_samples s
     where s.device_id = p_device_id
       and s.session_key = p_session_key
       and (s.lap_number, s.captured_at) < (p_lap, p_captured_at)
  ) then
    -- Wel latere rondes in dezelfde sessie? Dan is dit een gat of een
    -- nabrander en is de sessie zelf de kandidaat.
    if exists (
      select 1
        from public.simhub_tyre_lap_samples s
       where s.device_id = p_device_id
         and s.session_key = p_session_key
         and (s.lap_number, s.captured_at) <> (p_lap, p_captured_at)
    ) then
      return p_session_key;
    end if;

    -- Eerste ronde van een nieuwe sessie: de vorige sessie is nu gesloten.
    select s.session_key
      into v_vorig_sess
      from public.simhub_tyre_lap_samples s
     where s.device_id = p_device_id
       and s.session_key <> p_session_key
     order by s.captured_at desc, s.lap_number desc
     limit 1;
    return v_vorig_sess;
  end if;

  select s.tyre_set,
         greatest(nullif(s.wear_fl, 'NaN'::numeric),
                  nullif(s.wear_fr, 'NaN'::numeric),
                  nullif(s.wear_rl, 'NaN'::numeric),
                  nullif(s.wear_rr, 'NaN'::numeric))
    into v_vorig_set, v_vorig_wear
    from public.simhub_tyre_lap_samples s
   where s.device_id = p_device_id
     and s.session_key = p_session_key
     and (s.lap_number, s.captured_at) < (p_lap, p_captured_at)
   order by s.lap_number desc, s.captured_at desc
   limit 1;

  -- Zelfde teller, geen wear-sprong: de lopende stint loopt door.
  if p_set is not null
     and v_vorig_set is not null
     and p_set = v_vorig_set
     and coalesce(p_wear, 0) <= coalesce(v_vorig_wear, 0) + 0.5 then
    return null;
  end if;

  return p_session_key;
end;
$$;

comment on function public.tyre_prior_closed_session(uuid, text, integer, timestamptz, integer, numeric) is
  'Geeft de sessie waarvan de bijdragen herzien moeten worden na deze ronde, of NULL als er geen stint gesloten is (zelfde bandenset, geen wear-sprong). Conservatief: bij twijfel wordt de sessie herzien.';

revoke all on function public.tyre_prior_closed_session(uuid, text, integer, timestamptz, integer, numeric) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 5. De drie statement-triggers (overgangstabellen)
-- ---------------------------------------------------------------------------
-- Een enkele trigger voor INSERT OR UPDATE OR DELETE kan geen
-- overgangstabellen gebruiken; daarom drie. Ze zijn statement-level, dus één
-- aanroep per flush, en ze weten welke apparaten en sessies geraakt zijn zonder
-- de tabel te doorzoeken.
--
-- De tijdgrenzen staan op de functie (SET lock_timeout / SET statement_timeout):
-- ze gelden tijdens de aanroep en daarna weer niet, dus een ingest die zelf
-- langzamer is, houdt zijn eigen grenzen. Bij een timeout of een deadlock volgt
-- een warning en gaat de ingest door; de statistiek loopt dan achter tot de
-- volgende stint of een expliciete tyre_prior_refresh().
create or replace function public.tyre_prior_on_insert()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
set lock_timeout = '2s'
set statement_timeout = '8s'
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
      perform public.tyre_prior_sync_session(v_rij.device_id, v_sess);
    end if;
  else
    -- Een bulk-insert (backfill, import): alle geraakte sessies één keer.
    perform public.tyre_prior_sync_session(d.device_id, d.session_key)
      from (select distinct c.device_id, c.session_key
              from changed c
             where c.device_id is not null) d;
  end if;

  return null;
exception
  when lock_not_available or query_canceled or deadlock_detected then
    raise warning 'tyre_prior: statistiek overgeslagen, ingest gaat door (%). Herstel met tyre_prior_refresh().', sqlerrm;
    return null;
  when others then
    raise warning 'tyre_prior: statistiek overgeslagen (%). Herstel met tyre_prior_refresh().', sqlerrm;
    return null;
end;
$$;

create or replace function public.tyre_prior_on_update()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
set lock_timeout = '2s'
set statement_timeout = '8s'
as $$
begin
  -- Een bijgewerkte ronde kan een al gesloten stint veranderen (herstel van een
  -- meting), dus hier geen poortwachter: de geraakte sessies worden herzien.
  perform public.tyre_prior_sync_session(d.device_id, d.session_key)
    from (select distinct u.device_id, u.session_key
            from (select * from changed union all select * from oud) u
           where u.device_id is not null) d;
  return null;
exception
  when lock_not_available or query_canceled or deadlock_detected then
    raise warning 'tyre_prior: statistiek overgeslagen, ingest gaat door (%). Herstel met tyre_prior_refresh().', sqlerrm;
    return null;
  when others then
    raise warning 'tyre_prior: statistiek overgeslagen (%). Herstel met tyre_prior_refresh().', sqlerrm;
    return null;
end;
$$;

create or replace function public.tyre_prior_on_delete()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
set lock_timeout = '2s'
set statement_timeout = '8s'
as $$
begin
  -- Weg is weg: de bijdragen van deze sessie worden afgetrokken. Is de sessie
  -- helemaal verdwenen, dan blijven er geen bijdragen over en loopt de cel leeg.
  perform public.tyre_prior_sync_session(d.device_id, d.session_key)
    from (select distinct c.device_id, c.session_key
            from changed c
           where c.device_id is not null) d;
  return null;
exception
  when lock_not_available or query_canceled or deadlock_detected then
    raise warning 'tyre_prior: statistiek overgeslagen, ingest gaat door (%). Herstel met tyre_prior_refresh().', sqlerrm;
    return null;
  when others then
    raise warning 'tyre_prior: statistiek overgeslagen (%). Herstel met tyre_prior_refresh().', sqlerrm;
    return null;
end;
$$;

revoke all on function public.tyre_prior_on_insert() from public, anon, authenticated;
revoke all on function public.tyre_prior_on_update() from public, anon, authenticated;
revoke all on function public.tyre_prior_on_delete() from public, anon, authenticated;

-- De oude statement-trigger en zijn functie gaan weg: één trigger per tabel is
-- genoeg en de oude rekent alles opnieuw door. De `if exists` maakt deze
-- migratie herhaalbaar (na een rollback en opnieuw toepassen).
drop trigger if exists simhub_tyre_lap_samples_prior_trg on public.simhub_tyre_lap_samples;
drop trigger if exists simhub_tyre_lap_samples_prior_ins on public.simhub_tyre_lap_samples;
drop trigger if exists simhub_tyre_lap_samples_prior_upd on public.simhub_tyre_lap_samples;
drop trigger if exists simhub_tyre_lap_samples_prior_del on public.simhub_tyre_lap_samples;
drop function if exists public.tyre_prior_touch();

create trigger simhub_tyre_lap_samples_prior_ins
  after insert on public.simhub_tyre_lap_samples
  referencing new table as changed
  for each statement execute function public.tyre_prior_on_insert();

create trigger simhub_tyre_lap_samples_prior_upd
  after update on public.simhub_tyre_lap_samples
  referencing old table as oud new table as changed
  for each statement execute function public.tyre_prior_on_update();

create trigger simhub_tyre_lap_samples_prior_del
  after delete on public.simhub_tyre_lap_samples
  referencing old table as changed
  for each statement execute function public.tyre_prior_on_delete();

-- ---------------------------------------------------------------------------
-- 6. Reparatie: dezelfde bijdragen, maar dan alles in één keer
-- ---------------------------------------------------------------------------
-- Blijft nodig na een bulk-import waarbij de trigger zijn tijdgrens raakte, na
-- een storing, en als iemand de waarheid opnieuw wil vaststellen. Bouwt
-- tyre_prior_contrib en tyre_prior_stats opnieuw op uit de stintview; idempotent.
create or replace function public.tyre_prior_refresh(p_car_key text default null, p_track_key text default null)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
set lock_timeout = '2s'
set statement_timeout = '120s'
as $$
declare
  v_rijen integer;
begin
  delete from public.tyre_prior_contrib c
   where (p_car_key is null or c.car_key = p_car_key)
     and (p_track_key is null or c.track_key = p_track_key);

  with laatste as (
    -- De lopende stint per apparaat: die van de nieuwste sample.
    select distinct on (s.device_id) s.device_id, s.session_key, s.lap_number
      from public.simhub_tyre_lap_samples s
     order by s.device_id, s.captured_at desc, s.lap_number desc
  ),
  stint as (
    select x.device_id, x.session_key, x.set_number, x.lap_from, x.lap_to,
           x.car_key, x.track_key, x.wear_span,
           x.wear_span_fl, x.wear_span_fr, x.wear_span_rl, x.wear_span_rr,
           case when x.wear_span_fl >= 3 and x.wear_per_lap_fl is not null
                then x.wear_begin_fl - x.wear_end_fl end as d_fl,
           case when x.wear_span_fr >= 3 and x.wear_per_lap_fr is not null
                then x.wear_begin_fr - x.wear_end_fr end as d_fr,
           case when x.wear_span_rl >= 3 and x.wear_per_lap_rl is not null
                then x.wear_begin_rl - x.wear_end_rl end as d_rl,
           case when x.wear_span_rr >= 3 and x.wear_per_lap_rr is not null
                then x.wear_begin_rr - x.wear_end_rr end as d_rr
      from public.tyre_stint_deltas x
     where x.car_key is not null
       and x.track_key is not null
       and x.heeft_helling
       and x.wear_span >= 3
       and (p_car_key is null or x.car_key = p_car_key)
       and (p_track_key is null or x.track_key = p_track_key)
  )
  insert into public.tyre_prior_contrib (
    device_id, session_key, set_number, lap_from, car_key, track_key, rondes,
    sum_wear_fl, sum_wear_fr, sum_wear_rl, sum_wear_rr,
    rondes_fl, rondes_fr, rondes_rl, rondes_rr, bijgewerkt_op)
  select s.device_id, s.session_key, s.set_number, s.lap_from,
         s.car_key, s.track_key, s.wear_span,
         coalesce(s.d_fl, 0), coalesce(s.d_fr, 0),
         coalesce(s.d_rl, 0), coalesce(s.d_rr, 0),
         case when s.d_fl is not null then s.wear_span_fl else 0 end,
         case when s.d_fr is not null then s.wear_span_fr else 0 end,
         case when s.d_rl is not null then s.wear_span_rl else 0 end,
         case when s.d_rr is not null then s.wear_span_rr else 0 end,
         now()
    from stint s
   where (s.d_fl is not null or s.d_fr is not null
          or s.d_rl is not null or s.d_rr is not null)
     and not exists (
       select 1
         from laatste l
        where l.device_id = s.device_id
          and l.session_key = s.session_key
          and s.lap_from <= l.lap_number
          and s.lap_to   >= l.lap_number
     )
  on conflict (device_id, session_key, set_number, lap_from) do update set
    car_key     = excluded.car_key,
    track_key   = excluded.track_key,
    rondes      = excluded.rondes,
    sum_wear_fl = excluded.sum_wear_fl,
    sum_wear_fr = excluded.sum_wear_fr,
    sum_wear_rl = excluded.sum_wear_rl,
    sum_wear_rr = excluded.sum_wear_rr,
    rondes_fl   = excluded.rondes_fl,
    rondes_fr   = excluded.rondes_fr,
    rondes_rl   = excluded.rondes_rl,
    rondes_rr   = excluded.rondes_rr,
    bijgewerkt_op = now();

  delete from public.tyre_prior_stats s
   where (p_car_key is null or s.car_key = p_car_key)
     and (p_track_key is null or s.track_key = p_track_key);

  insert into public.tyre_prior_stats (
    car_key, track_key, stints, rondes,
    sum_wear_fl, sum_wear_fr, sum_wear_rl, sum_wear_rr,
    rondes_fl, rondes_fr, rondes_rl, rondes_rr, bijgewerkt_op)
  select c.car_key, c.track_key,
         count(*)::integer, sum(c.rondes)::integer,
         sum(c.sum_wear_fl), sum(c.sum_wear_fr), sum(c.sum_wear_rl), sum(c.sum_wear_rr),
         sum(c.rondes_fl)::integer, sum(c.rondes_fr)::integer,
         sum(c.rondes_rl)::integer, sum(c.rondes_rr)::integer,
         now()
    from public.tyre_prior_contrib c
   where (p_car_key is null or c.car_key = p_car_key)
     and (p_track_key is null or c.track_key = p_track_key)
   group by c.car_key, c.track_key;

  select count(*) into v_rijen
    from public.tyre_prior_stats s
   where (p_car_key is null or s.car_key = p_car_key)
     and (p_track_key is null or s.track_key = p_track_key);
  return v_rijen;
end;
$$;

comment on function public.tyre_prior_refresh(text, text) is
  'Bouwt tyre_prior_contrib en tyre_prior_stats opnieuw op uit de stintview: alleen gesloten stints, dezelfde drempels als de trigger. Idempotent; zonder argumenten alles, met argumenten die cellen. Repareert wat een overgeslagen trigger liet liggen.';

revoke all on function public.tyre_prior_refresh(text, text) from public, anon, authenticated;

select public.tyre_prior_refresh();

-- ---------------------------------------------------------------------------
-- 7. De prior: eigen stints eruit, en de echte aantallen erbij
-- ---------------------------------------------------------------------------
-- Twee wijzigingen in één functie:
--
--   * p_exclude_device. De bijdragen van dat apparaat tellen niet mee. Gekozen
--     voor uitsluiten bij de bron in plaats van aftrekken achteraf: aftrekken
--     werkt alleen zolang de tellingen positief blijven, moet bij elke trap
--     opnieuw worden gedaan en maakt van een som een verschil dat je niet meer
--     kunt natellen. Uitsluiten is één voorwaarde, is exact, en laat de drempel
--     van drie rondes per trap op de juiste populatie werken (een trap die
--     alleen uit eigen stints bestond valt weg in plaats van "bijna leeg" te
--     blijven). De eigen stint telt daarna precies één keer mee: in v2, als
--     eigen meting.
--
--   * rondes en stints in de uitvoer. n_eff blijft de gewogen meetbasis (die
--     gaat de blend in); rondes is het echte aantal rondes achter de blend
--     (som van de meetbasis van de trap die meedeed) en stints het echte aantal
--     stints. De UI kan daarmee zeggen "gebaseerd op 41 rondes" zonder een
--     gewogen getal als aantal te presenteren.
--
-- De trap 'exact' heet niet langer "eigen data": sinds het uitsluiten is die
-- trap per definitie andermans data op precies deze combinatie.
drop function if exists public.tyre_prior(text, text);

create or replace function public.tyre_prior(p_car_key text, p_track_key text, p_exclude_device uuid default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_k        constant numeric := 8;
  v_min      constant integer := 3;
  v_traps    jsonb;
  v_rate     numeric;
  v_n_eff    numeric := 0;
  v_rondes   integer := 0;
  v_stints   integer := 0;
  v_niveau   text;          -- fijnste trap die meedeed
  v_trap     text;          -- lusteller
  v_bron     text[] := '{}';
  v_w        numeric;
  v_deel     jsonb;
  v_andere   text := case when p_exclude_device is null then ''
                          else ' (stints van andere apparaten)' end;
begin
  -- Vier disjuncte traps, en per cel de eigen bijdragen eraf. De aftrekking
  -- gebeurt op de sommen en tellingen van de CEL, want alleen daar is bekend
  -- hoeveel rondes dit apparaat in die cel had. Wat overblijft is de pool van
  -- andere apparaten; een cel die volledig van dit apparaat was houdt nul
  -- rondes over en doet daardoor niet mee.
  with eigen as (
    select c.car_key,
           c.track_key,
           count(*)::integer              as stints,
           sum(c.rondes)::integer         as rondes,
           sum(c.sum_wear_fl)             as w_fl, sum(c.rondes_fl)::integer as n_fl,
           sum(c.sum_wear_fr)             as w_fr, sum(c.rondes_fr)::integer as n_fr,
           sum(c.sum_wear_rl)             as w_rl, sum(c.rondes_rl)::integer as n_rl,
           sum(c.sum_wear_rr)             as w_rr, sum(c.rondes_rr)::integer as n_rr
      from public.tyre_prior_contrib c
     where p_exclude_device is not null
       and c.device_id = p_exclude_device
     group by c.car_key, c.track_key
  ),
  scoped as (
    select 'exact'::text as trap,
           s.stints - coalesce(e.stints, 0)   as stints,
           s.rondes - coalesce(e.rondes, 0)   as rondes,
           s.sum_wear_fl - coalesce(e.w_fl, 0) as w_fl,
           s.rondes_fl - coalesce(e.n_fl, 0)   as n_fl,
           s.sum_wear_fr - coalesce(e.w_fr, 0) as w_fr,
           s.rondes_fr - coalesce(e.n_fr, 0)   as n_fr,
           s.sum_wear_rl - coalesce(e.w_rl, 0) as w_rl,
           s.rondes_rl - coalesce(e.n_rl, 0)   as n_rl,
           s.sum_wear_rr - coalesce(e.w_rr, 0) as w_rr,
           s.rondes_rr - coalesce(e.n_rr, 0)   as n_rr
      from public.tyre_prior_stats s
      left join eigen e on e.car_key = s.car_key and e.track_key = s.track_key
     where p_car_key is not null and p_track_key is not null
       and s.car_key = p_car_key and s.track_key = p_track_key
    union all
    select 'auto'::text,
           s.stints - coalesce(e.stints, 0), s.rondes - coalesce(e.rondes, 0),
           s.sum_wear_fl - coalesce(e.w_fl, 0), s.rondes_fl - coalesce(e.n_fl, 0),
           s.sum_wear_fr - coalesce(e.w_fr, 0), s.rondes_fr - coalesce(e.n_fr, 0),
           s.sum_wear_rl - coalesce(e.w_rl, 0), s.rondes_rl - coalesce(e.n_rl, 0),
           s.sum_wear_rr - coalesce(e.w_rr, 0), s.rondes_rr - coalesce(e.n_rr, 0)
      from public.tyre_prior_stats s
      left join eigen e on e.car_key = s.car_key and e.track_key = s.track_key
     where p_car_key is not null
       and s.car_key = p_car_key
       and (p_track_key is null or s.track_key <> p_track_key)
    union all
    select 'circuit'::text,
           s.stints - coalesce(e.stints, 0), s.rondes - coalesce(e.rondes, 0),
           s.sum_wear_fl - coalesce(e.w_fl, 0), s.rondes_fl - coalesce(e.n_fl, 0),
           s.sum_wear_fr - coalesce(e.w_fr, 0), s.rondes_fr - coalesce(e.n_fr, 0),
           s.sum_wear_rl - coalesce(e.w_rl, 0), s.rondes_rl - coalesce(e.n_rl, 0),
           s.sum_wear_rr - coalesce(e.w_rr, 0), s.rondes_rr - coalesce(e.n_rr, 0)
      from public.tyre_prior_stats s
      left join eigen e on e.car_key = s.car_key and e.track_key = s.track_key
     where p_track_key is not null
       and s.track_key = p_track_key
       and (p_car_key is null or s.car_key <> p_car_key)
    union all
    select 'algemeen'::text,
           s.stints - coalesce(e.stints, 0), s.rondes - coalesce(e.rondes, 0),
           s.sum_wear_fl - coalesce(e.w_fl, 0), s.rondes_fl - coalesce(e.n_fl, 0),
           s.sum_wear_fr - coalesce(e.w_fr, 0), s.rondes_fr - coalesce(e.n_fr, 0),
           s.sum_wear_rl - coalesce(e.w_rl, 0), s.rondes_rl - coalesce(e.n_rl, 0),
           s.sum_wear_rr - coalesce(e.w_rr, 0), s.rondes_rr - coalesce(e.n_rr, 0)
      from public.tyre_prior_stats s
      left join eigen e on e.car_key = s.car_key and e.track_key = s.track_key
     where (p_car_key is null or s.car_key <> p_car_key)
       and (p_track_key is null or s.track_key <> p_track_key)
  ),
  total as (
    select trap,
           sum(stints)::integer as stints,
           sum(rondes)::integer as rondes,
           sum(w_fl) as w_fl, sum(n_fl)::integer as n_fl,
           sum(w_fr) as w_fr, sum(n_fr)::integer as n_fr,
           sum(w_rl) as w_rl, sum(n_rl)::integer as n_rl,
           sum(w_rr) as w_rr, sum(n_rr)::integer as n_rr
      from scoped
     group by trap
  ),
  hoek as (
    select t.trap, t.stints, t.rondes, h.rate, h.n
      from total t
      cross join lateral (
        select x.wear / x.rondes as rate, x.rondes as n
          from (values
                 ('fl', t.w_fl, t.n_fl),
                 ('fr', t.w_fr, t.n_fr),
                 ('rl', t.w_rl, t.n_rl),
                 ('rr', t.w_rr, t.n_rr)
               ) as x(hoek, wear, rondes)
         where x.rondes >= v_min
         order by x.wear / x.rondes desc, x.rondes desc
         limit 1
      ) h
  )
  select coalesce(jsonb_object_agg(
           h.trap,
           jsonb_build_object('rate', h.rate, 'n', h.n,
                              'stints', h.stints, 'rondes', h.rondes)), '{}'::jsonb)
    into v_traps
    from hoek h;

  -- Van grof naar fijn. Een trap zonder data laat de lopende waarde staan:
  -- geen data is geen mening, en null mag nooit een getal wegpoetsen.
  v_deel := v_traps->'algemeen';
  if v_deel is not null then
    v_rate := (v_deel->>'rate')::numeric;
    v_w := (v_deel->>'n')::numeric / ((v_deel->>'n')::numeric + v_k);
    v_n_eff := v_n_eff + v_w * (v_deel->>'n')::numeric;
    v_rondes := v_rondes + (v_deel->>'n')::integer;
    v_stints := v_stints + (v_deel->>'stints')::integer;
    v_niveau := 'algemeen';
    v_bron := v_bron || format('alle auto''s en circuits: %s stints, %s rondes%s',
                               v_deel->>'stints', v_deel->>'rondes', v_andere);
  end if;

  foreach v_trap in array array['circuit', 'auto', 'exact'] loop
    v_deel := v_traps->v_trap;
    if v_deel is null then
      continue;
    end if;
    v_w := (v_deel->>'n')::numeric / ((v_deel->>'n')::numeric + v_k);
    v_rate := case when v_rate is null then (v_deel->>'rate')::numeric
                   else v_w * (v_deel->>'rate')::numeric + (1 - v_w) * v_rate end;
    v_n_eff := v_n_eff + v_w * (v_deel->>'n')::numeric;
    v_rondes := v_rondes + (v_deel->>'n')::integer;
    v_stints := v_stints + (v_deel->>'stints')::integer;
    v_niveau := v_trap;
    v_bron := v_bron || format('%s: %s stints, %s rondes%s',
                               case v_trap when 'circuit' then 'andere auto''s op dit circuit'
                                           when 'auto'    then 'deze auto op andere circuits'
                                           else 'deze auto op dit circuit' end,
                               v_deel->>'stints', v_deel->>'rondes', v_andere);
  end loop;

  return jsonb_build_object(
    'rate',   case when v_rate is null then null else round(v_rate, 4) end,
    'n_eff',  round(coalesce(v_n_eff, 0), 2),
    'rondes', v_rondes,
    'stints', v_stints,
    'level',  v_niveau,
    'bron',   case when v_rate is null then 'nog geen gedeelde stints voor deze combinatie'
                   else array_to_string(v_bron, ' · ') end
  );
end;
$$;

comment on function public.tyre_prior(text, text, uuid) is
  'Hiërarchische bandenprior: exact (auto+circuit) -> auto -> circuit -> algemeen, per trap gewicht w=n/(n+8) op rondes, van grof naar fijn geblend. p_exclude_device laat de stints van dat apparaat buiten de pool (leave-one-out); de traps zijn disjunct en een trap met minder dan drie rondes doet niet mee. Geeft rate (pp per ronde), n_eff (gewogen meetbasis), rondes en stints (de echte aantallen achter de blend), level en een mensleesbare bron. Geen apparaat, sessie of coureur in de uitvoer.';

revoke all on function public.tyre_prior(text, text, uuid) from public, anon;
grant execute on function public.tyre_prior(text, text, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 8. De schatting (v2): eigen stint één keer, prior zonder de eigen stints
-- ---------------------------------------------------------------------------
-- Alleen de regels die met de prior te maken hebben veranderen; de rest van de
-- functie is ongewijzigd. De eigen stint gaat als p_exclude_device mee, dus de
-- prior bevat geen eigen rondes meer en n_eff = eigen + prior telt niets dubbel.
-- basis krijgt prior_rondes en prior_stints naast prior_n (n_eff).
create or replace function public.pitwall_tyre_estimate_v2(p_device_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public, auth, pg_temp
as $function$
declare
    v_user       uuid := auth.uid();
    v_toegestaan boolean;
    v_totaal     bigint := 0;
    v_aantal     bigint := 0;   -- alleen stints met een gemeten helling
    v_grade      text := 'D';
    v_label      text;
    v_provenance text := 'unavailable';
    v_voorlopig  boolean := true;
    v_usable     boolean := false;
    v_own_rate   numeric;
    v_own_n      integer;
    v_hoek       text;          -- steilste hoek van de eigen stint
    v_rate       numeric;
    v_w_eigen    numeric;
    v_prior      jsonb;
    v_prior_rate numeric;
    v_prior_n    numeric;
    v_prior_rondes integer;
    v_prior_stints integer;
    v_prior_level text;
    v_prior_bron text;
    v_bron       text;
    v_n_eff      numeric;
    v_wear_now   numeric;
    v_wear_car   text;
    v_wear_track text;
    v_remaining  numeric;
    v_laps       numeric;
    v_low        numeric;
    v_high       numeric;
    v_fac_laag   numeric;
    v_fac_hoog   numeric;
    v_schaal     numeric;
    v_span       numeric;
    -- De meetbasis van het getal: de span van de hoek waar de helling vandaan
    -- komt. Die is per definitie niet groter dan de stintspan en kan veel
    -- kleiner zijn (een hoek die maar twee rondes meeliep).
    v_span_hoek  integer;
    v_basis_car   text;
    v_basis_track text;
    v_prior_car   text;
    v_prior_track text;
    v_basis      jsonb;
    v_range      jsonb;
    v_best       public.tyre_stint_deltas%rowtype;
    v_stand      public.tyre_stint_deltas%rowtype;
    v_ctx_car    text;
    v_ctx_track  text;
    v_threshold  constant numeric := 40;
    -- Onder deze basislengte is een helling niet meer dan een indicatie: de
    -- pit- en out-lapruis weegt dan zwaarder dan de slijtage zelf. De maat is
    -- de span van de gebruikte hoek, niet die van de hele stint.
    v_min_basis  constant integer := 8;
    v_k          constant numeric := 8;
begin
    if p_device_id is null then
        raise exception 'device_id is verplicht' using errcode = '22023';
    end if;

    if v_user is null then
        raise exception 'Authentication required' using errcode = '42501';
    end if;

    -- Zelfde apparaatpoort als tyre_rounds_for_device() en tyre_data_coverage():
    -- eigen apparaat, of beheerder. Geen teamcheck: een apparaat hangt niet aan
    -- een event/team, en deze functie wordt niet breder opengesteld dan v1.
    v_toegestaan := exists (
        select 1
          from public.simhub_devices d
         where d.id = p_device_id
           and (d.owner_user_id = v_user or public.can_manage_simhub())
    );
    if not v_toegestaan then
        raise exception 'Permission denied' using errcode = '42501';
    end if;

    -- De graad rust op stints met een gemeten helling; het totaal blijft
    -- beschikbaar zodat zichtbaar is hoeveel blokken er wél zijn.
    select count(*) filter (where v.heeft_helling), count(*)
      into v_aantal, v_totaal
      from public.tyre_stint_deltas v
     where v.device_id = p_device_id;

    v_grade := case when v_aantal >= 3 then 'A'
                    when v_aantal = 2 then 'B'
                    when v_aantal = 1 then 'C'
                    else 'D' end;

    -- Huidige context: de laatst bekende auto en baan van dit apparaat. Null is
    -- "niet bekend", geen mismatch. Alleen de nieuwste honderd rijen: de
    -- pitwall pollt dit en hoeft geen hele historie te sorteren.
    select (array_agg(c.car_key order by c.captured_at desc, c.lap_number desc)
              filter (where c.car_key is not null))[1],
           (array_agg(c.track_key order by c.captured_at desc, c.lap_number desc)
              filter (where c.track_key is not null))[1]
      into v_ctx_car, v_ctx_track
      from (
        select s.car_key, s.track_key, s.captured_at, s.lap_number
          from public.simhub_tyre_lap_samples s
         where s.device_id = p_device_id
         order by s.captured_at desc, s.lap_number desc
         limit 100
      ) c;

    -- Beste stint: de meest recente met een gemeten helling over minstens drie
    -- rondes; bij gelijke tijd de langste. "Best beschikbaar" is dus niet "de
    -- mooiste", maar de meest recente meting waar een helling uit volgt.
    select * into v_best
      from public.tyre_stint_deltas v
     where v.device_id = p_device_id
       and v.heeft_helling
       and v.wear_span is not null
       and v.wear_span >= 3
     order by v.laatste_meting desc, v.wear_span desc
     limit 1;

    if found then
        -- De helling van de steilste hoek: hetzelfde getal als zwakste_hoek
        -- aanwijst. Zo kunnen tabel en getal niet uit elkaar lopen.
        v_own_rate := case v_best.zwakste_hoek
                        when 'fl' then -v_best.wear_per_lap_fl
                        when 'fr' then -v_best.wear_per_lap_fr
                        when 'rl' then -v_best.wear_per_lap_rl
                        when 'rr' then -v_best.wear_per_lap_rr
                      end;
        -- De noemer van dát getal, niet die van de stint. Een hoek die maar
        -- twee rondes meeliep levert een helling over één ronde; die mag de
        -- schatting niet als "basis van negen rondes" presenteren.
        v_span_hoek := case v_best.zwakste_hoek
                         when 'fl' then v_best.wear_span_fl
                         when 'fr' then v_best.wear_span_fr
                         when 'rl' then v_best.wear_span_rl
                         when 'rr' then v_best.wear_span_rr
                       end;
        v_own_n       := v_span_hoek;
        v_hoek        := v_best.zwakste_hoek;
        v_basis_car   := v_best.car_key;
        v_basis_track := v_best.track_key;
        v_basis := jsonb_build_object(
            'car_key', v_best.car_key,
            'track_key', v_best.track_key,
            'track_temp_c', v_best.track_temp_c,
            'rondes_in_basis', coalesce(v_span_hoek, 0),
            'rondes_in_stint', v_best.wear_span,
            'set_number', v_best.set_number,
            'set_bron', v_best.set_bron,
            'lap_from', v_best.lap_from,
            'lap_to', v_best.lap_to,
            'zwakste_hoek', v_best.zwakste_hoek
        );
        v_provenance := case when v_best.set_bron = 'payload'
                             then 'measured' else 'estimated' end;
    else
        -- Geen helling. Welke stand is er dan? De laatste stint met een
        -- wear-meting, zonder er een tempo aan te hangen.
        select * into v_stand
          from public.tyre_stint_deltas v
         where v.device_id = p_device_id
           and v.wear_metingen > 0
         order by v.laatste_meting desc
         limit 1;
        if found then
            v_basis_car   := v_stand.car_key;
            v_basis_track := v_stand.track_key;
            v_provenance := 'last_known';
            v_basis := jsonb_build_object(
                'car_key', v_stand.car_key,
                'track_key', v_stand.track_key,
                'track_temp_c', v_stand.track_temp_c,
                'rondes_in_basis', coalesce(v_stand.wear_span, 0),
                'rondes_in_stint', v_stand.wear_span,
                'set_number', v_stand.set_number,
                'set_bron', v_stand.set_bron,
                'lap_from', v_stand.lap_from,
                'lap_to', v_stand.lap_to,
                'zwakste_hoek', v_stand.zwakste_hoek
            );
        end if;
    end if;

    -- Huidige wear-stand: de zwakste hoek van de laatste meting. NaN is geen
    -- meting (nullif), en een rij die bij de basis past krijgt voorrang boven
    -- een rij van een andere auto of baan. Dat geldt nu ook in het
    -- last_known-pad: de voorkeur hing aan v_best en deed daar dus niets.
    select w.wear_min, w.car_key, w.track_key
      into v_wear_now, v_wear_car, v_wear_track
      from (
        select least(nullif(s.wear_fl, 'NaN'::numeric),
                     nullif(s.wear_fr, 'NaN'::numeric),
                     nullif(s.wear_rl, 'NaN'::numeric),
                     nullif(s.wear_rr, 'NaN'::numeric)) as wear_min,
               s.car_key,
               s.track_key,
               s.captured_at,
               s.lap_number
          from public.simhub_tyre_lap_samples s
         where s.device_id = p_device_id
      ) w
     where w.wear_min is not null
     order by case
                when v_basis_car is not null
                 and w.car_key = v_basis_car
                 and (v_basis_track is null
                      or w.track_key is null
                      or w.track_key = v_basis_track) then 0
                else 1
              end,
              w.captured_at desc,
              w.lap_number desc
     limit 1;

    -- Een helling of stand van een andere auto of baan dan de basis is een
    -- schatting, geen meting voor deze combinatie. De controle geldt voor beide
    -- paden: in het last_known-pad bleef de herkomst anders staan terwijl de
    -- wear-stand uit een andere auto kwam.
    if v_provenance in ('measured', 'last_known') and v_basis_car is not null then
        if (v_ctx_car is not null and v_basis_car is not null
            and v_ctx_car <> v_basis_car)
           or (v_ctx_track is not null and v_basis_track is not null
               and v_ctx_track <> v_basis_track)
           or (v_wear_car is not null and v_basis_car is not null
               and v_wear_car <> v_basis_car)
           or (v_wear_track is not null and v_basis_track is not null
               and v_wear_track <> v_basis_track) then
            v_provenance := 'estimated';
        end if;
    end if;

    -- Welke combinatie vragen we de prior naar? De basis van de eigen meting
    -- is de eerlijkste vraag (daar hoort het getal bij). Zonder eigen stint de
    -- laatste wear-stand, en zonder die de context. Auto en baan blijven bij
    -- elkaar: een auto van de ene bron met een baan van de andere zou een
    -- combinatie verzinnen die niemand reed.
    if v_basis_car is not null or v_basis_track is not null then
        v_prior_car := v_basis_car;   v_prior_track := v_basis_track;
    elsif v_wear_car is not null or v_wear_track is not null then
        v_prior_car := v_wear_car;    v_prior_track := v_wear_track;
    else
        v_prior_car := v_ctx_car;     v_prior_track := v_ctx_track;
    end if;

    -- De eigen stints tellen niet mee in de prior: die zitten al in het getal
    -- hieronder, en maar één keer. Zonder deze uitsluiting telt de eigen stint
    -- dubbel en wordt de band smaller zonder nieuwe informatie.
    v_prior := public.tyre_prior(v_prior_car, v_prior_track, p_device_id);
    v_prior_rate   := (v_prior->>'rate')::numeric;
    v_prior_n      := (v_prior->>'n_eff')::numeric;
    v_prior_rondes := (v_prior->>'rondes')::integer;
    v_prior_stints := (v_prior->>'stints')::integer;
    v_prior_level  := v_prior->>'level';
    v_prior_bron   := v_prior->>'bron';

    -- Bijwerken met de eigen stint, met dezelfde formule als in de prior:
    -- w = n/(n+8). Zonder prior is w_eigen het enige gewicht en verandert er
    -- niets aan het getal; zonder eigen stint is de prior het getal en heet de
    -- bron auto/circuit/algemeen.
    if v_own_rate is not null and v_own_rate > 0 then
        v_w_eigen := coalesce(v_own_n, 0)::numeric / (coalesce(v_own_n, 0)::numeric + v_k);
        if v_prior_rate is not null and v_prior_rate > 0 then
            v_rate  := v_w_eigen * v_own_rate + (1 - v_w_eigen) * v_prior_rate;
            v_n_eff := coalesce(v_own_n, 0) + coalesce(v_prior_n, 0);
        else
            v_rate  := v_own_rate;
            v_n_eff := coalesce(v_own_n, 0);
        end if;
        v_bron := 'eigen';
    elsif v_prior_rate is not null and v_prior_rate > 0 then
        v_rate  := v_prior_rate;
        v_n_eff := coalesce(v_prior_n, 0);
        v_bron  := coalesce(v_prior_level, 'algemeen');
        -- Geen eigen meting: dit getal komt uit de pool, niet uit een stand van
        -- dit apparaat. Ook een wear-stand alleen (last_known) wordt hier dus
        -- 'geschat', want de helling is geleend.
        v_provenance := 'estimated';
    end if;

    if v_rate is not null and v_rate > 0 and v_wear_now is not null then
        v_remaining := v_wear_now - v_threshold;
        if v_remaining > 0 then
            v_laps := v_remaining / v_rate;
            -- De bandbreedte hangt aan de effectieve basis: acht rondes is de
            -- nominale marge, korter wordt breder (tot 4x), langer smaller
            -- (tot 0,5x). Die 0,5 is de vloer: de helling blijft een meting
            -- met ruis, dus meer data maakt de band niet willekeurig smal.
            v_span := greatest(coalesce(v_n_eff, 0), 1);
            v_schaal := least(greatest(v_min_basis::numeric / v_span, 0.5), 4.0);
            case v_grade
                when 'A' then v_fac_laag := 1.10; v_fac_hoog := 0.90;
                when 'B' then v_fac_laag := 1.30; v_fac_hoog := 0.75;
                else          v_fac_laag := 2.00; v_fac_hoog := 0.50;
            end case;
            v_fac_laag := 1 + (v_fac_laag - 1) * v_schaal;
            v_fac_hoog := greatest(1 - (1 - v_fac_hoog) * v_schaal, 0.20);
            v_low  := greatest(floor(v_laps / v_fac_laag), 0);
            v_high := ceil(v_laps / v_fac_hoog);
            -- De eigen meting valt altijd binnen de band. Een prior mag het
            -- gemeten getal niet wegduwen: wijkt de pool af van wat dit
            -- apparaat zelf zag, dan wordt de band breder in plaats van dat de
            -- meting erbuiten valt. Zonder prior is dit een no-op, want dan is
            -- rate de eigen helling en ligt die per definitie in het midden.
            if v_own_rate is not null and v_own_rate > 0 then
                v_low  := least(v_low, floor(v_remaining / v_own_rate));
                v_high := greatest(v_high, ceil(v_remaining / v_own_rate));
            end if;
            -- Guard vóór de casts: NaN of NULL mag nooit op ::integer klappen.
            if v_laps is null or v_laps = 'NaN'::numeric
               or v_low is null or v_low = 'NaN'::numeric
               or v_high is null or v_high = 'NaN'::numeric then
                v_range := null;
            else
                v_range := jsonb_build_object('low', v_low::integer, 'high', v_high::integer);
            end if;
        else
            -- Wear staat al op of onder de drempel: geen bereik verzinnen.
            v_range := jsonb_build_object('low', 0, 'high', 0);
        end if;
    end if;

    v_label := case
        when v_totaal = 0 then 'geen stints'
        when v_grade = 'A' then 'drie of meer onafhankelijke stints'
        when v_grade = 'B' then 'twee onafhankelijke stints'
        when v_grade = 'C' then 'één stint, ruime marge'
        else 'geen stint met een gemeten helling'
    end;

    -- Bruikbaar = er is een getal, de graad is A of B, er is nog wear over en de
    -- meetbasis van de gebruikte hoek is lang genoeg (acht rondes) om de
    -- helling boven de ruis uit te tillen. Dat blijft een uitspraak over de
    -- eigen meting: een prior maakt een apparaat niet bruikbaar, hij maakt het
    -- bereik alleen smaller of breder. Voorlopig = dat getal is nog niet
    -- bevestigd, of het startpunt was niet de eigen stint.
    v_usable := v_rate is not null
                and v_grade in ('A', 'B')
                and coalesce(v_remaining, 0) > 0
                and coalesce(v_span_hoek, 0) >= v_min_basis
                and v_range is not null;
    v_voorlopig := (not v_usable)
                   or v_provenance <> 'measured'
                   or coalesce(v_span_hoek, 0) < v_min_basis
                   or coalesce(v_bron, 'algemeen') <> 'eigen';

    -- De basis blijft exact wat hij was (de eigen stint), met daaronder de
    -- herkomst van het startpunt. Ontbreekt een eigen stint, dan is er geen
    -- basis om te tonen behalve de context en de prior — geen verzonnen
    -- stintgegevens, alleen wat we werkelijk weten.
    if v_basis is null then
        v_basis := jsonb_build_object(
            'car_key', v_prior_car,
            'track_key', v_prior_track,
            'track_temp_c', null,
            'rondes_in_basis', 0,
            'rondes_in_stint', null,
            'set_number', null,
            'set_bron', null,
            'lap_from', null,
            'lap_to', null,
            'zwakste_hoek', null
        );
    end if;
    v_basis := v_basis || jsonb_build_object(
        'rondes_effectief', coalesce(v_n_eff, 0),
        'bron', v_bron,
        'prior_rate', case when v_prior_rate is null then null else round(v_prior_rate, 4) end,
        -- prior_n blijft n_eff (gewogen meetbasis) voor bestaande lezers; de
        -- echte aantallen staan ernaast en zijn wat de UI hoort te tonen.
        'prior_n', v_prior_n,
        'prior_rondes', coalesce(v_prior_rondes, 0),
        'prior_stints', coalesce(v_prior_stints, 0),
        'prior_level', v_prior_level,
        'prior_bron', v_prior_bron
    );

    return jsonb_build_object(
        'grade', v_grade,
        'grade_label', v_label,
        'usable', v_usable,
        'voorlopig', v_voorlopig,
        'stints', v_aantal,
        'stints_totaal', v_totaal,
        'wear_per_lap', case when v_rate is not null then round(v_rate, 4) end,
        'zwakste_hoek', case when v_own_rate is not null then v_hoek end,
        'range_laps', v_range,
        'wear_now', v_wear_now,
        'wear_now_car_key', v_wear_car,
        'wear_now_track_key', v_wear_track,
        'threshold_pct', v_threshold,
        'basis', v_basis,
        'provenance', v_provenance
    );
end;
$function$;

comment on function public.pitwall_tyre_estimate_v2(uuid) is
  'Stintschatting per apparaat: graad op de eigen stints met een gemeten helling, wear_per_lap van de steilste hoek (procentpunt per ronde, positief = slijt), bijgewerkt met de hiërarchische prior (tyre_prior, zonder de eigen stints van dit apparaat) via w = n/(n+8) op rondes. basis.bron zegt waar het startpunt vandaan kwam (eigen|exact|auto|circuit|algemeen), basis.prior_rate/prior_n/prior_level de prior zelf, basis.prior_rondes en basis.prior_stints de echte aantallen in de pool en basis.rondes_effectief de basis achter de bandbreedte (eigen + prior, elk één keer). range_laps schaalt met rate en die effectieve basis, met 0,5x als meetruisvloer; usable blijft een uitspraak over de eigen meting.';

revoke all on function public.pitwall_tyre_estimate_v2(uuid) from public, anon;
grant execute on function public.pitwall_tyre_estimate_v2(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 9. Controle: het recht is weg, RLS staat, en niemand anders schrijft
-- ---------------------------------------------------------------------------
-- Deze controle staat in de migratie zelf, want een grant die per ongeluk
-- terugkomt is een stille terugkeer van het truncate-gat. Faalt hij, dan stopt
-- de migratie — dat is de bedoeling.
do $$
declare
  v_rol text;
  v_priv text;
begin
  foreach v_rol in array array['anon', 'authenticated', 'service_role'] loop
    foreach v_priv in array array['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER'] loop
      if has_table_privilege(v_rol, 'public.tyre_prior_stats', v_priv) then
        raise exception 'recht % op tyre_prior_stats voor % is niet ingetrokken', v_priv, v_rol;
      end if;
      if has_table_privilege(v_rol, 'public.tyre_prior_contrib', v_priv) then
        raise exception 'recht % op tyre_prior_contrib voor % is niet ingetrokken', v_priv, v_rol;
      end if;
    end loop;
  end loop;

  if exists (select 1 from pg_policies
              where schemaname = 'public'
                and tablename in ('tyre_prior_stats', 'tyre_prior_contrib')) then
    raise exception 'tyre_prior_stats/contrib horen geen policies te hebben';
  end if;

  if not (select relrowsecurity from pg_class where oid = 'public.tyre_prior_stats'::regclass)
     or not (select relrowsecurity from pg_class where oid = 'public.tyre_prior_contrib'::regclass) then
    raise exception 'RLS staat niet aan op de pooltabellen';
  end if;

  -- De triggerfuncties zijn de enige schrijvers: ze zijn SECURITY DEFINER en
  -- niet uitvoerbaar voor een clientrol.
  if has_function_privilege('authenticated', 'public.tyre_prior_sync_session(uuid, text)', 'EXECUTE')
     or has_function_privilege('anon', 'public.tyre_prior_sync_session(uuid, text)', 'EXECUTE') then
    raise exception 'tyre_prior_sync_session is uitvoerbaar voor een clientrol';
  end if;
end $$;

commit;
