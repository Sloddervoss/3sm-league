# API_ROUTES

This project does not define a traditional Express/Next backend API in the repo. Backend API surfaces are Supabase REST/Auth/Storage/RPC/Edge Functions plus Discord bot interactions.

## Supabase base configuration

- Browser client: `src/integrations/supabase/client.ts`
- Required frontend env vars:
  - `VITE_SUPABASE_URL`
  - `VITE_SUPABASE_ANON_KEY`
- Supabase project config file: `supabase/config.toml`
  - `project_id = "cwwfriypwdluynajubhz"`
- Bot/service client env vars are documented in `bot/.env.example`:
  - `SUPABASE_URL`
  - `SUPABASE_SERVICE_KEY`

## Supabase REST surfaces

The frontend uses Supabase PostgREST through `@supabase/supabase-js`, e.g. `.from(...).select/insert/update/upsert/delete`.

Important table endpoints used by the website include:

- `profiles`
- `confirmed_profiles` view
- `user_roles`
- `leagues`
- `races`
- `race_registrations`
- `season_registrations`
- `race_results`
- `race_session_results`
- `teams`
- `team_memberships`
- `team_creation_requests`
- `protests`
- `penalties`
- `points_config`
- `driver_3sr`
- `race_3sr_results`
- `v_3sr_race_eligibility` view
- `announcements`
- `news_posts`
- `discord_link_tokens`
- `discord_sync_queue`
- `member_track_history` (migration exists; generated TS types appear stale)
- `track_intelligence_runs` (migration exists; generated TS types appear stale)

## RPC/functions

Functions present in `src/integrations/supabase/types.ts` and/or migrations:

| RPC | Source / usage | Purpose |
|---|---|---|
| `_3sr_rank_label` | `supabase/migrations/20260321110000_3sr_functions.sql` | Convert 3SR score/race count to label |
| `admin_delete_user` | `20260320200000_super_admin.sql`, used by `src/pages/admin/DriversList.tsx` | Admin/super_admin delete user profile/auth user |
| `admin_get_all_profiles` | Used by `src/pages/admin/DriversList.tsx`, listed in `types.ts`; defining migration not found | Admin profile listing; onzeker source |
| `admin_get_user_roles` | `20260320200000_super_admin.sql`, used by `DriversList.tsx` | List roles for admin UI |
| `admin_grant_role` | `20260320200000_super_admin.sql`, updated later | Grant app roles with super_admin protection |
| `admin_revoke_role` | `20260320200000_super_admin.sql`, updated later | Revoke app roles with super_admin protection |
| `discord_claim_token` | `20260403100000_discord_link_tokens.sql`, used by `src/pages/KoppelPage.tsx` | Claim Discord link token for logged-in website user |
| `discord_link_account` | `20260328140000_discord_integration.sql` | Older code-based Discord link flow |
| `discord_register_race` | `20260328140000_discord_integration.sql`, used by bot | Register/unregister race from Discord ID |
| `get_driver_sp` | `20260412100000_steward_sp_system.sql`, used by `src/pages/StewardPage.tsx` | Calculate steward points |
| `has_role` | initial migration, hardened later | RLS/helper role check |
| `recalculate_3sr_all` | 3SR migrations | Recalculate all 3SR |
| `recalculate_3sr_for_race` | 3SR migrations, used by steward/admin flows | Recalculate 3SR for one race |
| `uid` | Listed in `types.ts`; source uncertain | Unzeker |

## Edge Functions

### `supabase/functions/sync-irating/index.ts`

- Invoked from admin UI in `src/pages/AdminPage.tsx`.
- Uses service role key.
- Uses iRacing credentials from env:
  - `IRACING_EMAIL`
  - `IRACING_PASSWORD`
- Reads profiles with iRacing IDs.
- Updates `profiles.irating` and `profiles.safety_rating`.

### `supabase/functions/track-intelligence-sync/index.ts`

- Invoked from `src/pages/TrackIntelligenceTestPage.tsx`.
- Requires Authorization header and authenticated Supabase user.
- Verifies caller has `admin` or `super_admin` via service client.
- Uses iRacing login/API.
- Writes/upserts `member_track_history`.
- Can update `track_intelligence_runs`.

### `supabase/functions/track-intelligence-upload/index.ts`

- Called by the browser extension in `tools/iracing-content-extension/popup.js`.
- Uses service role key.
- Optional `EXTENSION_API_KEY` validation.
- Accepts uploaded track scan payload.
- Matches a member/profile by iRacing ID/name/candidates.
- Writes `member_track_history` with source `extension_scan`.

## Supabase Storage APIs

Buckets/policies in migrations:

- `announcement-images`
  - Created in `supabase/migrations/20260415100000_announcement_images_bucket.sql`.
  - Used by announcement admin tooling.
- `avatars`
  - Created in `supabase/migrations/20260320120000_avatar_url.sql`.
  - Used by `src/pages/ProfilePage.tsx` via `supabase.storage.from("avatars")`.
- `news-images`
  - Created in `supabase/migrations/20260601090000_editor_role_and_news_access.sql`.
  - Used by `src/pages/NewsEditorPage.tsx`.

## Discord bot command/API surface

`bot/index.js` registers slash commands:

- `/koppel`
- `/races`
- `/site`
- `/aanmelden`
- `/afmelden`
- `/setup-server`
- `/setprofile`
- `/deleteprofile`
- `/invite`

Button custom IDs:

- `aanmelden_<raceId>`
- `afmelden_<raceId>`

The bot uses Discord API via `discord.js`; no separate HTTP server is defined in repo.

## Browser extension upload endpoint

Extension source: `tools/iracing-content-extension/`.

- `tools/iracing-content-extension/popup.js` uploads to:
  - `https://api.3stripemotorsport.cc/functions/v1/track-intelligence-upload`
- Payload includes track list, candidate identity fields and scan metadata.
- The extension source contains an API key constant. Treat as sensitive-ish operational credential even if client-side; rotate/change carefully.

## SEO/indexing external APIs

- `scripts/submit-indexnow.mjs`
  - Reads URLs from `dist/sitemap.xml` unless CLI URLs are passed.
  - Submits to IndexNow.
  - Supports `--dry-run`.
- No Search Console API script was found in the repo during this pass.

## Unzeker

- `admin_get_all_profiles` defining SQL is not found in `supabase/migrations/`. Zeker maken: productie DB functie-definitie uitlezen met een read-only query op `pg_proc`/`pg_get_functiondef` en vergelijken met generated types/UI usage.
- `confirmed_profiles` staat in generated types en wordt gebruikt door queries, maar een `CREATE VIEW confirmed_profiles` migration is niet gevonden. Zeker maken: productie DB view-definitie uitlezen via `pg_views` en migration history controleren.
- `uid` RPC source/purpose is unclear from generated types alone. Zeker maken: productie DB functie-definitie uitlezen en bepalen of dit Supabase-intern, public helper of stale type-output is.
- Live API gateway/proxy config for `api.3stripemotorsport.cc` is outside this repo unless represented by production infrastructure not inspected here. Zeker maken: read-only server/CDN config inspectie uitvoeren.
