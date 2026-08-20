-- PostgreSQL cannot remove individual enum values without rebuilding app_role and
-- every dependent object. This rollback is deliberately non-destructive: the two
-- now-unused values remain valid enum labels after helpers, policies and grants are
-- removed by their own rollbacks. The guarded notices make this safely rerunnable.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_type t
    JOIN pg_namespace n ON n.oid = t.typnamespace
    JOIN pg_enum e ON e.enumtypid = t.oid
    WHERE n.nspname = 'public' AND t.typname = 'app_role' AND e.enumlabel = 'tester'
  ) THEN
    RAISE NOTICE 'Leaving app_role value tester in place (safe non-destructive rollback)';
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_type t
    JOIN pg_namespace n ON n.oid = t.typnamespace
    JOIN pg_enum e ON e.enumtypid = t.oid
    WHERE n.nspname = 'public' AND t.typname = 'app_role' AND e.enumlabel = 'endurance_manager'
  ) THEN
    RAISE NOTICE 'Leaving app_role value endurance_manager in place (safe non-destructive rollback)';
  END IF;
END
$$;
