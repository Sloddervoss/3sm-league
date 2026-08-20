BEGIN;

DROP TRIGGER IF EXISTS endurance_validate_iracing_slot_interest_link
  ON public.endurance_iracing_slot_interest;
DROP FUNCTION IF EXISTS public.endurance_validate_iracing_slot_interest_link();

-- Herstel de 16:30-definities zonder active-filter; de 16:30 rollback blijft
-- vervolgens verantwoordelijk voor het volledig verwijderen van de feature.
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

REVOKE ALL ON FUNCTION public.endurance_iracing_slot_interest_summary() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.endurance_iracing_slot_interest_summary() TO authenticated;
REVOKE ALL ON FUNCTION public.endurance_iracing_slot_interest_members(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.endurance_iracing_slot_interest_members(UUID) TO authenticated;

COMMIT;
