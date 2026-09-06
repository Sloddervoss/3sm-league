# Road-layout projection repair — 2026-09-06

Branch: `fix/pitwall-road-layouts`, based on merged catalog release `37937d7`.
Owner explicitly requested repair and deployment of road exceptions only; defer oval/dirt exceptions.

## Coverage

16 road IDs: `145,146,168,173,175,176,202,207,209,211,215,216,239,242,244,319`.
These are Brands Hatch GP/Indy; Suzuka GP/Moto/West/West-chicane; Oran Park GP/North/North A/Moto; Kansas Road/Infield; Monza GP/no-chicanes/no-first-chicane; Detroit.

Six remain deliberately guarded: `143,189,214,398,399,581`. Source metadata classifies Centripetal, Kentucky Legends and Kansas Oval as oval. Lucas Oil Dirt Road and Mount Washington climb/descent have `track_type_text: Dirt Road Course` (Mount Washington has `is_dirt: false`, so that boolean alone is insufficient).

Expected full catalog coverage: 418 projected layouts, six deferred, all 424 official maps available. Projection is still schematic lap-distance placement, not an empirically distance-calibrated racing line or GPS/pitbox positioning.

## Source and method

Public source: https://github.com/meowmachine/racing-track-maps-vector at commit `b182cb7faeda236cce740530e52f3774364f3c0b`, `from-iracing/` only. Do not mix real-world AIM/RaceStudio circuits into the iRacing catalog.

The road SVGs are thin filled ribbons. An offline generator thins their alpha masks to connected centerlines, removes short terminal raster spurs and requires exactly one unbranched component. This fixes the double-sided perimeter issue without redrawing circuits. At Suzuka, Oran Park and Monza, the official drawing intentionally breaks the ribbon under a bridge. The two endpoints are explicitly recorded/reviewed per layout and joined only across that short overpass gap; arbitrary broken paths are rejected. Raster stair-steps are lightly smoothed and resampled to 1024 points.

Start/finish and any direction arrow are read by the shared official SVG parser. For Brands Hatch, Kansas Road/Infield and Detroit, which have no arrow, the first official turn labels 1–3 establish increasing lap order. Detroit splits the glyph “11” into two later “1” text elements; the generator uses the first matching label, not every text “1”. All 16 assets are tested against increasing turn 1–3 order, including those with arrows.

Generated assets under `public/tracks/projections/` include upstream revision, source hashes, reference/turn markers and reviewed bridge endpoints. The generator checks the upstream checkout revision and clean source, and compares every active SVG with the layer shipped by 3SM before writing output. The runtime verifies layout ID, SVG SHA-256 (normalized line endings), schema, coordinates and bounded continuous steps. Missing/mismatched files fail closed to the map/progress strip, not another layout.

## Files and reproduction

- `scripts/road-track-centerlines.mjs`: offline source validation, extraction and generation.
- `public/tracks/projections/track-<id>.json`: 16 generated assets.
- `src/lib/pitwallRoadProjection.ts`: allowlist and validated loading.
- `src/lib/pitwallTrackGeometry.ts`: shared reference parser and road-asset selection.
- `src/test/pitwallRoadProjection.test.ts`: coverage, source, turn-order, malformed data and transport checks.
- `scripts/audit-pitwall-tracks.mjs`: full-catalog assertions and 16-road visual contact sheet.

With the upstream checkout at the exact revision and a local Vite server:

```sh
node scripts/road-track-centerlines.mjs /path/to/racing-track-maps-vector/from-iracing http://127.0.0.1:4193 --generate
node scripts/audit-pitwall-tracks.mjs http://127.0.0.1:4193
node scripts/audit-pitwall-tracks.mjs http://127.0.0.1:4193 --visual
```

Use the existing Sharp and Playwright dependencies. No new package/runtime dependency is introduced. Never run the generator on the production request path.

## Impact, verification and rollout

Website: map data and source validation only. Backend/API, database/migrations, auth, bot and SimHub plugin: no impact expected. Browser SubtleCrypto requires the existing HTTPS site (localhost is valid for development).

Before publishing, run selected Pitwall/Endurance/SimHub tests, changed-file ESLint, Vite build, full-catalog browser audit and inspect the 16-layout contact sheet. Existing unrelated TypeScript failures in PayPal/community-support/main.tsx remain outside scope. Run the configured complete production build on Linux.

Prepublication results: 468 selected tests pass (69 files), changed-file ESLint and Vite build pass. Native Chrome loads 424/424 maps with 418 projections, zero invalid coordinates and exactly the six deferred layouts. All 16 repaired layouts were visually inspected with simulated increasing-lap markers. The offline generator additionally checks all 16,384 generated points against the official rasterized course ribbon: any unpainted point must fall within the explicitly reviewed short bridge segment. This is source-geometry verification, not an on-track telemetry accuracy test.

Deployment follows the prior assets-first process with backup, preserved downloads and SEO timer/source synchronization. Also verify the 16 new JSON assets through the public site, including their source-hash validity. Roll back website and SEO-source dist together if verification fails. No database rollback is needed. Do not publish internal deployment records without separate disclosure authorization.
