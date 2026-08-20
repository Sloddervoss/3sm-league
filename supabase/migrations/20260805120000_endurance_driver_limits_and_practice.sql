-- Endurance Fase 3.5: per-coureur rijlimieten + practice-sessie-voorbereiding.
-- (1) max_stint_minutes / max_total_minutes op endurance_registrations
-- (2) practice-sessie-raamwerk: endurance_practice_sessions + endurance_practice_laps (SimHub-laag koopt later aan)

BEGIN;
ALTER TABLE public.endurance_registrations
  ADD COLUMN IF NOT EXISTS max_stint_minutes integer,
  ADD COLUMN IF NOT EXISTS max_total_minutes integer;

CREATE TABLE IF NOT EXISTS public.endurance_practice_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid NOT NULL REFERENCES public.endurance_events(id) ON DELETE CASCADE,
  team_id uuid REFERENCES public.endurance_teams(id) ON DELETE SET NULL,
  label text NOT NULL DEFAULT 'Practice',
  started_at timestamptz NOT NULL DEFAULT now(),
  ended_at timestamptz,
  requires_registered boolean NOT NULL DEFAULT true,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS endurance_practice_sessions_event_idx ON public.endurance_practice_sessions (event_id);
CREATE INDEX IF NOT EXISTS endurance_practice_sessions_active_idx ON public.endurance_practice_sessions (event_id, ended_at);

CREATE TABLE IF NOT EXISTS public.endurance_practice_laps (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid NOT NULL REFERENCES public.endurance_practice_sessions(id) ON DELETE CASCADE,
  event_id uuid NOT NULL REFERENCES public.endurance_events(id) ON DELETE CASCADE,
  user_id uuid,
  car_id text,
  circuit text,
  lap_seconds numeric NOT NULL,
  fuel_used_litres numeric,
  fuel_per_lap_litres numeric,
  incident_count smallint NOT NULL DEFAULT 0,
  recorded_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS endurance_practice_laps_session_idx ON public.endurance_practice_laps (session_id);
CREATE INDEX IF NOT EXISTS endurance_practice_laps_user_idx ON public.endurance_practice_laps (user_id);

ALTER TABLE public.endurance_practice_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.endurance_practice_laps ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "endurance practice sessions super admin all" ON public.endurance_practice_sessions;
CREATE POLICY "endurance practice sessions super admin all" ON public.endurance_practice_sessions
  FOR ALL USING (has_role(auth.uid(), 'super_admin'::public.app_role));
DROP POLICY IF EXISTS "endurance practice laps super admin all" ON public.endurance_practice_laps;
CREATE POLICY "endurance practice laps super admin all" ON public.endurance_practice_laps
  FOR ALL USING (has_role(auth.uid(), 'super_admin'::public.app_role));
COMMIT;
