# Endurance / connector repair — 2026-09-05

Status: website and database repair deployed after Vincent's approval. Local source commit `bae9279` on `codex/endurance-connector-repair`; production commit `1153a97` applies that scoped patch to the prior production base `746040e`, without importing unrelated local commits. No GitHub push or plugin installation performed. Plugin 0.4.1.1 is published to canary; stable remains 0.4.0.0. Live in-game telemetry validation still requires a user session.

## Production verification and publication

- Exact production candidate: full production build/SEO generation succeeds; 392 selected Endurance/SimHub/Pitwall/connector tests pass, including the new regression files.
- Schema backup: `/var/backups/3sm/schema-before-endurance-bae9279.sql` on Docker. Migration applied transactionally; anonymous execution denied, authenticated execution granted, an unrelated caller receives no teams. PostgREST schema cache reloaded.
- Website and prior build backups: `/var/backups/3sm/web-before-bae9279.tar.gz` and `dist-before-bae9279.tar.gz` on the web server. Assets published before HTML; existing downloads and hashed assets preserved. Main checkout and dist updated together; SEO timer resumed and active.
- Public home returns HTTP 200 and references `index-O7jOIdFi.js`; Endurance bundle `EndurancePage-DZDvkYtl.js` exists; connector bundle contains `Site gekoppeld`.
- Hermes SSH host identity verified against Vincent's Proxmox fingerprint. Release key used only on Hermes. Frozen DLL 0.4.1.1: 341504 bytes, SHA256 `bfcdc07b2a27a24e7a68513dae6ebecad8978370586e3487771150a48a6c7161`. OpenSSL and the actual Release DLL accept the signature; six tampered manifest fields are rejected. Production key present, test key absent, embedded updater present, updater payload validation passes.
- Publication was paused when existing stable 0.4.0.0 and canary 0.4.1.0 manifest DLLs were missing. Both were absent from the pre-deployment web backup. Original artifacts recovered from Hermes `/tmp/3sm-040` and `/tmp/3sm-041`, matched to the unchanged signed manifest hashes, restored and independently verified via HTTPS (octet-stream and exact SHA256).
- Real 0.4.1.0 Release verifier accepts the new signed manifest. Its embedded updater installs the new DLL in an isolated test directory, preserves an exact old-DLL backup, and restores original bytes on an injected post-replacement failure. This does not replace a real SimHub/iRacing session test.
- Versioned 0.4.1.1 DLL and ZIP published and verified through HTTPS: correct MIME types, 341504-byte inner DLL matching the frozen hash, installation instructions included. Stable latest ZIP alias intentionally untouched because the new build is canary-only.
- Only six `SIMHUB_PLUGIN_CANARY_*` fields changed after config validation. Backup: `/opt/supabase/docker/docker-compose.override.yml.pre-0.4.1.1`. Only functions service recreated, without dependencies. All six live fields match the verified manifest; stable 0.4.0.0 fields unchanged.
- Root deployment hazard found: `deploy.sh` excluded assets but not downloads from `rsync --delete-after`. Added an explicit `downloads/` exclusion and regression test so future site deploys neither delete released DLLs nor overwrite the stable ZIP alias from old build assets.

## Verified causes and changes

- The four non-revoked devices in production have an owner and pairing timestamp. The old “Niet gekoppeld” badge described a missing Endurance race assignment, not account pairing. The overview now displays “Site gekoppeld” and a separate “Geen racetoewijzing” / “Race toegewezen”. Existing device records are preserved.
- Connector health uses the newest health/last-seen/telemetry timestamp; labels refresh even if the response data is unchanged. Stale game state is not presented as a current connection. Unknown pit state is not displayed as “Nee”. Nested V3 identity, timing, fuel and track fields are read correctly. Fetch failures are shown explicitly. A detected installed version is not claimed to be the latest available release.
- Pitwall membership incorrectly filtered a nonexistent `endurance_team_members.event_id`. Production table RLS also only permits staff reads. New `get_pitwall_teams(event)` provides bounded discovery using the same authenticated own-team/staff boundary as `get_pitwall_data`, without widening table policies.
- Async team selection, staff team switching, event/user cache isolation, driver display names, router-based focus navigation and telemetry freshness are repaired. Missing strategy samples are distinct from a disconnected telemetry stream.
- The page uses the existing server capability response for access and management controls. Managers no longer need a personal race registration just to manage the workspace. Failed invitation acceptance is reported.
- Malformed individual event slots are ignored safely rather than crashing mapping.
- Plugin capture skips missing `NewData`. Central traffic stays V3; local fallback uses the existing `/v1/telemetry` endpoint and V2 envelope. The local bridge now validates V1 and V2. Last completed lap uses `LastLapTime` instead of `CurrentLapTime`.
- The build script finds standalone VS Build Tools via `vswhere -products '*'`. Plugin version `0.4.1.1` is now signed/published on canary (see production verification above).
- Test setup uses inert localhost Supabase configuration. Existing path-based isolation tests now work on Windows; the two explicitly authorized Pitwall read RPCs are included in the repository boundary test.

