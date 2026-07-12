-- Enforce the role-management boundary at both the table privilege and RPC layers.
-- Browser clients can read role data through RLS, but all role mutations must go
-- through one unambiguous, hierarchy-enforcing SECURITY DEFINER RPC per action.

BEGIN;

-- RLS without mutation policies can still result in a silent 204/no-op when the
-- API role retains UPDATE/DELETE privileges. Revoke the privileges so direct
-- REST table writes are positively rejected (HTTP 403), rather than merely
-- hidden by a filter.
REVOKE INSERT, UPDATE, DELETE ON TABLE public.user_roles FROM anon, authenticated;

-- PostgREST cannot select between the text and enum overload from JSON RPC
-- parameters. Keep only the text signature exposed to clients.
DROP FUNCTION IF EXISTS public.admin_grant_role(uuid, public.app_role) CASCADE;
DROP FUNCTION IF EXISTS public.admin_revoke_role(uuid, public.app_role) CASCADE;

CREATE OR REPLACE FUNCTION public.admin_grant_role(target_user_id uuid, target_role text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  normalized_role public.app_role;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Permission denied';
  END IF;

  BEGIN
    normalized_role := target_role::public.app_role;
  EXCEPTION WHEN invalid_text_representation THEN
    RAISE EXCEPTION 'Ongeldige rol: %', target_role USING ERRCODE = '22023';
  END;

  IF normalized_role = 'super_admin' THEN
    RAISE EXCEPTION 'De super admin rol kan niet worden toegewezen';
  END IF;

  IF normalized_role = 'editor' THEN
    IF NOT (
      public.has_role(auth.uid(), 'admin'::public.app_role)
      OR public.has_role(auth.uid(), 'super_admin'::public.app_role)
    ) THEN
      RAISE EXCEPTION 'Alleen admins mogen de editor rol toekennen';
    END IF;
  ELSIF NOT public.has_role(auth.uid(), 'super_admin'::public.app_role) THEN
    RAISE EXCEPTION 'Alleen de super admin mag deze rol toekennen';
  END IF;

  INSERT INTO public.user_roles (user_id, role)
  VALUES (target_user_id, normalized_role)
  ON CONFLICT (user_id, role) DO NOTHING;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_revoke_role(target_user_id uuid, target_role text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  normalized_role public.app_role;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Permission denied';
  END IF;

  BEGIN
    normalized_role := target_role::public.app_role;
  EXCEPTION WHEN invalid_text_representation THEN
    RAISE EXCEPTION 'Ongeldige rol: %', target_role USING ERRCODE = '22023';
  END;

  IF normalized_role = 'super_admin' THEN
    RAISE EXCEPTION 'De super admin rol kan niet worden ingetrokken';
  END IF;

  IF normalized_role = 'editor' THEN
    IF NOT (
      public.has_role(auth.uid(), 'admin'::public.app_role)
      OR public.has_role(auth.uid(), 'super_admin'::public.app_role)
    ) THEN
      RAISE EXCEPTION 'Alleen admins mogen de editor rol intrekken';
    END IF;
  ELSIF NOT public.has_role(auth.uid(), 'super_admin'::public.app_role) THEN
    RAISE EXCEPTION 'Alleen de super admin mag deze rol intrekken';
  END IF;

  DELETE FROM public.user_roles
  WHERE user_id = target_user_id
    AND role = normalized_role;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_grant_role(uuid, text) FROM PUBLIC, anon, service_role;
REVOKE ALL ON FUNCTION public.admin_revoke_role(uuid, text) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.admin_grant_role(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_revoke_role(uuid, text) TO authenticated;

COMMIT;
