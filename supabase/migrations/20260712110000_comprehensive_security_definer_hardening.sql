-- Comprehensive forward-only SECURITY DEFINER hardening.
--
-- This migration follows the pending registration, role-boundary, profile-read,
-- and protest migrations. It removes default API execution, pins safe paths, and
-- makes authorization an explicit part of every browser-invocable definer RPC.

BEGIN;

-- Keep the RLS helper's intentionally narrow anonymous contract. It returns false
-- for anonymous callers and is needed by policies evaluated for anon requests.
CREATE OR REPLACE FUNCTION public.has_role(_user_id UUID, _role public.app_role)
RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, auth, pg_temp
AS $$
BEGIN
  IF _user_id IS NULL OR _role IS NULL THEN
    RETURN false;
  END IF;

  IF auth.role() = 'service_role' THEN
    RETURN EXISTS (
      SELECT 1
      FROM public.user_roles AS ur
      WHERE ur.user_id = _user_id
        AND ur.role = _role
    );
  END IF;

  IF auth.uid() IS NULL THEN
    RETURN false;
  END IF;

  IF _user_id <> auth.uid() AND NOT EXISTS (
    SELECT 1
    FROM public.user_roles AS ur
    WHERE ur.user_id = auth.uid()
      AND ur.role IN ('admin'::public.app_role, 'super_admin'::public.app_role)
  ) THEN
    RETURN false;
  END IF;

  RETURN EXISTS (
    SELECT 1
    FROM public.user_roles AS ur
    WHERE ur.user_id = _user_id
      AND ur.role = _role
  );
END;
$$;

-- This RPC is consumed by the Discord bot, never by a browser. Consume the
-- single-use code in the same statement that proves it has not expired; an error
-- updating profiles rolls the delete back with the surrounding function call.
CREATE OR REPLACE FUNCTION public.discord_link_account(p_discord_id TEXT, p_code TEXT)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, auth, pg_temp
AS $$
DECLARE
  v_user_id UUID;
BEGIN
  IF auth.role() <> 'service_role' THEN
    RAISE EXCEPTION 'Permission denied' USING ERRCODE = '42501';
  END IF;

  IF p_discord_id IS NULL OR p_discord_id !~ '^[0-9]{1,32}$' THEN
    RETURN 'invalid_discord_id';
  END IF;

  DELETE FROM public.discord_link_codes AS code
  WHERE code.code = p_code
    AND code.expires_at > now()
  RETURNING code.user_id INTO v_user_id;

  IF NOT FOUND THEN
    RETURN 'invalid_code';
  END IF;

  UPDATE public.profiles AS profile
  SET discord_id = p_discord_id
  WHERE profile.user_id = v_user_id;

  RETURN 'ok';
END;
$$;

-- Claim a bot-issued link token atomically. The token contents and Discord ID are
-- never returned to the browser; a competing claim can only receive invalid_token.
CREATE OR REPLACE FUNCTION public.discord_claim_token(p_token TEXT)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, auth, pg_temp
AS $$
DECLARE
  v_discord_id TEXT;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Permission denied' USING ERRCODE = '42501';
  END IF;

  UPDATE public.discord_link_tokens AS token
  SET used = true
  WHERE token.token = p_token
    AND token.used = false
    AND token.expires_at > now()
  RETURNING token.discord_id INTO v_discord_id;

  IF NOT FOUND THEN
    RETURN 'invalid_token';
  END IF;

  UPDATE public.profiles AS profile
  SET discord_id = v_discord_id
  WHERE profile.user_id = auth.uid();

  RETURN 'ok';
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_delete_user(target_user_id UUID)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, auth, pg_temp
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Permission denied' USING ERRCODE = '42501';
  END IF;

  IF NOT (
    public.has_role(auth.uid(), 'admin'::public.app_role)
    OR public.has_role(auth.uid(), 'super_admin'::public.app_role)
  ) THEN
    RAISE EXCEPTION 'Permission denied' USING ERRCODE = '42501';
  END IF;

  IF public.has_role(target_user_id, 'super_admin'::public.app_role) THEN
    RAISE EXCEPTION 'De super admin kan niet worden verwijderd';
  END IF;

  DELETE FROM auth.users AS user_record WHERE user_record.id = target_user_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_get_user_roles()
RETURNS TABLE(user_id UUID, role public.app_role)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, auth, pg_temp
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Permission denied' USING ERRCODE = '42501';
  END IF;

  IF NOT (
    public.has_role(auth.uid(), 'admin'::public.app_role)
    OR public.has_role(auth.uid(), 'super_admin'::public.app_role)
  ) THEN
    RAISE EXCEPTION 'Permission denied' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT ur.user_id, ur.role
  FROM public.user_roles AS ur;
