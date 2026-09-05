# Endurance / connector repair — 2026-09-05

Status: local candidate on `codex/endurance-connector-repair`. No production migration, deployment, plugin installation, commit or push performed.

## Verified causes and changes

- The four non-revoked devices in production have an owner and pairing timestamp. The old “Niet gekoppeld” badge described a missing Endurance race assignment, not account pairing. The overview now displays “Site gekoppeld” and a separate “Geen racetoewijzing” / “Race toegewezen”. Existing device records are preserved.
- Connector health uses the newest health/last-seen/telemetry timestamp; labels refresh even if the response data is unchanged. Stale game state is not presented as a current connection. Unknown pit state is not displayed as “Nee”. Nested V3 identity, timing, fuel and track fields are read correctly. Fetch failures are shown explicitly. A detected installed version is not claimed to be the latest available release.
- Pitwall membership incorrectly filtered a nonexistent `endurance_team_members.event_id`. Production table RLS also only permits staff reads. New `get_pitwall_teams(event)` provides bounded discovery using the same authenticated own-team/staff boundary as `get_pitwall_data`, without widening table policies.
- Async team selection, staff team switching, event/user cache isolation, driver display names, router-based focus navigation and telemetry freshness are repaired. Missing strategy samples are distinct from a disconnected telemetry stream.
- The page uses the existing server capability response for access and management controls. Managers no longer need a personal race registration just to manage the workspace. Failed invitation acceptance is reported.
- Malformed individual event slots are ignored safely rather than crashing mapping.
- Plugin capture skips missing `NewData`. Central traffic stays V3; local fallback uses the existing `/v1/telemetry` endpoint and V2 envelope. The local bridge now validates V1 and V2. Last completed lap uses `LastLapTime` instead of `CurrentLapTime`.
- The build script finds standalone VS Build Tools via `vswhere -products '*'`. Candidate plugin version is `0.4.1.1`; it has not been signed/published as a release.
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

Existing unrelated file-mode changes and `builds/` contents were preserved. Review scoped changes using `git diff`; nothing is staged.
