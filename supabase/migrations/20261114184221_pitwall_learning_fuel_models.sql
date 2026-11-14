-- Normal update: bounded personal provisioning and registered fuel candidate persistence.
-- Depends on 20261114181959. No historical data is reclassified and no pooling is enabled.
BEGIN;
CREATE FUNCTION pitwall_learning.fuel_worker_provision(p_limit integer DEFAULT 100) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pitwall_learning,pg_temp AS $fn$
DECLARE changed integer;
BEGIN
 IF NOT pitwall_learning.fuel_worker_allowed() OR p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 1000 OR NOT EXISTS(
   SELECT 1 FROM pitwall_learning.runtime_settings WHERE id=1 AND automatic_personal_enrollment AND capture_enabled
 ) THEN RETURN 0; END IF;
 WITH eligible AS (
  SELECT DISTINCT d.owner_user_id FROM public.simhub_devices d
  JOIN public.simhub_device_health h ON h.device_id=d.id JOIN auth.users u ON u.id=d.owner_user_id
  WHERE d.device_status IN ('active_unbound','bound','active') AND d.last_seen_at>clock_timestamp()-interval '30 days'
   AND CASE WHEN h.connector_version ~ '^[0-9]{1,4}\.[0-9]{1,4}\.[0-9]{1,4}\.[0-9]{1,4}$'
     THEN string_to_array(h.connector_version,'.')::integer[]>=ARRAY[0,7,6,3] ELSE false END
   AND NOT EXISTS(SELECT 1 FROM pitwall_learning.account_policy a WHERE a.owner_user_id=d.owner_user_id)
  ORDER BY d.owner_user_id LIMIT p_limit
 ) INSERT INTO pitwall_learning.account_policy(owner_user_id,capture_enabled,personal_fit_enabled,serving_enabled,pooling_enabled)
 SELECT owner_user_id,true,true,true,false FROM eligible ON CONFLICT(owner_user_id) DO NOTHING;
 GET DIAGNOSTICS changed=ROW_COUNT; RETURN changed;
END $fn$;

CREATE FUNCTION pitwall_learning.fuel_worker_save_model(p_owner uuid,p_context text,p_candidate jsonb) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pitwall_learning,pg_temp AS $fn$
DECLARE a pitwall_learning.account_policy%ROWTYPE; ids jsonb; actual integer; sessions integer;
 dataset jsonb; dataset_hash text; model_hash text; mid uuid; score jsonb; eligible boolean; permit boolean;
 through_ms numeric; gen bigint;
