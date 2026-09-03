# Telemetry V3 — 0.3.16.0 Stable Rollout Closure

**Status:** PASS — OFFICIALLY CLOSED
**Date:** 2026-09-03

## Release

| Field | Value |
|-------|-------|
| Version | **0.3.16.0** |
| Branch | `release/simhub-0.3.16.0-stable-candidate` |
| Commit | `0fef511` |
| DLL size | 333,824 bytes |
| SHA-256 | `92ef0919f2d8c6a3c40503a65c2620303e881a534703a0e85bd6f45d80f1d01e` |
| RSA validation | PASS |
| Manifest URL | `https://api.3stripemotorsport.cc/functions/v1/simhub-version` |

## Backend

- V3 Edge (`simhub-ingest-v3`) — deployed, healthy
- Phase B/E/F persistence — deployed, healthy
- Strategy pipeline — deployed, healthy
- Diagnostics — deployed, healthy
- Stable manifest — **0.3.16.0** live

## Validation history

| Phase | Description | Result |
|-------|-------------|--------|
| Phase G | CAT-PC true V3 canary (0.3.12.0) | PASS |
| Phase G | Strategy validation raceRun | PASS |
| Phase H | 20-connector staged load test | PASS |
| Phase I | Updater canary (0.3.13.0→0.3.14.0→0.3.15.0) | PASS |
| Phase J | Stable candidate CAT-PC transition (0.3.15.0→0.3.16.0) | PASS |
| Phase K | Global stable manifest flip to 0.3.16.0 | PASS |
| Phase L | BEEST first real legacy stable upgrade | PASS |

## Load test summary (Phase H)

- 20 concurrent synthetic V3 connectors at 1 Hz
- 10,359 total requests
- 10,354 accepted (99.95%)
- Stage E (20 connectors): p50=234ms, p95=403ms, p99=552ms
- 5 total 5xx (0.05%)
- No cross-device contamination
- CAT-PC authority unaffected throughout

## Real device status

| Device | Version | Status | Rollout |
|--------|---------|--------|---------|
| CAT-PC | 0.3.16.0 | `active_binding / primary` | **UPGRADED** |
| BEEST | 0.3.16.0 | `inactive` | **UPGRADED** (manual) |
| DESKTOP-E2SEMRP | unknown | `inactive` | **PENDING OFFLINE** |
| RICKY | unknown | `inactive` | **PENDING OFFLINE** |
| CAT-PC (revoked) | — | `revoked` | Not a target |
| BEEST (revoked) | — | `revoked` | Not a target |
| RICKY (revoked) | — | `revoked` | Not a target |

Offline devices will receive 0.3.16.0 naturally when they return and poll the stable manifest.

## Rollback

- **Stable 0.3.9.0 snapshot retained:** `/opt/supabase/docker/docker-compose.override.yml.pre-0316`
- **Snapshot SHA-256:** `c53b511d4c161ab5eb6642cfccba8f0db95b68985c9cf365022c567e7b967a43`
- **Rollback procedure:** Restore snapshot → `docker compose up -d --force-recreate functions`
- **Automatic downgrade:** NOT supported — already-upgraded clients do not auto-downgrade

## Known follow-up

- Diagnostics/Admin UI (separate phase)
- Optional future device-targeted canary control
- No 0.3.17.0 work started