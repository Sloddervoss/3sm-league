-- Rollback voor 20261027090000_profile_team_assignment_rpc.sql
--
-- Draait alles terug wat de migratie doet:
--   * de zes RPC's;
--   * de partiële unieke index op iracing_id;
--   * de kolommen rating_source en rating_updated_at (+ de check-constraint);
--   * de kolomgrants op public.profiles en de schrijfgrants op
--     public.team_memberships (terug naar de situatie van
--     20260712100000_harden_profile_reads.sql).
--
-- Data blijft staan: irating, safety_rating, iracing_id, team_id en de
-- team_memberships-rijen worden niet aangeraakt. Alleen de herkomst-metadata
-- (rating_source, rating_updated_at) verdwijnt, omdat het schema van vóór deze
-- migratie daar geen kolom voor heeft; de ratings zelf blijven dus intact.
--
-- In één keer uitvoerbaar met `psql -f`.

BEGIN;

DROP FUNCTION IF EXISTS public.admin_set_team(UUID, UUID);
DROP FUNCTION IF EXISTS public.leave_team();
DROP FUNCTION IF EXISTS public.join_team(UUID);
DROP FUNCTION IF EXISTS public.update_own_racing_profile(TEXT, INTEGER, TEXT);
DROP FUNCTION IF EXISTS public.unlink_own_discord();
DROP FUNCTION IF EXISTS public.admin_update_driver_ratings(UUID, INTEGER, TEXT);

DROP INDEX IF EXISTS public.profiles_iracing_id_uniq;

ALTER TABLE public.profiles
  DROP CONSTRAINT IF EXISTS profiles_rating_source_check;

ALTER TABLE public.profiles
  DROP COLUMN IF EXISTS rating_updated_at,
  DROP COLUMN IF EXISTS rating_source;

REVOKE UPDATE (display_name, iracing_name, avatar_url) ON TABLE public.profiles FROM authenticated;
GRANT UPDATE ON TABLE public.profiles TO authenticated;

REVOKE INSERT (user_id, display_name, iracing_name, avatar_url) ON TABLE public.profiles FROM authenticated;
GRANT INSERT ON TABLE public.profiles TO authenticated;

-- Herstel de rechtstreekse membership-schrijfweg. RLS ("Users can manage own
-- team memberships") begrenst die weer tot de eigen rijen.
GRANT INSERT, UPDATE, DELETE ON TABLE public.team_memberships TO anon, authenticated;

COMMIT;
