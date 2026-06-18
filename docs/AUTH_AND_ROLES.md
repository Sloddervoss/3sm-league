# AUTH_AND_ROLES

## Auth provider

File: `src/contexts/AuthContext.tsx`

Behavior:

- Loads current Supabase session with `supabase.auth.getSession()`.
- Subscribes to auth changes with `supabase.auth.onAuthStateChange()`.
- Reads `user_roles` for the current user.
- Exposes:
  - `session`
  - `user`
  - `isAdmin`
  - `isSuperAdmin`
  - `isSteward`
  - `isEditor`
  - `loading`
  - `rolesLoading`
  - `signOut()`

Role mapping in `AuthContext.tsx`:

| DB role | Frontend flag | Meaning in UI |
|---|---|---|
| `admin` | `isAdmin` | Admin dashboard/management |
| `super_admin` | `isSuperAdmin` | Elevated admin/role protection |
| `moderator` | `isSteward` | Steward/moderator workflows |
| `editor` | `isEditor` | News editor without full admin |

## Database roles

Enum `app_role` is created and extended by migrations:

- `supabase/migrations/20260316174919_ab6aa480-9e30-4985-a9a4-79cbffa03866.sql`
- `supabase/migrations/20260320200000_super_admin.sql`
- `supabase/migrations/20260601090000_editor_role_and_news_access.sql`

Current generated type in `src/integrations/supabase/types.ts`:

```ts
"admin" | "moderator" | "user" | "super_admin" | "editor"
```

## Route/page guards

Guards are implemented inside page components, not through a central protected-route wrapper.

| Page | File | Guard behavior |
|---|---|---|
| `/admin` | `src/pages/AdminPage.tsx` | Requires logged in and `isAdmin`; `isSuperAdmin` alone is not accepted by this page guard |
| `/admin/track-intelligence*` | `src/pages/TrackIntelligenceTestPage.tsx` | Requires logged in and `isAdmin`; `isSuperAdmin` alone is not accepted by this page guard |
| `/news-editor` | `src/pages/NewsEditorPage.tsx` | Requires `isAdmin || isSuperAdmin || isEditor` |
| `/stewards` | `src/pages/StewardPage.tsx` | Requires login; full moderation uses `isAdmin || isSteward` |
| `/profile` | `src/pages/ProfilePage.tsx` | Requires login |
| `/koppel` | `src/pages/KoppelPage.tsx` | Requires login to claim token; redirects through `/auth?redirect=...` |
| `/auth` | `src/pages/AuthPage.tsx` | Public auth page |

Navigation visibility is controlled in `src/components/Navbar.tsx`:

- Admin nav: `isAdmin || isSuperAdmin`.
- Redactie/news editor nav: `isAdmin || isSuperAdmin || isEditor`.
- Stewards nav: `isAdmin || isSuperAdmin || isSteward`.

## Admin role management

Main UI:

- `src/pages/admin/DriversList.tsx`

RPCs used:

- `admin_get_all_profiles`
- `admin_get_user_roles`
- `admin_grant_role`
- `admin_revoke_role`
- `admin_delete_user`

Important migrations:

- `supabase/migrations/20260320200000_super_admin.sql`
- `supabase/migrations/20260601090000_editor_role_and_news_access.sql`
- `supabase/migrations/20260522170000_tighten_public_policies.sql`
- `supabase/migrations/20260523120000_harden_has_role_rpc.sql`
- `supabase/migrations/20260601153000_grant_has_role_for_rls_policies.sql`

Protection rules visible in migrations:

- `super_admin` cannot be granted/revoked through admin RPC.
- Super admin deletion is protected.
- Later role RPCs allow editor management by admin/super_admin, while other elevated roles are more restricted.

## RLS helper `has_role`

- Initially created in `20260316174919_ab6aa480-9e30-4985-a9a4-79cbffa03866.sql`.
- Hardened in `20260523120000_harden_has_role_rpc.sql`.
- Later granted to anon in `20260601153000_grant_has_role_for_rls_policies.sql` so public policies using it do not fail; function should return false for anon.

The hardened intent is to avoid a cross-user role oracle while preserving RLS policy evaluation.

## Auth-related tables

- `profiles`
  - Created automatically for new auth users by `handle_new_user()` trigger in initial migration.
- `user_roles`
  - Stores app roles.
- `discord_link_tokens`
  - Used to link Discord and website identities.
- `discord_link_codes`
  - Older Discord link flow.

## Discord linking

Website:

- `src/pages/KoppelPage.tsx`
- RPC: `discord_claim_token`

Bot:

- `bot/index.js`
- `/koppel` creates a row in `discord_link_tokens` and sends a site link.

Profile:

- `profiles.discord_id` was added by `supabase/migrations/20260328140000_discord_integration.sql`.

## Editor role

- Added in `supabase/migrations/20260601090000_editor_role_and_news_access.sql`.
- UI access:
  - `src/pages/NewsEditorPage.tsx`
  - `src/components/Navbar.tsx`
- Purpose: edit/publish news without broad admin access.

## Steward/moderator role

- DB role: `moderator`.
- Frontend name: `isSteward`.
- Primary UI:
  - `src/pages/StewardPage.tsx`
- Can moderate protests/penalties per RLS/RPC policies.

## Storage access

- `news-images` policies are tied to editor/admin/super_admin access in `20260601090000_editor_role_and_news_access.sql`.
- `announcement-images` policies are created/managed in `20260415100000_announcement_images_bucket.sql` and tightened later.

## Risks and things to verify before changing roles

- Keep UI guards and RLS/RPC policies aligned. UI-only checks are not security boundaries.
- Super admin behavior is special; do not accidentally allow granting/revoking/deleting super admins.
- `moderator` and “steward” are the same concept in different naming layers.
- `admin_get_all_profiles` defining migration was not found. Zeker maken: productie DB functie-definitie uitlezen en ontbrekende migration toevoegen of expliciet documenteren.
- Navbar allows `super_admin` into admin navigation, but `/admin` and `/admin/track-intelligence*` currently require `isAdmin` only. Zeker maken of dit bug of rolconventie is: test/read a live user with only `super_admin`, or verify that every super_admin also receives `admin` in `user_roles`.
