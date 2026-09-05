-- Same access boundary as get_pitwall_data: own team or existing Endurance staff.
-- No broad table grants or changes to race registration permissions.
CREATE OR REPLACE FUNCTION public.get_pitwall_teams(p_event_id uuid)
RETURNS TABLE (id uuid, name text)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, auth, pg_temp
AS $$
DECLARE
  v_user_id uuid := auth.uid();
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
  SELECT t.id, t.name
  FROM public.endurance_teams t
  WHERE t.event_id = p_event_id
    AND (public.is_endurance_staff(v_user_id) OR EXISTS (
      SELECT 1 FROM public.endurance_team_members m
      WHERE m.team_id = t.id AND m.user_id = v_user_id
    ))
  ORDER BY t.name, t.id
  LIMIT 200;
END;
$$;
REVOKE ALL ON FUNCTION public.get_pitwall_teams(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_pitwall_teams(uuid) TO authenticated;
