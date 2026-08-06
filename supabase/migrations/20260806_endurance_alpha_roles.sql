-- Endurance alpha-rollen: tester + endurance_manager.
-- Additief: voegt nieuwe app_role-waarden en helper-functies toe. Verandert geen
-- bestaand gedrag voor de huidige rollen (super_admin blijft alles mogen).
BEGIN;

-- Voeg rollen toe (idempotent per waarde).
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_enum WHERE enumlabel = 'tester' AND enumtypid = 'public.app_role'::regtype) THEN
    ALTER TYPE public.app_role ADD VALUE 'tester';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_enum WHERE enumlabel = 'endurance_manager' AND enumtypid = 'public.app_role'::regtype) THEN
    ALTER TYPE public.app_role ADD VALUE 'endurance_manager';
  END IF;
END $$;

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
