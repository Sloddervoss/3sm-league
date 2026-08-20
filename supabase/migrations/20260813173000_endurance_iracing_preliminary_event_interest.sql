BEGIN;

-- Voorlopige eventinteresse is uitsluitend toegestaan zolang een actief event
-- nog geen actieve tijdsloten heeft. Bestaande eventinteresse blijft bewaard.
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
  SELECT
    interest.catalog_event_id,
    count(*)::BIGINT,
    bool_or(interest.user_id = auth.uid())
  FROM public.endurance_iracing_event_interest AS interest
  JOIN public.endurance_iracing_events AS event
    ON event.id = interest.catalog_event_id AND event.active
  WHERE NOT EXISTS (
    SELECT 1 FROM public.endurance_iracing_event_slots AS slot
    WHERE slot.catalog_event_id = interest.catalog_event_id AND slot.active
  )
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
DECLARE
  v_user_id UUID := auth.uid();
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Permission denied' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM public.endurance_iracing_events AS event
    WHERE event.id = p_catalog_event_id
      AND event.active
      AND NOT EXISTS (
        SELECT 1 FROM public.endurance_iracing_event_slots AS slot
        WHERE slot.catalog_event_id = event.id AND slot.active
      )
  ) THEN
    RAISE EXCEPTION 'Voorlopige eventinteresse is alleen mogelijk voordat tijdsloten bekend zijn'
      USING ERRCODE = '22023';
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

-- Managers zien op iedere kaart het aantal UNIEKE coureurs met voorlopige
-- eventinteresse of interesse in minstens één tijdslot. Meerdere slotkliks van
-- dezelfde coureur tellen dus één keer. Er worden geen identiteiten geretourneerd.
CREATE OR REPLACE FUNCTION public.endurance_iracing_manager_interest_overview()
RETURNS TABLE (catalog_event_id UUID, interested_count BIGINT)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, auth, pg_temp
AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_endurance_manager(auth.uid()) THEN
    RAISE EXCEPTION 'Permission denied: alleen endurance_manager of super_admin kan eventanimo bekijken'
      USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
  SELECT combined.catalog_event_id, count(DISTINCT combined.user_id)::BIGINT
  FROM (
    SELECT event_interest.catalog_event_id, event_interest.user_id
    FROM public.endurance_iracing_event_interest AS event_interest
    UNION ALL
    SELECT slot_interest.catalog_event_id, slot_interest.user_id
    FROM public.endurance_iracing_slot_interest AS slot_interest
    JOIN public.endurance_iracing_event_slots AS slot
      ON slot.id = slot_interest.catalog_slot_id
     AND slot.catalog_event_id = slot_interest.catalog_event_id
     AND slot.active
  ) AS combined
  JOIN public.endurance_iracing_events AS event
    ON event.id = combined.catalog_event_id AND event.active
  GROUP BY combined.catalog_event_id;
END;
$$;

REVOKE ALL ON FUNCTION public.endurance_iracing_interest_summary() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.endurance_set_iracing_interest(UUID, BOOLEAN) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.endurance_iracing_manager_interest_overview() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.endurance_iracing_interest_summary() TO authenticated;
GRANT EXECUTE ON FUNCTION public.endurance_set_iracing_interest(UUID, BOOLEAN) TO authenticated;
GRANT EXECUTE ON FUNCTION public.endurance_iracing_manager_interest_overview() TO authenticated;

COMMIT;
