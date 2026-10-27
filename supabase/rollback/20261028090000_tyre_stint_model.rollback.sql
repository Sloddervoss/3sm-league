-- Rollback voor 20261028090000_tyre_stint_model.sql
--
-- Alleen objecten die deze migratie heeft aangemaakt. De brontabel
-- (simhub_tyre_lap_samples), de bestaande RPC's en tyre_estimate_v1 blijven
-- staan: er is niets aan bestaande objecten gewijzigd, dus er valt niets te
-- herstellen.

begin;

drop function if exists public.pitwall_tyre_estimate_v2(uuid);
drop function if exists public.tyre_coverage(integer);
drop view if exists public.tyre_stint_deltas;
drop index if exists public.simhub_tyre_lap_samples_session_lap_idx;

commit;
