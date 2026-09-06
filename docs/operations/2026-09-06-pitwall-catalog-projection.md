# Pitwall catalog projection — 2026-09-06

Branch: `feat/pitwall-all-track-projection`, based on `main` at `f1b28a6`.

## Scope

Replaces the Road Atlanta-only renderer with shared official-SVG projection. All 424 catalog entries resolve to their own official circuit/layout asset. Explicitly conflicting configurations do not silently select another layout.

The reader handles relative moveto continuations, implicit filled-subpath closure, inherited transforms, rotated finish lines, both arrow styles, and symbol/use references (Adelaide). Direction is compared at the arrow's location, not at a potentially distant start line. Start/finish is sampled on the selected contour.

This remains a **schematic** lap-distance projection, not measured GPS or an iRacing distance-calibrated centerline. Pit cars remain on the course outline. A passing geometry audit does not prove real driving correspondence at every corner.

Unknown direction, single-boundary/complex/clipped layouts, and invalid geometry fail closed: display the correct official map plus the existing live lap-progress strip, without guessed map markers. The remaining layouts need additional calibration; this release must not be described as accurate live positioning on every map.

## Files and checks

- `src/lib/pitwallTrackGeometry.ts`: official catalog selection and shared SVG extraction.
- `src/features/endurance/pitwall/TrackProjection.tsx`: renderer, stale/layout-switch protection, outside-car suppression; replaces `RoadAtlantaProjection.tsx`.
- `src/features/endurance/pitwall/LiveTrackPanel.tsx`: shared renderer for every layout.
- `src/test/pitwallAllTrackProjection.test.ts`, `src/test/pitwallTrackProjection.test.tsx`: catalog, arrow/transform, configuration, UI and missing-data regressions.
- `scripts/audit-pitwall-tracks.mjs`: native Chrome SVG geometry audit of all catalog assets. Run with a local Vite server: `node scripts/audit-pitwall-tracks.mjs http://127.0.0.1:4192`. Add `--visual` for a 12-layout simulated-marker contact sheet in `builds/pitwall-allmaps/catalog.png`. Requires installed Playwright browser runtime (Windows uses installed Chrome).

Selected Endurance/Pitwall/SimHub tests, changed-file ESLint, Vite build and browser geometry/visual checks are required before publication. The full app TypeScript check has pre-existing failures in community-support/PayPal and `src/main.tsx`, outside this change. Windows full build also has the known URL-path conversion failure in the route generator; the configured full production build must run on Linux before deployment.

Native Chrome audit: 424/424 official maps available; 402 schematic projections; zero missing assets or invalid projected coordinates. Visual inspection covered Road Atlanta, Oulton Fosters variants, Hockenheim National B, Hickory, Kern, Misano forward/reverse and Adelaide, plus guarded examples. This is simulated marker inspection, not an on-track telemetry validation.

The 22 guarded track IDs are `143,145,146,168,173,175,176,189,202,207,209,211,214,215,216,239,242,244,319,398,399,581`: Centripetal; Brands Hatch GP/Indy; Suzuka GP/Moto/West/West-chicane; Kentucky Legends; Oran Park GP/North/North A/Moto; Kansas Oval/Road/Infield; Monza GP/no-chicanes/no-first-chicane; Detroit; Mount Washington climb/descent; Lucas Oil Dirt Road. Seven lack an usable official direction arrow; fifteen need topology/calibration beyond the simple closed-contour reader. The browser audit asserts this exact supported/guarded set, so silently losing additional projections fails the check.

## Impact and rollout

Website: map rendering only; no route, SEO or asset source changes. Backend/API, bot, database and auth/roles: no impact expected. No migration, connector release or Supabase change is needed.

Owner has explicitly approved live publication. Preserve the existing divergent production checkout and use a clean release worktree. Build with existing production configuration without printing credentials. Back up the webroot and `/opt/3sm/dist`, briefly pause SEO refresh during synchronization, publish assets before HTML, retain previous hashed assets, and exclude `downloads/`. Synchronize the SEO source dist too, then restore the timer. Verify the deployed bundle, representative map assets and protected downloads.

Rollback: restore the backed-up webroot and SEO source dist together while the SEO timer is paused; restore its prior active state. No data rollback required.
