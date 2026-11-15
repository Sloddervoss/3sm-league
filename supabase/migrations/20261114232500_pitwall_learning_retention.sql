-- Bounded private retention. Original immutable evidence remains immutable except
-- expired DELETE / expired transport-FK unlink inside this restricted maintenance RPC.
BEGIN;
ALTER TABLE pitwall_learning.source_revisions DROP CONSTRAINT source_revisions_batch_fkey;
ALTER TABLE pitwall_learning.source_revisions ADD CONSTRAINT source_revisions_batch_fkey
 FOREIGN KEY(capture_batch_id) REFERENCES pitwall_learning.capture_batches(id) ON DELETE SET NULL;

CREATE OR REPLACE FUNCTION pitwall_learning.reject_capture_batch_mutation() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pitwall_learning,pg_temp AS $fn$
BEGIN
 IF TG_OP='DELETE' AND session_user IN('pitwall_learning_worker','postgres','supabase_admin')
  AND current_setting('pitwall_learning.retention_delete',true)='on'
  AND OLD.received_at<clock_timestamp()-interval '7 days' THEN RETURN OLD; END IF;
 IF TG_OP='UPDATE' AND OLD.owner_user_id IS NOT NULL AND NEW.owner_user_id IS NULL
  AND (NEW.owner_basis='none' OR NEW.owner_basis IS NOT DISTINCT FROM OLD.owner_basis)
  AND (to_jsonb(NEW)-'owner_user_id'-'owner_basis') IS NOT DISTINCT FROM (to_jsonb(OLD)-'owner_user_id'-'owner_basis') THEN
  NEW.owner_basis:='none'; RETURN NEW;
 END IF;
 IF TG_OP='UPDATE' AND OLD.materialized_at IS NULL AND NEW.materialized_at IS NOT NULL AND NEW.materialized_items=OLD.item_count
  AND (to_jsonb(NEW)-'materialized_at'-'materialized_items') IS NOT DISTINCT FROM (to_jsonb(OLD)-'materialized_at'-'materialized_items') THEN RETURN NEW; END IF;
 RAISE EXCEPTION 'pitwall_learning.capture_batches is immutable' USING ERRCODE='PWL03';
END $fn$;
CREATE OR REPLACE FUNCTION pitwall_learning.reject_source_revision_mutation() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pitwall_learning,pg_temp AS $fn$
BEGIN
 IF session_user IN('pitwall_learning_worker','postgres','supabase_admin')
  AND current_setting('pitwall_learning.retention_delete',true)='on' THEN
  IF TG_OP='DELETE' AND OLD.created_at<clock_timestamp()-interval '180 days' THEN RETURN OLD; END IF;
  IF TG_OP='UPDATE' AND OLD.capture_batch_id IS NOT NULL AND NEW.capture_batch_id IS NULL
   AND OLD.server_receipt_at<clock_timestamp()-interval '7 days'
   AND (to_jsonb(NEW)-'capture_batch_id') IS NOT DISTINCT FROM (to_jsonb(OLD)-'capture_batch_id') THEN RETURN NEW; END IF;
 END IF;
 IF TG_OP='UPDATE' AND OLD.owner_user_id IS NOT NULL AND NEW.owner_user_id IS NULL
  AND (to_jsonb(NEW)-'owner_user_id'-'owner_basis') IS NOT DISTINCT FROM (to_jsonb(OLD)-'owner_user_id'-'owner_basis') THEN
  NEW.owner_basis:='none'; RETURN NEW;
 END IF;
 RAISE EXCEPTION 'pitwall_learning.source_revisions is immutable' USING ERRCODE='PWL02';
END $fn$;

