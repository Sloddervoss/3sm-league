-- Terugdraaien van 20261027211000_endurance_practice_lap_scope.sql
--
-- De policy gaat terug naar de deelnemersvariant uit 20260910210000: iedereen
-- die aan het event meedoet leest alle praktijkrondes van dat event. Dat is
-- precies de toestand van vóór deze migratie — inclusief het lek. Alleen
-- bruikbaar als de migratie zelf onverwacht schade aanricht.
--
-- Volgorde: eerst de policy vervangen (die verwijst naar het predicaat), dan pas
-- het predicaat droppen.

drop policy if exists "endurance team practice laps select" on public.endurance_practice_laps;

drop policy if exists "endurance participant practice laps select" on public.endurance_practice_laps;
create policy "endurance participant practice laps select" on public.endurance_practice_laps
  for select to authenticated
  using (public.endurance_is_participant(event_id, auth.uid()));

drop function if exists public.endurance_practice_lap_visible(uuid, uuid, uuid);
