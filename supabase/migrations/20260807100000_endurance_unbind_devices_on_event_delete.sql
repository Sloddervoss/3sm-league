-- Endurance: events verwijderen terwijl een SimHub-device eraan gebonden is.
-- Doel: wanneer een endurance-event wordt verwijderd, blokkeert de check-constraint
-- `simhub_devices_binding_check` (event_id en team_id moeten beide NULL óf beide gezet
-- zijn) de `ON DELETE SET NULL` van `simhub_devices.endurance_event_id` — die zet alleen
-- event_id op NULL terwijl team_id nog staat. Gevolg: event-delete faalt stil in de UI.
--
-- Fix: BEFORE DELETE-trigger op endurance_events die alle daaraan gebonden devices
-- atomair ontbindt (event_id + team_id + binding_source samen → NULL) vóórdat de
-- FK/cascade loopt. De invariant blijft daarmee geldig.
-- Additief + omkeerbaar via de bijbehorende rollback.
BEGIN;

CREATE OR REPLACE FUNCTION public.endurance_unbind_devices_on_event_delete()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, auth, pg_temp
AS $$
BEGIN
  UPDATE public.simhub_devices
     SET endurance_event_id = NULL,
         endurance_team_id = NULL,
         endurance_binding_source = NULL,
         updated_at = now()
   WHERE endurance_event_id = OLD.id;
  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS trg_endurance_unbind_devices_on_event_delete ON public.endurance_events;
CREATE TRIGGER trg_endurance_unbind_devices_on_event_delete
BEFORE DELETE ON public.endurance_events
FOR EACH ROW EXECUTE FUNCTION public.endurance_unbind_devices_on_event_delete();

COMMIT;
