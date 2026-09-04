# 3SM Pitwall — 0.4.2 TEST Live Standings

Date: 2026-09-04

## Scope / result

- Activated the existing hidden `data-pitwall-slot="standings"` in the Pitwall main grid
  with a compact, high-density **LiveStandings widget** (AHEAD / YOU / BEHIND + compact table).
- **No connector binary change** — 0.4.2 is a frontend/read-model increment only. Connector canary stays **0.4.1.0**.

## Data source

- `get_pitwall_data.v3_normalized.opponents` (0.4.1 bounded opponent snapshot) + own `v3_normalized.position`.
- Client-side derivation in `src/features/endurance/pitwall/standings.ts` (pure, unit-tested). No RPC change, no table queries, no history scan.

## Derivation rules

- **Sort:** overall position asc; missing position sorts last; own (player) row first when tied. Rows bounded ≤ cap(40) + player.
- **Own position:** prefers `v3.position`; falls back to the player row's position in the snapshot.
- **Directly AHEAD:** nearest active connected opponent with position < own position (highest such). Prefers `gapToPlayer`.
- **Directly BEHIND:** nearest active connected opponent with position > own position (lowest such). Prefers `gapToPlayer`.
- **Lapped cars:** handled by absolute position ordering (a lapped car ahead in race order = higher/lower per position; gap shown as-is).
- **Pit-lane:** shown with a `PIT` indicator; still eligible as ahead/behind (it is on-track in race order).
- **Disconnected:** excluded from direct ahead/behind and from the active table (muted/omitted). Rule chosen: omit disconnected non-players from a/b; the row is not rendered.
- **Missing gaps/positions / NaN / non-finite:** rendered as `—` / `null`; never invented.
- **Empty state:** when no opponents array present → clean "Wacht op tegenstanderdata…". No fake rows in production.

## Class behavior

- Own row shows `P<overall> K<class>`. Each table row shows both overall (P) and class (K) where present.
- No complex class filter toggle in 0.4.2 (out of scope).

## Security / isolation

- Unchanged: standings read through the existing `get_pitwall_data` SECURITY DEFINER gate (staff / own-team only; cross-team + anon denied). No new RPC, no raw device metadata, no secrets.

## Demo / DEV fixture

- `?pitwallDemo=normal|pit` shows a synthetic 16-car grid (lapped / pit / disconnected / missing-gap rows) for visual layout validation.
- Strictly `import.meta.env.DEV` guarded; **production cannot activate demo data** (same guard as existing Pitwall demo). No synthetic rows in production DB.

## Channel states (unchanged by 0.4.2, verified)

- default/stable (bootstrap bridge): **0.4.0.0**
- canary/test (connector): **0.4.1.0**

## Tests / gates (committed `0a1ecb9` on `feature/pitwall-0.4.2-live-standings`, merged to main `9d98033`)

- `src/test/pitwallStandings.test.ts` — 8: sort/player handling, ahead/behind selection, disconnected exclusion, missing-position null, cap bound, render helpers, own-position priority.
- `tsc --noEmit` PASS, `npm run build` PASS, eslint (new files) clean.
- Pre-existing on main: `simHubConnectorContract.test.ts` asserts V3-era `ConnectorSettings.UseCentralRelay` which main's connector source lacks (divergent connector line, NOT a 0.4.2 regression; no connector change in 0.4.2).
- Production deployed: `EndurancePage-D2YJYoR2.js` (contains standings), root 200, /endurance 200.

## Natural observation

- Natural standings/opponent data: **NOT YET OBSERVED** (no TEST user has entered a session with opponents yet). This does not block the technical release.
- No synthetic production telemetry created. No SimHub/iRacing remote restart.