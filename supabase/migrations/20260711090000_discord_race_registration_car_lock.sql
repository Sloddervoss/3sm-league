-- Race-by-race entrants inherit an existing per-league car lock when they
-- register through Discord. Full-season registration remains a separate flow.
CREATE OR REPLACE FUNCTION public.discord_register_race(
  p_discord_id TEXT,
  p_race_id    UUID,
  p_action     TEXT
)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
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
    IF v_league_id IS NOT NULL THEN
      SELECT registration.car_choice INTO v_car_choice
      FROM public.race_registrations AS registration
      JOIN public.races AS registered_race ON registered_race.id = registration.race_id
      WHERE registration.user_id = v_user_id
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

-- Result import and the explicitly admin-only exception manager need the same
-- least-privilege write access for both registration sources. Regular users
-- retain only their existing own-registration policy.
DROP POLICY IF EXISTS "Admins can update season registrations" ON public.season_registrations;
CREATE POLICY "Admins can update season registrations"
  ON public.season_registrations
  FOR UPDATE
  USING (
    public.has_role((SELECT auth.uid()), 'admin')
    OR public.has_role((SELECT auth.uid()), 'super_admin')
  )
  WITH CHECK (
    public.has_role((SELECT auth.uid()), 'admin')
    OR public.has_role((SELECT auth.uid()), 'super_admin')
  );

DROP POLICY IF EXISTS "Admins can update race registrations" ON public.race_registrations;
CREATE POLICY "Admins can update race registrations"
  ON public.race_registrations
  FOR UPDATE
  USING (
    public.has_role((SELECT auth.uid()), 'admin')
    OR public.has_role((SELECT auth.uid()), 'super_admin')
  )
  WITH CHECK (
    public.has_role((SELECT auth.uid()), 'admin')
    OR public.has_role((SELECT auth.uid()), 'super_admin')
  );
