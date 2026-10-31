-- Rollback van 20261031130000_pitwall_prior_pool_privacy.sql
--
-- Haalt de wrapper en de kern weg en zet het recht op tyre_prior() terug voor
-- authenticated. Daarmee is de oude situatie terug: één functie, geen
-- publicatiepoort, en de aanroeper kan zelf een apparaat meegeven.
--
-- Volgorde: eerst de wrapper (die verwijst naar de kern), dan de kern, dan pas
-- het recht. Draai deze rollback pas na die van 20261031130100: de oude
-- schatting roept tyre_prior(text, text, uuid) aan, niet de kern.
--
-- Wat blijft staan: tyre_prior(text, text, uuid) zelf. Die is nooit weggeweest;
-- alleen het recht van authenticated was ingetrokken.

begin;

drop function if exists public.pitwall_prior_v1(text, text);
drop function if exists public.tyre_prior_core(text, text, uuid[]);

grant execute on function public.tyre_prior(text, text, uuid) to authenticated;

commit;
