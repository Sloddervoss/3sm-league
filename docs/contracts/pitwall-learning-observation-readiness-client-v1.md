# Pitwall learning — client observation-readiness reader v1 (LOCAL DRAFT)

Status: **local draft contract, not deployed and not a server guarantee.**
Base: `28662018f5cf6ec3dae23472ab05ef31515b9697` (`feat/pitwall-learning-p2`).
Scope: SimHub client only — one new shared source file, its test group, minimal
response wiring and build-inventory tokens. No SQL, Edge, flag, settings,
updater, release or installed-runtime change is part of this contract.

## 1. What the accepted server answer actually contains today

`supabase/functions/simhub-ingest-v3/index.ts:340-350` returns, on an accepted
V3 frame:

```json
{"accepted":true,"receivedAt":"…","measurements":{…},"aggregates":{…},
 "observation":{"enabled":true,"mode":"on","available":true}}
```

That block describes **receiver ability** only. It says nothing about an
account, a device, consent, or the client-local pairing generation. The client
therefore treats it as *ineligible on its own*: the three-field answer can never
arm observation.

`account_policy` (`20261111163052_pitwall_learning_evidence.sql:112-135`) is
private-schema; rights are revoked from `PUBLIC`/`anon`/`authenticated`/
`service_role` (lines 1765-1775). It is not device-reachable, so a real client
cannot read consent today. Nothing here invents that publisher or grants SQL
rights.

## 2. Optional local-draft `observation.policy`

For a future identity-scoped, server-published consent fact this client would
accept an **optional** nested object:

```json
"observation":{
  "enabled":true,"mode":"on","available":true,
  "policy":{"captureAllowed":true,"policyVersion":1}
}
```

* `policy` is **not** an existing server field. It is a local draft shape for
  the future publisher; its presence in tests is a synthetic fixture only.
* `captureAllowed` must be a JSON boolean `true` (no string/number coercion).
* `policyVersion` must be a JSON number that is exactly the integer `1`
  (`1.0` is accepted because it is integral; `"1"`, `2`, `0`, `-1`, `1.5` are
  not).
* Absent `policy`, `null`, wrong type, `captureAllowed` false, or any other
  version ⇒ deny.

## 3. Strictness and bounds

* `enabled` must be boolean `true`.
* `mode` must be the string `"on"` (ordinal).
* `available` must be boolean `true`.
* Input is bounded at 16384 characters *before* parsing; larger answers deny.
* Malformed JSON, trailing data, a non-object root, `observation:null`, an
  array/string observation ⇒ deny.
* The reader reuses the existing `MeasurementJson` dictionary reader
  (`MeasurementJson.DeserializeDictionary`), so it behaves identically on
  net48 and net8 and cannot silently drop nested objects.

## 4. Trust, binding and lifetime

An answer only counts when it belongs to the *exact request that carried it*:

* The request stamp is captured before the HTTP call from the request's own
  producer identity: device id, owner id, pairing generation and
  generation-known flag must be complete, and authorization (token present)
  must be true.
* Publication additionally requires that identical binding to still be the
  host's current trusted identity.
* Publication is accepted only for the newest request of the current host
  lifetime. Older in-flight answers can neither arm, refresh nor clear a newer
  state.
* `Pair`, `Unpair`, a committed identity change, `Stop` and plugin `End` bump
  the lifetime/epoch, so a late answer from the old identity or lifetime is
  ignored and can never publish authority.
* The owner id is never claimed from JSON: it comes from the captured local
  identity only. Nothing here raises a known generation or allocates one.

## 5. Freshness (local draft choice)

* The clock is an injected, local, monotonic millisecond source; memory only.
* TTL is `60000` ms and the age window is `[0, 60000)`: exactly 60000 and
  beyond deny, and a negative (backward) age denies.
* A throwing clock fails closed.
* This TTL is a **new local draft choice**, not an existing remote contract.

## 6. Response seams

Both real ingress points feed the *same* cache instance:

1. **Legacy 202 read site** (`SendLegacyV3Async`): request stamp from the
   identity captured for that send; the read success body is observed before
   the existing ACK path, and a non-2xx/exception denies.
2. **Mixed transport** (`ObservationReadinessTransportObserver` around the
   existing `HttpObservationSendTransport`): request stamp from the immutable
   `SendEnvelope` binding and token presence; the existing response/exception
   passes through unchanged and a binding-guard refusal denies without a POST.

The host's historical constant `false` receiver provider is replaced by
`ObservationReadinessCache.IsReadyFor(binding, authorized)` when a cache is
injected. The lock order is host gate → cache lock; no settings gate is taken
inside the host boundary or the cache, and no late callback can reach a newer
host instance. The old host constructor API remains valid: without an injected
cache the historical provider is still used.

Readiness, opt-in and settings stay independently required. On any observer
fault the core ACK, status, replay, retries, leases, disposal,
`transportPosted`, `RowJson` and normal telemetry are unchanged; readiness
never adds a POST, timer, network fetch, disk write, outbox or ledger write.

## 7. Deny matrix (bounded local reason codes)

| Reason | Cause |
| --- | --- |
| `not_observed` | no answer seen yet |
| `observation_absent` | no/ill-typed `observation` object |
| `receiver_disabled` | `enabled` not boolean true |
| `receiver_mode_off` | `mode` not `"on"` |
| `receiver_unavailable` | `available` not boolean true |
| `policy_absent` | **current** three-field answer; no `policy` object |
| `policy_denied` | `captureAllowed` not boolean true |
| `policy_version_unsupported` | absent/non-integral/other version |
| `request_untrusted` | incomplete/unauthorized/old-binding request |
| `response_empty` / `response_malformed` / `response_too_large` | unusable body |
| `http_non_success` / `transport_failure` / `request_not_sent` | failed attempt |
| `identity_changed` / `host_stopped` | Pair/Unpair/Stop/End |
| `clock_invalid` / `clock_backwards` / `expired` | local freshness |

## 8. Deliberately unchanged / not proven

* No account-policy publisher, no new Edge output, no SQL grant, no deployed
  receiver, no server-side learning-policy enforcement.
* `ObservationEnabled` stays `false`; there is no UI copy, toggle or new
  control capability.
* The default-off legacy telemetry request bytes, trim, ACK, drop, backoff,
  status and transport sequence remain byte-identical: the accepted
  `SendLegacyV3Async` body is reproduced exactly by removing only the three new
  observer statements, and both bodies are hash-pinned in
  `check-measurement-wiring.py` (W10).
* Existing ACK parsers classify a 202 identically with, without and before the
  proposed `policy` block (test `R32`).
* No claim of fleet adoption, of a successful remote RPC, or of installed
  runtime behaviour. Existing unknown local generations stay closed until a
  legitimate optional new Pair; updater/legacy telemetry do not require it.

## 9. Open dependency for real production arming

A working client reader still cannot arm real production observation because
the server side does not publish an identity-scoped consent fact to the device:
the only device-reaching receiver answer is the three-field ability block, and
`account_policy` is private and revoked from every device-reachable role. Until
an authenticated, identity-scoped account-policy projection (and its server
enforcement plus a deployed receiver) exists, the reader must — and does —
deny every real answer.
