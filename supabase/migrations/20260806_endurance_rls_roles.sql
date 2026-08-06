-- Endurance RLS verruimen voor de alpha-rollen.
-- Additief: behoudt de bestaande super_admin-regels en voegt toe:
--   - endurance_manager: VOL beheer (FOR ALL) op alle endurance_*-tabellen
--   - tester/endurance_manager/super_admin: VIEW (FOR SELECT)
--   - own-row participatie (registratie + beschikbaarheid) voor testers
BEGIN;

DO $$
DECLARE
  t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'endurance_events',
    'endurance_registrations',
    'endurance_availability',
    'endurance_pace_entries',
    'endurance_teams',
    'endurance_team_members',
    'endurance_stints',
    'endurance_planning_versions',
    'endurance_confirmations',
    'endurance_notifications',
    'endurance_audit_log',
    'endurance_practice_sessions',
    'endurance_practice_laps'
  ] LOOP
    EXECUTE format(
      'DROP POLICY IF EXISTS "endurance manager all" ON public.%I', t);
    EXECUTE format(
      'CREATE POLICY "endurance manager all" ON public.%I
         FOR ALL
         TO authenticated
         USING (public.is_endurance_manager(auth.uid()))
         WITH CHECK (public.is_endurance_manager(auth.uid()))', t);
    EXECUTE format(
      'DROP POLICY IF EXISTS "endurance staff view" ON public.%I', t);
    EXECUTE format(
      'CREATE POLICY "endurance staff view" ON public.%I
         FOR SELECT
         TO authenticated
         USING (public.is_endurance_staff(auth.uid()))', t);
  END LOOP;
END;
$$;

-- Participatie: testers (en staff) mogen hun EIGEN registratie en beschikbaarheid wijzigen.
DROP POLICY IF EXISTS "endurance staff own registration" ON public.endurance_registrations;
CREATE POLICY "endurance staff own registration" ON public.endurance_registrations
  FOR ALL
  TO authenticated
  USING (user_id = auth.uid() AND public.is_endurance_staff(auth.uid()))
  WITH CHECK (user_id = auth.uid() AND public.is_endurance_staff(auth.uid()));

DROP POLICY IF EXISTS "endurance staff own availability" ON public.endurance_availability;
CREATE POLICY "endurance staff own availability" ON public.endurance_availability
  FOR ALL
  TO authenticated
  USING (user_id = auth.uid() AND public.is_endurance_staff(auth.uid()))
  WITH CHECK (user_id = auth.uid() AND public.is_endurance_staff(auth.uid()));

COMMIT;
