-- Endurance Race Control — optimistic concurrency + append-only audit (additive, Fase 3B).
-- ----------------------------------------------------------------------------
-- 1) Nieuwe SECURITY DEFINER RPC `endurance_race_control_apply` die een stip
--    server-side with een relatieve delta (delay in minuten óf repair in
--    seconden, semantisch onderscheiden) verschuift. De bestaande
--    `endurance_apply_stint_updates` / `endurance_replace_draft_stints`
--    signatures blijven onaangeraakt voor oude clients (backend-first).
-- 2) Optistiche concurrency: de client stuurt `expected_updated_at`; past de
--    rij inmiddels, weigert de RPC hard met SQLSTATE 40001 + expliciete
--    stalemessage. No silent retry/overwrite.
-- 3) Iedere schrijft append uitsluitend een immutable before/after audit rij
--    in `endurance_race_control_audit` (geen direct client write; managers
--    lezen via de SECURITY DEFINER `endurance_list_race_control_audit` RPC).
-- Additief: geen bestaande tabellen/policies/RPC-signatures gewijzigd.
BEGIN;

-- =========================================================================
-- (1) capture op enum + append-only audit-tabel
-- =========================================================================
CREATE TYPE public.endurance_race_control_op AS ENUM ('delay', 'repair', 'complete', 'replace_driver');

CREATE TABLE public.endurance_race_control_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Bewust zonder cascade-FK's: auditgeschiedenis overleeft latere cleanup.
  -- De schrijf-RPC valideert event/team/stint onder locks.
  event_id uuid NOT NULL,
  team_id uuid NOT NULL,
  stint_id uuid NOT NULL,
  actor_id uuid NOT NULL,
  operation public.endurance_race_control_op NOT NULL,
  delta_minutes integer,
  repair_seconds integer,
  replacement_driver_id uuid,
  effective_at timestamptz,
  expected_updated_at timestamptz,
  before_actual_start_at timestamptz,
  before_actual_end_at timestamptz,
  after_actual_start_at timestamptz,
  after_actual_end_at timestamptz,
  before_status public.endurance_stint_status NOT NULL,
  after_status public.endurance_stint_status NOT NULL,
  before_driver_id uuid,
  after_driver_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT endurance_race_control_audit_op_delta CHECK (
    (operation = 'delay'::public.endurance_race_control_op AND delta_minutes IS NOT NULL AND delta_minutes <> 0 AND repair_seconds IS NULL AND replacement_driver_id IS NULL AND effective_at IS NOT NULL)
    OR (operation = 'repair'::public.endurance_race_control_op AND repair_seconds IS NOT NULL AND repair_seconds > 0 AND delta_minutes IS NULL AND replacement_driver_id IS NULL AND effective_at IS NOT NULL)
    OR (operation = 'complete'::public.endurance_race_control_op AND effective_at IS NOT NULL AND delta_minutes IS NULL AND repair_seconds IS NULL AND replacement_driver_id IS NULL)
    OR (operation = 'replace_driver'::public.endurance_race_control_op AND replacement_driver_id IS NOT NULL AND delta_minutes IS NULL AND repair_seconds IS NULL AND effective_at IS NULL)
  )
);

CREATE INDEX endurance_race_control_audit_event_time_idx
  ON public.endurance_race_control_audit (event_id, created_at DESC);

-- Append-only: uitsluitend SELECT voor super_admin via RLS; geen direct
-- INSERT/UPDATE/DELETE policy ⇒ clients kunnen nooit muteren. Writes gangen
-- alleen via de SECURITY DEFINER RPC (owner-recht), managers lezen via RPC.
ALTER TABLE public.endurance_race_control_audit ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.endurance_race_control_audit FROM PUBLIC, anon;

CREATE POLICY "endurance race control audit super select"
  ON public.endurance_race_control_audit
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'super_admin'));

-- Basis-SELECT-recht voor authenticated (nodig voor de policy), maar de policy
-- filtert hard op super_admin; INSERT/UPDATE/DELETE blijven grantless en
-- onmogelijk voor elke clientrol. Manager-lezen loopt via de RPC.
GRANT SELECT ON public.endurance_race_control_audit TO authenticated;

