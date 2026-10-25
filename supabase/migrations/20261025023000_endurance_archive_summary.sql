-- 2026-10-25: samenvatting per team voor het endurance-archief.
--
-- Een afgeronde race had in het archief alleen een naam en een circuit. Deze
-- functie levert per team de cijfers die er wel toe doen: rondes, snelste ronde,
-- stops en wie er gereden heeft.

create or replace function public.get_endurance_archive_summary(p_event_id uuid)
returns table (
  team_id uuid,
  team_name text,
  car_number text,
  laps integer,
  best_lap_seconds numeric,
  stops integer,
  drivers text[]
)
language sql
stable
security definer
set search_path to 'pg_catalog', 'public', 'auth', 'pg_temp'
as $function$
  with per_team as (
    select s.team_id,
           max(s.completed_laps) as laps,
           min(s.lap_time_seconds) filter (where s.lap_time_seconds is not null) as best_lap,
           count(*) filter (where s.exclusion_reason = 'pit_lane_during_lap') as stops
      from public.endurance_strategy_lap_samples s
     where s.event_id = p_event_id
     group by s.team_id
  ),
  per_driver as (
    select e.team_id, array_agg(distinct p.display_name order by p.display_name) as namen
      from public.endurance_telemetry_events e
      join public.profiles p on p.user_id::text = e.driver_id
     where e.event_id = p_event_id and e.driver_id is not null
     group by e.team_id
  )
  select t.id,
         t.name,
         t.car_number,
         coalesce(pt.laps, 0)::integer,
         round(pt.best_lap, 3),
         coalesce(pt.stops, 0)::integer,
         coalesce(pd.namen, '{}'::text[])
    from public.endurance_teams t
    left join per_team pt on pt.team_id = t.id
    left join per_driver pd on pd.team_id = t.id
   where t.event_id = p_event_id
   order by coalesce(pt.laps, 0) desc;
$function$;

grant execute on function public.get_endurance_archive_summary(uuid) to authenticated;
