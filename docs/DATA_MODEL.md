# DATA_MODEL

This map is based on `supabase/migrations/` and `src/integrations/supabase/types.ts`. Where generated types and migrations disagree, the disagreement is called out.

## Source files

- Initial schema: `supabase/migrations/20260316174919_ab6aa480-9e30-4985-a9a4-79cbffa03866.sql`
- Main migrations: `supabase/migrations/*.sql`
- Generated client types: `src/integrations/supabase/types.ts`
- Supabase client: `src/integrations/supabase/client.ts`

## Core identity/auth tables

### `profiles`

Created in initial migration. Represents app users/profile details and is linked to `auth.users` by user id.

Known uses:

- `src/contexts/AuthContext.tsx` indirectly through `user_roles`.
- `src/pages/ProfilePage.tsx`
- `src/pages/DriversPage.tsx`
- `src/pages/admin/DriversList.tsx`
- bot Discord nickname/profile sync.

Notable columns added later include Discord/iRacing/avatar/admin profile fields. See migrations:

- `20260320120000_avatar_url.sql`
- `20260328140000_discord_integration.sql`
- `20260321120000_admin_profile_update.sql`

### `user_roles`

- Stores `app_role` entries per user.
- Read by `src/contexts/AuthContext.tsx`.
- Managed by admin RPCs and `src/pages/admin/DriversList.tsx`.

### Enum `app_role`

Current values in `src/integrations/supabase/types.ts`:

- `admin`
- `moderator`
- `user`
- `super_admin`
- `editor`

Frontend maps `moderator` to steward.

## Racing/league tables

### `leagues`

Seasons/competitions. Used by calendar, standings, seasons, admin and news relations.

Frontend files:

- `src/pages/CalendarPage.tsx`
- `src/pages/StandingsPage.tsx`
- `src/pages/SeasonsPage.tsx`
- `src/pages/admin/SeasonsAdmin.tsx`
- `src/pages/NewsEditorPage.tsx`

### `races`

Race calendar entries and completed race metadata.

Used by:

- `src/pages/CalendarPage.tsx`
- `src/pages/ResultsPage.tsx`
- `src/pages/RaceDetailPage.tsx`
- `src/pages/admin/ResultsImportAdmin.tsx`
- `scripts/generate-route-html.mjs`
- Discord bot race reminders/results.

Known status handling includes upcoming/completed/cancelled. `20260328120000_race_cancelled_status.sql` adds cancellation status support.

### `race_registrations`

Per-race user registrations.

Used by:

- `src/lib/useRegistration.ts`
- `src/components/preview/RaceModal.tsx`
- Discord bot `/aanmelden` and `/afmelden` through RPC `discord_register_race`.

### `season_registrations`

Season/league registration table.

Migration:

- `supabase/migrations/20260316220000_season_registrations_team_requests.sql`

Used by:

- `src/lib/useRegistration.ts`
- `src/components/preview/RaceModal.tsx`

### `race_results`

Main race result rows.

Used by:

- `src/pages/ResultsPage.tsx`
- `src/pages/RaceDetailPage.tsx`
- `src/pages/StandingsPage.tsx`
- `src/pages/DriversPage.tsx`
- `src/pages/TeamsPage.tsx`
- `src/pages/ProfilePage.tsx`
- `src/pages/admin/ResultsImportAdmin.tsx`
- `src/pages/StewardPage.tsx`
- `scripts/generate-route-html.mjs`
- Discord bot result posting.

Enriched by migrations:

- `20260526185000_iracing_result_enrichment.sql`
- `20260531002000_iracing_session_results.sql`

### `race_session_results`

Session-level/extra iRacing import data.

Migration:

- `supabase/migrations/20260531002000_iracing_session_results.sql`

Used by:

- `src/pages/RaceDetailPage.tsx`
- `src/pages/admin/ResultsImportAdmin.tsx`

## Standings/3SR tables and views

### `driver_3sr`

Driver 3SR aggregate. Used by `src/components/preview/DriverModal.tsx`.

### `race_3sr_results`

Per-race 3SR calculation output.

### `v_3sr_race_eligibility`

View for 3SR eligibility.

### RPCs

- `_3sr_rank_label`
- `recalculate_3sr_for_race`
- `recalculate_3sr_all`

Defined/hardened in:

- `supabase/migrations/20260321100000_3sr_schema.sql`
- `supabase/migrations/20260321110000_3sr_functions.sql`
- `supabase/migrations/20260523080000_harden_3sr_recalculation_rpc.sql`

## Teams

### `teams`

Used by team directory, admin, registrations and Discord sync.

### `team_memberships`

Links users to teams.

Used by:

- `src/pages/TeamsPage.tsx`
- `src/pages/ProfilePage.tsx`
- `bot/index.js` team role sync

### `team_creation_requests`

Created by `20260316220000_season_registrations_team_requests.sql`.

Used by `src/pages/ProfilePage.tsx` for team request flows.

## Steward/protest/penalty tables

### `protests`

Created by `20260316200000_teams_protests_penalties.sql`, extended by later steward migrations.

Used by:

- `src/pages/StewardPage.tsx`
- Discord bot steward notifications.