-- =============================================================================
-- (2) optimistic, server-side delta RPC (+ before/after audit in same xact)
-- =============================================================================
CREATE OR REPLACE FUNCTION public.endurance_race_control_apply(
  p_event_id uuid,
  p_team_id uuid,
  p_stint_id uuid,
  p_operation public.endurance_race_control_op,
  p_delta_minutes integer,
  p_repair_seconds integer,
  p_replacement_driver_id uuid,
  p_effective_at timestamptz,
  p_expected_updated_at timestamptz
) RETURNS public.endurance_stints
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, auth, pg_temp
AS $$
DECLARE
  v_user uuid := auth.uid();
  v_team public.endurance_teams%ROWTYPE;
  v_stint public.endurance_stints%ROWTYPE;
  v_shift interval;
  v_start timestamptz;
  v_end timestamptz;
  v_new_start timestamptz;
  v_new_end timestamptz;
  v_result public.endurance_stints;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501';
  END IF;

  -- Serialiseer alle Race Control-writes voor hetzelfde event/team zodat twee
  -- gelijktijdige correcties niet interleaven.
  PERFORM pg_advisory_xact_lock(hashtextextended(p_event_id::text || ':' || p_team_id::text, 0));

  SELECT * INTO v_team
  FROM public.endurance_teams
  WHERE id = p_team_id AND event_id = p_event_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Unknown event/team combination' USING ERRCODE = '22023';
  END IF;

  -- Globale Endurance Managers én de toegewezen manager van deze crew mogen
  -- correcteren. Server-side autorisatie; UI-gates zijn presentatie-only.
  IF NOT public.is_endurance_manager(v_user) AND v_team.manager_id IS DISTINCT FROM v_user THEN
    RAISE EXCEPTION 'Permission denied' USING ERRCODE = '42501';
  END IF;

  -- Semantisch distincte operaties: delay is een signed minutencorrectie
  -- (negatief = eerder), repair is een positieve correctie in seconden.
  IF p_operation = 'delay'::public.endurance_race_control_op THEN
    IF p_delta_minutes IS NULL OR p_delta_minutes = 0 OR p_effective_at IS NULL
       OR p_repair_seconds IS NOT NULL OR p_replacement_driver_id IS NOT NULL THEN
      RAISE EXCEPTION 'delay requires delta_minutes and effective_at' USING ERRCODE = '22023';
    END IF;
    v_shift := make_interval(mins => p_delta_minutes);
  ELSIF p_operation = 'repair'::public.endurance_race_control_op THEN
    IF p_repair_seconds IS NULL OR p_repair_seconds <= 0 OR p_effective_at IS NULL
       OR p_delta_minutes IS NOT NULL OR p_replacement_driver_id IS NOT NULL THEN
      RAISE EXCEPTION 'repair requires repair_seconds and effective_at' USING ERRCODE = '22023';
    END IF;
    v_shift := make_interval(secs => p_repair_seconds);
  ELSIF p_operation = 'complete'::public.endurance_race_control_op THEN
    IF p_effective_at IS NULL OR p_delta_minutes IS NOT NULL OR p_repair_seconds IS NOT NULL OR p_replacement_driver_id IS NOT NULL THEN
      RAISE EXCEPTION 'complete requires effective_at' USING ERRCODE = '22023';
    END IF;
  ELSIF p_operation = 'replace_driver'::public.endurance_race_control_op THEN
    IF p_delta_minutes IS NOT NULL OR p_repair_seconds IS NOT NULL OR p_effective_at IS NOT NULL
       OR p_replacement_driver_id IS NULL OR NOT EXISTS (
      SELECT 1 FROM public.endurance_team_members AS member
      WHERE member.team_id = p_team_id AND member.user_id = p_replacement_driver_id
    ) THEN
      RAISE EXCEPTION 'replacement driver must belong to this team' USING ERRCODE = '22023';
    END IF;
  ELSE
    RAISE EXCEPTION 'Invalid operation' USING ERRCODE = '22023';
  END IF;

  -- Rij-lock vóór versiecheck: hieldt een concurrent write af buiten onze
  -- transactie, zodat expected-versie + before-snapshot gefuls is.
  SELECT * INTO v_stint
  FROM public.endurance_stints
  WHERE id = p_stint_id AND event_id = p_event_id AND team_id = p_team_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Unknown stint for event/team' USING ERRCODE = '22023';
  END IF;
  IF v_stint.status IN ('completed', 'replaced', 'expired') THEN
    RAISE EXCEPTION 'Terminal stint cannot be changed by Race Control' USING ERRCODE = '22023';
  END IF;

  -- Optistiche conversie: weigert een stale write expliciet (SQLSTATE 40001).
  -- Geen automatic retry: de client hoedt de conflict en past opnieuw aan.
  IF p_expected_updated_at IS NULL OR v_stint.updated_at IS DISTINCT FROM p_expected_updated_at THEN
    RAISE EXCEPTION '%',
      format('%s Stale Race Control update: stint %s changed since loaded (expected updated_at %s, current %s). Reload before retrying.',
        'SQLSTATE 40001', p_stint_id, COALESCE(p_expected_updated_at::text, 'NULL'), v_stint.updated_at::text)
      USING ERRCODE = '40001';
  END IF;

  v_start := COALESCE(v_stint.actual_start_at, v_stint.original_start_at);
  v_end := COALESCE(v_stint.actual_end_at, v_stint.original_end_at);

  IF p_operation = 'delay'::public.endurance_race_control_op THEN
    -- Actief/verlopen: alleen het einde; toekomstig: start en einde verschuiven.
    IF v_start <= p_effective_at THEN
      v_new_start := v_start;
      v_new_end := v_end + v_shift;
    ELSE
      v_new_start := v_start + v_shift;
      v_new_end := v_end + v_shift;
    END IF;
  ELSIF p_operation = 'repair'::public.endurance_race_control_op THEN
    -- Repairtijd verlengt uitsluitend de eindtijd; nooit de starttijd.
    IF p_effective_at < v_start OR p_effective_at >= v_end OR v_stint.status IN ('completed', 'replaced', 'expired') THEN
      RAISE EXCEPTION 'repair requires an active non-terminal stint' USING ERRCODE = '22023';
    END IF;
    v_new_start := v_start;
    v_new_end := v_end + v_shift;
  ELSIF p_operation = 'complete'::public.endurance_race_control_op THEN
    v_new_start := v_start;
    v_new_end := p_effective_at;
  ELSE
    v_new_start := v_start;
    v_new_end := v_end;
  END IF;

  IF v_new_end <= v_new_start THEN
    RAISE EXCEPTION 'Shift would produce a non-positive stint duration' USING ERRCODE = '22023';
  END IF;

  UPDATE public.endurance_stints
  SET actual_start_at = v_new_start,
      actual_end_at = v_new_end,
      driver_id = CASE WHEN p_operation = 'replace_driver'::public.endurance_race_control_op THEN p_replacement_driver_id ELSE v_stint.driver_id END,
      status = CASE
        WHEN p_operation = 'complete'::public.endurance_race_control_op THEN 'completed'::public.endurance_stint_status
        WHEN p_operation = 'replace_driver'::public.endurance_race_control_op THEN 'replaced'::public.endurance_stint_status
        ELSE v_stint.status
      END,
      updated_at = now()
  WHERE id = p_stint_id
  RETURNING * INTO v_result;

  INSERT INTO public.endurance_race_control_audit (
    event_id, team_id, stint_id, actor_id, operation,
    delta_minutes, repair_seconds, replacement_driver_id, effective_at, expected_updated_at,
    before_actual_start_at, before_actual_end_at,
    after_actual_start_at, after_actual_end_at,
    before_status, after_status, before_driver_id, after_driver_id
  ) VALUES (
    p_event_id, p_team_id, p_stint_id, v_user, p_operation,
    p_delta_minutes, p_repair_seconds, p_replacement_driver_id, p_effective_at, p_expected_updated_at,
    v_stint.actual_start_at, v_stint.actual_end_at,
    v_result.actual_start_at, v_result.actual_end_at,
    v_stint.status, v_result.status, v_stint.driver_id, v_result.driver_id
  );

  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.endurance_race_control_apply(uuid, uuid, uuid, public.endurance_race_control_op, integer, integer, uuid, timestamptz, timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.endurance_race_control_apply(uuid, uuid, uuid, public.endurance_race_control_op, integer, integer, uuid, timestamptz, timestamptz) TO authenticated;

-- =============================================================================
-- (3) append-only auditleez via SECURITY DEFINER (manager-scoped)
-- =============================================================================
CREATE OR REPLACE FUNCTION public.endurance_list_race_control_audit(p_event_id uuid)
RETURNS SETOF public.endurance_race_control_audit
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, auth, pg_temp
AS $$
DECLARE
  v_user uuid := auth.uid();
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501';
  END IF;
  IF public.has_role(v_user, 'super_admin') OR public.is_endurance_manager(v_user) THEN
    RETURN QUERY
    SELECT a.* FROM public.endurance_race_control_audit AS a
    WHERE a.event_id = p_event_id
    ORDER BY a.created_at DESC;
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.endurance_teams AS team
    WHERE team.event_id = p_event_id AND team.manager_id = v_user
  ) THEN
    RETURN QUERY
    SELECT a.* FROM public.endurance_race_control_audit AS a
    WHERE a.event_id = p_event_id
      AND EXISTS (
        SELECT 1 FROM public.endurance_teams AS team
        WHERE team.id = a.team_id AND team.manager_id = v_user
      )
    ORDER BY a.created_at DESC;
  END IF;
  RAISE EXCEPTION 'Permission denied' USING ERRCODE = '42501';
END;
$$;

REVOKE ALL ON FUNCTION public.endurance_list_race_control_audit(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.endurance_list_race_control_audit(uuid) TO authenticated;

COMMIT;