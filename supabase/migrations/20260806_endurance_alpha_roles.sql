-- Endurance alpha-rollen: tester + endurance_manager.
-- PostgreSQL staat toe dat ALTER TYPE ... ADD VALUE in een transactie gebeurt,
-- maar de nieuwe waarde mag pas na COMMIT worden gebruikt. Daarom staan de
-- enumuitbreiding en de helperfuncties bewust in afzonderlijke transacties.

BEGIN;

ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'tester';
ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'endurance_manager';

COMMIT;

BEGIN;

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
