-- ============================================================================
-- Endurance — een stint die van cel verhuist, verhuist zijn bijdrage echt
-- Datum: 2026-10-31
-- Vorige migratie: 20261031130100_pitwall_tyre_estimate_adviespoort.sql
--
-- Contractpunt 5. De oude functie berekende het verschil per stint als
-- "nieuw min oud" en boekte dat verschil op de NIEUWE cel:
--
--     delta = nieuw - oud   (één rij, met coalesce(n.car_key, o.car_key))
--
-- Zolang alleen rondes of wear veranderen is dat correct: dezelfde cel, het
-- verschil erbij. Zodra de IDENTITEIT verandert (een auto of baan die later
-- gecorrigeerd wordt, een frame dat met de verkeerde carId binnenkwam) is het
-- dat niet meer. De oude cel hield zijn bijdrage, en de nieuwe cel kreeg
-- "nieuw min oud" in plaats van "nieuw". Bij een verhuizing zonder wijziging
-- in rondes of wear (het geval uit het contract) is dat verschil nul: de
-- bijdrage stond daarna in GEEN van beide cellen, en de oude cel bleef hem
-- eeuwig meetellen.
--
-- De reparatie is klein en expliciet: bij elke gewijzigde stint gaan er twee
-- rijen de delta in.
--
--     + de volledige NIEUWE bijdrage op de nieuwe cel
--     - de volledige OUDE bijdrage op de oude cel
--
-- Voor een stint die alleen in rondes of wear verandert, is de som van die twee
-- weer precies het oude verschil (zelfde cel, +nieuw en -oud). Voor een
-- verhuizing is het de enige boekhouding die klopt: de oude cel gaat exact naar
-- wat hij zonder deze stint was, en de nieuwe cel krijgt exact wat de stint nu
-- bijdraagt. Beide zijden worden per cel gegroepeerd, zodat één stint die
-- binnen dezelfde sessie twee keer van cel wisselt geen twee schrijfacties op
-- dezelfde rij oplevert.
--
-- Wat NIET verandert: de poortwachter (alleen gesloten stints), de drempel van
-- drie rondes, de per-hoek-voorwaarde, de tijdgrenzen (lock_timeout 2 s,
-- statement_timeout 8 s), de tabel tyre_prior_contrib als boekhouding en het
-- opruimen van bijdragen die niet meer bestaan.
-- ============================================================================

begin;

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
           c.car_key, c.track_key, c.rondes,
           c.sum_wear_fl, c.sum_wear_fr, c.sum_wear_rl, c.sum_wear_rr,
           c.rondes_fl, c.rondes_fr, c.rondes_rl, c.rondes_rr
      from public.tyre_prior_contrib c
     where c.device_id = p_device_id
       and c.session_key = p_session_key
  ),
  -- Welke stints zijn gewijzigd? Inhoudelijk (rondes, wear, per-hoek-basis) of
  -- in identiteit (auto/baan). Een stint die alleen van identiteit wisselt en
  -- verder identiek is, valt hier ook onder: daar zit de fout van de oude
  -- functie.
  gewijzigd as (
    select coalesce(n.set_number, o.set_number) as set_number,
           coalesce(n.lap_from, o.lap_from)     as lap_from
      from nieuw n
      full join oud o using (set_number, lap_from)
     where (n.car_key, n.track_key, n.rondes,
            n.sum_wear_fl, n.sum_wear_fr, n.sum_wear_rl, n.sum_wear_rr,
            n.rondes_fl, n.rondes_fr, n.rondes_rl, n.rondes_rr)
           is distinct from
           (o.car_key, o.track_key, o.rondes,
            o.sum_wear_fl, o.sum_wear_fr, o.sum_wear_rl, o.sum_wear_rr,
            o.rondes_fl, o.rondes_fr, o.rondes_rl, o.rondes_rr)
        or (n.set_number is null) <> (o.set_number is null)
  ),
  -- Twee kanten, elk volledig: de nieuwe bijdrage positief op de nieuwe cel, de
  -- oude bijdrage negatief op de oude cel. Geen "verschil op de nieuwe cel"
  -- meer — dat is alleen goed zolang de identiteit niet verandert.
  delta as (
    -- Plus-kant. Alleen voor stints die nu nog bestaan.
    select n.car_key,
           n.track_key,
           1::integer        as stints,
           n.rondes,
           n.sum_wear_fl, n.sum_wear_fr, n.sum_wear_rl, n.sum_wear_rr,
           n.rondes_fl, n.rondes_fr, n.rondes_rl, n.rondes_rr
      from nieuw n
      join gewijzigd g on g.set_number = n.set_number and g.lap_from = n.lap_from
    union all
    -- Min-kant. Alleen voor bijdragen die er eerder waren; een stint die voor
    -- het eerst verschijnt heeft geen oude cel om af te boeken.
    select o.car_key,
           o.track_key,
           -1::integer       as stints,
           -o.rondes,
           -o.sum_wear_fl, -o.sum_wear_fr, -o.sum_wear_rl, -o.sum_wear_rr,
           -o.rondes_fl, -o.rondes_fr, -o.rondes_rl, -o.rondes_rr
      from oud o
      join gewijzigd g on g.set_number = o.set_number and g.lap_from = o.lap_from
  ),
  -- De cel bijwerken: één rij per cel per aanroep, gesorteerd zodat twee
  -- apparaten die tegelijk dezelfde cellen raken dezelfde volgorde aanhouden
  -- (minder kans op een deadlock).
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
  -- bijdrage is hierboven al volledig van de oude cel afgetrokken.
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
  select count(*) into v_gewijzigd from gewijzigd;

  -- Een cel die leegloopt (laatste stint verwijderd of verhuisd) hoort niet te
  -- blijven staan: een rij met nul stints is geen kennis en zou de traps
  -- vervuilen.
  if v_gewijzigd > 0 then
    delete from public.tyre_prior_stats s
     where s.stints <= 0;
  end if;

  return v_gewijzigd;
end;
$$;

comment on function public.tyre_prior_sync_session(uuid, text) is
  'Werkt de gepoolde cijfers bij voor één sessie van één apparaat: alleen de gesloten stints, en per gewijzigde stint de volledige nieuwe bijdrage positief op de nieuwe cel plus de volledige oude bijdrage negatief op de oude cel. Daardoor verhuist een stint die alleen van auto of baan wisselt zijn bijdrage echt. Geen herberekening van de hele pool; doet niets als er geen stint gesloten is.';

revoke all on function public.tyre_prior_sync_session(uuid, text) from public, anon, authenticated;

commit;
