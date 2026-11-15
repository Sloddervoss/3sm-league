# Normal-release prospective observation producer addendum

This addendum supersedes only the previous source-only opt-in and new-Pair-only
bootstrap restrictions. Historical evidence and accepted v1 SQL are not rewritten.
No worker, serving model, frontend, updater, signing, ACK rules or legacy outbox
format changes are part of this package.

## Defaults and durable transition

`ConnectorSettings.ObservationPreference` is nullable: absent/null means enabled;
explicit false is the privacy opt-out and is not cleared by Pair or upgrade.
`ObservationEnabled` is retained for DLL rollback compatibility. Its historical
false was an internal source-only default, not a recorded user privacy choice.
It is not used as the new preference: otherwise ordinary persisted old defaults
could never migrate. There was no prior separate privacy-choice marker to recover.

Settings load/decrypt never allocate an epoch. The real runtime chain is:

1. `EnduranceConnectorPlugin.SendLegacyV3Async` snapshots the host identity and
   begins the existing readiness request before its existing authenticated POST.
2. The accepted response and existing measurement ACK are processed normally.
   `ObservationProducerHost.ObserveIngestAsync` checks the exact identity object,
   token-bearing request snapshot, latest request/lifetime, successful HTTP,
   receiver mode/availability, supported allow-policy, and matching response
   device/owner identity. Arbitrary body/root owner intent is not authority.
3. Only under the existing coordinator shared lease, host gate and settings gate,
   `CommitProspectiveObservation` saves generation 1 for pristine absent metadata.
   All five existing ledger slots must be absent (target, backup, staging,
   preserved, preserved staging); IO/permission errors are not proof of absence.
   Ordinary legacy outbox bytes are not read, rewritten, adopted or backfilled.
4. Publish the new host binding/readiness only after save. In-progress laps keep
   their original frozen binding; only future capture can use the new epoch.
   A known-valid generation is retained, not incremented by ingest. Poisoned,
   lost-provenance, present-unknown and invalidated epochs are not repaired.
5. A failed save leaves the observation epoch poisoned/unknown and attempts to
   save that tombstone. Current token, protected token, owner/device, normal
   pairing and telemetry remain intact. A simultaneous failure of both settings
   saves cannot provide a crash-durability guarantee; no such guarantee is claimed.

New Pair retains its existing protect/combined-save and generation advance rules.
Observation opt-out is independent of account policy: opt-in never overrides deny,
revocation, unavailable receiver, expired readiness, rebind or host disposal.

## Existing-response negotiation (no new hop)

The successful ingest's optional `observation` metadata gains:

    identity: { deviceId, ownerUserId }
    observationSchemas: [1, 2]

Identity comes from the authenticated same-request device/token context, never the
telemetry body or simulator driver. It is emitted only for receiver mode `on` and
supported authoritative allow-policy. It is a response confirmation, not payload
account authority. The server still resolves the observation owner from the
existing authenticated device path.

`observationSchemas` additionally requires the server deployment assertion
`SIMHUB_OBSERVATION_V2_DEPLOYED=true`. This is an explicit operator deployment
flag, NOT a user toggle, canary or enrollment programme. Enable it only after
20261114160000_pitwall_learning_observation_v2_capture.sql has been applied and
verified. Disable the flag before paired rollback. No policy RPC is added: S2E5's
same-persist policy resolution and its pre-existing older-DB fallback are unchanged.
Old clients ignore metadata; old receivers/absent schema metadata cause new
captures to use v1. Frozen queued rows are never stripped/reidentified; their
existing ACK/defer/quarantine lifecycle remains authoritative during rollback.

## Exact wire and evidence mapping

v1 is accepted as before. v2 retains capture/interval/context and all optional v1
groups. It adds optional `fuelQuality`, with exactly these five REQUIRED nullable
members when the group is present:

    pitRoad: boolean | null
    refuel: boolean | null
    resetOrTow: boolean | null
    driverId: string | null
    driverChanged: boolean | null

No owner is added to capture or lap payload account authority. `driverId` is the
existing simulator `snapshot.Opponents.FirstOrDefault(IsPlayer).Id`, the same source
used by V3 `identity.currentDriverId`, distinct from the paired account owner.
Its raw nonempty well-formed value is capped at 128 UTF-8 bytes without rewriting.

The aggregation describes the whole accepted sampled interval, not an assertion
that every instant of the real lap was observed. Existing exact UTC time,
quantization, 1-second chain-gap limit, counters and 2048-byte budget are reused.
All samples must have known relevant values and a continuous context/driver chain
before a negative is emitted. Missing IDs, driver changes, >1-second gaps,
context transitions and schema transitions invalidate negative aggregation for the
remaining lap, rather than blessing a new tail as a clean whole lap.

- pitRoad: raw nullable `OnPitRoad`, with no defaultBool/SimHub false fallback.
  True if a true sample exists; false only with covered known-false samples.
- refuel: the existing observed positive fuel-level steps, rounded at 0.001 L.
  True if the existing positive-step aggregate is nonzero; false means no observed
  positive step across a covered known fuel/context/driver chain with >=2 samples.
  It is not proof that fuel could not have been added below resolution or hidden
  between samples. Existing positive v1 refuel detail is retained, not duplicated
  as an invented amount. Missing fuel never becomes zero or false.
- driverChanged: actual simulator source-ID comparison, not display-name
  continuity. True after an observed ID change; false only with covered known
  stable ID. driverId is null across changes or coverage/context/identity gaps.
- resetOrTow: NULL. No existing accepted measurement source proves reset/tow
  absence; no guessed SDK channel or owner-as-driver fallback is introduced.
  This is a material source limitation: a strict clean-fuel-lap consumer requiring
  resetOrTow=false MUST NOT qualify these intervals. Automatic evidence collection
  is implemented; end-to-end clean-lap learning is not claimed by this package.

The parser preserves exact nullable facts and rejects wrong types, extra/missing
quality members, unsupported versions and contradictory gap/negative facts.
Observation rejection remains row-scoped; ordinary core telemetry and neighbouring
legacy rows continue. Optional quality does not relax account binding or caps.

## Source inventory and gates

Runtime producer: ConnectorSettings.cs; EnduranceConnectorPlugin.cs;
ObservationProducerHost.cs; ObservationReadiness.cs; ObservationSampling.cs;
ObservationCapture.cs; LapAccumulator.cs. ObservationLedger.cs and
ObservationLedgerStore.cs only extend their row-version allowlist to 1 or 2;
file format, counters, immutable RowJson, quotas and lifecycle stay unchanged.

Receiver: `_shared/observationV1.ts`, `_shared/observationPolicyV1.ts`, and only the
successful metadata composer in `simhub-ingest-v3/index.ts`. New paired migration
wraps the verbatim original v1 validator instead of editing accepted old SQL.
Raw v2 JSON uses the existing capture column/hash/device fence/projection paths.
Rollback refuses future v2 and preserves previously captured bytes.

Focused execution: DiagnosticsTests `--only-normal-observation`; existing host and
readiness tests; real source-linked net8/C#7.3 artifact subset; Deno v1/v2/wiring/
policy tests and cached Edge graph check. Full Windows net48/plugin SDK build and
SQL forward/rollback execution in an existing disposable rehearsal database are
separate platform gates, not replaced with stubs or an invented lab. Exact commands,
exits and source inventory are in the artifact REPORT.md/CHECKPOINT.json.
