# Device-scoped telemetry: Edge context correction

The database already accepts authenticated, non-revoked devices without an
active team binding (see the September 4 device-scoped ingest decision).
However, `simhub-ingest-v3/context.ts` still returned `not_bound` or
`not_authority` before calling persistence. The endpoint consequently returned
HTTP 403 and no fresh snapshot reached the device Pitwall test page.

Context resolution now returns `accepted_device_context` for valid unbound,
partially bound, inactive and non-primary devices. All event/team/race-run
context stays null and authority stays false. No race-run lookup or opponent
sampling is performed for these contexts. The existing persistence RPC remains
the write-time authority and checks binding and registration itself.

Token lookup, revocation checks and payload validation are unchanged. Tests
cover acceptance without routing and rejection of invalid/revoked devices and
invalid payloads. No schema, RLS, account, device binding or plugin changes are
needed. Only the Edge context module requires deployment; keep unrelated live
Edge files unchanged. Back up the previous module and restore it on failure.

Verification must use real device traffic: check fresh v3 snapshots, advancing
sequence, successful ingest status and null team routing for an unbound device.
An already-running session initially rejected before persistence may require
restarting SimHub to establish a new sequence baseline; do not disable replay
protection or fabricate telemetry to make the test page look live.
