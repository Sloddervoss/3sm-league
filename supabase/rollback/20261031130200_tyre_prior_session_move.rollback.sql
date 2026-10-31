-- Rollback van 20261031130200_tyre_prior_session_move.sql
--
-- Zet tyre_prior_sync_session() terug op de versie van 20261029120000: het
-- verschil per stint (nieuw min oud) op de nieuwe cel. Daarmee komt ook de fout
-- terug dat een stint die alleen van auto of baan wisselt zijn bijdrage op de
-- oude cel laat staan; deze rollback is er voor het geval de nieuwe boekhouding
-- ergens niet klopt, niet als aanbevolen toestand.
--
-- Na de rollback is de pool niet automatisch hersteld; daarom bouwt
-- tyre_prior_refresh() de bijdragen en de cellen opnieuw uit de stintview op.

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

select public.tyre_prior_refresh();

commit;
