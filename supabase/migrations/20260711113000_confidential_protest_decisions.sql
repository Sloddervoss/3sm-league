-- Pending accusations are confidential. Participants may read their own submissions
-- directly, while staff retain their full table access. Accused drivers receive only
-- a deliberately redacted final decision through the RPC below.

ALTER TABLE public.protests
  ADD COLUMN IF NOT EXISTS public_decision TEXT;

DROP POLICY IF EXISTS "Protests viewable by involved users and admins" ON public.protests;
CREATE POLICY "Reporters and staff can view protests" ON public.protests
  FOR SELECT
  USING (
    auth.uid() = reporter_user_id
    OR public.has_role(auth.uid(), 'admin')
    OR public.has_role(auth.uid(), 'super_admin')
    OR public.has_role(auth.uid(), 'moderator')
  );

CREATE OR REPLACE FUNCTION public.get_my_visible_protests()
RETURNS TABLE (
  id UUID,
  visibility TEXT,
  event_name TEXT,
  track TEXT,
  lap_number INTEGER,
  race_date TIMESTAMPTZ,
  created_at TIMESTAMPTZ,
  status TEXT,
  penalty_type TEXT,
  penalty_points INTEGER,
  time_penalty_seconds INTEGER,
  grid_penalty_places INTEGER,
  race_ban_next BOOLEAN,
  public_decision TEXT,
  description TEXT,
  video_link TEXT
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT
    p.id,
    'submitted'::TEXT AS visibility,
    r.name AS event_name,
    r.track,
    p.lap_number,
    r.race_date,
    p.created_at,
    p.status,
    p.penalty_type,
    p.penalty_points,
    p.time_penalty_seconds,
    p.grid_penalty_places,
    p.race_ban_next,
    p.public_decision,
    p.description,
    p.video_link
  FROM public.protests AS p
  JOIN public.races AS r ON r.id = p.race_id
  WHERE auth.uid() IS NOT NULL
    AND p.reporter_user_id = auth.uid()

  UNION ALL

  SELECT
    p.id,
    'decision'::TEXT AS visibility,
    r.name AS event_name,
    r.track,
    p.lap_number,
    r.race_date,
    p.created_at,
    p.status,
    p.penalty_type,
    p.penalty_points,
    p.time_penalty_seconds,
    p.grid_penalty_places,
    p.race_ban_next,
    p.public_decision,
    NULL::TEXT AS description,
    NULL::TEXT AS video_link
  FROM public.protests AS p
  JOIN public.races AS r ON r.id = p.race_id
  WHERE auth.uid() IS NOT NULL
    AND p.accused_user_id = auth.uid()
    AND p.reporter_user_id <> auth.uid()
    AND p.status IN ('resolved', 'dismissed')
  ORDER BY created_at DESC;
$$;

REVOKE ALL ON FUNCTION public.get_my_visible_protests() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_my_visible_protests() FROM anon;
GRANT EXECUTE ON FUNCTION public.get_my_visible_protests() TO authenticated;
