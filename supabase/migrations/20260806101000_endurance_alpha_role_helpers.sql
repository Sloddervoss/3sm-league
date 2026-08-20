-- Endurance alpha-role helpers. De enumwaarden zijn in de voorgaande migratie
-- toegevoegd en gecommit voordat ze hier worden gebruikt.
BEGIN;

-- helper: endurance-beheer (super_admin of endurance_manager) — kan endurance-data
-- beheren + devices aan teams koppelen.
CREATE OR REPLACE FUNCTION public.is_endurance_manager(_user_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles AS r
    WHERE r.user_id = _user_id
      AND r.role = ANY ('{super_admin,endurance_manager}'::public.app_role[])
  );
$$;

-- helper: endurance-ster (super_admin, endurance_manager of tester) — mag de
-- suite zien, eigen device koppelen en (voor testers) streamen.
CREATE OR REPLACE FUNCTION public.is_endurance_staff(_user_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles AS r
    WHERE r.user_id = _user_id
      AND r.role = ANY ('{super_admin,endurance_manager,tester}'::public.app_role[])
  );
$$;

REVOKE ALL ON FUNCTION public.is_endurance_manager(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.is_endurance_manager(UUID) TO authenticated;
REVOKE ALL ON FUNCTION public.is_endurance_staff(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.is_endurance_staff(UUID) TO authenticated;

COMMIT;
