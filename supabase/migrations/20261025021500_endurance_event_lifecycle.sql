-- 2026-10-25: levensloop van een event op de klok.
--
-- Niets zette ooit een status om: een race bleef op registration_open of live
-- staan en verdween dus nooit uit de lijst. Deze functie loopt elke 5 minuten
-- en zet de status op basis van de tijd, niet op basis van een klik.
--
--   registration_open  -> registration_closed   na de inschrijfdeadline
--   alles              -> live                  tussen start en einde
--   alles              -> completed             15 min na het einde
--
-- Bij completed worden de openstaande race-runs gesloten, zodat de pitwall niet
-- blijft denken dat er gereden wordt.

create or replace function public.endurance_tick_events()
returns table (gesloten integer, gestart integer, afgerond integer)
language plpgsql
security definer
set search_path to 'pg_catalog', 'public', 'pg_temp'
as $function$
declare
  n_gesloten integer := 0;
  n_gestart  integer := 0;
  n_afgerond integer := 0;
begin
  update public.endurance_events
     set status = 'registration_closed', updated_at = now()
   where status = 'registration_open'
     and registration_deadline is not null
     and now() > registration_deadline
     and now() < start_at;
  get diagnostics n_gesloten = row_count;

  update public.endurance_events
     set status = 'live', updated_at = now()
   where status in ('registration_open', 'registration_closed', 'planning')
     and now() between start_at and end_at;
  get diagnostics n_gestart = row_count;

  update public.endurance_events
     set status = 'completed', updated_at = now()
   where status in ('registration_open', 'registration_closed', 'planning', 'live')
     and now() > end_at + interval '15 minutes';
  get diagnostics n_afgerond = row_count;

  update public.endurance_race_runs r
     set status = 'ended', ended_at = now()
    from public.endurance_events e
   where e.id = r.event_id
     and e.status = 'completed'
     and r.status = 'active';

  return query select n_gesloten, n_gestart, n_afgerond;
end;
$function$;

-- Elk kwartier is genoeg: de grenzen liggen op uren, niet op seconden.
select cron.unschedule('endurance-tick')
 where exists (select 1 from cron.job where jobname = 'endurance-tick');

select cron.schedule('endurance-tick', '*/5 * * * *', $cron$select public.endurance_tick_events()$cron$);
