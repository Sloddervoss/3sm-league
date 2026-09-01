-- ============================================================================
-- Remote Diagnostics v1 — 7-day retention via pg_cron (forward migration)
-- ============================================================================
-- Preconditions: existing pg_cron infrastructure; this migration never creates
-- the extension, changes server configuration, or requires a restart.
--
-- Verified API baseline: pg_cron 1.6.5 provides cron.job(jobid, jobname,
-- username), cron.schedule(text,text,text), and cron.unschedule(bigint).
-- Any deployment with another API/version fails closed below.
--
-- Rollback: supabase/rollback/20260831110001_remote_diagnostics_v1_cron_setup.rollback.sql
-- ============================================================================

-- The cleanup function is created by migration 20260831110000.
-- This migration owns exactly one stable diagnostics job and refuses to modify
-- a same-named job owned by a different database role.
DO $migration$
DECLARE
    v_extension_version text;
    v_job_count integer;
    v_job_id bigint;
    v_job_owner text;
    v_is_superuser boolean;
BEGIN
    SELECT extversion INTO v_extension_version
    FROM pg_extension
    WHERE extname = 'pg_cron';

    IF v_extension_version IS NULL
       OR to_regclass('cron.job') IS NULL
       OR to_regprocedure('cron.schedule(text,text,text)') IS NULL
       OR to_regprocedure('cron.unschedule(bigint)') IS NULL THEN
        RAISE EXCEPTION
            'Remote Diagnostics requires existing pg_cron with cron.job, cron.schedule(text,text,text), and cron.unschedule(bigint); found version %',
            coalesce(v_extension_version, 'absent');
    END IF;

    IF current_setting('cron.database_name', true) IS DISTINCT FROM current_database() THEN
        RAISE EXCEPTION
            'Remote Diagnostics cron setup must run in cron.database_name (%), not current database (%)',
            current_setting('cron.database_name', true), current_database();
    END IF;

    -- cron.job has row-level ownership filtering. Require superuser visibility so
    -- a same-named job owned by another role is never silently replaced.
    SELECT rolsuper INTO v_is_superuser
    FROM pg_roles
    WHERE rolname = current_user;
    IF NOT coalesce(v_is_superuser, false) THEN
        RAISE EXCEPTION
            'Remote Diagnostics cron setup must run as a superuser to verify pg_cron job ownership';
    END IF;

    SELECT count(*) INTO v_job_count
    FROM cron.job
    WHERE jobname = 'diagnostics-7day-cleanup';

    IF v_job_count > 1 THEN
        RAISE EXCEPTION
            'Remote Diagnostics found % jobs named diagnostics-7day-cleanup; refusing ambiguous cron state',
            v_job_count;
    END IF;

    IF v_job_count = 1 THEN
        SELECT jobid, username INTO v_job_id, v_job_owner
        FROM cron.job
        WHERE jobname = 'diagnostics-7day-cleanup';

        IF v_job_owner <> current_user THEN
            RAISE EXCEPTION
                'Remote Diagnostics refuses to replace cron job diagnostics-7day-cleanup owned by %',
                v_job_owner;
        END IF;

        PERFORM cron.unschedule(v_job_id);
    END IF;

    PERFORM cron.schedule(
        'diagnostics-7day-cleanup',
        '0 3 * * *',
        $$SELECT public.simhub_cleanup_old_diagnostic_events();$$
    );

    SELECT count(*) INTO v_job_count
    FROM cron.job
    WHERE jobname = 'diagnostics-7day-cleanup'
      AND username = current_user;
    IF v_job_count <> 1 THEN
        RAISE EXCEPTION
            'Remote Diagnostics expected exactly one owned diagnostics-7day-cleanup cron job, found %',
            v_job_count;
    END IF;
END
$migration$;