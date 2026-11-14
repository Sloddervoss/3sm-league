# Pitwall learning — normal plugin update (incomplete implementation)

Authority: Vincent's explicit GO, Discord `1571219534478708778`, 14 November
2026: extend the existing plugin and pitwall through a normal additive update.
Personal first; no new pooling, separate plugin, cohort platform or re-pairing
requirement. Parent owns acceptance and normal publication. Historical P1/P2
restrictions do not prohibit fitting under this new GO.

## Actual source scope and verification

Base: `d83bcf8cf89a43dc77ba5bc7aa23386de7c1095f`.
The only implemented addition is `learning/fuelCandidate.ts` and its synthetic
unit tests under `src/features/endurance/pitwall/`. It reuses the existing pinned
`strategy/fuelModel.ts` baseline. It fits a deterministic previous-complete-lap
ratio using train sessions, calibrates an absolute residual interval on separate
sessions and evaluates untouched later test sessions. It rejects duplicates,
unknown qualification, mixed owners/contexts and inconsistent causal chronology.
It does not authenticate source claims. `qualified: true` is not evidence of
server authorization; no production caller may construct it from client intent.

This is not the requested useful vertical slice. There is no automatic enrollment
change, prospective authority adapter, worker, persistence migration, authorised
read contribution or actual learned fuel consumer in this implementation. Do not
release it as a completed learner. Existing advice remains entirely baseline.

Actual checks:
- Candidate Vitest: 14 synthetic tests passed; targeted ESLint exit 0.
- Learning and strategy Vitest: 655 tests passed in 18 files, exit 0.
- Package typecheck: exit 2, diagnostics retained in private artifacts. No
  candidate-file diagnostic; exact clean-base diagnostic comparison not completed.
- Package build: exit 1 at the existing environment precheck; public Supabase
  build configuration was absent. No credentials were read or invented.
- No real SQL role/contract/rollback or end-to-end wire test was completed.
- Ingest, updater, ACK/outbox and accepted migration bytes are unchanged. Accepted
  S2E5 performance evidence remains historical evidence of those unchanged bytes;
  it does not validate this incomplete learner. No timing trial was repeated.

## Registered candidate thresholds, not a serving authorization

Version `personal-fuel-v1`, features `previous-complete-lap-v1`:
100 qualified laps, 20 independent chronological session groups, at least
10 train / 5 calibration / 5 test sessions. Minimum 10% MAE improvement over the
existing baseline; no worse mean underprediction. Nominal 90% interval with
actual held-out coverage at least 90%, full width at most 20% of median holdout
prediction; holdout median consumption-ratio drift at most 10% from training.
These limits were written before the first candidate test execution. A seven-day
age limit is declared for a future adapter; no serving/expiration implementation
exists. No threshold is asserted to confer production accuracy or safe ACTIVE
advice. Reserve and finish policies have not changed.

## Actual gaps and release ordering

The current client requires a hidden default-false flag and a known local pairing
generation; older configurations lack the latter. A normal update needs a durable
prospective epoch transition which preserves poisoned/high-watermark evidence,
not a reset/adoption of historical state. Server policies must provision only
missing eligible personal accounts, never overwrite denial rows or resurrect
opt-outs/deletion. Neither change has been implemented here.

Observation v1 deliberately does not carry owner/driver/reset proof and does not
turn missing pit/refuel facts into negative evidence. The private revision table
explicitly constrains every current row to non-training/as-of-unverifiable.
Existing context/quality modules must remain fail-closed. A future adapter must
establish causal authority before example construction; joining later device
ownership or treating name continuity as driver identity is not a fix.

The real initial surface is `PitwallDeviceTestPage.tsx` -> `usePitwallStrategy`
-> `buildStrategySnapshot` -> `advise` -> `estimateFuelPerLap`. The normal
endurance `get_pitwall_data` path and all three existing panels are unchanged.

Parent must not publish until the complete chain and paired disable/rollback have
been built and verified. Required ordering remains: new SQL/role contracts and
server acceptance first, then Edge acceptance if necessary, least-privilege
scheduled worker with capture/worker/shadow/advice independent switches, authorised
frontend integration, then Windows Release and updater old-to-new validation,
then the ordinary plugin manifest/publication. Intended version is 0.7.6.3;
no version/signing/manifest change is made here. No executable production
provisioning commands are supplied because that runtime is not implemented.

Disable/retention/restart: there is no new runtime to disable or roll back. The
new pure module has no production imports, storage or background activity. The
existing 7/180/90-day contracts remain unchanged, not newly implemented by this
work. Windows/device/publication and every worker/deployment gate remain open.

Private evidence and exact owned lab handles:
`/home/hermes/artifacts/3sm/pitwall-learning-normal-update-20261114/REPORT.md`.
An isolated PG15.19 instance was initialized but never restored with the captured
schema. Tool approval policy blocked the explicit owned-container cleanup command;
parent must clean up the handles in the checkpoint. No production SQL, deployment,
client installation, push, merge, child agent or external training service.

Impact: no runtime frontend/API/auth/bot behavior or database schema change.
Deployment impact: none applied. Local test lab cleanup remains required.
