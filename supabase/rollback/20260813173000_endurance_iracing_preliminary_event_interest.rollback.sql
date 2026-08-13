BEGIN;

DROP FUNCTION IF EXISTS public.endurance_iracing_manager_interest_overview();

-- Herstel de definities/grants van de slotinteresserelease: eventbrede interesse
-- blijft opgeslagen maar is niet bereikbaar voor de browser.
CREATE OR REPLACE FUNCTION public.endurance_iracing_interest_summary()
RETURNS TABLE (
  catalog_event_id UUID,
  interested_count BIGINT,
  is_current_user_interested BOOLEAN
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, auth, pg_temp
AS $$
  SELECT interest.catalog_event_id, count(*)::BIGINT,
    bool_or(interest.user_id = auth.uid())
  FROM public.endurance_iracing_event_interest AS interest
  GROUP BY interest.catalog_event_id
$$;

CREATE OR REPLACE FUNCTION public.endurance_set_iracing_interest(
  p_catalog_event_id UUID,
  p_interested BOOLEAN
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, auth, pg_temp
AS $$
DECLARE v_user_id UUID := auth.uid();
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Permission denied' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.endurance_iracing_events
    WHERE id = p_catalog_event_id AND active
  ) THEN
    RAISE EXCEPTION 'Onbekend iRacing catalogusevent' USING ERRCODE = '22023';
  END IF;
  IF p_interested THEN
    INSERT INTO public.endurance_iracing_event_interest (catalog_event_id, user_id)
    VALUES (p_catalog_event_id, v_user_id)
    ON CONFLICT (catalog_event_id, user_id) DO NOTHING;
  ELSE
    DELETE FROM public.endurance_iracing_event_interest
    WHERE catalog_event_id = p_catalog_event_id AND user_id = v_user_id;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.endurance_iracing_interest_summary() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.endurance_set_iracing_interest(UUID, BOOLEAN) FROM PUBLIC, anon, authenticated;

COMMIT;
