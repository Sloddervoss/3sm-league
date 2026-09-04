# Diagnostics Admin UI V1 — Live Release

**Date:** 2026-09-04
**Branch:** `feat/simhub-admin-diagnostics`
**Frontend commit:** `CmdUAb3V` (AdminWorkspacePrototype bundle)
**Production frontend server:** `3sm-web` (192.168.50.19)
**Production DB RPCs:** Already live on `3sm-docker`

## Route

`/admin` → Control Room sidebar → **"Connectors"**

## Capabilities (V1 — Read-only)

- **Fleet overview** — all non-revoked devices with status badges
- **Device detail** — per-device health, telemetry, binding, updater, diagnostic events
- **Health indicators:** online/offline, telemetry live/stale/none, game connected, role, binding
- **Updater status:** current/updating/failed/unknown
- **Diagnostic events:** 18 codes, Dutch labels, 8 default + show-more to 20
- **Binding labels:** human-readable event/team names from endurance tables
- **Polling:** fleet 10s, detail 5s
- **Responsive:** desktop + tablet + mobile

## Access Control

- **RLS gate:** `public.can_manage_simhub()` → only `super_admin` role
- **RPC gate:** `SECURITY DEFINER` with `can_manage_simhub()` check
- **Authentication required:** anon and regular users denied at function level

## Production Backend Changes

Two SECURITY DEFINER RPCs on production DB (`3sm-docker`):

1. `get_simhub_fleet()` — fleet overview with event/team name JOINs
2. `get_simhub_device_details(p_device_id uuid)` — full device detail in JSONB

**Rollback SQL:** `supabase/rollback/20260904100000_simhub_admin_read_rpcs.rollback.sql`

## Known Limitations (V1)

- Exact remote SimHub process state is **not available** (`game_connected` = iRacing/game, not SimHub)
- Per-device stable/canary assignment is **not persisted** — no channel badge
- Offline devices may show `Unknown` health — by design
- **No admin write controls** (revoke/rebind/promote/update/delete) — V1 is read-only
- NaN protection via `safeNum()` formatter handles null/undefined/NaN/Infinity

## Pre-live Test Results

| Check | Result |
|-------|--------|
| Build | ✅ 0 errors |
| Super-admin access | ✅ PASS |
| Non-super-admin denied | ✅ PASS (42501) |
| Secret exposure | ✅ PASS (no token_hash/signature) |
| Revoked devices excluded | ✅ PASS |
| Diagnostic events bounded | ✅ PASS (≤20) |
| Missing health = null | ✅ PASS |
| NaN/invalid numeric | ✅ PASS (safeNum) |
| Updater false failures | ✅ Fixed (case-insensitive) |
| Warning count consistency | ✅ PASS (0 = 0 after fixes) |
| TEST-ADMIN-PC removed | ✅ PASS |
| Production frontend unchanged | ✅ Before deploy |