-- SYNTHETIC SQL fixture, never production. All changes roll back.
BEGIN;
DO $guard$ BEGIN
 IF current_database()<>'pitwall_learning_normal_update' OR current_setting('data_directory')<>'/var/lib/postgresql/data'
    OR (pg_control_system()).system_identifier::text<>'7708088208607174673' OR inet_server_addr() IS NOT NULL
 THEN RAISE EXCEPTION 'Not the recorded owned fixture'; END IF;
END $guard$;
INSERT INTO pitwall_learning.capture_batches(id,source_kind,owner_user_id,owner_basis,account_policy_version,item_count,payload,received_at,created_at)
VALUES('b0000000-0000-4000-8000-000000000099','lap_summary',NULL,'none',1,1,'[{}]',now()-interval '8 days',now()-interval '8 days');
INSERT INTO pitwall_learning.source_revisions(id,capture_batch_id,source_kind,device_id,source_uid,record_revision,content_hash,
 source_received_at,server_receipt_at,owner_user_id,owner_basis,account_policy_version,payload,quality_reasons,created_at)
VALUES('e0000000-0000-4000-8000-000000000091','b0000000-0000-4000-8000-000000000099','lap_summary',
 'd0000000-0000-4000-8000-000000000091','e0000000-0000-4000-8000-000000000092',1,repeat('c',32),
 now()-interval '8 days',now()-interval '8 days',NULL,'none',1,'{"sentinel":"retain-unmodified"}',ARRAY['as_of_unverifiable'],now()-interval '8 days'),
 ('e0000000-0000-4000-8000-000000000093',NULL,'lap_summary',
 'd0000000-0000-4000-8000-000000000091','e0000000-0000-4000-8000-000000000094',1,repeat('d',32),
 now()-interval '181 days',now()-interval '181 days',NULL,'none',1,'{"sentinel":"expire"}',ARRAY['as_of_unverifiable'],now()-interval '181 days');
CREATE TEMP TABLE retention_preimage AS SELECT to_jsonb(r)-'capture_batch_id' AS data FROM pitwall_learning.source_revisions r
 WHERE id='e0000000-0000-4000-8000-000000000091';
SET SESSION AUTHORIZATION pitwall_learning_worker;
DO $test$ BEGIN
 BEGIN PERFORM pitwall_learning.fuel_worker_retention(NULL);RAISE EXCEPTION 'NULL limit accepted';
 EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
 BEGIN PERFORM pitwall_learning.fuel_worker_retention(1001);RAISE EXCEPTION 'Unbounded page accepted';
 EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
END $test$;
SELECT pitwall_learning.fuel_worker_retention(1000);
RESET SESSION AUTHORIZATION;
DO $test$ BEGIN
 IF EXISTS(SELECT 1 FROM pitwall_learning.capture_batches WHERE id='b0000000-0000-4000-8000-000000000099') THEN RAISE EXCEPTION 'Expired transport retained';END IF;
 IF EXISTS(SELECT 1 FROM pitwall_learning.source_revisions WHERE id='e0000000-0000-4000-8000-000000000093') THEN RAISE EXCEPTION 'Expired source retained';END IF;
 IF NOT EXISTS(SELECT 1 FROM pitwall_learning.source_revisions r,retention_preimage p WHERE r.id='e0000000-0000-4000-8000-000000000091'
  AND r.capture_batch_id IS NULL AND (to_jsonb(r)-'capture_batch_id')=p.data) THEN RAISE EXCEPTION 'Retained source changed/lost';END IF;
 IF current_setting('pitwall_learning.retention_delete',true)='on' THEN RAISE EXCEPTION 'Maintenance authority tag leaked';END IF;
 BEGIN DELETE FROM pitwall_learning.source_revisions WHERE id='e0000000-0000-4000-8000-000000000091';RAISE EXCEPTION 'Immutable guard disabled';
 EXCEPTION WHEN SQLSTATE 'PWL02' THEN NULL;END;
 IF has_table_privilege('pitwall_learning_worker','pitwall_learning.source_revisions','DELETE')
   OR has_function_privilege('authenticated','pitwall_learning.fuel_worker_retention(integer)','EXECUTE')
 THEN RAISE EXCEPTION 'Maintenance privileges leaked';END IF;
END $test$;
SELECT 'RETENTION_CONTRACT_PASS';
ROLLBACK;
