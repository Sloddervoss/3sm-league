-- Terugdraaien: de klok-taak en de levensloopfunctie verwijderen.
select cron.unschedule('endurance-tick') where exists (select 1 from cron.job where jobname = 'endurance-tick');
drop function if exists public.endurance_tick_events();
