-- Registration parity and integrity hardening.
-- The Discord bot uses the service_role key; browser users remain constrained by RLS.

CREATE OR REPLACE FUNCTION public.discord_register_race(
  p_discord_id TEXT,
  p_race_id    UUID,
  p_action     TEXT
)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_user_id UUID;
  v_league_id UUID;
  v_car_choice TEXT;
  v_car_locked BOOLEAN := false;
BEGIN
  SELECT user_id INTO v_user_id
  FROM public.profiles
  WHERE discord_id = p_discord_id;

  IF v_user_id IS NULL THEN
    RETURN 'not_linked';
  END IF;

  IF p_action = 'register' THEN
    SELECT league_id INTO v_league_id
    FROM public.races
    WHERE id = p_race_id;

    IF NOT FOUND THEN
      RETURN 'race_not_found';
    END IF;

    -- Standalone races have no league and deliberately remain independent.
    -- A withdrawn row must never supply a car lock to a later entry.
    IF v_league_id IS NOT NULL THEN
      SELECT registration.car_choice INTO v_car_choice
      FROM public.race_registrations AS registration
      JOIN public.races AS registered_race ON registered_race.id = registration.race_id
      WHERE registration.user_id = v_user_id
        AND registration.status <> 'withdrawn'
        AND registration.car_locked = true
        AND registered_race.league_id = v_league_id
      ORDER BY registered_race.race_date ASC, registration.created_at ASC
      LIMIT 1;
      v_car_locked := FOUND;
    END IF;

    INSERT INTO public.race_registrations (race_id, user_id, status, car_choice, car_locked)
    VALUES (p_race_id, v_user_id, 'registered', v_car_choice, v_car_locked)
    ON CONFLICT (race_id, user_id) DO NOTHING;
    RETURN 'registered';
  ELSIF p_action = 'unregister' THEN
    DELETE FROM public.race_registrations
    WHERE race_id = p_race_id AND user_id = v_user_id;
    RETURN 'unregistered';
  END IF;

  RETURN 'unknown_action';
END;
$$;

-- SECURITY DEFINER must not be callable with an arbitrary Discord ID by anon or
-- authenticated browser clients. The bot's service-role client retains access.
REVOKE ALL ON FUNCTION public.discord_register_race(TEXT, UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.discord_register_race(TEXT, UUID, TEXT) TO service_role;

-- A season is closed after its first completed race in every client path, not
-- merely in the website UI. Existing status rows are retained for admins only.
DROP POLICY IF EXISTS "Users can register themselves for season" ON public.season_registrations;
CREATE POLICY "Users can register themselves for open season"
  ON public.season_registrations
  FOR INSERT
  WITH CHECK (
    auth.uid() = user_id
    AND NOT EXISTS (
      SELECT 1
      FROM public.races
      WHERE races.league_id = season_registrations.league_id
        AND races.status = 'completed'
    )
  );

DROP POLICY IF EXISTS "Users can delete own season registration" ON public.season_registrations;
CREATE POLICY "Users can delete own registration from open season"
  ON public.season_registrations
  FOR DELETE
  USING (
    auth.uid() = user_id
    AND NOT EXISTS (
      SELECT 1
      FROM public.races
      WHERE races.league_id = season_registrations.league_id
        AND races.status = 'completed'
    )
  );

-- Car choices and lock state are administrative/import decisions. Removing the
-- broad self-update policies prevents a participant from forging a lock that
-- website or Discord enrollment would inherit.
DROP POLICY IF EXISTS "Users can update own registration" ON public.race_registrations;
DROP POLICY IF EXISTS "Users can update own season registration" ON public.season_registrations;
