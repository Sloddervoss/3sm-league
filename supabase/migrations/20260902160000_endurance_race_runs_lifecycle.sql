-- ============================================================================
-- Endurance race-run lifecycle storage — Telemetry V3 Phase B
-- ============================================================================
-- Server-authoritative lifecycle for endurance race runs. No client can create,
-- close, or modify a race run. The connector only carries a transportSessionId;
-- raceRunId is server-resolved from the authenticated device's event/team binding.
-- ============================================================================
-- Veiligheid:
--  - RLS enabled, PUBLIC/anon/authenticated mutation denied
--  - service_role-only write access via SECURITY DEFINER RPCs
--  - Partial unique index enforces max one active run per (event_id, team_id, run_kind)
--  - No automatic lifecycle transitions; only explicit server-side operations
-- ============================================================================

BEGIN;

-- ======================= ENUMS =============================================

CREATE TYPE public.endurance_run_kind AS ENUM (
  'practice',
  'qualifying',
  'race'
);

CREATE TYPE public.endurance_race_run_status AS ENUM (
  'active',
  'completed',
  'ended',
  'cancelled'
);

-- ======================= TABLE =============================================

CREATE TABLE public.endurance_race_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id UUID NOT NULL REFERENCES public.endurance_events(id) ON DELETE RESTRICT,
  team_id UUID NOT NULL REFERENCES public.endurance_teams(id) ON DELETE RESTRICT,
  run_kind public.endurance_run_kind NOT NULL,
  status public.endurance_race_run_status NOT NULL DEFAULT 'active',
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  ended_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ======================= CONSTRAINTS ========================================

-- ended_at must be null while active, set when closed, and >= started_at
ALTER TABLE public.endurance_race_runs
  ADD CONSTRAINT endurance_race_runs_ended_at_check
  CHECK (
    (status = 'active' AND ended_at IS NULL)
    OR
    (status <> 'active' AND ended_at IS NOT NULL AND ended_at >= started_at)
  );

-- Enforce at most one active run per (event_id, team_id, run_kind)
CREATE UNIQUE INDEX endurance_race_runs_active_unique_idx
  ON public.endurance_race_runs (event_id, team_id, run_kind)
  WHERE status = 'active';

-- Query performance: find active runs by event/team/run_kind
CREATE INDEX endurance_race_runs_active_event_team_idx
  ON public.endurance_race_runs (event_id, team_id, run_kind)
  WHERE status = 'active';

-- ======================= RLS ===============================================

ALTER TABLE public.endurance_race_runs ENABLE ROW LEVEL SECURITY;

-- No direct mutation by any role except service_role via SECURITY DEFINER functions
CREATE POLICY endurance_race_runs_service_role_all
  ON public.endurance_race_runs
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- Deny all direct access to PUBLIC, anon, authenticated
-- (service_role is already allowed above; no other role needs a policy)
REVOKE ALL ON public.endurance_race_runs FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.endurance_race_runs TO service_role;

-- ======================= LIFE CYCLE FUNCTIONS ===============================

-- Start a new race run. Only service_role (backend/Edge) may call this.
-- Caller supplies event_id, team_id, and run_kind.
-- Server generates UUID, sets started_at, and initial status = active.
-- Returns bounded result codes, never raw exception messages.
CREATE OR REPLACE FUNCTION public.simhub_start_race_run(
  p_event_id UUID,
  p_team_id UUID,
  p_run_kind TEXT
)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'auth', 'pg_temp'
AS $$
DECLARE
  v_run_kind public.endurance_run_kind;
  v_team_event UUID;
  v_existing UUID;
  v_new_id UUID;