## Changed source paths

Frontend:
- `src/features/control-room/connectors/SimHubConnectorsModule.tsx`
- `src/features/control-room/connectors/connectorState.ts`
- `src/features/endurance/pitwall/{PitwallTab,TopRaceBar}.tsx`
- `src/features/endurance/pitwall/usePitwallData.ts`
- `src/features/endurance/repository/{pitwallRepository,mappers}.ts`
- `src/features/endurance/shell/EndurancePage.tsx`
- `src/features/endurance/workspace/RaceWorkspace.tsx`

Backend:
- `supabase/migrations/20260905110000_pitwall_team_discovery.sql`
- `supabase/rollback/20260905110000_pitwall_team_discovery.rollback.sql`

Plugin / bridge:
- `tools/simhub-plugin/3SM.EnduranceConnector/{AssemblyInfo,ConnectorSettings,EnduranceConnectorPlugin}.cs`
- `tools/simhub-plugin/3SM.EnduranceConnector/build.ps1`
- `tools/simhub-bridge/{contract,self-test}.mjs`

Tests:
- `src/features/control-room/connectors/connectorState.test.ts`
- `src/features/endurance/repository/mappers.test.ts`
- `src/test/{connectorOverview,pitwallLoading,pitwallNavigation}.test.tsx`
- `src/test/pitwallTeams.test.ts`
- `src/test/{enduranceAlphaRoles,enduranceIntegration,enduranceRepositoryContract,simHubConnectorContract}.test.ts`
- `src/test/setup.ts`
- `tests/pitwall-team-discovery.mjs`

## Verification

- Vitest: 410 targeted tests pass before version-only candidate bump. Includes component interaction tests for team switching, focus, missing live data, and site pairing labels.
- C# diagnostics harness: 27 checks pass, including a 60-second concurrency test and cancellation/timeouts.
- Plugin + embedded updater MSBuild: succeeds without warnings or errors.
- Bridge HTTP self-test: V1/V2 acceptance, authentication, origin restrictions, replay rejection and malformed V2 rejection pass.
- Isolated in-memory PostgreSQL (PGlite): migration executes; anonymous and unauthenticated callers denied; member own-team/event isolation, staff event-scoped access and rollback pass. This is not a production migration test.
- Vite production bundle compiles into `builds/website-review`; build-time SEO/publishing scripts were not run. Do not deploy this review bundle without production configuration and normal release checks.
- Full Vitest check at review: 732 pass, two unrelated failures in `joinPageSeoContract.test.ts` and `paypalCheckout.test.ts`.
- Full TypeScript check still reports pre-existing errors in community-support/PayPal and `src/main.tsx`; Endurance test/type errors found during review were corrected.

## Impact and rollout

Website: connector labels, Pitwall reads/navigation/freshness and Endurance gates change. Backend: one new read RPC. Database: no user data or table policies changed; migration must precede the frontend deployment. Auth: existing capability and own-team/staff boundaries retained. Bot: no impact expected. Deployment: website rebuild and a separately signed plugin release are needed; live iRacing validation remains necessary.

Before production: obtain Vincent's explicit deployment approval, take a schema backup, apply the new migration, verify authenticated own-team/staff/anonymous behavior, and deploy the frontend with its production environment and SEO assets. Publish the plugin only through the existing signed release process; do not overwrite the previous version's DLL URL. Verify one unassigned-but-paired device, one assigned device, a manager without membership, and reconnect/session transition telemetry. Roll back frontend first, then remove the new RPC using the rollback file if required.

Existing unrelated file-mode changes and `builds/` contents were preserved. Source repair is committed; this deployment record is a subsequent documentation update.