END;
$$;

-- Penalty totals are personal disciplinary data. A signed-in driver may read only
-- their own total; staff retain the cross-driver view needed by steward tooling.
CREATE OR REPLACE FUNCTION public.get_driver_sp(
  p_user_id UUID,
  p_league_id UUID DEFAULT NULL
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, auth, pg_temp
AS $$
DECLARE
  v_sp INTEGER;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Permission denied' USING ERRCODE = '42501';
  END IF;

  IF p_user_id <> auth.uid() AND NOT (
    public.has_role(auth.uid(), 'admin'::public.app_role)
    OR public.has_role(auth.uid(), 'super_admin'::public.app_role)
    OR public.has_role(auth.uid(), 'moderator'::public.app_role)
  ) THEN
    RAISE EXCEPTION 'Permission denied' USING ERRCODE = '42501';
  END IF;

  SELECT COALESCE(SUM(pen.penalty_sp), 0)
    INTO v_sp
  FROM public.penalties AS pen
  JOIN public.races AS race ON race.id = pen.race_id
  WHERE pen.user_id = p_user_id
    AND pen.revoked = false
    AND pen.penalty_sp > 0
    AND (CASE WHEN p_league_id IS NULL THEN race.league_id IS NULL ELSE race.league_id = p_league_id END)
    AND race.id IN (
      SELECT result.race_id
      FROM public.race_results AS result
      JOIN public.races AS result_race ON result_race.id = result.race_id
      WHERE result.user_id = p_user_id
        AND (CASE WHEN p_league_id IS NULL THEN result_race.league_id IS NULL ELSE result_race.league_id = p_league_id END)
      ORDER BY result_race.race_date DESC
      LIMIT 6
    );

  RETURN COALESCE(v_sp, 0);
END;
$$;

-- Queue writers are trigger-only. The helper is intentionally not an RPC surface.
CREATE OR REPLACE FUNCTION public.enqueue_discord_sync(target_user_id UUID, sync_reason TEXT DEFAULT 'manual')
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
BEGIN
  IF target_user_id IS NULL THEN
    RETURN;
  END IF;

  UPDATE public.discord_sync_queue AS queue
  SET reason = CASE
      WHEN position(sync_reason IN queue.reason) > 0 THEN queue.reason
      ELSE left(queue.reason || ',' || sync_reason, 200)
    END,
    last_error = NULL
  WHERE queue.user_id = target_user_id
    AND queue.processed_at IS NULL;

  IF NOT FOUND THEN
    INSERT INTO public.discord_sync_queue (user_id, reason)
    VALUES (target_user_id, COALESCE(NULLIF(sync_reason, ''), 'manual'));
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.enqueue_discord_sync_from_profile()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.discord_id IS DISTINCT FROM OLD.discord_id THEN
    PERFORM public.enqueue_discord_sync(NEW.user_id, 'discord_link_changed');
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.enqueue_discord_sync_from_membership()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    PERFORM public.enqueue_discord_sync(OLD.user_id, 'team_membership_deleted');
    RETURN OLD;
  END IF;
  PERFORM public.enqueue_discord_sync(NEW.user_id, 'team_membership_changed');
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.enqueue_discord_sync_from_user_role()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    PERFORM public.enqueue_discord_sync(OLD.user_id, 'user_role_deleted');
    RETURN OLD;
  END IF;
  PERFORM public.enqueue_discord_sync(NEW.user_id, 'user_role_changed');
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
BEGIN
  INSERT INTO public.profiles (user_id, display_name)
  VALUES (NEW.id, COALESCE(NEW.raw_user_meta_data->>'display_name', NEW.email));
  RETURN NEW;
END;
$$;

-- Keep browser steward/admin recalculation while using the JWT role rather than
-- current_role (which is the definer owner inside a SECURITY DEFINER function).
CREATE OR REPLACE FUNCTION public.recalculate_3sr_for_race(p_race_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, auth, pg_temp
AS $$
DECLARE
  v_eligible boolean;
  v_finisher_count int;
  v_uid uuid;
  v_affected_users uuid[];
  v_score numeric(6,2);
  v_race_count int;
BEGIN
  IF NOT (
    auth.role() = 'service_role'
    OR (
      auth.uid() IS NOT NULL AND (
        public.has_role(auth.uid(), 'admin'::public.app_role)
        OR public.has_role(auth.uid(), 'super_admin'::public.app_role)
        OR public.has_role(auth.uid(), 'moderator'::public.app_role)
      )
    )
  ) THEN
    RAISE EXCEPTION 'Not allowed to recalculate 3SR' USING ERRCODE = '42501';
  END IF;

  SELECT race.counts_for_3sr INTO v_eligible FROM public.races AS race WHERE race.id = p_race_id;
  IF v_eligible IS NULL OR v_eligible = false THEN
    DELETE FROM public.race_3sr_results AS result WHERE result.race_id = p_race_id;
    RETURN;
  END IF;

  SELECT COUNT(*) INTO v_finisher_count
  FROM public.race_results AS result
  WHERE result.race_id = p_race_id AND (result.dnf IS NULL OR result.dnf = false);
  IF v_finisher_count < 5 THEN
    DELETE FROM public.race_3sr_results AS result WHERE result.race_id = p_race_id;
    RETURN;
  END IF;

  SELECT ARRAY_AGG(result.user_id) INTO v_affected_users
  FROM public.race_results AS result WHERE result.race_id = p_race_id;

  WITH starters AS (
    SELECT rr.user_id, rr.position, COALESCE(rr.dnf, false) AS dnf,
      COALESCE(rr.irating_snapshot, profile.irating) AS irating_val,
      COUNT(*) FILTER (WHERE NOT COALESCE(rr.dnf, false)) OVER (PARTITION BY rr.race_id) AS finisher_count
    FROM public.race_results AS rr
    LEFT JOIN public.profiles AS profile ON profile.user_id = rr.user_id
    WHERE rr.race_id = p_race_id
  ), ranked AS (
    SELECT starter.*, RANK() OVER (ORDER BY COALESCE(starter.irating_val, 0) DESC NULLS LAST) AS irating_rank,
      CASE WHEN starter.dnf THEN starter.finisher_count + 1 ELSE starter.position END AS effective_position
    FROM starters AS starter
  ), scored AS (
    SELECT ranked.*, ranked.irating_rank AS expected_position,
      ranked.irating_rank - ranked.effective_position AS delta,
      GREATEST(0::numeric, ROUND(100.0 * (1.0 - (ranked.effective_position - 1.0) / NULLIF(GREATEST(ranked.finisher_count - 1, 9), 0)), 2)) AS position_score,
      CASE WHEN ranked.irating_val IS NULL THEN 0::numeric ELSE GREATEST(-20::numeric, LEAST(20::numeric, ROUND((ranked.irating_rank - ranked.effective_position) * 2.0, 2))) END AS performance_bonus,
      COALESCE(penalty.points_deduction, 0) AS penalty_deduction
    FROM ranked
    LEFT JOIN public.penalties AS penalty ON penalty.race_id = p_race_id AND penalty.user_id = ranked.user_id
  )
  INSERT INTO public.race_3sr_results (
    race_id, user_id, position, effective_position, finishers, dnf, irating_snapshot,
    irating_rank, expected_position, delta, position_score, performance_bonus,
    penalty_deduction, race_score, calculated_at
  )
  SELECT p_race_id, score.user_id, score.position, score.effective_position, score.finisher_count,
    score.dnf, score.irating_val, score.irating_rank, score.expected_position, score.delta,
    score.position_score, score.performance_bonus, score.penalty_deduction,
    CASE WHEN score.dnf THEN 0::numeric ELSE GREATEST(0::numeric, score.position_score + score.performance_bonus - score.penalty_deduction) END,
    now()
  FROM scored AS score
  ON CONFLICT (race_id, user_id) DO UPDATE SET
    position = EXCLUDED.position, effective_position = EXCLUDED.effective_position,
    finishers = EXCLUDED.finishers, dnf = EXCLUDED.dnf, irating_snapshot = EXCLUDED.irating_snapshot,
    irating_rank = EXCLUDED.irating_rank, expected_position = EXCLUDED.expected_position,
    delta = EXCLUDED.delta, position_score = EXCLUDED.position_score,
    performance_bonus = EXCLUDED.performance_bonus, penalty_deduction = EXCLUDED.penalty_deduction,
    race_score = EXCLUDED.race_score, calculated_at = EXCLUDED.calculated_at;

  FOREACH v_uid IN ARRAY v_affected_users LOOP
    SELECT COALESCE((
      SELECT SUM(best.race_score) FROM (
        SELECT previous.race_score FROM public.race_3sr_results AS previous
        WHERE previous.user_id = v_uid ORDER BY previous.race_score DESC LIMIT 8
      ) AS best
    ), 0), (SELECT COUNT(*)::int FROM public.race_3sr_results AS previous WHERE previous.user_id = v_uid)
    INTO v_score, v_race_count;

    INSERT INTO public.driver_3sr (user_id, current_score, ranked_races, is_ranked, rank_label, last_updated)
    VALUES (v_uid, v_score, v_race_count, v_race_count >= 5, public._3sr_rank_label(v_score, v_race_count), now())
    ON CONFLICT (user_id) DO UPDATE SET
      current_score = EXCLUDED.current_score, ranked_races = EXCLUDED.ranked_races,
      is_ranked = EXCLUDED.is_ranked, rank_label = EXCLUDED.rank_label,
      last_updated = EXCLUDED.last_updated;
  END LOOP;
END;
$$;

CREATE OR REPLACE FUNCTION public.recalculate_3sr_all()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, auth, pg_temp
AS $$
DECLARE
  v_race_id uuid;
BEGIN
  IF NOT (
    auth.role() = 'service_role'
    OR (
      auth.uid() IS NOT NULL AND (
        public.has_role(auth.uid(), 'admin'::public.app_role)
        OR public.has_role(auth.uid(), 'super_admin'::public.app_role)
        OR public.has_role(auth.uid(), 'moderator'::public.app_role)
      )
    )
  ) THEN
    RAISE EXCEPTION 'Not allowed to recalculate 3SR' USING ERRCODE = '42501';
  END IF;

  FOR v_race_id IN
    SELECT race.id FROM public.races AS race WHERE race.counts_for_3sr = true ORDER BY race.race_date ASC
  LOOP
    PERFORM public.recalculate_3sr_for_race(v_race_id);
  END LOOP;
END;
$$;

-- Existing pending migrations deliberately expose these authenticated staff APIs;
-- make their final configurations safe as well.
ALTER FUNCTION public.admin_get_all_profiles() SET search_path = pg_catalog, public, auth, pg_temp;
ALTER FUNCTION public.admin_grant_role(uuid, text) SET search_path = pg_catalog, public, auth, pg_temp;
ALTER FUNCTION public.admin_revoke_role(uuid, text) SET search_path = pg_catalog, public, auth, pg_temp;
ALTER FUNCTION public.discord_register_race(text, uuid, text) SET search_path = pg_catalog, public, auth, pg_temp;
ALTER FUNCTION public.enforce_race_registration_write() SET search_path = pg_catalog, public, auth, pg_temp;
ALTER FUNCTION public.get_my_visible_protests() SET search_path = pg_catalog, public, auth, pg_temp;

-- Explicit ACLs: no default PUBLIC execution. Only has_role retains anon execution
-- for RLS evaluation; all human-facing RPCs require authenticated and have guards.
REVOKE ALL ON FUNCTION public.has_role(uuid, public.app_role) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.has_role(uuid, public.app_role) FROM anon;
GRANT EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) TO anon, authenticated, service_role;

REVOKE ALL ON FUNCTION public.discord_link_account(text, text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.discord_link_account(text, text) TO service_role;
REVOKE ALL ON FUNCTION public.discord_register_race(text, uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.discord_register_race(text, uuid, text) FROM service_role;
GRANT EXECUTE ON FUNCTION public.discord_register_race(text, uuid, text) TO service_role;

REVOKE ALL ON FUNCTION public.discord_claim_token(text) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.discord_claim_token(text) TO authenticated;
REVOKE ALL ON FUNCTION public.get_driver_sp(uuid, uuid) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.get_driver_sp(uuid, uuid) TO authenticated;

REVOKE ALL ON FUNCTION public.admin_get_all_profiles() FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.admin_get_all_profiles() TO authenticated;
REVOKE ALL ON FUNCTION public.admin_get_user_roles() FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.admin_get_user_roles() TO authenticated;
REVOKE ALL ON FUNCTION public.admin_delete_user(uuid) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.admin_delete_user(uuid) TO authenticated;
REVOKE ALL ON FUNCTION public.admin_grant_role(uuid, text) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.admin_grant_role(uuid, text) TO authenticated;
REVOKE ALL ON FUNCTION public.admin_revoke_role(uuid, text) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.admin_revoke_role(uuid, text) TO authenticated;

REVOKE ALL ON FUNCTION public.recalculate_3sr_for_race(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.recalculate_3sr_for_race(uuid) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.recalculate_3sr_all() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.recalculate_3sr_all() TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.get_my_visible_protests() FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.get_my_visible_protests() TO authenticated;

-- Trigger-only functions have no API execute grants. Trigger invocation continues
-- under the owning table/function context and does not depend on browser grants.
REVOKE ALL ON FUNCTION public.enqueue_discord_sync(uuid, text) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.enqueue_discord_sync_from_profile() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.enqueue_discord_sync_from_membership() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.enqueue_discord_sync_from_user_role() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.enforce_race_registration_write() FROM PUBLIC, anon, authenticated, service_role;

COMMIT;
