-- Rollback: verwijder de BEFORE DELETE-trigger + functie die devices ontbindt
-- bij event-delete. Hiermee keert de situatie terug waarin het verwijderen van
-- een endurance-event met een daaraan gebonden device door de check-constraint
-- geblokkeerd wordt. Alleen toepassen als de oplossing teruggedraaid moet worden.
BEGIN;

DROP TRIGGER IF EXISTS trg_endurance_unbind_devices_on_event_delete ON public.endurance_events;
DROP FUNCTION IF EXISTS public.endurance_unbind_devices_on_event_delete();

COMMIT;
