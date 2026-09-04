# Endurance Pitwall V1 — Production Rollout (2026-09-04)

## Build & deploy info

| Item | Value |
|---|---|
| Deployment date | 2026-09-04 |
| Frontend commit (canonical main) | `12b5286` |
| Backend migration | `20260904110000_pitwall_v1_read_rpc.sql` |
| Rollback backend | `DROP FUNCTION IF EXISTS public.get_pitwall_data(uuid, uuid);` |
| Rollback frontend | Revert main to `27d512c`, rebuild, deploy |
| Build hash (EndurancePage) | `C2CmOpS2` |
| Environment | Self-hosted Supabase op 3sm-docker (192.168.50.23) |

## Route

- `/endurance` retains all existing tabs
- `/endurance/races/:id` → tab "Pitwall"
- `/endurance/races/:id?pitwallFocus=1` → focus mode (pure pitwall, no chrome)
- Focus mode button in Pitwall tab
- `?debug=1` query parameter continues to work (previous fix)

## Pitwall data source

Real mode: **`get_pitwall_data(uuid, uuid)` RPC** (SECURITY DEFINER)
- Reads: `simhub_telemetry_latest`, `endurance_strategy_latest`, `endurance_telemetry_events`, `endurance_stints`, `endurance_pace_entries`
- Auth: `auth.uid()` gate + `is_endurance_staff()` OR `endurance_team_members`
- Grants: EXECUTE to `authenticated`, `service_role`, `supabase_admin`
- No direct frontend table queries

## Permission contract

| Role | Access |
|---|---|
| Super_admin | All teams |
| Endurance_manager | All teams |
| Tester | All teams |
| Team member (own) | Own team only |
| Unrelated authenticated user | DENIED |
| Anon | DENIED |

## V3 inputs

- `v3_normalized.position`: `overallPosition`, `classPosition`, `gapToLeaderSeconds`
- `v3_normalized.timing`: `lastLapTimeSeconds`, `bestLapTimeSeconds`
- `v3_normalized.session`: `sessionTimeRemainingSeconds` (race clock)
- Strategy: `fuel_laps_remaining` = current range, NOT next-stint distance

## Fuel-to-add — V1 intentional gap

**Not available in real V1.** The `calcFuelToAdd` function exists in source but:
- Requires explicit tank capacity (no 100L default)
- Returns `null` when any input is null
- Not called by any real UI component
- Real UI reads `fuel_to_add_litres` from `endurance_strategy_latest` (always `null` in current DB)
- UI fallback: `"—"` (Brandstof: berekening niet beschikbaar)
- Demo mode continues to show `+72L` (synthetic fixture)
- Required for real fuel: car-specific tank capacity, explicit reserve rule, service constraints — all MISSING in V1 schema

## Race clock — V3 authoritative

- Priority: `v3_normalized.session.sessionTimeRemainingSeconds` (when available)
- Fallback: `null` → UI shows `"—"`
- No scheduled-event end-time masquerading as iRacing clock

## Focus Mode

- Activated via `?pitwallFocus=1` or "Focus mode" button
- Hides: navbar, hero, event card, tab bar, "Alle races" button, footer
- Shows: compact focus header (3SM | event | team | ● LIVE | Volledig scherm | Focus verlaten)
- Grid: always 3-column desktop layout (`lg:grid-cols-3`), full viewport width
- Python `import.meta.env.DEV` guard ensures focus mode only in production

## Known V1 limitations

- No opponent traffic/standings
- No tyre telemetry
- No live track map
- No projected post-stop position
- No pitloss model
- No trustworthy numeric fuel-to-add in real mode
- Offline connector → no live Pitwall values

## Rollback procedure

### Frontend rollback
```bash
cd /opt/3sm
git checkout 27d512c
npm ci --legacy-peer-deps
npm run build
bash deploy.sh
```

### Backend rollback (only if security issue)
```bash
ssh 3sm-docker
echo "DROP FUNCTION IF EXISTS public.get_pitwall_data(uuid, uuid);" | docker exec -i supabase-db psql -U supabase_admin -d postgres
```

## Post-deploy observations

- Start: 2026-09-04
- Duration observed: immediate post-deploy
- Site health: `/ → 200`, `/endurance → 301`, `/admin → 301` (internal)
- Stable manifest: unchanged (0.3.16.0)
- Telemetry V3 unaffected: no connector/backend changes
- DB: 154 policies, 89 SECDEF RPCs unchanged (1 added: get_pitwall_data)
- Admin UI: unchanged
- Existing Endurance modules: unchanged (planner, availability, teams, pace, devices, race control, notifications)