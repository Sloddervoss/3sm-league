BEGIN;

DROP TRIGGER IF EXISTS trg_endurance_guard_own_notification_update ON public.endurance_notifications;
DROP TRIGGER IF EXISTS trg_endurance_guard_own_registration_update ON public.endurance_registrations;
DROP FUNCTION IF EXISTS public.endurance_guard_own_notification_update();
DROP FUNCTION IF EXISTS public.endurance_guard_own_registration_update();

DROP POLICY IF EXISTS "endurance discoverable events" ON public.endurance_events;
DROP POLICY IF EXISTS "endurance own registration select" ON public.endurance_registrations;
DROP POLICY IF EXISTS "endurance own registration insert" ON public.endurance_registrations;
DROP POLICY IF EXISTS "endurance own registration update" ON public.endurance_registrations;
DROP POLICY IF EXISTS "endurance participant availability select" ON public.endurance_availability;
DROP POLICY IF EXISTS "endurance own availability write" ON public.endurance_availability;
DROP POLICY IF EXISTS "endurance participant pace select" ON public.endurance_pace_entries;
DROP POLICY IF EXISTS "endurance own pace write" ON public.endurance_pace_entries;
DROP POLICY IF EXISTS "endurance participant teams select" ON public.endurance_teams;
DROP POLICY IF EXISTS "endurance participant team members select" ON public.endurance_team_members;
DROP POLICY IF EXISTS "endurance participant stints select" ON public.endurance_stints;
DROP POLICY IF EXISTS "endurance participant plans select" ON public.endurance_planning_versions;
DROP POLICY IF EXISTS "endurance participant confirmations select" ON public.endurance_confirmations;
DROP POLICY IF EXISTS "endurance own confirmation update" ON public.endurance_confirmations;
DROP POLICY IF EXISTS "endurance participant practice sessions select" ON public.endurance_practice_sessions;
DROP POLICY IF EXISTS "endurance participant practice laps select" ON public.endurance_practice_laps;
DROP POLICY IF EXISTS "endurance own notifications select" ON public.endurance_notifications;
DROP POLICY IF EXISTS "endurance own notifications update" ON public.endurance_notifications;

DROP FUNCTION IF EXISTS public.endurance_is_participant(uuid, uuid);
DROP FUNCTION IF EXISTS public.endurance_can_discover_event(uuid, uuid);

-- Restore the immediately preceding alpha policies.
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
    EXECUTE format(
      'CREATE POLICY "endurance staff view" ON public.%I FOR SELECT TO authenticated USING (public.is_endurance_staff(auth.uid()))',
      table_name
    );
  END LOOP;
END;
$$;

CREATE POLICY "endurance staff own registration" ON public.endurance_registrations
  FOR ALL TO authenticated
  USING (user_id = auth.uid() AND public.is_endurance_staff(auth.uid()))
  WITH CHECK (user_id = auth.uid() AND public.is_endurance_staff(auth.uid()));
CREATE POLICY "endurance staff own availability" ON public.endurance_availability
  FOR ALL TO authenticated
  USING (user_id = auth.uid() AND public.is_endurance_staff(auth.uid()))
  WITH CHECK (user_id = auth.uid() AND public.is_endurance_staff(auth.uid()));

COMMIT;
