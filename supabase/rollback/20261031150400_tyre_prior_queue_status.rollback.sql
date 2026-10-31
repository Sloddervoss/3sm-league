-- Rollback van 20261031150400_tyre_prior_queue_status.sql
-- Zet de wachtrij terug op afgerond_op als enige afrondingssignaal: de
-- statuskolom, de retentie, de probleemview en de statusindexen verdwijnen, de
-- oude partiële index en de oude drain komen terug. Rijen die nu 'mislukt' zijn
-- (drie pogingen, afgerond_op gezet) worden weer open: dat is de toestand van
-- vóór de migratie, met hetzelfde misleidende open=0.
--
-- BELANGRIJK — dubbele open rijen. De migratie staat toe dat dezelfde sessie
-- een mislukte rij én een nieuwe open rij heeft. Zodra deze rollback de
-- mislukte rij weer onafgerond maakt, staan er twee rijen met afgerond_op is
-- null voor dezelfde (device_id, session_key) en kan de oude unieke index niet
-- worden aangemaakt. Daarom voegt deze rollback die rijen eerst samen: de
-- oudste opdracht blijft staan, neemt de hoogste pogingen en de laatst bekende
-- fout over, en de rest wordt verwijderd. Pas daarna komt de index.
--
-- Geen eigen begin/commit: draai dit bestand met psql -1 (of in één
-- transactie). Daardoor is de rollback ook binnen een testtransactie te
-- gebruiken zonder de sessie te committen.
--
-- Draai deze rollback vóór die van 20261031150300 als de hele reeks terug moet.


drop view if exists public.tyre_prior_queue_problemen;
drop function if exists public.tyre_prior_queue_retention(integer);

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

drop index if exists public.tyre_prior_queue_status_idx;
drop index if exists public.tyre_prior_queue_wacht_idx;
create index if not exists tyre_prior_queue_wacht_idx
  on public.tyre_prior_queue (gevraagd_op, id)
  where afgerond_op is null and pogingen < 3;

update public.tyre_prior_queue
   set afgerond_op = null
 where status = 'mislukt';

-- ---------------------------------------------------------------------------
-- Samenvoegen van dubbele open rijen
-- ---------------------------------------------------------------------------
-- Dezelfde sessie kan na de migratie twee rijen hebben: een mislukte en een
-- nieuwe open opdracht. De stap hierboven maakt daar twee OPEN rijen van, en de
-- oude unieke index op (device_id, session_key) waar afgerond_op null is kan dat
-- niet aan. Bewaar de oudste opdracht (die met de eerste vraagtijd), neem de
-- hoogste pogingen en de laatst bekende fout over, en verwijder de rest.
do $$
declare
  v_weg integer := 0;
begin
  create temporary table if not exists _queue_dubbel on commit drop as
  with genummerd as (
    select q.id,
           q.device_id,
           q.session_key,
           q.pogingen,
           q.laatste_fout,
           first_value(q.id) over (partition by q.device_id, q.session_key
                                   order by q.gevraagd_op, q.id) as behoud,
           row_number() over (partition by q.device_id, q.session_key
                              order by q.gevraagd_op, q.id) as rn
      from public.tyre_prior_queue q
     where q.afgerond_op is null
  )
  select * from genummerd where rn > 1;

  update public.tyre_prior_queue q
     set pogingen = greatest(q.pogingen, d.pogingen),
         laatste_fout = coalesce(q.laatste_fout, d.laatste_fout)
    from (
      select d2.behoud,
             max(d2.pogingen) as pogingen,
             (array_agg(d2.laatste_fout order by d2.id desc))[1] as laatste_fout
        from _queue_dubbel d2
       group by d2.behoud
    ) d
   where q.id = d.behoud;

  delete from public.tyre_prior_queue q
   using _queue_dubbel d
   where q.id = d.id;

  get diagnostics v_weg = row_count;
  if v_weg > 0 then
    raise notice 'rollback: % dubbele open wachtrijrij(en) samengevoegd', v_weg;
  end if;

  drop table if exists _queue_dubbel;
end $$;

drop index if exists public.tyre_prior_queue_open_idx;
create unique index tyre_prior_queue_open_idx
  on public.tyre_prior_queue (device_id, session_key)
  where afgerond_op is null;

alter table public.tyre_prior_queue
  drop constraint if exists tyre_prior_queue_status_check;
alter table public.tyre_prior_queue
  drop column if exists status;

comment on column public.tyre_prior_queue.afgerond_op is
  'Tijdstip waarop tyre_prior_sync_session() voor deze sessie slaagde. NULL = nog open.';
comment on column public.tyre_prior_queue.pogingen is
  'Aantal mislukte verwerkingen. Bij 3 wordt de rij niet meer opgepakt; laatste_fout zegt waarom.';

