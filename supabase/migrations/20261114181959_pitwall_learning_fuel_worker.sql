-- Normal-update prospective fuel adapter. Does not reinterpret or mutate P1 history.
-- Release switches remain OFF until the parent enables the complete consumer chain.
BEGIN;
ALTER TABLE pitwall_learning.runtime_settings
  ADD COLUMN fuel_collection_started_at timestamptz,
  ADD COLUMN automatic_personal_enrollment boolean NOT NULL DEFAULT false,
  ADD COLUMN fuel_last_candidate_at timestamptz;
ALTER TABLE pitwall_learning.deployments
  ADD COLUMN owner_user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  ADD COLUMN fuel_context text;
DROP INDEX pitwall_learning.deployments_one_active_per_surface;
CREATE UNIQUE INDEX deployments_one_active_per_surface ON pitwall_learning.deployments(target,surface)
 WHERE state='active' AND owner_user_id IS NULL;
CREATE UNIQUE INDEX deployments_personal_active_scope ON pitwall_learning.deployments(target,surface,owner_user_id,fuel_context)
 WHERE state='active' AND owner_user_id IS NOT NULL;
ALTER TABLE pitwall_learning.models
  ADD COLUMN fuel_parameters jsonb,
  ADD COLUMN fuel_context text,
  ADD COLUMN trained_through timestamptz;
CREATE INDEX models_personal_fuel_scope_idx ON pitwall_learning.models
  (owner_user_id, fuel_context, created_at DESC) WHERE model_kind='fuel_next_lap';

-- A separate after-COMMIT lower-bound witness; source_revisions' old claims stay false.
CREATE TABLE pitwall_learning.fuel_visibility (
  source_revision_id uuid PRIMARY KEY REFERENCES pitwall_learning.source_revisions(id) ON DELETE CASCADE,
  owner_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  policy_version integer NOT NULL CHECK(policy_version>0),
  first_visible_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  qualified_data jsonb CHECK(qualified_data IS NULL OR
    (jsonb_typeof(qualified_data)='object' AND pg_column_size(qualified_data)<=4096))
);
CREATE INDEX fuel_visibility_owner_idx ON pitwall_learning.fuel_visibility(owner_user_id, first_visible_at DESC);
ALTER TABLE pitwall_learning.fuel_visibility ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON pitwall_learning.fuel_visibility FROM PUBLIC, anon, authenticated, service_role, pitwall_learning_worker;

CREATE FUNCTION pitwall_learning.fuel_worker_allowed() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,pitwall_learning,pg_temp AS $fn$
 SELECT session_user IN ('pitwall_learning_worker','postgres','supabase_admin')
   AND EXISTS(SELECT 1 FROM pitwall_learning.runtime_settings
              WHERE id=1 AND worker_enabled AND fuel_collection_started_at IS NOT NULL)
