-- Complete Endurance Realtime publication for filtered event/user subscriptions.
-- Historical publication migrations remain untouched; only tables absent from
-- their declared publication set are added here.
BEGIN;

ALTER PUBLICATION supabase_realtime ADD TABLE public.endurance_registrations;
ALTER PUBLICATION supabase_realtime ADD TABLE public.endurance_pace_entries;
ALTER PUBLICATION supabase_realtime ADD TABLE public.endurance_practice_sessions;
ALTER PUBLICATION supabase_realtime ADD TABLE public.endurance_practice_laps;
ALTER PUBLICATION supabase_realtime ADD TABLE public.endurance_confirmations;
ALTER PUBLICATION supabase_realtime ADD TABLE public.endurance_race_control_audit;

-- Realtime past dezelfde RLS-grens toe als de manager-scoped audit-RPC.
-- Zonder deze SELECT-policy ontvangen toegewezen crewmanagers geen audit-events.
CREATE POLICY "endurance race control audit managers select"
  ON public.endurance_race_control_audit
  FOR SELECT TO authenticated
  USING (
    public.is_endurance_manager(auth.uid())
    OR EXISTS (
      SELECT 1 FROM public.endurance_teams AS team
      WHERE team.id = endurance_race_control_audit.team_id
        AND team.manager_id = auth.uid()
    )
  );

COMMIT;
