BEGIN;

-- Per-timeslot interesse voor officiële iRacing-events.
-- Gewone leden zien uitsluitend aggregaten + hun eigen keuze. Alleen
-- endurance_manager/super_admin kan veilige profielnamen per slot opvragen.
CREATE TABLE public.endurance_iracing_slot_interest (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  catalog_event_id UUID NOT NULL
    REFERENCES public.endurance_iracing_events(id) ON DELETE CASCADE,
  catalog_slot_id UUID NOT NULL
    REFERENCES public.endurance_iracing_event_slots(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (catalog_slot_id, user_id)
);

CREATE INDEX endurance_iracing_slot_interest_event_slot_idx
  ON public.endurance_iracing_slot_interest (catalog_event_id, catalog_slot_id);
CREATE INDEX endurance_iracing_slot_interest_user_idx
  ON public.endurance_iracing_slot_interest (user_id);

ALTER TABLE public.endurance_iracing_slot_interest ENABLE ROW LEVEL SECURITY;
CREATE POLICY "endurance own slot interest row only"
  ON public.endurance_iracing_slot_interest
  FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

REVOKE ALL ON public.endurance_iracing_slot_interest FROM PUBLIC, anon, authenticated;

-- Migreer legacy eventinteresse alleen wanneer het doel eenduidig is: het reeds
-- gekozen lokale slot, of het enige actieve slot van het event. Meerdere
-- mogelijke slots worden bewust niet gegokt; de historische rij blijft bestaan.
WITH legacy_choices AS (
  SELECT
    legacy.catalog_event_id,
    legacy.user_id,
    legacy.created_at,
    COALESCE(
      (
        SELECT local_event.iracing_catalog_slot_id
        FROM public.endurance_events AS local_event
        WHERE local_event.iracing_catalog_event_id = legacy.catalog_event_id
          AND local_event.iracing_catalog_slot_id IS NOT NULL
        ORDER BY local_event.created_at, local_event.id
        LIMIT 1
      ),
      (
        SELECT CASE WHEN count(*) = 1 THEN (array_agg(slot.id ORDER BY slot.session_start_at))[1] END
        FROM public.endurance_iracing_event_slots AS slot
        WHERE slot.catalog_event_id = legacy.catalog_event_id
          AND slot.active
      )
    ) AS catalog_slot_id
  FROM public.endurance_iracing_event_interest AS legacy
)
INSERT INTO public.endurance_iracing_slot_interest (
  catalog_event_id,
  catalog_slot_id,
  user_id,
  created_at
)
SELECT catalog_event_id, catalog_slot_id, user_id, created_at
FROM legacy_choices
WHERE catalog_slot_id IS NOT NULL
ON CONFLICT (catalog_slot_id, user_id) DO NOTHING;

CREATE OR REPLACE FUNCTION public.endurance_iracing_slot_interest_summary()
RETURNS TABLE (
  catalog_event_id UUID,
  catalog_slot_id UUID,
  interested_count BIGINT,
  is_current_user_interested BOOLEAN
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, auth, pg_temp
AS $$
  SELECT
    interest.catalog_event_id,
    interest.catalog_slot_id,
    count(*)::BIGINT AS interested_count,
    bool_or(interest.user_id = auth.uid()) AS is_current_user_interested
  FROM public.endurance_iracing_slot_interest AS interest
  GROUP BY interest.catalog_event_id, interest.catalog_slot_id
$$;

REVOKE ALL ON FUNCTION public.endurance_iracing_slot_interest_summary() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.endurance_iracing_slot_interest_summary() TO authenticated;

CREATE OR REPLACE FUNCTION public.endurance_set_iracing_slot_interest(
  p_catalog_slot_id UUID,
  p_interested BOOLEAN
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, auth, pg_temp
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_catalog_event_id UUID;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Permission denied' USING ERRCODE = '42501';
  END IF;

  SELECT slot.catalog_event_id
  INTO v_catalog_event_id
  FROM public.endurance_iracing_event_slots AS slot
  JOIN public.endurance_iracing_events AS event ON event.id = slot.catalog_event_id
  WHERE slot.id = p_catalog_slot_id
    AND slot.active
    AND event.active;

  IF v_catalog_event_id IS NULL THEN
    RAISE EXCEPTION 'Onbekend of inactief iRacing-timeslot' USING ERRCODE = '22023';
  END IF;

  IF p_interested THEN
    INSERT INTO public.endurance_iracing_slot_interest (
      catalog_event_id,
      catalog_slot_id,
      user_id
    )
    VALUES (v_catalog_event_id, p_catalog_slot_id, v_user_id)
    ON CONFLICT (catalog_slot_id, user_id) DO NOTHING;
  ELSE
    DELETE FROM public.endurance_iracing_slot_interest
    WHERE catalog_slot_id = p_catalog_slot_id
      AND user_id = v_user_id;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.endurance_set_iracing_slot_interest(UUID, BOOLEAN) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.endurance_set_iracing_slot_interest(UUID, BOOLEAN) TO authenticated;

CREATE OR REPLACE FUNCTION public.endurance_iracing_slot_interest_members(
  p_catalog_event_id UUID
)
RETURNS TABLE (
  catalog_slot_id UUID,
  user_id UUID,
  iracing_name TEXT,
  display_name TEXT
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, auth, pg_temp
AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_endurance_manager(auth.uid()) THEN
    RAISE EXCEPTION 'Permission denied: alleen endurance_manager of super_admin kan slotinteresse-identiteiten bekijken'
      USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT
    interest.catalog_slot_id,
    interest.user_id,
    profile.iracing_name,
    profile.display_name
  FROM public.endurance_iracing_slot_interest AS interest
  LEFT JOIN public.public_profiles AS profile ON profile.user_id = interest.user_id
  WHERE interest.catalog_event_id = p_catalog_event_id
  ORDER BY interest.catalog_slot_id, COALESCE(profile.iracing_name, profile.display_name, interest.user_id::TEXT);
END;
$$;

REVOKE ALL ON FUNCTION public.endurance_iracing_slot_interest_members(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.endurance_iracing_slot_interest_members(UUID) TO authenticated;

-- Nieuwe browserflows mogen niet meer naar de oude eventbrede interesse schrijven.
REVOKE EXECUTE ON FUNCTION public.endurance_iracing_interest_summary() FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.endurance_set_iracing_interest(UUID, BOOLEAN) FROM authenticated;

COMMIT;
