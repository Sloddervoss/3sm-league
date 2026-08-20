-- Endurance participant access hardening.
-- Discovery (open/invited) is separate from private participant data.
BEGIN;

CREATE OR REPLACE FUNCTION public.endurance_can_discover_event(
  p_event_id uuid,
  p_user_id uuid DEFAULT auth.uid()
)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, auth, pg_temp
AS $$
BEGIN
  IF p_user_id IS NULL THEN RETURN false; END IF;
  IF p_user_id <> auth.uid() AND NOT public.is_endurance_manager(auth.uid()) THEN
    RETURN false;
  END IF;
  IF public.is_endurance_manager(p_user_id) THEN RETURN true; END IF;

  RETURN EXISTS (
    SELECT 1
    FROM public.endurance_events event
    WHERE event.id = p_event_id
      AND (
        event.visibility = 'open'::public.endurance_event_visibility
        OR p_user_id = ANY(COALESCE(event.invited_user_ids, ARRAY[]::uuid[]))
        OR p_user_id = ANY(COALESCE(event.manager_ids, ARRAY[]::uuid[]))
        OR EXISTS (
          SELECT 1 FROM public.endurance_registrations registration
          WHERE registration.event_id = event.id
            AND registration.user_id = p_user_id
            AND registration.status NOT IN ('rejected', 'withdrawn')
        )
      )
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.endurance_is_participant(
  p_event_id uuid,
  p_user_id uuid DEFAULT auth.uid()
)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, auth, pg_temp
AS $$
BEGIN
  IF p_user_id IS NULL THEN RETURN false; END IF;
  IF p_user_id <> auth.uid() AND NOT public.is_endurance_manager(auth.uid()) THEN
    RETURN false;
  END IF;
  IF public.is_endurance_manager(p_user_id) THEN RETURN true; END IF;

  RETURN EXISTS (
    SELECT 1 FROM public.endurance_registrations registration
    WHERE registration.event_id = p_event_id
      AND registration.user_id = p_user_id
      AND registration.status IN ('interest', 'provisional', 'confirmed', 'reserve')
  );
END;
$$;

REVOKE ALL ON FUNCTION public.endurance_can_discover_event(uuid, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.endurance_is_participant(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.endurance_can_discover_event(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.endurance_is_participant(uuid, uuid) TO authenticated;

-- Remove the alpha-wide tester read access and broad own-row policies.
DO $$
DECLARE table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'endurance_events','endurance_registrations','endurance_availability',
    'endurance_pace_entries','endurance_teams','endurance_team_members',
    'endurance_stints','endurance_planning_versions','endurance_confirmations',
    'endurance_notifications','endurance_audit_log','endurance_practice_sessions',
    'endurance_practice_laps'
  ] LOOP
    EXECUTE format('DROP POLICY IF EXISTS "endurance staff view" ON public.%I', table_name);
  END LOOP;
END;
$$;
DROP POLICY IF EXISTS "endurance staff own registration" ON public.endurance_registrations;
DROP POLICY IF EXISTS "endurance staff own availability" ON public.endurance_availability;

-- Event discovery.
CREATE POLICY "endurance discoverable events" ON public.endurance_events
  FOR SELECT TO authenticated
  USING (public.endurance_can_discover_event(id, auth.uid()));

-- Registration answers remain private to their owner and managers.
CREATE POLICY "endurance own registration select" ON public.endurance_registrations
  FOR SELECT TO authenticated USING (user_id = auth.uid());
CREATE POLICY "endurance own registration insert" ON public.endurance_registrations
  FOR INSERT TO authenticated
  WITH CHECK (
    user_id = auth.uid()
    AND public.endurance_can_discover_event(event_id, auth.uid())
    AND status IN ('interest', 'provisional', 'reserve')
  );
CREATE POLICY "endurance own registration update" ON public.endurance_registrations
  FOR UPDATE TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid() AND public.endurance_can_discover_event(event_id, auth.uid()));

CREATE OR REPLACE FUNCTION public.endurance_guard_own_registration_update()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, auth, pg_temp
AS $$
BEGIN
  IF public.is_endurance_manager(auth.uid()) THEN RETURN NEW; END IF;
  IF auth.uid() IS NULL OR OLD.user_id <> auth.uid() OR NEW.user_id <> auth.uid() THEN
    RAISE EXCEPTION 'Permission denied' USING ERRCODE = '42501';
  END IF;
  IF NEW.id <> OLD.id OR NEW.event_id <> OLD.event_id OR NEW.registered_at <> OLD.registered_at THEN
    RAISE EXCEPTION 'Registration identity fields are immutable' USING ERRCODE = '42501';
  END IF;
  IF NEW.status IS DISTINCT FROM OLD.status AND NOT (
    (OLD.status IN ('interest', 'provisional', 'reserve') AND NEW.status IN ('interest', 'provisional', 'reserve', 'withdrawn'))
    OR (OLD.status = 'confirmed' AND NEW.status = 'withdrawn')
  ) THEN
    RAISE EXCEPTION 'Registration status transition is manager-only' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_endurance_guard_own_registration_update ON public.endurance_registrations;
CREATE TRIGGER trg_endurance_guard_own_registration_update
  BEFORE UPDATE ON public.endurance_registrations
  FOR EACH ROW EXECUTE FUNCTION public.endurance_guard_own_registration_update();

-- Private participant reads; own availability/pace writes.
CREATE POLICY "endurance participant availability select" ON public.endurance_availability
  FOR SELECT TO authenticated USING (public.endurance_is_participant(event_id, auth.uid()));
CREATE POLICY "endurance own availability write" ON public.endurance_availability
  FOR ALL TO authenticated
  USING (user_id = auth.uid() AND public.endurance_is_participant(event_id, auth.uid()))
  WITH CHECK (user_id = auth.uid() AND public.endurance_is_participant(event_id, auth.uid()));

CREATE POLICY "endurance participant pace select" ON public.endurance_pace_entries
  FOR SELECT TO authenticated USING (public.endurance_is_participant(event_id, auth.uid()));
CREATE POLICY "endurance own pace write" ON public.endurance_pace_entries
  FOR ALL TO authenticated
  USING (user_id = auth.uid() AND public.endurance_is_participant(event_id, auth.uid()))
  WITH CHECK (user_id = auth.uid() AND public.endurance_is_participant(event_id, auth.uid()));

CREATE POLICY "endurance participant teams select" ON public.endurance_teams
  FOR SELECT TO authenticated USING (public.endurance_is_participant(event_id, auth.uid()));
CREATE POLICY "endurance participant team members select" ON public.endurance_team_members
  FOR SELECT TO authenticated USING (
    EXISTS (SELECT 1 FROM public.endurance_teams team WHERE team.id = endurance_team_members.team_id AND public.endurance_is_participant(team.event_id, auth.uid()))
  );
CREATE POLICY "endurance participant stints select" ON public.endurance_stints
  FOR SELECT TO authenticated USING (public.endurance_is_participant(event_id, auth.uid()));
CREATE POLICY "endurance participant plans select" ON public.endurance_planning_versions
  FOR SELECT TO authenticated USING (public.endurance_is_participant(event_id, auth.uid()));
CREATE POLICY "endurance participant confirmations select" ON public.endurance_confirmations
  FOR SELECT TO authenticated USING (
    user_id = auth.uid() OR EXISTS (
      SELECT 1 FROM public.endurance_planning_versions version
      WHERE version.id = version_id AND public.endurance_is_participant(version.event_id, auth.uid())
    )
  );
CREATE POLICY "endurance own confirmation update" ON public.endurance_confirmations
  FOR UPDATE TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
CREATE POLICY "endurance participant practice sessions select" ON public.endurance_practice_sessions
  FOR SELECT TO authenticated USING (public.endurance_is_participant(event_id, auth.uid()));
CREATE POLICY "endurance participant practice laps select" ON public.endurance_practice_laps
  FOR SELECT TO authenticated USING (public.endurance_is_participant(event_id, auth.uid()));

-- Notifications are strictly private; managers retain their existing management policy.
CREATE POLICY "endurance own notifications select" ON public.endurance_notifications
  FOR SELECT TO authenticated USING (user_id = auth.uid());
CREATE POLICY "endurance own notifications update" ON public.endurance_notifications
  FOR UPDATE TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

CREATE OR REPLACE FUNCTION public.endurance_guard_own_notification_update()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, auth, pg_temp
AS $$
BEGIN
  IF public.is_endurance_manager(auth.uid()) THEN RETURN NEW; END IF;
  IF auth.uid() IS NULL OR OLD.user_id <> auth.uid() OR NEW.user_id <> auth.uid() THEN
    RAISE EXCEPTION 'Permission denied' USING ERRCODE = '42501';
  END IF;
  IF (to_jsonb(NEW) - 'read') IS DISTINCT FROM (to_jsonb(OLD) - 'read') THEN
    RAISE EXCEPTION 'Only notification read state may be changed' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_endurance_guard_own_notification_update ON public.endurance_notifications;
CREATE TRIGGER trg_endurance_guard_own_notification_update
  BEFORE UPDATE ON public.endurance_notifications
  FOR EACH ROW EXECUTE FUNCTION public.endurance_guard_own_notification_update();

COMMIT;
