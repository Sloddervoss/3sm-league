-- ============================================================================
-- Rollback: 20260813120000_endurance_iracing_event_catalog
-- ----------------------------------------------------------------------------
-- Verwijdert alleen de door deze migratie toegevoegde objecten. Bestaande
-- handmatige `endurance_events` worden NIET geraakt (bronkolommen worden
-- verwijderd, bestaande data heeft deze kolommen nooit gevuld).
-- Volgorde:
--   1. triggers/functies die naar nieuwe objecten verwijzen
--   2. activatie- en guard-RPC's
--   3. additieve kolommen (+ FK/indexen/check via kolomdrop) op endurance_events
--   4. de nieuwe catalogustabellen
-- ============================================================================

BEGIN;

-- 1. Registratie-slot-gate-trigger + functie (alleen onze guard).
DROP TRIGGER IF EXISTS endurance_guard_iracing_registration_slot ON public.endurance_registrations;
DROP FUNCTION IF EXISTS public.endurance_guard_iracing_registration_slot();

-- 2. Activatie-RPC + koppelvaliderende trigger/functie.
DROP FUNCTION IF EXISTS public.endurance_activate_iracing_slot(
  UUID, UUID, TIMESTAMPTZ, public.endurance_event_visibility, INTEGER, UUID[], UUID[]
);
DROP TRIGGER IF EXISTS endurance_events_validate_iracing_link ON public.endurance_events;
DROP FUNCTION IF EXISTS public.endurance_validate_iracing_link();

-- 3. Additieve bronkolommen op `endurance_events`.
--    Het droppen van een kolom verwijdert automatisch de FK's, de partial
--    unique indexen en de check-constraint die erop rusten.
ALTER TABLE public.endurance_events
  DROP COLUMN IF EXISTS iracing_imported_at,
  DROP COLUMN IF EXISTS iracing_slot_key,
  DROP COLUMN IF EXISTS iracing_source_hash,
  DROP COLUMN IF EXISTS iracing_source_key,
  DROP COLUMN IF EXISTS iracing_catalog_slot_id,
  DROP COLUMN IF EXISTS iracing_catalog_event_id;

-- 4. Nieuwe catalogustabellen (slot eerst, dan event vanwege DE CASCADE/links).
ALTER TABLE public.endurance_iracing_events DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.endurance_iracing_event_slots DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.endurance_iracing_sync_runs DISABLE ROW LEVEL SECURITY;

DROP TABLE IF EXISTS public.endurance_iracing_sync_runs;
DROP TABLE IF EXISTS public.endurance_iracing_event_slots;
DROP TABLE IF EXISTS public.endurance_iracing_events;

COMMIT;
