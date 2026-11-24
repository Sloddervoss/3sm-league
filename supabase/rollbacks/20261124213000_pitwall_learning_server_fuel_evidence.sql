-- Paired rollback for 20261124213000_pitwall_learning_server_fuel_evidence.
--
-- Restores the pre-migration fuel_worker_window definition, removes the
-- server-evidence reader and the min_examples setting. No capture, revision,
-- visibility, prediction, example or model row is touched.
BEGIN;

DROP FUNCTION IF EXISTS pitwall_learning.fuel_worker_server_source(uuid, uuid);

CREATE OR REPLACE FUNCTION pitwall_learning.fuel_worker_window(p_owner uuid, p_context text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'pitwall_learning', 'pg_temp'
AS $function$
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
END $function$

REVOKE ALL ON FUNCTION pitwall_learning.fuel_worker_window(uuid,text)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION pitwall_learning.fuel_worker_window(uuid,text) TO pitwall_learning_worker;

ALTER TABLE pitwall_learning.runtime_settings DROP COLUMN IF EXISTS min_examples;

COMMIT;
