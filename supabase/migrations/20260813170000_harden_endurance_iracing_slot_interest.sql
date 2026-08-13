BEGIN;

-- Defense-in-depth voor denormaliseerde event+slot-koppeling. De browser-RPC
-- leidt event_id al af uit het slot; deze trigger beschermt ook service/admin
-- writes en latere onderhoudsscripts tegen een mismatched paar.
CREATE OR REPLACE FUNCTION public.endurance_validate_iracing_slot_interest_link()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = pg_catalog, public, pg_temp
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM public.endurance_iracing_event_slots AS slot
    WHERE slot.id = NEW.catalog_slot_id
      AND slot.catalog_event_id = NEW.catalog_event_id
  ) THEN
    RAISE EXCEPTION 'iRacing-timeslot hoort niet bij het opgegeven catalogusevent'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.endurance_validate_iracing_slot_interest_link() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER endurance_validate_iracing_slot_interest_link
  BEFORE INSERT OR UPDATE OF catalog_event_id, catalog_slot_id
  ON public.endurance_iracing_slot_interest
  FOR EACH ROW
  EXECUTE FUNCTION public.endurance_validate_iracing_slot_interest_link();

-- Alleen interesse voor nog actieve bronwaarheid meetellen. De toggle-RPC had
-- deze gate al; hiermee blijven summary en managernamen identiek wanneer een
-- event/slot later door de sync wordt gedeactiveerd.
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
  JOIN public.endurance_iracing_event_slots AS slot
    ON slot.id = interest.catalog_slot_id
   AND slot.catalog_event_id = interest.catalog_event_id
   AND slot.active
  JOIN public.endurance_iracing_events AS event
    ON event.id = interest.catalog_event_id
   AND event.active
  GROUP BY interest.catalog_event_id, interest.catalog_slot_id
$$;

REVOKE ALL ON FUNCTION public.endurance_iracing_slot_interest_summary() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.endurance_iracing_slot_interest_summary() TO authenticated;

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
  JOIN public.endurance_iracing_event_slots AS slot
    ON slot.id = interest.catalog_slot_id
   AND slot.catalog_event_id = interest.catalog_event_id
   AND slot.active
  JOIN public.endurance_iracing_events AS event
    ON event.id = interest.catalog_event_id
   AND event.active
  LEFT JOIN public.public_profiles AS profile ON profile.user_id = interest.user_id
  WHERE interest.catalog_event_id = p_catalog_event_id
  ORDER BY interest.catalog_slot_id, COALESCE(profile.iracing_name, profile.display_name, interest.user_id::TEXT);
END;
$$;

REVOKE ALL ON FUNCTION public.endurance_iracing_slot_interest_members(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.endurance_iracing_slot_interest_members(UUID) TO authenticated;

COMMIT;
