-- Harden has_role so browser clients cannot use the SECURITY DEFINER RPC
-- as a cross-user role oracle.
--
-- Existing app behavior is preserved for the AuthContext role checks because a
-- signed-in user can still check their own admin/super_admin/moderator flags.
-- Admin/super_admin callers and service-role jobs can still evaluate another
-- user's role for administrative flows and policy helper usage.

BEGIN;

CREATE OR REPLACE FUNCTION public.has_role(_user_id UUID, _role public.app_role)
RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
BEGIN
  IF _user_id IS NULL OR _role IS NULL THEN
    RETURN false;
  END IF;

  IF auth.role() = 'service_role' THEN
    RETURN EXISTS (
      SELECT 1
      FROM public.user_roles
      WHERE user_id = _user_id
        AND role = _role
    );
  END IF;

  IF auth.uid() IS NULL THEN
    RETURN false;
  END IF;

  IF NOT (_user_id = auth.uid()) AND NOT EXISTS (
    SELECT 1
    FROM public.user_roles
    WHERE user_id = auth.uid()
      AND role IN ('admin'::public.app_role, 'super_admin'::public.app_role)
  ) THEN
    RETURN false;
  END IF;

  RETURN EXISTS (
    SELECT 1
    FROM public.user_roles
    WHERE user_id = _user_id
      AND role = _role
  );
END;
$$;

REVOKE ALL ON FUNCTION public.has_role(UUID, public.app_role) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.has_role(UUID, public.app_role) FROM anon;
GRANT EXECUTE ON FUNCTION public.has_role(UUID, public.app_role) TO authenticated, service_role;

COMMIT;
