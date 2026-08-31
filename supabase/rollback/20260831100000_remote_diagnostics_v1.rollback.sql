-- ============================================================================
-- Rollback: Remote Diagnostics v1 — 20260831100000
-- ============================================================================

DROP FUNCTION IF EXISTS simhub_insert_diagnostic_event;
DROP FUNCTION IF EXISTS simhub_upsert_health;

DROP POLICY IF EXISTS simhub_device_diagnostic_events_admin_read ON simhub_device_diagnostic_events;
DROP POLICY IF EXISTS simhub_device_diagnostic_events_service_write ON simhub_device_diagnostic_events;
DROP POLICY IF EXISTS simhub_device_health_admin_read ON simhub_device_health;
DROP POLICY IF EXISTS simhub_device_health_service_write ON simhub_device_health;

DROP TABLE IF EXISTS simhub_device_diagnostic_events;
DROP TABLE IF EXISTS simhub_device_health;

DROP TYPE IF EXISTS simhub_diagnostic_code;