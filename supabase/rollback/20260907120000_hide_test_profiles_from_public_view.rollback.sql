-- Rollback: restore the unfiltered public_profiles view (pre-2026-09-07).
CREATE OR REPLACE VIEW public.public_profiles
WITH (security_invoker = false, security_barrier = true)
AS
SELECT
  p.user_id,
  p.display_name,
  p.iracing_name,
  p.avatar_url,
  p.irating,
  p.safety_rating,
  p.team_id
FROM public.profiles AS p;

REVOKE ALL ON TABLE public.public_profiles FROM PUBLIC;
GRANT SELECT ON TABLE public.public_profiles TO anon, authenticated;

COMMIT;