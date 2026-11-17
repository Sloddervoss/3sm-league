# Live sector updates v1 — frozen implementation contract

Base: a4545823d725a44e3758f2910091f32b8c00d441.
Target connector 0.7.6.4; current stable 0.7.6.3. Recent fleet also contains
0.7.6.2 and 0.4.2.1 (plus one unknown). Existing old clients remain supported.
Scope: implementation/build/test/freeze, no production publication or installation
until separate explicit GO. Never change updater, pairing, fuel/tyre learning or
existing mandatory V3 telemetry. Ordinary admitted PACE timing follows its existing
enablement/opt-out policy; no new default-off switch.

## Wire: optional addition to existing paceCapture, schemaRevision stays 1

`sectorUpdates?: PaceSectorUpdate[]`, max 8 updates per <=4096-byte PACE block.
Empty/absent is backwards compatible. All arrays already required by PACE remain.

Each entry has exactly:
- id: existing car id (1..64 chars), NOT account id or current driver id.
- lap: integer 1..100000.
- sectorIndex: integer 0..sectorCount-1.
- sectorCount: integer 1..16, actual measured track layout.
- seconds: finite >0 and <=86400 for provisional/verified; null for invalidated.
- completedSessionTimeSeconds: finite 0..86400, actual sector-end source time.
- observedSessionTimeSeconds: finite completion..86400, state-change source time.
- revision: integer 1..Number.MAX_SAFE_INTEGER, monotonic per car per segment.
- status: provisional | verified | invalidated.
- referenceSeconds: finite >0..86400 or null; previous VERIFIED personal best for
  this sector, frozen when the sector first completes (do not make a new PB delta 0).

Namespace = transportSessionId + observedSessionId + segmentId + car id.
Update identity within namespace = lap + sectorIndex. Repeated identical revision
is idempotent; stale revisions must not replace newer state for that identity.

## Producer semantics

Publish provisional immediately after a genuinely measured contiguous boundary
passage, without waiting for the finish. A sector requires both observed ends;
joining mid-sector must not invent its start. Existing interpolation and <=250ms
gap/jump/pit/reset protections remain. At finish, retain existing whole-lap sum
validation <=0.1 seconds and delayed last-lap grace. Promote that lap's sectors to
verified only after this passes. Invalidate previously emitted provisional results
when their lap is invalid, discontinuous or fails/times out validation; do not clear
prior verified laps on an unrelated future gap. Reset namespace on session/track/
layout/reset changes. Keep all buffers bounded.

Separate changed-sector priority from heavy trace round-robin. Deliver changed
updates promptly for every supported car (<=40), repeat/background resend snapshots
for loss recovery. Do not prioritize own/leader at everyone else's expense.
Send metrics fairly, up to existing parser cap 4/frame. Fit the actual serialized
PACE and total-body budgets: trim traces/lap extras/diagnostics before silently
losing all new sectors; never break mandatory core telemetry. Test 40-car bursts.

## Server history (existing JSON, no new table or changed persist signature)

`paceHistory.cars[].sectors?: PaceSectorUpdate[]`: latest state per sectorIndex,
max 16. Compare lap first, revision second; old-lap confirmation must not overwrite
new-lap provisional display. Older verified updates may still improve best history.
`paceHistory.cars[].sectorBests?: {sectorIndex:number, lap:number, seconds:number}[]`:
max 16, verified minima only. Invalidation of the exact stored best removes it;
never promote provisional values to a proven record. Bounds and namespace resets
stay intact. Existing projector already retains extra car fields for opponents.
The migration replaces only the pure PACE merge helper, not simhub_persist_v3.
Optional malformed sector entries are isolated; core and legacy PACE survive.

## Frontend

Consume persisted sectors independently of the 5-second live-metric TTL. Preserve
completed result until a new result for that sector, explicit invalidation, or
namespace change. Tag lap/status; dim previous-lap values so mixed latest sectors
are NEVER presented as one proven complete lap. Invalidation displays — for that
slot; no fabricated fallback. Use frozen referenceSeconds for +/- personal-best
delta (negative green, positive red). Session-best purple derives from verified
sectorBests of cars actually present in the read view, not an official unseen field.
Preserve existing unknown layout placeholder, dynamic 1..16 count, fixed columns,
FLIP and reduced-motion, and the normal/shared component defaults. Legacy complete
rounds remain a clearly separate fallback when no new-sector contract is present;
keep validity/sum/identity checks. No new page or layout variant.

## Required proof

- C# harness: 3/6/16 sectors; before-finish publication; no initial partial-start;
  repeat/ordering; finish verification and failed/delayed finish; gaps/pit/reset;
  immutable best reference; 40-car fairness/burst and actual byte budgets.
- Real C# serialization -> actual TS parser -> actual SQL merge -> real consumer.
- SQL: namespace reset, duplicates/reordering/status transitions, bounded state,
  verified-only best, old client preservation, no changed ACL/persist signature.
- UI: no blinking after 5s, individual next-lap replacement, dim previous lap,
  deltas/records, invalidation/reset, normal and premium consumers.
- Full net48 vendor-SDK Windows compile and frozen artifact before claiming build.
- Live telemetry, device update and publication remain distinct unexecuted gates
  until actually exercised; never label synthetic replay as a live accuracy proof.
