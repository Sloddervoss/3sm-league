# Profile data access audit

**Scope:** every direct `from('profiles')` / `from("profiles")` call found on 2026-07-12 after the profile-read hardening change. The new forward migration is `20260712100000_harden_profile_reads.sql`; it has **not** been applied from this repository.

## Public read contract

Public driver, standings, race-registration, and news-author UIs now read only `public_profiles`. Its fixed projection is:

- `user_id`, `display_name`, `iracing_name`, `avatar_url`
- `irating`, `safety_rating`, `team_id`

It intentionally excludes `id`, `discord_id`, `iracing_id`, `created_at`, and `updated_at`. `confirmed_profiles` has no browser grant after the migration, so it cannot remain an alternate identifier leak.

## Direct raw-table calls

Each row covers **every** direct call in its named file; the call count is included so this remains a complete audit rather than a sample. Calls grouped in a row share the same authorization boundary.

| Location | Calls | Classification | Reason / authorization boundary |
| --- | ---: | --- | --- |
| `src/lib/useRegistration.ts` | 1 | Self-only | Reads the current user's profile to assess registration completeness. |
| `src/components/UpcomingRaces.tsx` | 1 | Self-only | Reads the current user's iRacing linkage for their registration state. |
| `src/pages/ProfilePage.tsx` | 6 | Self-only | Full editable profile read and self-scoped writes, including Discord unlink. |
| `src/pages/admin/SeasonsAdmin.tsx` | 1 | Staff | Admin season/registration management requires iRacing matching data. |
| `src/pages/admin/ResultsImportAdmin.tsx` | 3 | Staff | Admin result matching and iRating/SR updates. |
| `src/pages/admin/TeamsAdmin.tsx` | 1 | Staff write | Admin team-approval workflow assigns the requester's team. |
| `src/pages/AdminPage.tsx` | 1 | Staff | Admin dashboard driver count. |
| `src/pages/TrackIntelligenceTestPage.tsx` | 1 | Staff | Admin/super-admin linked iRacing-member scan. |
| `src/pages/AdminWorkspacePrototype.tsx` | 1 | Staff | Admin/super-admin Track Intelligence preview. |
| `src/features/control-room/track/useTrackIntelligence.ts` | 1 | Staff | Admin/super-admin linked iRacing-member sync data. |
| `src/features/control-room/results/ResultImportWorkspace.tsx` | 3 | Staff | Admin result import matching and profile ratings updates. |
| `src/features/control-room/season/SeasonRaceWorkspace.tsx` | 1 | Staff | Control Room registration context including iRacing ID. |
| `src/features/control-room/community/CommunityModule.tsx` | 1 | Staff write | Team-request approval assigns the requester’s team. |
| `supabase/functions/sync-irating/index.ts` | 2 | Service-role backend | Scheduled/privileged iRating synchronization. |
| `supabase/functions/track-intelligence-sync/index.ts` | 1 | Service-role backend | Privileged linked-member track sync. |
| `supabase/functions/track-intelligence-upload/index.ts` | 4 | Service-role backend | Privileged extension upload identity validation/update. |
| `scripts/sync-irating.js` | 2 | Operator service script | Server-side iRating synchronization. |
| `bot/index.js` | 5 | Discord bot service client | Discord account lookup/linking and bot registration flows. |
| `src/test/profileReadHardening.test.ts` | 2 | Regression-test literals | Static source assertions; it does not create a Supabase client or issue a query. |

The raw table’s forward RLS policy permits an authenticated member only where `auth.uid() = user_id`; it separately permits staff roles (`admin`, `super_admin`, `moderator`) for the operational paths above. `anon` has no raw-table privilege, and a normal authenticated member cannot enumerate another member’s row or the full table.

## Migrated safe UI reads

The following non-staff and public/staff-display-only paths previously queried `profiles` and now use `public_profiles`:

- `src/hooks/data/useSharedQueries.ts` (`useDrivers`)
- `src/pages/HomepagePrototype.tsx`
- `src/pages/NewsPage.tsx`
- `src/pages/NewsAuthorPage.tsx`
- `src/pages/NewsDetailPage.tsx`
- `src/pages/StandingsPage.tsx`
- `src/components/StandingsStrip.tsx`
- `src/components/preview/RaceModal.tsx`
- `src/features/control-room/season/SeasonCarLockManager.tsx`
- `src/features/control-room/stewarding/UserProtestWorkspace.tsx`
- `src/features/control-room/stewarding/StewardingWorkspace.tsx`

No public route should use `profiles` for a display list. New call sites must use `public_profiles` unless they are one of the audited self, staff, or service-role cases above.