### `penalties`

Created by `20260316200000_teams_protests_penalties.sql`, extended by steward SP migrations.

Used by:

- `src/pages/StewardPage.tsx`
- `src/pages/ResultsPage.tsx`
- `src/pages/RaceDetailPage.tsx`
- Discord bot penalty/decision notifications.

### `points_config`

Created by `20260316200000_teams_protests_penalties.sql`.

Used by admin/points tooling.

## Discord integration tables

### `discord_link_codes`

Older code-based Discord linking table.

Migration:

- `supabase/migrations/20260328140000_discord_integration.sql`

### `discord_link_tokens`

Token-based linking table.

Migration:

- `supabase/migrations/20260403100000_discord_link_tokens.sql`

Used by:

- `bot/index.js` `/koppel`
- `src/pages/KoppelPage.tsx` RPC `discord_claim_token`

### `discord_sync_queue`

Created by `supabase/migrations/20260425160000_discord_sync_queue.sql`.

Used by bot `discordSyncQueue` to sync profile/team/role changes to Discord.

## News/editorial data

### `news_posts`

Created by `supabase/migrations/20260601090000_editor_role_and_news_access.sql` and extended by later news migrations.

Used by:

- `src/pages/NewsPage.tsx`
- `src/pages/NewsDetailPage.tsx`
- `src/pages/NewsAuthorPage.tsx`
- `src/pages/NewsEditorPage.tsx`
- `scripts/generate-route-html.mjs`

Related migrations:

- `20260601103000_news_editor_professional_fields.sql`
- `20260601140000_news_platform_metadata.sql`
- `20260611120000_news_race_link.sql`

### Storage bucket `news-images`

Created by `20260601090000_editor_role_and_news_access.sql`.

Used by `src/pages/NewsEditorPage.tsx`.

## Profile avatars

### Storage bucket `avatars`

Created by `supabase/migrations/20260320120000_avatar_url.sql`.

Used by:

- `src/pages/ProfilePage.tsx` through `supabase.storage.from("avatars")`.

Policies in the migration allow public read and authenticated owner upload/update/delete based on object path/user id.

## Announcements

### `announcements`

Created by `supabase/migrations/20260405120000_announcements.sql`.

Used by:

- `src/pages/admin/AnnouncementsAdmin.tsx`
- Discord bot `checkAnnouncements`.

### Storage bucket `announcement-images`

Created by `supabase/migrations/20260415100000_announcement_images_bucket.sql`.

## Track intelligence

### `track_intelligence_runs`

Created by `supabase/migrations/20260614130000_track_intelligence_test.sql`.

Used by:

- `src/pages/TrackIntelligenceTestPage.tsx`
- `supabase/functions/track-intelligence-sync/index.ts`

### `member_track_history`

Created by `supabase/migrations/20260614130000_track_intelligence_test.sql`.

Source constraint extended by `supabase/migrations/20260614150500_allow_extension_scan_source.sql` to include `extension_scan`.

Used by:

- `src/pages/TrackIntelligenceTestPage.tsx`
- `supabase/functions/track-intelligence-sync/index.ts`
- `supabase/functions/track-intelligence-upload/index.ts`

Important uncertainty: these two tables are not present in `src/integrations/supabase/types.ts`, so generated types appear stale.

## Generated types tables/views/functions

`src/integrations/supabase/types.ts` lists tables including:

- `announcements`
- `news_posts`
- `discord_link_codes`
- `discord_link_tokens`
- `driver_3sr`
- `leagues`
- `penalties`
- `points_config`
- `profiles`
- `protests`
- `race_3sr_results`
- `race_registrations`
- `race_results`
- `race_session_results`
- `races`
- `season_registrations`
- `team_creation_requests`
- `team_memberships`
- `teams`
- `user_roles`

Views include:

- `confirmed_profiles`
- `v_3sr_race_eligibility`

Functions include the RPCs listed in `docs/API_ROUTES.md`.

## RLS pattern summary

- Public read is allowed for many public-facing tables such as races, teams, standings/results and published news.
- User-owned writes are used for profile updates and registrations.
- Admin/super_admin policies govern league/race/team/admin resources.
- `moderator` is used for steward access to protests/penalties.
- Editor role grants access to draft/published news workflows without full admin.

## Unzeker

- `admin_get_all_profiles` exists in generated types and UI usage but defining migration is not found. Zeker maken: productie DB functie-definitie uitlezen met `pg_get_functiondef` en daarna een migration toevoegen of documenteren als bewust externe functie.
- `confirmed_profiles` exists in generated types and frontend usage, but defining migration is not found. Zeker maken: productie DB view-definitie uitlezen met `pg_views` en migration toevoegen als die ontbreekt.
- `track_intelligence_runs` and `member_track_history` exist in migrations but are missing from generated types; this strongly suggests stale generated types or generation from a different DB state. Zeker maken: Supabase types opnieuw genereren tegen de live DB and compare the resulting table list.
- Exact production DB state may include hotfixes outside migrations. Zeker maken: read-only production schema dump or targeted `information_schema`/`pg_catalog` queries before schema-changing work.
