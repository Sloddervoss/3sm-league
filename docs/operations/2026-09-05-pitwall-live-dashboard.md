# Pitwall live dashboard candidate — 2026-09-05

Status: review candidate on `feat/pitwall-live-dashboard`, rebuilt from GitHub `main` after the repository workflow rules were added. No production changes, plugin installation, signature or manifest switch have occurred yet. Candidate plugin version: 0.4.2.0. Previous published canary remains 0.4.1.1.

## Scope and source evidence

- Uses existing official layered iRacing assets, not redrawn circuits. First projection targets Road Atlanta Full Course (`public/tracks/layered/track-127.svg`, official track ID 127). Other circuits retain their existing static maps and a live lap-progress strip.
- The active course outline and the start/finish layer were inspected. Start-line center is approximately (1749, 327.7) in the 1920×1080 viewBox; the direction arrow points downward. Markers project received `lapDistancePct` onto the first closed contour, sampled at 1024 points with reversed winding from the start line. This is a schematic outline projection, not a GPS-calibrated centerline. Pit-lane cars are labelled as pit cars but remain on the main-course projection. Actual driving remains necessary to confirm correspondence around the whole lap.
- Installed `GameReaderCommon.dll` metadata confirms standard SimHub tyre pressure/temperature/wear, unit, throttle, brake, RPM, gear and last-lap sector properties. Availability in a running iRacing session is not proven by SDK property existence alone. Tyres are labelled last-available; missing/sentinel values remain null. No continuous wear model or invented tyre strategy was added.
- Production `_shared/simhub.ts` was compared read-only with the repository. Production contains the V3 parser/normalizer missing locally (286 added lines; existing V1/V2 implementation preserved). The local baseline was aligned to that code before adding optional vehicle validation. No live file was overwritten.

## Changes

- `src/features/endurance/pitwall/PitwallTab.tsx`: map/car column, wider standings/timing column; new panels do not depend on fuel strategy existing; stale standings no longer labelled current. Existing team/access queries remain.
- `LiveTrackPanel.tsx`, `RoadAtlantaProjection.tsx`, `src/lib/pitwallTrackGeometry.ts`: official SVG projection, own-car fallback, bounded opponent markers, no stale/invalid coordinates, static-map fallback.
- `VehicleTelemetryPanel.tsx`, `RaceTelemetryStrip.tsx`, `PedalTrace.tsx`, `pedalHistory.ts`, `telemetryFormat.ts`: tyre corners with source units, sectors, precise lap timing, vehicle readouts, bounded 30-second display-only pedal history. Gaps over six seconds and null samples break lines. Session/team changes clear history. Existing RPC polls every three seconds; no claim of high-frequency analysis.
- `StandingsWidget.tsx`: last/best lap and class columns; horizontally scrollable table on small displays.
- `pitwallHelpers.ts`: optional vehicle and capture/session metadata types.
- `supabase/functions/_shared/vehicleTelemetry.ts` and `contracts/simhub-vehicle.v1.schema.json`: strict optional extension, bounded numeric values, explicit units, no server identity/authority inputs. Older V3 payloads remain valid.
- `supabase/functions/_shared/simhub.ts`: optional vehicle integration after production-baseline reconciliation. Existing persistence and Pitwall RPC source preserve the complete normalized JSON; no schema migration or table/RLS change is currently needed.
- `tools/simhub-plugin/3SM.EnduranceConnector/{TelemetryContractsV3,EnduranceConnectorPlugin,ConnectorSettings,SettingsControl,AssemblyInfo}.cs`: optional vehicle serialization, safe property capture, source units and explicit settings checkbox. Extension defaults OFF to avoid sending unsupported fields before the relay update. Own lap position can fall back to the existing player opponent data; elapsed lap time uses the SDK CurrentLapTime fallback.
- `src/test/pitwall{VehicleTelemetry,PedalHistory,TelemetryFormat}.test.*`, `pitwallNavigation.test.tsx`: parser/security/null/compatibility, formatting, history and UI regressions.

## Verification

- 424 selected Endurance/Pitwall/SimHub Vitest tests pass, including outside-car suppression of own-car readings.
- Actual Release plugin build succeeds (0 warnings/errors). A reflection/serialization check confirms missing SDK inputs remain null and the emitted vehicle wire object is accepted by the TypeScript ingest parser.
- Vite production bundle compiles to `builds/pitwall-dashboard-build` using inert local Supabase configuration. This is a review bundle, NOT a deployable production build; production SEO/build steps were not run.
- Headless Chrome renders real panel components at 1600px and 390px without page errors or viewport overflow. Fifteen connected demo cars are positioned; the disconnected demo car is omitted. The start marker is approximately (1759.04, 326.93), alongside the official finish line. Screenshots: `builds/pitwall-visual/{desktop,mobile}.png`. Preview values are prominently labelled simulated.
- Full app TypeScript check still fails only in pre-existing community-support/PayPal and `src/main.tsx` paths; no new Pitwall error reported. Full repository lint/audit not yet run.

## Impact and controlled rollout

Website: dashboard structure, map assets and displays. Backend: optional V3 DTO validation. Database: normalized JSON only, no migration planned. Auth/roles: no changes. Bot: no impact expected. Deployment: relay MUST accept optional vehicle before enabling it on the candidate plugin; production website needs its normal configured build.

Publication was explicitly approved by Vincent. Before changing production: back up functions/config and web build; validate complete old/new ingest on the deployment candidate; publish receiver first, then website, then separately sign/release the plugin through the existing canary process. Do not silently promote stable. Enable extended telemetry only on the test device after receiver verification. Validate Road Atlanta Full Course on track, including start/finish, multiple known corners, pit entry, session changes, units and tyre updates. If a source property is unavailable, preserve unknown values rather than fabricating readings.

Rollback: disable the plugin extension first; old receivers reject the additional field. Restore previous frontend/functions if needed. No user data or device pairing has been modified. Existing unrelated file-mode changes and `builds/` contents are preserved.