BEGIN
  -- Authorization: only service_role
  IF auth.role() <> 'service_role' THEN
    RETURN 'unauthorized';
  END IF;

  -- Validate required inputs
  IF p_event_id IS NULL OR p_team_id IS NULL OR p_run_kind IS NULL THEN
    RETURN 'invalid_input';
  END IF;

  -- Validate run_kind is a known enum value
  BEGIN
    v_run_kind := p_run_kind::public.endurance_run_kind;
  EXCEPTION WHEN others THEN
    RETURN 'invalid_run_kind';
  END;

  -- Validate event exists
  IF NOT EXISTS (SELECT 1 FROM public.endurance_events WHERE id = p_event_id) THEN
    RETURN 'invalid_event';
  END IF;

  -- Validate team exists and belongs to the event
  SELECT event_id INTO v_team_event
    FROM public.endurance_teams
   WHERE id = p_team_id;
  IF v_team_event IS NULL THEN
    RETURN 'invalid_team';
  END IF;
  IF v_team_event <> p_event_id THEN
    RETURN 'invalid_binding';
  END IF;

  -- Check if an active run already exists for this (event, team, run_kind)
  SELECT id INTO v_existing
    FROM public.endurance_race_runs
   WHERE event_id = p_event_id
     AND team_id = p_team_id
     AND run_kind = v_run_kind
     AND status = 'active'
   LIMIT 1;

  IF FOUND THEN
    RETURN 'already_active';
  END IF;

  -- Create the new run
  INSERT INTO public.endurance_race_runs (event_id, team_id, run_kind, status, started_at)
  VALUES (p_event_id, p_team_id, v_run_kind, 'active', now())
  RETURNING id INTO v_new_id;

  RETURN 'accepted';
END;
$$;

-- Close an active race run. Only service_role may call this.
-- Sets ended_at server-side. Final status must be completed, ended, or cancelled.
-- Idempotent: already-closed run with same final status returns 'already_final'.
CREATE OR REPLACE FUNCTION public.simhub_close_race_run(
  p_race_run_id UUID,
  p_final_status TEXT
)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'auth', 'pg_temp'
AS $$
DECLARE
  v_status public.endurance_race_run_status;
  v_current_status public.endurance_race_run_status;
  v_allowed TEXT[] := ARRAY['completed', 'ended', 'cancelled'];
BEGIN
  -- Authorization: only service_role
  IF auth.role() <> 'service_role' THEN
    RETURN 'unauthorized';
  END IF;

  IF p_race_run_id IS NULL OR p_final_status IS NULL THEN
    RETURN 'invalid_input';
  END IF;

  -- Validate final_status is a known enum value
  BEGIN
    v_status := p_final_status::public.endurance_race_run_status;
  EXCEPTION WHEN others THEN
    RETURN 'invalid_status';
  END;

  -- Only completed, ended, cancelled are allowed final states
  IF NOT (v_status = ANY (v_allowed::public.endurance_race_run_status[])) THEN
    RETURN 'invalid_status';
  END IF;

  -- Read current status, lock the row
  SELECT status INTO v_current_status
    FROM public.endurance_race_runs
   WHERE id = p_race_run_id
   FOR UPDATE;

  IF NOT FOUND THEN
    RETURN 'invalid_run';
  END IF;

  -- If already closed, idempotent: same status returns already_final
  IF v_current_status <> 'active' THEN
    IF v_current_status = v_status THEN
      RETURN 'already_final';
    END IF;
    RETURN 'already_closed';
  END IF;

  -- Close the run
  UPDATE public.endurance_race_runs
     SET status = v_status,
         ended_at = now(),
         updated_at = now()
   WHERE id = p_race_run_id;

  RETURN 'accepted';
END;
$$;

-- Returns the UUID of the active race run for (event, team, run_kind), or NULL.
CREATE OR REPLACE FUNCTION public.simhub_get_active_race_run(
  p_event_id UUID,
  p_team_id UUID,
  p_run_kind TEXT
)
RETURNS UUID
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'auth', 'pg_temp'
AS $$
DECLARE
  v_run_kind public.endurance_run_kind;
  v_run_id UUID;
BEGIN
  IF p_event_id IS NULL OR p_team_id IS NULL OR p_run_kind IS NULL THEN
    RETURN NULL;
  END IF;

  BEGIN
    v_run_kind := p_run_kind::public.endurance_run_kind;
  EXCEPTION WHEN others THEN
    RETURN NULL;
  END;

  SELECT id INTO v_run_id
    FROM public.endurance_race_runs
   WHERE event_id = p_event_id
     AND team_id = p_team_id
     AND run_kind = v_run_kind
     AND status = 'active'
   LIMIT 1;

  RETURN v_run_id;
END;
$$;

-- ======================= GRANTS =============================================

REVOKE ALL ON FUNCTION public.simhub_start_race_run(UUID, UUID, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.simhub_start_race_run(UUID, UUID, TEXT) TO service_role;

REVOKE ALL ON FUNCTION public.simhub_close_race_run(UUID, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.simhub_close_race_run(UUID, TEXT) TO service_role;

REVOKE ALL ON FUNCTION public.simhub_get_active_race_run(UUID, UUID, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.simhub_get_active_race_run(UUID, UUID, TEXT) TO service_role;

COMMIT;