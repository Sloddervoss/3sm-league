# Diagnostics Admin UI V1 — Live Release

**Date:** 2026-09-04
**Canonical source commit:** `6703699` (main)
**Previous production commit:** `ecf49e6` (main)
**Feature branch:** `feat/simhub-admin-diagnostics` (HEAD `b14ca9b`)
**Merge method:** Clean branch from main + fast-forward
**Production frontend server:** `3sm-web` (192.168.50.19)
**Production DB RPCs:** Already live on `3sm-docker` (applied during dev phase)

## Route

`/admin` → Control Room sidebar → **"Connectors"**

## Rollback

### Source rollback:
```bash
git checkout ecf49e6
```

### Frontend deployment rollback:
```bash
ssh 3sm-web
cd /opt/3sm
git checkout ecf49e6
npm run build
bash deploy.sh
```

### Database rollback (if needed):
```sql
-- on 3sm-docker:
DROP FUNCTION IF EXISTS public.get_simhub_device_details(uuid);
DROP FUNCTION IF EXISTS public.get_simhub_fleet();
```

## Capabilities (V1 — Read-only)

- Fleet overview — all non-revoked devices with status badges
- Device detail — per-device health, telemetry, binding, updater, diagnostic events
- Health indicators: online/offline, telemetry live/stale/none, game connected, role, binding
- Updater status: current/updating/failed/unknown
- Diagnostic events: 18 codes, Dutch labels, 8 default + show-more to 20
- Binding labels: human-readable event/team names from endurance tables
- Polling: fleet 10s, detail 5s
- Responsive: desktop + tablet + mobile

## Access Control

- RLS gate: `public.can_manage_simhub()` → only `super_admin` role
- RPC gate: `SECURITY DEFINER` with `can_manage_simhub()` check
- Authentication required: anon and regular users denied at function level

## Files Changed (6 files, +1000/-1)

| File | Change |
|------|--------|
| `src/features/control-room/connectors/SimHubConnectorsModule.tsx` | NEW (628 lines) |
| `src/features/control-room/connectors/types.ts` | NEW (108 lines) |
| `src/pages/AdminWorkspacePrototype.tsx` | MODIFIED (+5/-1) |
| `supabase/migrations/20260904100000_simhub_admin_read_rpcs.sql` | NEW (191 lines) |
| `supabase/rollback/20260904100000_simhub_admin_read_rpcs.rollback.sql` | NEW (6 lines) |
| `docs/operations/2026-09-04-simhub-diagnostics-admin-ui-v1.md` | NEW (62 lines) |
