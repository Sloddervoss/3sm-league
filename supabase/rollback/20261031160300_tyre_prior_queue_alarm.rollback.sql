-- Rollback van 20261031160300_tyre_prior_queue_alarm.sql
-- Haalt het alarm, het herstel en de bewakingsjob weg en zet de retentie terug
-- op 30 dagen voor alle afgeronde rijen (dus ook voor mislukte rijen).
--
-- Volgorde van terugdraaien: eerst deze, dan 20261031160200, 20261031160100 en
-- 20261031160000.
--
-- Geen eigen begin/commit: atomair te draaien met psql -1.

-- 1. De bewakingsjob weg (de drainjob blijft staan).
do $$
begin
  if to_regprocedure('cron.unschedule(text)') is not null
     and exists (select 1 from cron.job j where j.jobname = 'tyre-prior-alarm') then
    perform cron.unschedule('tyre-prior-alarm');
  end if;
end $$;

-- 2. Alarm en herstel weg.
drop function if exists public.tyre_prior_queue_herstel(bigint);
drop function if exists public.tyre_prior_queue_alarm(integer);

-- 3. Retentie terug op de versie van 20261031150400: één grens van p_dagen voor
--    verwerkte én mislukte rijen.
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
