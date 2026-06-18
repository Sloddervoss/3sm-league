# WEBSITE_MAP

## App shell

- `src/main.tsx` mounts the React app.
- `src/App.tsx` wraps the app in:
  - `QueryClientProvider`
  - `TooltipProvider`
  - `BrowserRouter`
  - `LanguageProvider`
  - `AuthProvider`
  - `ErrorBoundary`
  - `Suspense`
- React Query defaults in `src/App.tsx`:
  - `staleTime: 30_000`
  - `gcTime: 5 * 60_000`
  - `retry: 1`
  - `refetchOnWindowFocus: false`

## Routes

Defined in `src/App.tsx`:

| Path | Component | Notes |
|---|---|---|
| `/` | `src/pages/Index.tsx` | Homepage |
| `/calendar` | `src/pages/CalendarPage.tsx` | Race calendar and registrations |
| `/standings` | `src/pages/StandingsPage.tsx` | Championship standings |
| `/drivers` | `src/pages/DriversPage.tsx` | Driver directory |
| `/teams` | `src/pages/TeamsPage.tsx` | Team directory |
| `/results` | `src/pages/ResultsPage.tsx` | Results hub/archive |
| `/results/:raceId` | `src/pages/RaceDetailPage.tsx` | Race detail page |
| `/news` | `src/pages/NewsPage.tsx` | News hub |
| `/news/author/:authorSlug` | `src/pages/NewsAuthorPage.tsx` | Author archive |
| `/news/:categorySlug/:slug` | `src/pages/NewsDetailPage.tsx` | News detail with category |
| `/news/:categorySlug` | `src/pages/NewsCategoryOrDetailPage.tsx` | Category or fallback detail router |
| `/news/:slug` | `src/pages/NewsDetailPage.tsx` | Legacy/short news detail |
| `/seasons` | `src/pages/SeasonsPage.tsx` | Seasons overview |
| `/meedoen` | `src/pages/JoinPage.tsx` | Join/onboarding page |
| `/stewards` | `src/pages/StewardPage.tsx` | Protest/steward workflows |
| `/news-editor` | `src/pages/NewsEditorPage.tsx` | Editorial CMS |
| `/auth` | `src/pages/AuthPage.tsx` | Login/register/reset |
| `/admin` | `src/pages/AdminPage.tsx` | Admin dashboard |
| `/admin/track-intelligence` | `src/pages/TrackIntelligenceTestPage.tsx` | Admin track intelligence |
| `/admin/track-intelligence-test` | `src/pages/TrackIntelligenceTestPage.tsx` | Same component, legacy/test path |
| `/profile` | `src/pages/ProfilePage.tsx` | User profile |
| `/koppel` | `src/pages/KoppelPage.tsx` | Discord linking |
| `*` | `src/pages/NotFound.tsx` | 404 + temporary noindex meta |

## Public pages

### Homepage

- File: `src/pages/Index.tsx`
- Composes:
  - `src/components/Navbar.tsx`
  - `src/components/StickyRaceBar.tsx`
  - `src/components/HeroSection.tsx`
  - `src/components/NextRaceTeaser.tsx`
  - `src/components/RaceRecapPanel.tsx`
  - `src/components/StandingsStrip.tsx`
  - `src/components/Footer.tsx`

### Calendar

- File: `src/pages/CalendarPage.tsx`
- Reads Supabase `races` with `leagues(...)`.
- Reads `leagues`.
- Uses `src/lib/useRegistration.ts` for registration state/mutations.
- Important components:
  - `src/components/preview/NewHeroRace.tsx`
  - `src/components/preview/NewRaceCard.tsx`
  - `src/components/preview/SeasonBanner.tsx`
  - `src/components/preview/PreviewModal.tsx`
  - `src/components/preview/RaceModal.tsx`

### Standings

- File: `src/pages/StandingsPage.tsx`
- Uses `src/hooks/data/useSharedQueries.ts`:
  - `useLeagues()`
  - `useTeams()`
  - `useDrivers()`
- Reads `race_results` with `races(league_id)` and profile data, computes standings client-side.
- Related types: `src/lib/standingsTypes.ts`.

### Drivers

- File: `src/pages/DriversPage.tsx`
- Uses `confirmed_profiles`, `teams`, `race_results`.
- Computes stats such as races, wins, podiums, points and incidents.
- Components:
  - `src/components/preview/NewDriverCard.tsx`
  - `src/components/preview/DriverModal.tsx`

### Teams

- File: `src/pages/TeamsPage.tsx`
- Reads `teams`, `team_memberships`, `profiles`, `race_results`.
- Components:
  - `src/components/preview/NewTeamCard.tsx`
  - `src/components/preview/TeamModal.tsx`

### Seasons

- File: `src/pages/SeasonsPage.tsx`
- Reads `leagues` with nested `races(...)`.
- Reads `race_results` with race/league data to compute standings/leader information.

### Results hub and race detail

- Hub: `src/pages/ResultsPage.tsx`
  - Reads completed races from `races` with `leagues(...)`.
  - Reads winners from `race_results`.
  - Expanded race content reads `race_results` and `penalties`.
  - Supports `?race=<id>` to expand/scroll a race.
  - Injects client-side JSON-LD for the result list.
