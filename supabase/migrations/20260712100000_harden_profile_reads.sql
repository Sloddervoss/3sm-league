-- Replace the historical public profile-table read with two deliberately separate
-- contracts:
--   * public.public_profiles: safe display data only, usable by public UI.
--   * public.profiles: an authenticated user may read their own editable row;
--     staff retain direct access for operational joins and the audited admin RPC.
--
-- This is forward-only. Do not apply it manually to a live project outside the
-- normal Supabase migration deployment process.

BEGIN;

-- The original policy exposed every profile column (including Discord and
-- iRacing identifiers) to anon and normal authenticated callers.
DROP POLICY IF EXISTS "Profiles viewable by everyone" ON public.profiles;
DROP POLICY IF EXISTS "Users can view own profile" ON public.profiles;
DROP POLICY IF EXISTS "Staff can view all profiles" ON public.profiles;

CREATE POLICY "Users can view own profile"
  ON public.profiles
  FOR SELECT
  USING (auth.uid() = user_id);

-- Staff read access is retained for existing operational joins (stewarding,
-- result import, and admin management). Normal authenticated users do not meet
-- this predicate and therefore cannot enumerate raw rows.
CREATE POLICY "Staff can view all profiles"
  ON public.profiles
  FOR SELECT
  USING (
    public.has_role(auth.uid(), 'admin'::public.app_role)
    OR public.has_role(auth.uid(), 'super_admin'::public.app_role)
    OR public.has_role(auth.uid(), 'moderator'::public.app_role)
  );

-- Browser table privileges are required for RLS to evaluate. Grant only the
-- self-service operations already covered by policies; anon gets no raw-table
-- privilege and RLS prevents normal users from enumerating rows.
REVOKE ALL ON TABLE public.profiles FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE public.profiles TO authenticated;

-- A definer view intentionally bypasses the table's row policy only to expose
-- this fixed, column-safe projection. Keep identifiers and audit fields out of
-- the view: discord_id, iracing_id, internal primary key, and timestamps are
-- never public profile data.
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

-- confirmed_profiles previously exposed iracing_id through a definer view.
-- No frontend source uses it after this migration; revoke its browser grants so
-- it cannot remain an alternate bypass around the raw-table policy.
REVOKE ALL ON TABLE public.confirmed_profiles FROM PUBLIC, anon, authenticated;

COMMIT;