$fn$;
REVOKE ALL ON FUNCTION pitwall_learning.fuel_worker_allowed() FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION pitwall_learning.fuel_worker_source(p_job uuid,p_lease uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pitwall_learning,pg_temp AS $fn$
DECLARE r pitwall_learning.source_revisions%ROWTYPE; a pitwall_learning.account_policy%ROWTYPE;
        seen_at timestamptz; collection_at timestamptz;
BEGIN
 IF NOT pitwall_learning.fuel_worker_allowed() THEN RETURN NULL; END IF;
 SELECT s.* INTO r FROM pitwall_learning.jobs j JOIN pitwall_learning.source_revisions s ON s.id=j.source_revision_id
 WHERE j.id=p_job AND j.kind='source_validate' AND j.status='leased' AND j.lease_token=p_lease
   AND j.lease_expires_at>clock_timestamp() AND s.source_kind='lap_summary';
 IF NOT FOUND OR r.owner_user_id IS NULL THEN RETURN NULL; END IF;
 SELECT * INTO a FROM pitwall_learning.account_policy WHERE owner_user_id=r.owner_user_id;
 IF NOT FOUND OR NOT(a.capture_enabled AND a.personal_fit_enabled) OR a.policy_version<>r.account_policy_version
   OR NOT EXISTS(SELECT 1 FROM auth.users WHERE id=r.owner_user_id) THEN RETURN NULL; END IF;
 SELECT greatest(fuel_collection_started_at,a.created_at,a.updated_at) INTO collection_at
 FROM pitwall_learning.runtime_settings WHERE id=1;
 INSERT INTO pitwall_learning.fuel_visibility(source_revision_id,owner_user_id,policy_version)
 VALUES(r.id,r.owner_user_id,a.policy_version) ON CONFLICT DO NOTHING;
 SELECT first_visible_at INTO seen_at FROM pitwall_learning.fuel_visibility WHERE source_revision_id=r.id;
 RETURN jsonb_build_object('id',r.id,'owner',r.owner_user_id,'device',r.device_id,
  'policyVersion',a.policy_version,'knownAt',ceil(extract(epoch FROM seen_at)*1000),
  'collectionStartedAt',ceil(extract(epoch FROM collection_at)*1000),'allowed',true,
  'superseded',EXISTS(SELECT 1 FROM pitwall_learning.source_revisions s
    WHERE s.source_kind=r.source_kind AND s.device_id=r.device_id AND s.source_uid=r.source_uid
    AND (s.record_revision>r.record_revision OR (s.record_revision=r.record_revision AND s.content_hash<>r.content_hash)))
    OR r.quality_reasons && ARRAY['late_delivery','clock_skew','source_hash_revision_conflict','stale_revision_delivered_late'],
  'payload',r.payload);
END $fn$;

CREATE FUNCTION pitwall_learning.fuel_worker_record(p_job uuid,p_lease uuid,p_data jsonb) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pitwall_learning,pg_temp AS $fn$
DECLARE s jsonb;
BEGIN
 s:=pitwall_learning.fuel_worker_source(p_job,p_lease);
 IF s IS NULL OR s->>'superseded'='true' OR jsonb_typeof(p_data)<>'object' OR pg_column_size(p_data)>4096
   OR p_data->>'revision' IS DISTINCT FROM s->>'id'
   OR p_data->>'owner' IS DISTINCT FROM s->>'owner'
   OR p_data->>'device' IS DISTINCT FROM s->>'device'
   OR p_data->'policyVersion' IS DISTINCT FROM s->'policyVersion'
   OR p_data->'knownAt' IS DISTINCT FROM s->'knownAt'
   OR s#>'{payload,observation,version}' IS DISTINCT FROM '2'::jsonb
   OR s#>'{payload,observation,fuelQuality,pitRoad}' IS DISTINCT FROM 'false'::jsonb
   OR s#>'{payload,observation,fuelQuality,refuel}' IS DISTINCT FROM 'false'::jsonb
   OR s#>'{payload,observation,fuelQuality,resetOrTow}' IS DISTINCT FROM 'false'::jsonb
   OR s#>'{payload,observation,fuelQuality,driverChanged}' IS DISTINCT FROM 'false'::jsonb
   OR p_data#>>'{scope,driver}' IS DISTINCT FROM s#>>'{payload,observation,fuelQuality,driverId}'
   OR p_data->'lap' IS DISTINCT FROM s#>'{payload,lap_number}'
   OR (p_data->>'session')::jsonb IS DISTINCT FROM jsonb_build_array(
       s#>'{payload,observation,context,sessionUniqueId}',s#>'{payload,observation,context,sessionNumber}')
   OR (p_data->>'context')::jsonb IS DISTINCT FROM jsonb_build_array(s->'owner',s->'device',
       s#>'{payload,observation,fuelQuality,driverId}',s#>'{payload,observation,context,carId}',
       s#>'{payload,observation,context,trackId}',s#>'{payload,observation,context,trackConfig}')
   OR (p_data->>'startedAt')::numeric IS DISTINCT FROM floor(extract(epoch FROM (s#>>'{payload,started_at}')::timestamptz)*1000)
   OR (p_data->>'endedAt')::numeric IS DISTINCT FROM floor(extract(epoch FROM (s#>>'{payload,ended_at}')::timestamptz)*1000)
   OR abs((p_data->>'usedLitres')::double precision-
       ((s#>>'{payload,fuel_start_litres}')::double precision-(s#>>'{payload,fuel_end_litres}')::double precision))>1e-9
   OR jsonb_typeof(p_data->'scope')<>'object' OR jsonb_typeof(p_data->'context')<>'string'
   OR jsonb_typeof(p_data->'session')<>'string' OR jsonb_typeof(p_data->'lap')<>'number'
   OR jsonb_typeof(p_data->'usedLitres') IS DISTINCT FROM 'number'
   OR (p_data->>'usedLitres')::numeric NOT BETWEEN 0.2 AND 15 THEN RETURN false; END IF;
 -- The trusted worker computes qualification; SQL still pins owner/device/source/lease and immutable result.
 UPDATE pitwall_learning.fuel_visibility SET qualified_data=p_data
 WHERE source_revision_id=(s->>'id')::uuid AND qualified_data IS NULL;
 RETURN EXISTS(SELECT 1 FROM pitwall_learning.fuel_visibility
               WHERE source_revision_id=(s->>'id')::uuid AND qualified_data=p_data);
END $fn$;

CREATE FUNCTION pitwall_learning.fuel_worker_window(p_owner uuid,p_context text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pitwall_learning,pg_temp AS $fn$
DECLARE observations jsonb; forecasts jsonb; examples_out jsonb;
BEGIN
 IF NOT pitwall_learning.fuel_worker_allowed() OR octet_length(p_context)>1024 OR NOT EXISTS(
   SELECT 1 FROM pitwall_learning.account_policy WHERE owner_user_id=p_owner AND capture_enabled AND personal_fit_enabled
 ) THEN RETURN NULL; END IF;
 SELECT coalesce(jsonb_agg(q.qualified_data ORDER BY q.first_visible_at),'[]') INTO observations FROM (
  SELECT v.qualified_data,v.first_visible_at FROM pitwall_learning.fuel_visibility v
  JOIN pitwall_learning.source_revisions r ON r.id=v.source_revision_id
  JOIN pitwall_learning.account_policy a ON a.owner_user_id=v.owner_user_id
  WHERE v.owner_user_id=p_owner AND a.policy_version=v.policy_version
    AND v.qualified_data->>'context'=p_context AND v.first_visible_at>clock_timestamp()-interval '180 days'
    AND NOT EXISTS(SELECT 1 FROM pitwall_learning.source_revisions n WHERE n.device_id=r.device_id AND n.source_kind=r.source_kind
      AND n.source_uid=r.source_uid AND (n.record_revision>r.record_revision OR (n.record_revision=r.record_revision AND n.content_hash<>r.content_hash)))
  ORDER BY v.first_visible_at DESC LIMIT 1000
 ) q;
 SELECT coalesce(jsonb_agg(q.forecast),'[]') INTO forecasts FROM (
  SELECT p.prediction || jsonb_build_object('id',p.id,'knownAt',ceil(extract(epoch FROM p.as_of)*1000)) AS forecast
  FROM pitwall_learning.predictions p JOIN pitwall_learning.models m ON m.id=p.model_id
  JOIN pitwall_learning.account_policy a ON a.owner_user_id=m.owner_user_id
  WHERE m.owner_user_id=p_owner AND m.fuel_context=p_context AND p.policy_version=a.policy_version
    AND p.retention_expires_at>clock_timestamp()
  ORDER BY p.as_of DESC LIMIT 1000
 ) q;
 SELECT coalesce(jsonb_agg(q.label),'[]') INTO examples_out FROM (
  SELECT e.label FROM pitwall_learning.examples e JOIN pitwall_learning.account_policy a ON a.owner_user_id=e.owner_user_id
  WHERE e.owner_user_id=p_owner AND e.feature_version='previous-complete-lap-v1'
    AND e.label->>'context'=p_context AND e.label->>'policyVersion'=a.policy_version::text
    AND e.retention_expires_at>clock_timestamp() ORDER BY e.created_at DESC LIMIT 1000
 ) q;
 RETURN jsonb_build_object('observations',observations,'forecasts',forecasts,'examples',examples_out,
   'asOf',ceil(extract(epoch FROM clock_timestamp())*1000));
END $fn$;

CREATE FUNCTION pitwall_learning.fuel_worker_forecast(p_revision uuid,p_baseline jsonb) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pitwall_learning,pg_temp AS $fn$
DECLARE v pitwall_learning.fuel_visibility%ROWTYPE; q jsonb; a pitwall_learning.account_policy%ROWTYPE;
        m uuid; h text; f uuid; target_lap integer; prior uuid; session_start numeric; expected_samples jsonb;
BEGIN
 IF NOT pitwall_learning.fuel_worker_allowed() THEN RETURN NULL; END IF;
 SELECT * INTO v FROM pitwall_learning.fuel_visibility WHERE source_revision_id=p_revision;
 q:=v.qualified_data;
 SELECT * INTO a FROM pitwall_learning.account_policy WHERE owner_user_id=v.owner_user_id;
 IF q IS NULL OR NOT(a.capture_enabled AND a.personal_fit_enabled) OR a.policy_version<>v.policy_version
   OR jsonb_typeof(p_baseline)<>'array' OR jsonb_array_length(p_baseline) NOT BETWEEN 3 AND 20
   OR EXISTS(SELECT 1 FROM jsonb_array_elements(p_baseline) x WHERE jsonb_typeof(x)<>'number' OR (x#>>'{}')::numeric NOT BETWEEN 0.2 AND 15)
 THEN RETURN NULL; END IF;
 SELECT jsonb_agg(z.value ORDER BY z.seen DESC) INTO expected_samples FROM (
   SELECT fv.qualified_data->'usedLitres' AS value,fv.first_visible_at AS seen
   FROM pitwall_learning.fuel_visibility fv
   WHERE fv.owner_user_id=v.owner_user_id AND fv.policy_version=v.policy_version
     AND fv.qualified_data->>'context'=q->>'context' AND fv.qualified_data->>'session'=q->>'session'
     AND fv.first_visible_at<=v.first_visible_at
   ORDER BY fv.first_visible_at DESC LIMIT 20
 ) z;
 IF p_baseline IS DISTINCT FROM expected_samples THEN RETURN NULL; END IF;
 target_lap:=(q->>'lap')::integer+2;
 -- Per account/device/session/context/target exactly one first forecast; never rewrite knowledge time.
 PERFORM pg_advisory_xact_lock(hashtextextended((q->>'context')||(q->>'session'),0));
 SELECT p.id INTO prior FROM pitwall_learning.predictions p JOIN pitwall_learning.models mm ON mm.id=p.model_id
 WHERE mm.owner_user_id=v.owner_user_id AND mm.fuel_context=q->>'context'
   AND p.prediction->>'session'=q->>'session' AND p.prediction->>'targetLap'=target_lap::text
   AND p.policy_version=v.policy_version LIMIT 1;
 IF prior IS NOT NULL THEN RETURN prior; END IF;
 h:=encode(sha256(convert_to(jsonb_build_array('pinned-baseline-v1',v.owner_user_id,q->>'context',v.policy_version)::text,'UTF8')),'hex');
 INSERT INTO pitwall_learning.models(owner_user_id,model_kind,version,manifest_hash,policy_version,fuel_context,fuel_parameters)
 VALUES(v.owner_user_id,'fuel_next_lap','baseline-'||left(h,48),h,v.policy_version,q->>'context','{"kind":"baseline"}')
 ON CONFLICT(manifest_hash) DO NOTHING;
 SELECT id INTO m FROM pitwall_learning.models WHERE manifest_hash=h;
 SELECT min((qualified_data->>'knownAt')::numeric) INTO session_start FROM pitwall_learning.fuel_visibility
 WHERE owner_user_id=v.owner_user_id AND qualified_data->>'context'=q->>'context' AND qualified_data->>'session'=q->>'session';
 INSERT INTO pitwall_learning.predictions(model_id,source_revision_id,as_of,prediction,policy_version)
 VALUES(m,p_revision,clock_timestamp(),jsonb_build_object(
   'owner',v.owner_user_id,'device',q->>'device','policyVersion',v.policy_version,'context',q->>'context',
   'session',q->>'session','sessionStartedAt',session_start,'targetLap',target_lap,
   'previousLitres',q->'usedLitres','baselineSamples',p_baseline),v.policy_version) RETURNING id INTO f;
 RETURN f;
END $fn$;

CREATE FUNCTION pitwall_learning.fuel_worker_example(p_forecast uuid,p_label uuid) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pitwall_learning,pg_temp AS $fn$
DECLARE v pitwall_learning.fuel_visibility%ROWTYPE; p pitwall_learning.predictions%ROWTYPE;
        m pitwall_learning.models%ROWTYPE; a pitwall_learning.account_policy%ROWTYPE; q jsonb; out_id uuid;
BEGIN
 IF NOT pitwall_learning.fuel_worker_allowed() THEN RETURN NULL; END IF;
 SELECT * INTO v FROM pitwall_learning.fuel_visibility WHERE source_revision_id=p_label; q:=v.qualified_data;
 SELECT * INTO p FROM pitwall_learning.predictions WHERE id=p_forecast;
 SELECT * INTO m FROM pitwall_learning.models WHERE id=p.model_id;
 SELECT * INTO a FROM pitwall_learning.account_policy WHERE owner_user_id=v.owner_user_id;
 IF q IS NULL OR p.id IS NULL OR m.owner_user_id IS DISTINCT FROM v.owner_user_id
   OR NOT(a.capture_enabled AND a.personal_fit_enabled) OR a.policy_version<>v.policy_version OR p.policy_version<>v.policy_version
   OR p.prediction->>'device' IS DISTINCT FROM q->>'device'
   OR p.prediction->>'context' IS DISTINCT FROM q->>'context'
   OR p.prediction->>'session' IS DISTINCT FROM q->>'session'
   OR p.prediction->>'targetLap' IS DISTINCT FROM q->>'lap'
   OR ceil(extract(epoch FROM p.as_of)*1000)+1 >= (q->>'startedAt')::numeric
 THEN RETURN NULL; END IF;
 INSERT INTO pitwall_learning.examples(source_revision_id,owner_user_id,feature_version,label,label_quality)
 VALUES(p_label,v.owner_user_id,'previous-complete-lap-v1',jsonb_build_object(
   'id',p.id,'owner',v.owner_user_id,'context',q->>'context','session',q->>'session',
   'policyVersion',v.policy_version,'sessionStartedAt',p.prediction->'sessionStartedAt',
   'featureKnownAt',ceil(extract(epoch FROM p.as_of)*1000),'targetStartedAt',q->'startedAt',
   'labelKnownAt',ceil(extract(epoch FROM v.first_visible_at)*1000),
   'previousLitres',p.prediction->'previousLitres','usedLitres',q->'usedLitres',
   'baselineSamples',p.prediction->'baselineSamples','qualified',true),'observed')
 ON CONFLICT(source_revision_id,feature_version) DO NOTHING RETURNING id INTO out_id;
 RETURN out_id;
END $fn$;

DO $grants$ DECLARE f record; BEGIN
 FOR f IN SELECT p.oid::regprocedure AS sig FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
 WHERE n.nspname='pitwall_learning' AND p.proname IN ('fuel_worker_source','fuel_worker_record','fuel_worker_window','fuel_worker_forecast','fuel_worker_example') LOOP
 EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,anon,authenticated,service_role',f.sig);
 EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO pitwall_learning_worker',f.sig);
 END LOOP;
END $grants$;
COMMIT;
