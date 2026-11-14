-- Authorized, bounded read contribution for the EXISTING admin device pitwall.
BEGIN;
CREATE INDEX examples_fuel_forecast_ref_idx ON pitwall_learning.examples((label->>'id'))
 WHERE feature_version='previous-complete-lap-v1';
CREATE FUNCTION public.pitwall_fuel_learning_v1(p_device uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path=pg_catalog,public,pitwall_learning,pg_temp AS $fn$
DECLARE d public.simhub_devices%ROWTYPE; v pitwall_learning.fuel_visibility%ROWTYPE;
 m pitwall_learning.models%ROWTYPE; a pitwall_learning.account_policy%ROWTYPE;
 ev pitwall_learning.evaluations%ROWTYPE; q jsonb; tele jsonb; received timestamptz;
 point double precision; radius double precision; actual integer; expected_hash text;
BEGIN
 IF auth.uid() IS NULL THEN RETURN NULL; END IF;
 SELECT * INTO d FROM public.simhub_devices WHERE id=p_device;
 IF NOT FOUND OR d.owner_user_id IS NULL OR NOT(auth.uid()=d.owner_user_id OR public.can_manage_simhub()) THEN RETURN NULL; END IF;
 IF NOT EXISTS(SELECT 1 FROM pitwall_learning.runtime_settings WHERE id=1 AND advice_enabled AND worker_enabled) THEN RETURN NULL; END IF;
 SELECT * INTO a FROM pitwall_learning.account_policy WHERE owner_user_id=d.owner_user_id;
 IF NOT FOUND OR NOT(a.capture_enabled AND a.personal_fit_enabled AND a.serving_enabled) THEN RETURN NULL; END IF;
 SELECT v3_normalized,received_at INTO tele,received FROM public.simhub_telemetry_latest WHERE device_id=p_device;
 IF tele IS NULL OR received<clock_timestamp()-interval '30 seconds' THEN RETURN NULL; END IF;
 SELECT * INTO v FROM pitwall_learning.fuel_visibility fv
 WHERE fv.owner_user_id=d.owner_user_id AND fv.policy_version=a.policy_version
   AND fv.qualified_data->>'device'=p_device::text AND fv.first_visible_at>clock_timestamp()-interval '5 minutes'
 ORDER BY fv.first_visible_at DESC LIMIT 1;
 q:=v.qualified_data;
 IF q IS NULL OR tele#>>'{identity,currentDriverId}' IS DISTINCT FROM q#>>'{scope,driver}'
   OR tele#>>'{identity,carId}' IS DISTINCT FROM q#>>'{scope,car}'
   OR tele#>'{identity,trackId}' IS DISTINCT FROM q#>'{scope,track}'
   OR tele#>>'{identity,trackConfig}' IS DISTINCT FROM q#>>'{scope,layout}' THEN RETURN NULL; END IF;
 SELECT mm.* INTO m FROM pitwall_learning.deployments dep JOIN pitwall_learning.models mm ON mm.id=dep.model_id
 WHERE dep.owner_user_id=d.owner_user_id AND dep.fuel_context=q->>'context'
   AND dep.target='fuel_next_lap' AND dep.surface='admin_pitwall_test' AND dep.state='active'
   AND mm.state='active' AND mm.policy_version=a.policy_version AND mm.created_at>clock_timestamp()-interval '7 days'
 ORDER BY dep.generation DESC LIMIT 1;
 IF NOT FOUND OR m.fuel_parameters IS NULL THEN RETURN NULL; END IF;
 SELECT * INTO ev FROM pitwall_learning.evaluations WHERE model_id=m.id AND status='passed' AND retention_expires_at>clock_timestamp() LIMIT 1;
 IF NOT FOUND THEN RETURN NULL; END IF;
 expected_hash:=encode(sha256(convert_to(jsonb_build_array(m.owner_user_id,m.fuel_context,m.policy_version,ev.dataset_manifest_hash,m.fuel_parameters)::text,'UTF8')),'hex');
 IF m.manifest_hash IS DISTINCT FROM expected_hash THEN RETURN NULL; END IF;
 SELECT count(*) INTO actual FROM pitwall_learning.examples e JOIN pitwall_learning.source_revisions r ON r.id=e.source_revision_id
 WHERE e.owner_user_id=d.owner_user_id AND e.feature_version='previous-complete-lap-v1'
   AND e.label->>'context'=m.fuel_context AND e.label->>'policyVersion'=a.policy_version::text
   AND e.label->>'id' IN(SELECT jsonb_array_elements_text(m.fuel_parameters->'exampleIds'))
   AND e.retention_expires_at>clock_timestamp()
   AND NOT EXISTS(SELECT 1 FROM pitwall_learning.source_revisions n WHERE n.source_kind=r.source_kind AND n.device_id=r.device_id
     AND n.source_uid=r.source_uid AND (n.record_revision>r.record_revision OR (n.record_revision=r.record_revision AND n.content_hash<>r.content_hash)));
 IF actual IS DISTINCT FROM jsonb_array_length(m.fuel_parameters->'exampleIds') THEN RETURN NULL; END IF;
 point:=(q->>'usedLitres')::double precision*(m.fuel_parameters->>'ratio')::double precision;
 radius:=(m.fuel_parameters->>'radius')::double precision;
 IF point-radius<0.2 OR point+radius>15 OR radius<0 OR 2*radius>point*.2 THEN RETURN NULL; END IF;
 RETURN jsonb_build_object('knownModelVersions',jsonb_build_array(m.version),'scope',q->'scope',
 'transportSessionId',tele->'transportSessionId','contribution',jsonb_build_object(
 'schemaVersion',1,'target','fuel','state','active','unit','L/lap','corner',NULL,
 'modelVersion',m.version,'featureVersion','previous-complete-lap-v1','policyVersion','personal-fuel-v1',
 'trainedThrough',to_char(m.trained_through AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
 'sourceObservedAt',to_char(v.first_visible_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
 'sourceFrameSequence',NULL,'estimate',point,'lower',point-radius,'upper',point+radius,
 'independentSessions',(m.fuel_parameters->>'sessions')::integer,'independentSets',NULL,
 'contextMatch',true,'decisive',true,'reasonCodes','[]'::jsonb));
END $fn$;
REVOKE ALL ON FUNCTION public.pitwall_fuel_learning_v1(uuid) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.pitwall_fuel_learning_v1(uuid) TO authenticated;
NOTIFY pgrst,'reload schema';
COMMIT;
