-- Public race-registration integrity. This is intentionally forward-only: it
-- supersedes broad historical self-registration policies without touching data.
-- The Discord bot calls the RPC with service_role; browser writes use RLS.

CREATE OR REPLACE FUNCTION public.enforce_race_registration_write()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_race_status TEXT;
  v_race_date TIMESTAMPTZ;
  v_league_id UUID;
  v_inherited_car TEXT;
  v_privileged BOOLEAN := (
    auth.role() = 'service_role'
    OR public.has_role(auth.uid(), 'admin')
    OR public.has_role(auth.uid(), 'super_admin')
  );
BEGIN
  -- Result imports, the admin car-lock exception flow, and the Discord RPC
  -- remain deliberately available to their established privileged paths.
  IF v_privileged THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NEW.user_id IS DISTINCT FROM auth.uid()
       OR NEW.status <> 'registered'
       OR NEW.car_choice IS NOT NULL
       OR NEW.car_locked IS DISTINCT FROM false THEN
      RAISE EXCEPTION 'invalid public race registration write';
    END IF;
  ELSE
    -- A normal user may only revive their own withdrawn row. In particular,
    -- no browser client can forge or alter a car choice/lock.
    IF OLD.user_id IS DISTINCT FROM auth.uid()
       OR NEW.user_id IS DISTINCT FROM OLD.user_id
       OR NEW.race_id IS DISTINCT FROM OLD.race_id
       OR OLD.status <> 'withdrawn'
       OR NEW.status <> 'registered'
       OR NEW.car_choice IS DISTINCT FROM OLD.car_choice
       OR NEW.car_locked IS DISTINCT FROM OLD.car_locked THEN
      RAISE EXCEPTION 'only withdrawn race registrations may be reactivated';
    END IF;
  END IF;

  SELECT status, race_date, league_id
    INTO v_race_status, v_race_date, v_league_id
  FROM public.races
  WHERE id = NEW.race_id;

  IF NOT FOUND OR v_race_status <> 'upcoming' OR v_race_date <= now() THEN
    RAISE EXCEPTION 'race registration is closed';
  END IF;

  -- A direct entrant inherits only an active per-race lock from this exact
  -- league. Standalone races (NULL league_id) remain independent.
  IF NEW.car_choice IS NULL AND NEW.car_locked = false AND v_league_id IS NOT NULL THEN
    SELECT registration.car_choice
      INTO v_inherited_car
    FROM public.race_registrations AS registration
    JOIN public.races AS registered_race ON registered_race.id = registration.race_id
    WHERE registration.user_id = NEW.user_id
      AND registration.status <> 'withdrawn'
      AND registration.car_locked = true
      AND registration.car_choice IS NOT NULL
      AND registered_race.league_id = v_league_id
    ORDER BY registered_race.race_date ASC, registration.created_at ASC
    LIMIT 1;

    IF FOUND THEN
      NEW.car_choice := v_inherited_car;
      NEW.car_locked := true;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS enforce_race_registration_write ON public.race_registrations;
CREATE TRIGGER enforce_race_registration_write
  BEFORE INSERT OR UPDATE ON public.race_registrations
  FOR EACH ROW EXECUTE FUNCTION public.enforce_race_registration_write();

-- Replace the original broad public policies. The trigger above is the column
-- integrity boundary; these policies enforce ownership and the open window.
DROP POLICY IF EXISTS "Users can register themselves" ON public.race_registrations;
DROP POLICY IF EXISTS "Users can update own registration" ON public.race_registrations;
DROP POLICY IF EXISTS "Users can delete own registration" ON public.race_registrations;

CREATE POLICY "Users can register themselves for open races"
  ON public.race_registrations
  FOR INSERT
  WITH CHECK (
    auth.uid() = user_id
    AND EXISTS (
      SELECT 1 FROM public.races
      WHERE races.id = race_registrations.race_id
        AND races.status = 'upcoming'
        AND races.race_date > now()
    )
  );