- Detail: `src/pages/RaceDetailPage.tsx`
  - Reads `races`, `race_results`, `race_session_results`, `penalties`.
  - Uses `src/lib/raceDetailStats.ts`.
  - Sets race-specific `document.title`.

### News

- Hub/category: `src/pages/NewsPage.tsx`
  - Reads published `news_posts`.
  - Hydrates authors from `profiles` and seasons from `leagues`.
  - Uses `src/lib/newsTaxonomy.ts`.
  - Supports mock preview through `src/lib/mockNewsPosts.ts`.
- Detail: `src/pages/NewsDetailPage.tsx`
  - Reads one published `news_posts` row by slug.
  - Hydrates `profiles`, `leagues`, `races`.
  - Sanitizes article HTML locally.
  - Sets client-side title/meta/OG tags.
- Router shim: `src/pages/NewsCategoryOrDetailPage.tsx`.
- Author archive: `src/pages/NewsAuthorPage.tsx`.

### Join/meedoen

- File: `src/pages/JoinPage.tsx`
- Uses `src/i18n/useLanguage.ts`.
- Sets language-specific metadata, canonical and FAQPage JSON-LD.

## Authenticated/admin pages

- `src/pages/AuthPage.tsx`: sign-in, sign-up, password reset via Supabase Auth.
- `src/pages/ProfilePage.tsx`: profile details, own results, team flows, avatar upload, Discord unlink.
- `src/pages/KoppelPage.tsx`: token-based Discord linking via RPC `discord_claim_token`.
- `src/pages/AdminPage.tsx`: admin dashboard and tab container.
- `src/pages/admin/DriversList.tsx`: profile/role management RPC UI.
- `src/pages/admin/SeasonsAdmin.tsx`: season/race management.
- `src/pages/admin/TeamsAdmin.tsx`: team management.
- `src/pages/admin/PointsAdmin.tsx`: points/config/admin operations.
- `src/pages/admin/AnnouncementsAdmin.tsx`: announcements admin.
- `src/pages/admin/ResultsImportAdmin.tsx`: result import/upsert workflows.
- `src/pages/StewardPage.tsx`: protests, penalties, steward decisions.
- `src/pages/NewsEditorPage.tsx`: news CMS.
- `src/pages/TrackIntelligenceTestPage.tsx`: track intelligence admin module.

## Shared frontend/data files

- `src/integrations/supabase/client.ts`: creates Supabase browser client from `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`.
- `src/hooks/data/useSharedQueries.ts`: shared query hooks for drivers/teams/leagues.
- `src/lib/useRegistration.ts`: calendar/season/race registration hooks.
- `src/lib/importHelpers.ts`: result import helpers.
- `src/lib/raceDetailStats.ts`: race detail derived statistics.
- `src/lib/trackIntelligence.ts`: track intelligence helpers.
- `src/lib/newsTaxonomy.ts`: news category slugs/labels.
- `src/lib/trackPhotos.ts`, `src/lib/trackData.ts`, `src/lib/iracingTracks.ts`: track data/photos.
- `src/lib/dateHelpers.ts`, `src/lib/useCountdown.ts`, `src/lib/utils.ts`: generic helpers.

## i18n

- `src/i18n/LanguageContext.tsx` stores language in localStorage and uses a MutationObserver to translate DOM text/attributes.
- `src/i18n/translations.ts` contains translations.
- `src/i18n/useLanguage.ts` exposes the hook.
- Default language appears to be Dutch. English is supported.

## SEO/static HTML

- Client-side metadata is set in several pages, but crawler-facing static route HTML is generated by `scripts/generate-route-html.mjs`.
- Generated public static route HTML includes `/`, `/meedoen`, `/calendar`, `/standings`, `/results`, `/news`, `/seasons`, `/drivers`, `/teams` plus dynamic news/result detail routes.
- Private/noindex generated routes include `/auth`, `/profile`, `/admin`, `/admin/track-intelligence-test`, `/news-editor`, `/stewards`, `/koppel`.
- Let op: `src/App.tsx` heeft ook route `/admin/track-intelligence`, maar `scripts/generate-route-html.mjs` noemt alleen `/admin/track-intelligence-test` in `privateRoutes`. Daardoor kan `/admin/track-intelligence` via nginx SPA fallback de root HTML krijgen in plaats van eigen noindex HTML. Dit is een echte code/doc-observatie, geen gewenste toestand.

## Unzeker

- Some client-side metadata duplicates build-time metadata. Which one Google indexes depends on raw HTML vs rendered JS; build-time HTML is intended crawler source.
- Admin route guard in `src/pages/AdminPage.tsx` gebruikt alleen `isAdmin`, terwijl `src/components/Navbar.tsx` admin-navigatie toont voor `isAdmin || isSuperAdmin`. Zeker maken of dit functioneel klopt: test een account met alleen `super_admin` of lees productie `user_roles` conventie of super_admin altijd óók admin krijgt.
