-- Bot (anon key) mag discord_role_id updaten op teams
CREATE POLICY "Anon can update discord_role_id on teams"
  ON public.teams FOR UPDATE
  USING (true)
  WITH CHECK (true);
