-- ============================================================================
-- Rollback: Remote Diagnostics v1 — pg_cron 7-day retention scheduler
-- ============================================================================
-- Unscheduled uitsluitend de diagnostics-7day-cleanup job.
-- Laat de cleanup function intact (wordt verwijderd door hoofdmigration-rollback).
-- ============================================================================

SELECT cron.unschedule('diagnostics-7day-cleanup');