-- ─────────────────────────────────────────────────────────────
-- Super Admin — STAP 1: run dit blok eerst alleen, dan STAP 2.
-- PostgreSQL vereist dat ALTER TYPE ADD VALUE in een aparte
-- transactie zit voordat de nieuwe waarde gebruikt kan worden.
-- ─────────────────────────────────────────────────────────────

-- ══ STAP 1 — run dit als eerste (apart) ══
ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'super_admin';

-- ══ STAP 2 — run dit daarna (apart) ══

-- 2. Wijs super_admin toe aan de eigenaar (idempotent)
INSERT INTO public.user_roles (user_id, role)
VALUES ('103daeb3-9f46-4d79-a0a1-c460e43ed3b7', 'super_admin')
ON CONFLICT (user_id, role) DO NOTHING;

-- 3. admin_get_user_roles — alle rollen teruggeven (alleen voor admins/super_admin)
CREATE OR REPLACE FUNCTION public.admin_get_user_roles()
RETURNS TABLE(user_id UUID, role app_role)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'super_admin')) THEN
    RAISE EXCEPTION 'Permission denied';
  END IF;
  RETURN QUERY SELECT ur.user_id, ur.role FROM public.user_roles ur;
END;
$$;

-- 4. admin_grant_role — alleen super_admin mag rollen toekennen
CREATE OR REPLACE FUNCTION public.admin_grant_role(target_user_id UUID, target_role app_role)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'super_admin') THEN
    RAISE EXCEPTION 'Alleen de super admin mag rollen toekennen';
  END IF;
  IF target_role = 'super_admin' THEN
    RAISE EXCEPTION 'De super admin rol kan niet worden toegewezen';
  END IF;
  INSERT INTO public.user_roles (user_id, role)
  VALUES (target_user_id, target_role)
  ON CONFLICT (user_id, role) DO NOTHING;
END;
$$;

-- 5. admin_revoke_role — alleen super_admin mag rollen intrekken; super_admin is beschermd
CREATE OR REPLACE FUNCTION public.admin_revoke_role(target_user_id UUID, target_role app_role)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'super_admin') THEN
    RAISE EXCEPTION 'Alleen de super admin mag rollen intrekken';
  END IF;
  IF target_role = 'super_admin' THEN
    RAISE EXCEPTION 'De super admin rol kan niet worden ingetrokken';
  END IF;
  DELETE FROM public.user_roles WHERE user_id = target_user_id AND role = target_role;
END;
$$;

-- 6. admin_delete_user — super_admin kan niet verwijderd worden
CREATE OR REPLACE FUNCTION public.admin_delete_user(target_user_id UUID)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'super_admin')) THEN
    RAISE EXCEPTION 'Permission denied';
  END IF;
  IF public.has_role(target_user_id, 'super_admin') THEN
    RAISE EXCEPTION 'De super admin kan niet worden verwijderd';
  END IF;
  DELETE FROM auth.users WHERE id = target_user_id;
END;
$$;

-- 7. RLS belt-and-suspenders: super_admin rij kan nooit direct verwijderd worden
DROP POLICY IF EXISTS "Prevent super_admin role deletion" ON public.user_roles;
CREATE POLICY "Prevent super_admin role deletion" ON public.user_roles
  FOR DELETE USING (role != 'super_admin');
