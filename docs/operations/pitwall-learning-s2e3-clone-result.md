# S2E3 real-catalog isolated HTTP rehearsal — result

Status: execution completed; release gates FAIL. No production change, push,
publication, deployment, enrollment or activation.

Worktree: `/home/hermes/wt/pitwall-learning-p2-readonly-clone`
Branch: `test/pitwall-learning-p2-readonly-clone`
Execution started at `319911a7703db6d0da1a83ad245c0317ab12283f`.
Application/migrations remain frozen at the approved `e939c32a` bytes.
Only rehearsal harness/tests/status were changed in this continuation.

## Actual gates

| Gate | Result | Evidence |
| --- | --- | --- |
| Read-only Kong/PostgREST backend marker, both arms | PASS | `HTTP-ROUTE-PROOF.json`, final route in `FINAL-AUDIT.json` |
| Actual Edge ingress/auth/context/persist RPC/PG/response | PASS for exercised matrix | `functional-smoke.json`, `functional-feature-on.json`, `FUNCTIONAL-AUTHORITY.json` |
| Feature-on capture / deny / missing-policy / RPC faults | PASS | Fresh eligible write captured; deny/missing owner policy made no private batch; missing/permission-error RPC omitted policy without core loss |
| Default-off extra observation calls | PASS | Zero probe/policy HTTP call deltas, separate from feature-on timing |
| Path-relevant ACLs | PASS | Actual HTTP anon 401, authenticated 403, service-role 200; effective SQL ACL evidence |
| Clone faithfulness | QUALIFIED, not whole-DB identical | Earlier object inventories reused; candidate restored only, current application object categories match saved applied snapshot; extension/role/ACL/publication residuals below |
| Full-path feature-on latency | FAIL | 200 matched measured pairs + 40 warmups/arm; no validation errors |
| Full Edge entry typecheck | FAIL in both arms | Three compiler errors in each arm; runtime execution is not typecheck PASS |
| Normative rollback safe-disable | PASS | All three rollback files exit 0; positive closed-permission/switch/trigger/RPC checks; retained data hashes unchanged; V1/V2/V3 HTTP continues |
| Full byte restoration | OPEN / not performed | Safe-disable deliberately retains private schema, evidence, observation column and amended writer |

Private evidence root (0700; exports 0600):
`/home/hermes/artifacts/3sm/pitwall-learning-p2-readonly-clone-20261114`

Parent entry points: `RESULT.md`, `CHECKPOINT.json`, `RESUME-CURRENT-HANDLES.json`,
`EVIDENCE-MANIFEST.json`. No raw export, source copy, credential, policy row or
production catalog is committed.

## Fixed latency result — no favorable rerun

Internal HTTP only, actual deployed source baseline versus whole hash-defined
candidate, real Kong -> Edge -> Kong -> PostgREST -> PostgreSQL path.
Candidate Edge flag explicitly true, database capture/observation flags true and
synthetic account policy allowed during the run. No preloaded future baseline.

Nearest-rank pooled measured p95:

- Baseline: 201.1858349999966 ms.
- Candidate: 251.65781199999037 ms.
- Increase: 50.471976999993785 ms (25.087241852784835%).
- Allowed increase: min(10% of baseline, 20 ms) = 20 ms. FAIL, without rounding waiver.

480 actual responses were 202: 80 warmups + 400 measured responses. ABBA order,
registered payloads, source/schema/config stability, per-arm sample counts and
semantic ACK differences were mechanically verified. No measured sample omitted.
Measured traffic per arm: 196 ordinary hot frames, two fresh legacy laps, two fresh
observation laps. Fresh-write class tails are descriptive only, not independent
p95 evidence. Both DBs reached sequence 1240; candidate persisted five benchmark
laps / five private capture batches, including two observation rows; baseline
persisted the three legacy laps and explicitly rejected observation-bearing rows,
as preregistered. This is no WAN/CDN/TLS or ML-quality claim.

Original registration SHA256:
`9b68118938f5dc84664e86a18bc94ca372486f7d37594fcd6edd2f0e1dd41214`

Corrected-run registration SHA256:
`4f9c56180631f7ae070df29e4876bc7084ba8a2acbfb58664e5180f849b71864`

Corrected-run raw SHA256:
`949eba1fc131fd79e1a3adc446c3baafd6c7166ffabcedb9bcb4e76d6775cac4`

Attempt 1 is preserved as INVALID: third warmup request received 429, zero
measured pairs completed. Cold service time defeated start-based device spacing.
Attempt 2 was separately preregistered before timing: same-arm completion +700ms,
global 600ms spacing, sequence offset to avoid replay, same workload/statistic/gate.
Actual timer minima were about 699.67ms after completion, above the real 400ms DB
floor. Original registration and timestamp-only preflight addenda are retained;
volatile catalog IDENT/COUNTS capture timestamps were not treated as schema drift.
The valid FAIL was not rerun or optimized away.

## Source classification and clone qualifications

Actual tree comparison found FOUR modified existing files, not just the three
called out in the handoff: `index.ts`, `context.ts`, `_shared/simhub.ts`, and
`_shared/simhubExtensions.ts`. The latter is the intended observation row parser
wiring. Three files were added: observation policy/parser/capability modules.
No files were deleted. All four existing-file diffs are intentional observation
capture/publisher/authenticated-device plumbing; no unrelated lost-hotfix hunk was
found in them. Hashes define the tested candidate. In-container TS source hashes
matched the saved baseline/candidate trees after execution. The live inherited
pace helper was not replaced by a friendlier baseline or edited to pass checks.

