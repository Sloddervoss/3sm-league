-- ============================================================================
-- Manual SimHub primary-authority handoff (no automatic failover).
-- A service/backend caller explicitly promotes a currently bound standby device.
-- The target's existing binding is authoritative; no caller-supplied binding can
-- redirect a device to another event/team.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.simhub_set_primary_device(
  p_target_device_id UUID
)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'auth', 'pg_temp'
AS $$
DECLARE
  v_target public.simhub_devices%ROWTYPE;
  v_current_primary public.simhub_devices%ROWTYPE;
  v_registered BOOLEAN;
  v_lock_key BIGINT;
BEGIN
  -- Defense in depth: direct client execution is not permitted even if a grant
  -- is accidentally widened later. The intended caller is a trusted backend.
  IF auth.role() <> 'service_role' THEN
    RETURN 'unauthorized';
  END IF;

  IF p_target_device_id IS NULL THEN
    RETURN 'invalid_device';
  END IF;

  -- Lock target first so its binding/state cannot change while it is inspected.
  SELECT d.*
    INTO v_target
    FROM public.simhub_devices AS d
   WHERE d.id = p_target_device_id
   FOR UPDATE;

  IF NOT FOUND THEN
    RETURN 'invalid_device';
  END IF;
  IF v_target.revoked_at IS NOT NULL THEN
    RETURN 'revoked';
  END IF;
  IF v_target.endurance_event_id IS NULL OR v_target.endurance_team_id IS NULL THEN
    RETURN 'not_bound';
  END IF;
  IF v_target.device_status <> 'active_binding' THEN
    RETURN 'invalid_status';
  END IF;
  -- Practice is deliberately not a promotion source in this manual race-authority
  -- workflow. It must be explicitly reassigned to standby by an authorized flow first.
  IF v_target.device_role NOT IN ('primary', 'standby') THEN
    RETURN 'invalid_role';
  END IF;

  -- Keep promotion eligibility aligned with the existing ingest authority gate.
  SELECT EXISTS (
    SELECT 1
      FROM public.endurance_registrations AS reg
     WHERE reg.event_id = v_target.endurance_event_id
       AND reg.user_id = v_target.owner_user_id
       AND reg.status NOT IN ('rejected', 'withdrawn')
  ) INTO v_registered;
  IF NOT v_registered THEN
    RETURN 'registration_invalid';
  END IF;

  -- Serialize all handoffs for exactly this server-derived binding. Advisory locks
  -- cover the no-primary case, where a row lock alone cannot serialize contenders.
  v_lock_key := hashtextextended(
    'simhub-primary:' || v_target.endurance_event_id::TEXT || ':' || v_target.endurance_team_id::TEXT,
    0
  );
  PERFORM pg_advisory_xact_lock(v_lock_key);

  -- Re-read and lock the primary after the binding-level lock. The partial unique
  -- index remains the final database invariant against split-brain primaries.
  SELECT d.*
    INTO v_current_primary
    FROM public.simhub_devices AS d
   WHERE d.endurance_event_id = v_target.endurance_event_id
     AND d.endurance_team_id = v_target.endurance_team_id
     AND d.device_status = 'active_binding'
     AND d.device_role = 'primary'
     AND d.revoked_at IS NULL
   FOR UPDATE;

  IF v_target.device_role = 'primary' THEN
    RETURN 'already_primary';
  END IF;

  -- Demote first to satisfy the non-deferrable partial unique index. Both updates
  -- are inside this one function call/transaction: an error rolls the demotion back.
  IF FOUND AND v_current_primary.id <> v_target.id THEN
    UPDATE public.simhub_devices
       SET device_role = 'standby',
           updated_at = now()
     WHERE id = v_current_primary.id;
  END IF;

  UPDATE public.simhub_devices
     SET device_role = 'primary',
         updated_at = now()
   WHERE id = v_target.id;

  RETURN 'accepted';
END;
$$;

REVOKE ALL ON FUNCTION public.simhub_set_primary_device(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.simhub_set_primary_device(UUID) TO service_role;
