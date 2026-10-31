-- Rollback van 20261031180100_plugin08_lap_summaries.sql
--
-- Verwijdert de tabel met alles erin. Zelfde afweging als bij de
-- gebeurtenissentabel: de connector kan een ronde opnieuw aanbieden zolang de
-- outbox hem nog heeft, en deze migratie is nog niet toegepast.
--
-- Volgorde van terugdraaien: eerst 20261031180300 (de schrijver), dan deze.
-- Geen begin/commit: atomair te draaien met psql -1.

drop table if exists public.simhub_lap_summaries;