Candidate was found in prior safe-disable state. Only candidate DB was reset and
restored from the existing approved dump. First transactional P1 application
refused the retained cluster worker role; this failed attempt is recorded. After
proving no shared-object dependencies, the isolated lab-only retained role was
removed and the approved chain applied without editing its SQL. Baseline DB
objects were preserved; the shared worker role necessarily changed during apply
and was closed again by final rollback. Compared with saved applied evidence,
application table/column/constraint/index/policy/function/trigger/type inventories
match; one publication is absent in the reset candidate.

Earlier residuals remain explicit: image-only roles/memberships and component
schema default ACLs, pg_graphql version difference, unavailable unused pg_cron,
and realtime/publication differences. These are not whole-DB equality. The actual
measured path uses neither GraphQL, cron nor realtime subscriptions. Service-role
RPC/auth-role behavior and anon/authenticated denial were exercised through the
real gateway/PostgREST rather than assumed from object counts.

## Typecheck and rollback

Cached-only full entry `deno check` reached actual compilation in both arms and
returned exit 1 with the same error classes:

- `_shared/paceCapture.ts:65`: TS2345 PropertyKey/null inference.
- Entry context call: TS2589 excessive type instantiation.
- Entry context call: TS2345 SDK PostgrestBuilder is thenable, not the declared
  Promise shape (baseline line 113, candidate line 146).

An initial 128MiB client attempt exited 137 and is retained as resource-blocked,
not a compiler result. For the completed check, 384MiB was temporarily transferred
from the own DB memory budget to the client; total limits stayed unchanged.
Original budgets were restored and read back. No application fixes were made.

Final rollback is the documented safe-disable, not schema restoration. Positive
checks prove all five switches off, capture triggers absent, publisher RPC absent,
worker NOLOGIN/connection limit zero/no schema usage/no execute, ten private tables
retained, observation column retained, and unchanged retained data digests across
rollback. V1/V2/V3 and fresh legacy measurements still work; observation rows are
explicitly rejected without losing core telemetry. No reapply-after-rollback loop.
The candidate Edge's lab env flag remains true but database switches are off.

## Reproducers, verification and retained resources

From this worktree, completed stages were run with `python3` under
`scripts/pitwall-learning/s2e3/`:

- `resume.py route`, then `client` / `prove-route` after recorded startup scaffolding
  fixes; final read-only route PASS.
- `continue_checks.py prepare` / `apply-restored`; approved SQL exits recorded.
- `functional.py seed`, `smoke`, `flag-on`, `matrix`: final exits 0.
- `benchmark.py register`, `execute` (INVALID warmup), `attempt2` (valid FAIL),
  `recompute2`: raw/registration/results retained; script exit 0 does not mean gate PASS.
- `finish.py authority`, `acl`, `typecheck`, `typecheck-rebalanced`, `rollback`:
  stage scripts exit 0; compiler commands exit 1, rollback SQL commands exit 0.
- `final_audit.py`: exit 0; all 480 requests/order, final route, current resources,
  default-off call counts and actual in-container source hashes verified.
- `python3 -m unittest discover -s scripts/pitwall-learning/s2e3 -p test_resume.py -v`,
  `python3 -m compileall -q scripts/pitwall-learning/s2e3`, `git diff --check`.

No fresh project/SDK build, package install or production access was needed.
Bun/node_modules are unavailable in this worktree; root build/lint/test were not
substituted for full Edge entry checks. The resumed execution changed no frozen
application or migration file.

At executor handoff, seven owned containers, six owned volumes and the original
internal network remained for parent readback: total 2944MiB / 2 CPU, no host ports/binds,
production volumes, Docker socket or privileged containers. Exact retained IDs,
images, users, mounts and labels are in `FINAL-AUDIT.json` and
`RESUME-CURRENT-HANDLES.json`. DB ID remains the original approved handle.
No all-nonroot claim. Historical transient seed-helper exact IDs were not captured
before their `--rm` removal: a tracing gap, not an invented complete ID ledger.
The preserved harness now records helper IDs before start and checks aggregate
helper budget; that hardening has offline regression coverage, not a retroactive
claim about earlier helpers.

Remaining release constraints: latency gate FAIL; full entry typecheck FAIL;
separate full byte-restoration proof if required; accepted clone residuals and
limited fresh-write tail coverage must remain qualified. The supported old->new
automatic updater rehearsal remains separately required. No production apply,
deploy, enrollment, activation, model fitting/advice or release permission follows.
Frontend/bot/deployment/application code: unchanged. Own isolated synthetic DB,
lab roles/config/resources only were mutated. PRODUCTIEWIJZIGING: NEE.

## Parent verification and closeout

Parent independently recomputed all 480 raw samples and the nearest-rank p95;
the unrounded FAIL above is confirmed. All 107 manifest entries were checked:
only the active producer CLI log changed when its final answer was appended
after manifest creation. All other frozen hashes match; the original manifest
was not rewritten. See private `PARENT-FINAL-VERIFICATION.json`.

Parent read back the actual read-only HTTP markers through both retained arms,
verified exact container IDs/images/limits and reran the nine harness guard tests
(PASS). No mutating functional test or measured run was repeated. Application,
migrations, plugin and frontend remain byte-identical to the approved baseline.

After that readback, only the exact seven owned containers, six labelled managed
volumes and original internal network were removed. Each removal and final empty
label inventory were read back; no phase resource remains. Full private evidence,
schema export and raw samples are retained. See `PARENT-CLEANUP-VERIFIED.json`.
Production frontend changes: NONE. PRODUCTIEWIJZIGING: NEE.
