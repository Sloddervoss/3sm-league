BEGIN;

-- Registration stays open while a season is upcoming or active. The previous
-- policy closed the entire season after its first completed race, while the
-- calendar intentionally keeps offering season registration for active seasons.
DROP POLICY IF EXISTS "Users can register themselves for open season" ON public.season_registrations;
CREATE POLICY "Users can register themselves for open season"
  ON public.season_registrations
  FOR INSERT
  TO authenticated
  WITH CHECK (
    auth.uid() = user_id
    AND EXISTS (
      SELECT 1
      FROM public.leagues
      WHERE leagues.id = season_registrations.league_id
        AND leagues.status IN ('upcoming', 'active')
    )
  );

DROP POLICY IF EXISTS "Users can delete own registration from open season" ON public.season_registrations;
CREATE POLICY "Users can delete own registration from open season"
  ON public.season_registrations
  FOR DELETE
  TO authenticated
  USING (
    auth.uid() = user_id
    AND EXISTS (
      SELECT 1
      FROM public.leagues
      WHERE leagues.id = season_registrations.league_id
        AND leagues.status IN ('upcoming', 'active')
    )
  );

COMMIT;