CREATE POLICY "Users can reactivate own withdrawn open registrations"
  ON public.race_registrations
  FOR UPDATE
  USING (
    auth.uid() = user_id
    AND status = 'withdrawn'
    AND EXISTS (
      SELECT 1 FROM public.races
      WHERE races.id = race_registrations.race_id
        AND races.status = 'upcoming'
        AND races.race_date > now()
    )
  )
  WITH CHECK (
    auth.uid() = user_id
    AND status = 'registered'
    AND EXISTS (
      SELECT 1 FROM public.races
      WHERE races.id = race_registrations.race_id
        AND races.status = 'upcoming'
        AND races.race_date > now()
    )
  );

CREATE POLICY "Users can delete own open race registrations"
  ON public.race_registrations
  FOR DELETE
  USING (
    auth.uid() = user_id
    AND EXISTS (
      SELECT 1 FROM public.races
      WHERE races.id = race_registrations.race_id
        AND races.status = 'upcoming'
        AND races.race_date > now()
    )
  );

-- Preserve the bot entry point but bind it to the identical public window and
-- revive a withdrawn row instead of silently treating it as a duplicate.
CREATE OR REPLACE FUNCTION public.discord_register_race(
  p_discord_id TEXT,
  p_race_id UUID,
  p_action TEXT
)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_user_id UUID;
  v_race_status TEXT;
  v_race_date TIMESTAMPTZ;
  v_league_id UUID;
  v_inherited_car TEXT;
BEGIN
  SELECT user_id INTO v_user_id
  FROM public.profiles
  WHERE discord_id = p_discord_id;

  IF v_user_id IS NULL THEN
    RETURN 'not_linked';
  END IF;

  SELECT status, race_date, league_id INTO v_race_status, v_race_date, v_league_id
  FROM public.races
  WHERE id = p_race_id;

  IF NOT FOUND THEN
    RETURN 'race_not_found';
  END IF;

  IF v_race_status <> 'upcoming' OR v_race_date <= now() THEN
    RETURN 'registration_closed';
  END IF;

  IF p_action = 'register' THEN
    -- SECURITY DEFINER/service-role calls bypass the browser trigger above, so
    -- this bot path must explicitly carry the same per-league inherited lock.
    IF v_league_id IS NOT NULL THEN
      SELECT registration.car_choice
        INTO v_inherited_car
      FROM public.race_registrations AS registration
      JOIN public.races AS registered_race ON registered_race.id = registration.race_id
      WHERE registration.user_id = v_user_id
        AND registration.status <> 'withdrawn'
        AND registration.car_locked = true
        AND registration.car_choice IS NOT NULL
        AND registered_race.league_id = v_league_id
      ORDER BY registered_race.race_date ASC, registration.created_at ASC
      LIMIT 1;
    END IF;

    INSERT INTO public.race_registrations (race_id, user_id, status, car_choice, car_locked)
    VALUES (p_race_id, v_user_id, 'registered', v_inherited_car, v_inherited_car IS NOT NULL)
    ON CONFLICT (race_id, user_id) DO UPDATE
      SET status = 'registered',
          car_choice = CASE
            WHEN public.race_registrations.car_locked THEN public.race_registrations.car_choice
            ELSE EXCLUDED.car_choice
          END,
          car_locked = public.race_registrations.car_locked OR EXCLUDED.car_locked
      WHERE public.race_registrations.status = 'withdrawn';
    RETURN 'registered';
  ELSIF p_action = 'unregister' THEN
    DELETE FROM public.race_registrations
    WHERE race_id = p_race_id AND user_id = v_user_id;
    RETURN 'unregistered';
  END IF;

  RETURN 'unknown_action';
END;
$$;

REVOKE ALL ON FUNCTION public.discord_register_race(TEXT, UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.discord_register_race(TEXT, UUID, TEXT) TO service_role;
