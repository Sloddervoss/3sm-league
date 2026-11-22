-- Paired rollback for 20261122134500_pitwall_learning_fleet_eligibility.sql.
--
-- Data-preserving: restores the two function bodies that existed before the
-- repair and removes the helper. No account_policy, capture, evidence, model
-- or history row is touched. Apply this only if the forward migration causes a
-- regression; stopping the worker and turning the runtime switches off is the
-- safe first step described in the release note.
BEGIN;

CREATE OR REPLACE FUNCTION pitwall_learning.fuel_worker_provision(p_limit integer DEFAULT 100) RETURNS integer
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

CREATE OR REPLACE FUNCTION pitwall_learning.fuel_worker_source(p_job uuid,p_lease uuid) RETURNS jsonb
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

REVOKE ALL ON FUNCTION pitwall_learning.connector_supports_fuel_learning(text)
  FROM PUBLIC, anon, authenticated, service_role, pitwall_learning_worker;
DROP FUNCTION IF EXISTS pitwall_learning.connector_supports_fuel_learning(text);

COMMIT;
