BEGIN;

DROP POLICY IF EXISTS "Staff can read active latest SimHub telemetry" ON public.simhub_telemetry_latest;
DROP FUNCTION IF EXISTS public.simhub_read_effective_endurance_latest(uuid, uuid, uuid);
DROP FUNCTION IF EXISTS public.simhub_list_effective_endurance_devices(uuid, uuid);

CREATE OR REPLACE FUNCTION public.is_active_simhub_device(p_device_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, auth, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.simhub_devices AS device
    WHERE device.id = p_device_id
      AND device.revoked_at IS NULL
      AND (
        (device.race_id IS NULL AND device.team_id IS NULL AND device.expires_at IS NULL)
        OR (
          device.race_id IS NOT NULL AND device.team_id IS NOT NULL
          AND device.expires_at > now()
          AND EXISTS (
            SELECT 1 FROM public.races AS race
            WHERE race.id = device.race_id
              AND race.status IN ('upcoming', 'live')
              AND race.race_date > now() - interval '36 hours'
          )
        )
      )
      AND EXISTS (
        SELECT 1 FROM public.user_roles AS role_record
        WHERE role_record.user_id = device.owner_user_id
          AND role_record.role = 'super_admin'::public.app_role
      )
  );
$$;

DROP FUNCTION IF EXISTS public.simhub_device_matches_endurance_context(uuid, uuid, uuid);
DROP FUNCTION IF EXISTS public.simhub_effective_endurance_binding(uuid);

CREATE POLICY "Staff can read active latest SimHub telemetry"
  ON public.simhub_telemetry_latest
  FOR SELECT TO authenticated
  USING (public.can_manage_simhub() AND public.is_active_simhub_device(device_id));

REVOKE ALL ON FUNCTION public.is_active_simhub_device(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_active_simhub_device(uuid) TO authenticated;

COMMIT;
