-- Rollback van 20261031130300_tyre_prior_queue.sql
--
-- Zet het onderhoud terug IN het ingestpad: de drie statement-triggers roepen
-- weer tyre_prior_on_insert/update/delete() aan, en die syncen de sessie zoals
-- vóór deze migratie. De wachtrij en de drain verdwijnen.
--
-- Wat er met onverwerkte wachtrij-opdrachten gebeurt: die gaan verloren bij het
-- droppen van de tabel. Daarom bouwt tyre_prior_refresh() aan het eind de
-- bijdragen en de cellen opnieuw uit de stintview op — dezelfde reparatie die
-- ook na een gemiste trigger nodig is. Zonder die stap zou de pool achterblijven
-- op wat de drain toevallig al had verwerkt.
--
-- De functies tyre_prior_on_insert/update/delete bestaan nog: de migratie heeft
-- alleen hun triggers weggehaald, niet de functies. Deze rollback zet de
-- triggers terug en laat de functies ongemoeid.

begin;

drop trigger if exists simhub_tyre_lap_samples_queue_ins on public.simhub_tyre_lap_samples;
drop trigger if exists simhub_tyre_lap_samples_queue_upd on public.simhub_tyre_lap_samples;
drop trigger if exists simhub_tyre_lap_samples_queue_del on public.simhub_tyre_lap_samples;

drop function if exists public.tyre_prior_enqueue_on_insert();
drop function if exists public.tyre_prior_enqueue_on_update();
drop function if exists public.tyre_prior_enqueue_on_delete();

drop table if exists public.tyre_prior_queue;

create trigger simhub_tyre_lap_samples_prior_ins
  after insert on public.simhub_tyre_lap_samples
  referencing new table as changed
  for each statement execute function public.tyre_prior_on_insert();

create trigger simhub_tyre_lap_samples_prior_upd
  after update on public.simhub_tyre_lap_samples
  referencing old table as oud new table as changed
  for each statement execute function public.tyre_prior_on_update();

create trigger simhub_tyre_lap_samples_prior_del
  after delete on public.simhub_tyre_lap_samples
  referencing old table as changed
  for each statement execute function public.tyre_prior_on_delete();

-- Inhaalactie: wat de wachtrij nog niet had verwerkt, wordt hier alsnog
-- berekend. Idempotent en set-based.
select public.tyre_prior_refresh();

commit;
