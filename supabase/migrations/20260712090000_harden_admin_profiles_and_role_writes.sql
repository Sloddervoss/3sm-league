-- Close two privilege-escalation paths discovered in the admin security audit.
--
-- 1. admin_get_all_profiles is a SECURITY DEFINER RPC. It must authenticate the
--    caller before returning every profile, regardless of the function owner's
--    RLS bypass rights.
-- 2. Browser clients must not mutate user_roles directly: the role hierarchy is
--    enforced by admin_grant_role/admin_revoke_role, where only editor may be
--    managed by an admin and other roles require a super_admin.

BEGIN;

-- The original definition was not source controlled. Drop its unknown return
-- signature before recreating the generated-type contract explicitly. The
-- migration is transactional, so callers never observe an absent function.
DROP FUNCTION IF EXISTS public.admin_get_all_profiles();
CREATE FUNCTION public.admin_get_all_profiles()
RETURNS SETOF public.profiles
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  -- Do not let an unauthenticated JWT, including a direct anon RPC call, reach
  -- the SECURITY DEFINER query.
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Permission denied';
  END IF;

  -- Check the caller's roles inside the definer function rather than relying on
  -- table RLS, which the function owner may bypass.
  IF NOT (
    public.has_role(auth.uid(), 'admin'::public.app_role)
    OR public.has_role(auth.uid(), 'super_admin'::public.app_role)
  ) THEN
    RAISE EXCEPTION 'Permission denied';
  END IF;

  RETURN QUERY
  SELECT p.*
  FROM public.profiles AS p;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_get_all_profiles() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_get_all_profiles() FROM anon;
REVOKE ALL ON FUNCTION public.admin_get_all_profiles() FROM service_role;
GRANT EXECUTE ON FUNCTION public.admin_get_all_profiles() TO authenticated;

-- Preserve read paths: a user can read their own role through the initial
-- policy, while admins and super_admins can read all roles. Remove every
-- browser-facing mutation path so the SECURITY DEFINER role RPCs are the sole
-- route for grants and revocations and their hierarchy cannot be bypassed.
DROP POLICY IF EXISTS "Admins can manage user roles" ON public.user_roles;
DROP POLICY IF EXISTS "Admins can insert non-super-admin roles" ON public.user_roles;
DROP POLICY IF EXISTS "Admins can update non-super-admin roles" ON public.user_roles;
DROP POLICY IF EXISTS "Admins can delete non-super-admin roles" ON public.user_roles;
DROP POLICY IF EXISTS "Prevent super_admin role deletion" ON public.user_roles;

COMMIT;