CREATE FUNCTION pitwall_learning.fuel_worker_retention(p_limit integer DEFAULT 1000) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pitwall_learning,pg_temp AS $fn$
DECLARE n integer; result jsonb:='{}'; previous text;
BEGIN
 IF session_user NOT IN('pitwall_learning_worker','postgres','supabase_admin') THEN RAISE EXCEPTION 'Not a learning worker' USING ERRCODE='42501'; END IF;
 IF p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 1000 THEN RAISE EXCEPTION 'Invalid retention bound' USING ERRCODE='22023'; END IF;
 previous:=current_setting('pitwall_learning.retention_delete',true);
 PERFORM set_config('pitwall_learning.retention_delete','on',true);
 -- Reader revocation/expiry fences are immediate; maintenance retires metadata in bounded pages.
 WITH stale AS(SELECT m.id FROM pitwall_learning.models m LEFT JOIN pitwall_learning.account_policy a ON a.owner_user_id=m.owner_user_id
  WHERE m.state IN('active','shadow','draft') AND (m.created_at<clock_timestamp()-interval '7 days'
   OR a.owner_user_id IS NULL OR NOT(a.capture_enabled AND a.personal_fit_enabled) OR a.policy_version<>m.policy_version)
  ORDER BY m.created_at LIMIT p_limit FOR UPDATE OF m SKIP LOCKED)
 UPDATE pitwall_learning.models m SET state='retired',retired_at=clock_timestamp() FROM stale WHERE m.id=stale.id;
 GET DIAGNOSTICS n=ROW_COUNT;result:=result||jsonb_build_object('retiredModels',n);
 WITH stale AS(SELECT d.id FROM pitwall_learning.deployments d JOIN pitwall_learning.models m ON m.id=d.model_id
  WHERE d.state IN('active','shadow') AND m.state='retired' ORDER BY d.created_at LIMIT p_limit FOR UPDATE OF d SKIP LOCKED)
 UPDATE pitwall_learning.deployments d SET state='retired',retired_at=clock_timestamp() FROM stale WHERE d.id=stale.id;
 WITH expired AS(SELECT id FROM pitwall_learning.predictions WHERE retention_expires_at<=clock_timestamp() ORDER BY retention_expires_at LIMIT p_limit FOR UPDATE SKIP LOCKED)
 DELETE FROM pitwall_learning.predictions p USING expired WHERE p.id=expired.id;
 GET DIAGNOSTICS n=ROW_COUNT;result:=result||jsonb_build_object('predictions',n);
 WITH expired AS(SELECT id FROM pitwall_learning.evaluations WHERE retention_expires_at<=clock_timestamp() ORDER BY retention_expires_at LIMIT p_limit FOR UPDATE SKIP LOCKED)
 DELETE FROM pitwall_learning.evaluations p USING expired WHERE p.id=expired.id;
 GET DIAGNOSTICS n=ROW_COUNT;result:=result||jsonb_build_object('evaluations',n);
 WITH expired AS(SELECT e.id FROM pitwall_learning.examples e WHERE e.retention_expires_at<=clock_timestamp()
  AND NOT EXISTS(SELECT 1 FROM pitwall_learning.predictions p WHERE p.example_id=e.id)
  ORDER BY e.retention_expires_at LIMIT p_limit FOR UPDATE SKIP LOCKED)
 DELETE FROM pitwall_learning.examples p USING expired WHERE p.id=expired.id;
 GET DIAGNOSTICS n=ROW_COUNT;result:=result||jsonb_build_object('examples',n);
 WITH expired AS(SELECT id FROM pitwall_learning.jobs WHERE
   (finished_at<clock_timestamp()-interval '7 days' OR created_at<clock_timestamp()-interval '7 days')
   AND (status<>'leased' OR lease_expires_at<=clock_timestamp()) ORDER BY created_at LIMIT p_limit FOR UPDATE SKIP LOCKED)
 DELETE FROM pitwall_learning.jobs p USING expired WHERE p.id=expired.id;
 GET DIAGNOSTICS n=ROW_COUNT;result:=result||jsonb_build_object('jobs',n);
 WITH expired AS(SELECT r.id FROM pitwall_learning.source_revisions r WHERE r.created_at<clock_timestamp()-interval '180 days'
  AND NOT EXISTS(SELECT 1 FROM pitwall_learning.examples e WHERE e.source_revision_id=r.id)
  AND NOT EXISTS(SELECT 1 FROM pitwall_learning.predictions p WHERE p.source_revision_id=r.id)
  AND NOT EXISTS(SELECT 1 FROM pitwall_learning.jobs j WHERE j.source_revision_id=r.id)
  ORDER BY r.created_at LIMIT p_limit FOR UPDATE SKIP LOCKED)
 DELETE FROM pitwall_learning.source_revisions p USING expired WHERE p.id=expired.id;
 GET DIAGNOSTICS n=ROW_COUNT;result:=result||jsonb_build_object('revisions',n);
 WITH expired AS(SELECT b.id FROM pitwall_learning.capture_batches b WHERE b.received_at<clock_timestamp()-interval '7 days'
  AND NOT EXISTS(SELECT 1 FROM pitwall_learning.jobs j WHERE j.capture_batch_id=b.id)
  ORDER BY b.received_at LIMIT p_limit FOR UPDATE SKIP LOCKED)
 DELETE FROM pitwall_learning.capture_batches p USING expired WHERE p.id=expired.id;
 GET DIAGNOSTICS n=ROW_COUNT;result:=result||jsonb_build_object('batches',n);
 WITH expired AS(SELECT id FROM pitwall_learning.deployments WHERE state IN('retired','rolled_back') AND retired_at<clock_timestamp()-interval '90 days'
  ORDER BY retired_at LIMIT p_limit FOR UPDATE SKIP LOCKED)
 DELETE FROM pitwall_learning.deployments p USING expired WHERE p.id=expired.id;
 WITH expired AS(SELECT m.id FROM pitwall_learning.models m WHERE m.state='retired' AND m.retired_at<clock_timestamp()-interval '90 days'
  AND NOT EXISTS(SELECT 1 FROM pitwall_learning.predictions p WHERE p.model_id=m.id)
  AND NOT EXISTS(SELECT 1 FROM pitwall_learning.evaluations e WHERE e.model_id=m.id)
  AND NOT EXISTS(SELECT 1 FROM pitwall_learning.deployments d WHERE d.model_id=m.id)
  ORDER BY m.retired_at LIMIT p_limit FOR UPDATE SKIP LOCKED)
 DELETE FROM pitwall_learning.models p USING expired WHERE p.id=expired.id;
 GET DIAGNOSTICS n=ROW_COUNT;result:=result||jsonb_build_object('models',n);
 PERFORM set_config('pitwall_learning.retention_delete',coalesce(previous,''),true);
 RETURN result;
END $fn$;
REVOKE ALL ON FUNCTION pitwall_learning.fuel_worker_retention(integer) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION pitwall_learning.fuel_worker_retention(integer) TO pitwall_learning_worker;
COMMIT;
