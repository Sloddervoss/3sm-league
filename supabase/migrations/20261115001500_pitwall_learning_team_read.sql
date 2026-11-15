-- Optional personal contribution for the existing real-mode endurance pitwall.
-- Resolve exactly the same latest event/team device as get_pitwall_data. The
-- delegated reader still requires device ownership/can_manage_simhub; this does
-- NOT share personal models with other team members or pool training accounts.
BEGIN;
CREATE FUNCTION public.pitwall_fuel_learning_for_team_v1(p_event_id uuid,p_team_id uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,auth,pg_temp AS $fn$
DECLARE device uuid;
BEGIN
 IF auth.uid() IS NULL OR p_event_id IS NULL OR p_team_id IS NULL THEN RETURN NULL; END IF;
 SELECT t.device_id INTO device FROM public.simhub_telemetry_latest t
 WHERE t.endurance_event_id=p_event_id AND t.endurance_team_id=p_team_id
 ORDER BY t.received_at DESC LIMIT 1;
 IF device IS NULL THEN RETURN NULL; END IF;
 RETURN public.pitwall_fuel_learning_v1(device);
END $fn$;
REVOKE ALL ON FUNCTION public.pitwall_fuel_learning_for_team_v1(uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.pitwall_fuel_learning_for_team_v1(uuid,uuid) TO authenticated;
NOTIFY pgrst,'reload schema';
COMMIT;
