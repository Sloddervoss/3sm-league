-- Endurance Fase 3.5: constraint-aware planner (Stap 1 — JRES-formulering naar TS).
-- max_consecutive_stints: maximale aantal opeenvolgende stints achter elkaar (hard).
-- min_rest_minutes: minimale rusttijd tussen twee stints van dezelfde coureur (hard).
BEGIN;
ALTER TABLE public.endurance_registrations
  ADD COLUMN IF NOT EXISTS max_consecutive_stints INTEGER,
  ADD COLUMN IF NOT EXISTS min_rest_minutes INTEGER;
COMMIT;