BEGIN
 IF NOT pitwall_learning.fuel_worker_allowed() OR pg_column_size(p_candidate)>131072
  OR p_candidate->>'owner' IS DISTINCT FROM p_owner::text OR p_candidate->>'context' IS DISTINCT FROM p_context
  OR p_candidate->>'policyVersion' IS DISTINCT FROM 'personal-fuel-v1'
  OR p_candidate->>'featureVersion' IS DISTINCT FROM 'previous-complete-lap-v1'
  OR jsonb_typeof(p_candidate->'exampleIds') IS DISTINCT FROM 'array'
  OR jsonb_array_length(p_candidate->'exampleIds') NOT BETWEEN 100 AND 1000
 THEN RETURN NULL; END IF;
 SELECT * INTO a FROM pitwall_learning.account_policy WHERE owner_user_id=p_owner;
 IF NOT FOUND OR NOT(a.capture_enabled AND a.personal_fit_enabled) THEN RETURN NULL; END IF;
 ids:=p_candidate->'exampleIds';
 SELECT count(*),count(DISTINCT e.label->>'session'),jsonb_agg(e.label ORDER BY e.label->>'id'),max((e.label->>'labelKnownAt')::numeric)
 INTO actual,sessions,dataset,through_ms FROM pitwall_learning.examples e
 JOIN pitwall_learning.source_revisions r ON r.id=e.source_revision_id
 WHERE e.owner_user_id=p_owner AND e.feature_version='previous-complete-lap-v1'
   AND e.label_quality='observed' AND e.label->>'context'=p_context
   AND e.label->>'policyVersion'=a.policy_version::text AND e.retention_expires_at>clock_timestamp()
   AND e.label->>'id' IN(SELECT jsonb_array_elements_text(ids))
   AND NOT EXISTS(SELECT 1 FROM pitwall_learning.source_revisions n WHERE n.source_kind=r.source_kind AND n.device_id=r.device_id
     AND n.source_uid=r.source_uid AND (n.record_revision>r.record_revision OR (n.record_revision=r.record_revision AND n.content_hash<>r.content_hash)));
 IF actual<>jsonb_array_length(ids) OR actual<100 OR sessions<20 OR through_ms IS DISTINCT FROM (p_candidate->>'trainedThrough')::numeric
   OR through_ms>ceil(extract(epoch FROM clock_timestamp())*1000) THEN RETURN NULL; END IF;
 dataset_hash:=encode(sha256(convert_to(dataset::text,'UTF8')),'hex');
 model_hash:=encode(sha256(convert_to(jsonb_build_array(p_owner,p_context,a.policy_version,dataset_hash,p_candidate)::text,'UTF8')),'hex');
 SELECT id INTO mid FROM pitwall_learning.models WHERE manifest_hash=model_hash;
 IF mid IS NOT NULL THEN RETURN mid; END IF;
 IF NOT pg_try_advisory_xact_lock(hashtextextended('pitwall-learning-fuel-model-promotion',0)) THEN RETURN NULL; END IF;
 IF EXISTS(SELECT 1 FROM pitwall_learning.runtime_settings WHERE id=1 AND fuel_last_candidate_at>clock_timestamp()-interval '1 hour') THEN RETURN NULL; END IF;
 UPDATE pitwall_learning.runtime_settings SET fuel_last_candidate_at=clock_timestamp() WHERE id=1;
 score:=p_candidate->'metrics';
 eligible:=coalesce(p_candidate->'eligible'='true'::jsonb
   AND jsonb_array_length(p_candidate#>'{split,train}')>=10
   AND jsonb_array_length(p_candidate#>'{split,calibration}')>=5
   AND jsonb_array_length(p_candidate#>'{split,test}')>=5
   AND (score->>'baselineMae')::numeric>0
   AND (score->>'mae')::numeric<=(score->>'baselineMae')::numeric*0.9
   AND (score->>'underprediction')::numeric<=(score->>'baselineUnderprediction')::numeric
   AND (score->>'coverage')::numeric>=0.9 AND (score->>'relativeWidth')::numeric BETWEEN 0 AND 0.2
   AND (score->>'relativeDrift')::numeric BETWEEN 0 AND 0.1
   AND (p_candidate->>'ratio')::numeric BETWEEN 0.25 AND 4 AND (p_candidate->>'radius')::numeric BETWEEN 0 AND 15,false);
 SELECT advice_enabled AND shadow_enabled AND a.serving_enabled INTO permit FROM pitwall_learning.runtime_settings WHERE id=1;
 INSERT INTO pitwall_learning.models(owner_user_id,model_kind,version,manifest_hash,state,policy_version,fuel_context,fuel_parameters,trained_through,activated_at)
 VALUES(p_owner,'fuel_next_lap','fuel-'||left(model_hash,48),model_hash,
   CASE WHEN eligible AND permit THEN 'active' ELSE 'shadow' END,a.policy_version,p_context,p_candidate,
   to_timestamp(through_ms/1000),CASE WHEN eligible AND permit THEN clock_timestamp() ELSE NULL END) RETURNING id INTO mid;
 INSERT INTO pitwall_learning.evaluations(model_id,dataset_manifest_hash,metrics,status,evaluated_at)
 VALUES(mid,dataset_hash,score,CASE WHEN eligible THEN 'passed' ELSE 'failed' END,clock_timestamp());
 IF eligible AND permit THEN
  UPDATE pitwall_learning.models SET state='retired',retired_at=clock_timestamp()
   WHERE id<>mid AND owner_user_id=p_owner AND fuel_context=p_context AND state='active' AND model_kind='fuel_next_lap';
  UPDATE pitwall_learning.deployments SET state='retired',retired_at=clock_timestamp()
   WHERE owner_user_id=p_owner AND fuel_context=p_context AND target='fuel_next_lap' AND surface='admin_pitwall_test' AND state='active';
  SELECT coalesce(max(generation),0)+1 INTO gen FROM pitwall_learning.deployments WHERE target='fuel_next_lap' AND surface='admin_pitwall_test';
  INSERT INTO pitwall_learning.deployments(model_id,target,surface,generation,state,activated_at,owner_user_id,fuel_context)
  VALUES(mid,'fuel_next_lap','admin_pitwall_test',gen,'active',clock_timestamp(),p_owner,p_context);
 END IF;
 RETURN mid;
END $fn$;
REVOKE ALL ON FUNCTION pitwall_learning.fuel_worker_provision(integer) FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION pitwall_learning.fuel_worker_save_model(uuid,text,jsonb) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION pitwall_learning.fuel_worker_provision(integer),pitwall_learning.fuel_worker_save_model(uuid,text,jsonb) TO pitwall_learning_worker;
COMMIT;
