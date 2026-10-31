-- Rollback van 20261031180000_plugin08_measurement_events.sql
--
-- Verwijdert de tabel met alles erin. Dat is opzettelijk: dit is een voorstel
-- dat nog niet is toegepast, en de tabel bevat alleen gegevens die de connector
-- opnieuw kan aanbieden uit zijn outbox (idempotent op device_id + event_id).
-- Zodra er productiegegevens in staan, hoort hier een export- of bewaarstap
-- boven te staan in plaats van een kale drop.
--
-- Volgorde van terugdraaien: eerst 20261031180300 (de schrijver), dan deze.
-- Geen begin/commit: atomair te draaien met psql -1.

drop table if exists public.simhub_measurement_events;
