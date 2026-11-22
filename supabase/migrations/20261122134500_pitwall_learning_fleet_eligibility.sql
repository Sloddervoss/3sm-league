-- Personal fuel learning — fleet eligibility repair.
--
-- Two production defects are corrected without changing the schema, the
-- connector protocol or any existing account row:
--
--   1. fuel_worker_provision listed device_status values that the live
--      simhub_devices constraint cannot contain ('bound', 'active') and omitted
--      the real bound status ('active_binding'). Owners with three recent
--      0.7.6.4 active_binding devices were therefore never enrolled.
--   2. An enrolled account could still feed Auto Learn from a second, old
--      device on the same account. The worker now requires the *source device*
--      to report a connector version that actually contains the v2 fuel-quality
--      producer. The version is read from simhub_telemetry_latest, which
--      simhub_persist_v3 writes in the same transaction before the measurement
--      batch, so the check is per row/device rather than per account.
--
-- The minimum is 0.7.6.3: the v2 producer (observation version 2 plus the five
-- fuelQuality fields) was introduced in 5db05ec8 and shipped in the 0.7.6.3
-- connector. The source file ObservationCapture.cs is byte-identical from
-- 843c8a00 (0.7.6.3 bump) through 0.7.6.5, so 0.7.6.4/0.7.6.5 are above the
-- gate and 0.7.6.2 and older are below it. fuel_worker_record keeps enforcing
-- the actual payload capability, so a forged/wrong version string cannot
-- create a training example on its own.
--
-- Opt-outs are preserved: provisioning still skips every owner that already
-- has an account_policy row; disabled capture/personal-fit, history and
-- research rows are never updated or deleted. No connector re-pairing or
-- client change is required.
--
-- Forward is one transaction. Paired data-preserving rollback:
-- supabase/rollbacks/20261122134500_pitwall_learning_fleet_eligibility.sql
BEGIN;

DO $guard$
BEGIN
  IF to_regprocedure('pitwall_learning.fuel_worker_provision(integer)') IS NULL
     OR to_regprocedure('pitwall_learning.fuel_worker_source(uuid,uuid)') IS NULL THEN
    RAISE EXCEPTION 'fleet eligibility requires the fuel worker functions';
  END IF;
  IF to_regclass('public.simhub_devices') IS NULL
     OR to_regclass('public.simhub_device_health') IS NULL
     OR to_regclass('public.simhub_telemetry_latest') IS NULL
     OR to_regclass('pitwall_learning.account_policy') IS NULL THEN
    RAISE EXCEPTION 'fleet eligibility baseline objects are missing';
  END IF;
END
$guard$;

-- Parse the connector's four-part (or, defensively, three-part) version and
-- compare it as integers. Malformed, empty and NULL values are false: unknown
-- is never treated as capable.
CREATE FUNCTION pitwall_learning.connector_supports_fuel_learning(p_version text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path = pg_catalog, pg_temp
AS $fn$
  SELECT coalesce(
    p_version ~ '^[0-9]{1,4}(\.[0-9]{1,4}){2,3}$'
    AND (string_to_array(p_version, '.') || ARRAY['0','0','0','0'])[1:4]::integer[]
        >= ARRAY[0,7,6,3],
    false)
$fn$;

REVOKE ALL ON FUNCTION pitwall_learning.connector_supports_fuel_learning(text)
  FROM PUBLIC, anon, authenticated, service_role, pitwall_learning_worker;

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
  WHERE d.device_status IN ('active_binding','active_unbound','bound','active')
   AND d.revoked_at IS NULL
   AND d.last_seen_at>clock_timestamp()-interval '30 days'
   AND pitwall_learning.connector_supports_fuel_learning(h.connector_version)
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
 -- Per-source-device capability. A mixed-version account (new binding plus an
 -- old spare PC) must not let the old device's rows become training examples.
 -- The row must still belong to the same owner and the source device must have
 -- reported a capable connector version. Missing telemetry/version = refused.
 IF NOT EXISTS(
   SELECT 1 FROM public.simhub_telemetry_latest t
   WHERE t.device_id::text=r.device_id
     AND t.owner_user_id=r.owner_user_id
     AND pitwall_learning.connector_supports_fuel_learning(t.connector_version)
 ) THEN RETURN NULL; END IF;
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

COMMENT ON FUNCTION pitwall_learning.connector_supports_fuel_learning(text) IS
  'True only for a well-formed connector version >= 0.7.6.3, the first release containing the v2 fuelQuality producer. Unknown/null is false.';

-- CREATE OR REPLACE keeps the existing owner and ACLs. Re-assert the worker
-- grant explicitly so a future manual recreation cannot silently drop it.
REVOKE ALL ON FUNCTION pitwall_learning.fuel_worker_provision(integer)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION pitwall_learning.fuel_worker_source(uuid,uuid)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION pitwall_learning.fuel_worker_provision(integer),
                        pitwall_learning.fuel_worker_source(uuid,uuid)
  TO pitwall_learning_worker;

COMMIT;
