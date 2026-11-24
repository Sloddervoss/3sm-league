import { fitFuelCandidate, type FuelExample } from "../../src/features/endurance/pitwall/learning/fuelCandidate.ts";
import { qualifyFuelRevision, type VisibleFuelRevision, type QualifiedFuelObservation, type ProspectiveFuelForecast } from "../../src/features/endurance/pitwall/learning/fuelEvidence.ts";
import { qualifyServerFacts, type ServerFuelFacts } from "../../src/features/endurance/pitwall/learning/serverEvidence.ts";
export interface FuelDatabase {
  call<T>(name: string, args: unknown[]): Promise<T>;
}
interface Job { job_id: string; lease_token: string; kind: string }
interface Window {
  observations: QualifiedFuelObservation[];
  forecasts: ProspectiveFuelForecast[];
  examples: FuelExample[];
  asOf: number;
  minExamples?: number;
}
export interface CycleResult { jobs: number; materialized: number; observations: number; examples: number; candidates: number; retries: number }
/** Actual bounded caller of the existing queue, causal adapter and fitted candidate. */
export async function runFuelCycle(db: FuelDatabase): Promise<CycleResult> {
  const result: CycleResult = { jobs: 0, materialized: 0, observations: 0, examples: 0, candidates: 0, retries: 0 };
  const jobs = await db.call<Job[]>("claim_jobs", [5, 60]);
  for (const job of jobs) {
    result.jobs++;
    try {
      if (job.kind === "materialize_capture_batch") {
        const response = await db.call<{ ok: boolean }>("materialize_capture_batch", [job.job_id, job.lease_token]);
        if (!response.ok) throw new Error("materialization_not_committed");
        result.materialized++; continue;
      }
      const source = await db.call<VisibleFuelRevision | null>("fuel_worker_source", [job.job_id, job.lease_token]);
      let observation = source ? qualifyFuelRevision(source) : null;
      if (source && !observation) {
        // The connector's local observation ledger never opened on any field
        // device, so the lap summary arrives without an observation block.
        // The restricted SQL function resolves the same facts from the stored
        // lap row plus the identity written by the same persist transaction.
        const facts = await db.call<ServerFuelFacts | null>("fuel_worker_server_source", [job.job_id, job.lease_token]);
        observation = qualifyServerFacts(facts);
      }
      if (observation) {
        const recorded = await db.call<boolean>("fuel_worker_record", [job.job_id, job.lease_token, observation]);
        if (!recorded) throw new Error("qualification_not_committed");
        result.observations++;
        let window = await db.call<Window | null>("fuel_worker_window", [observation.owner, observation.context]);
        if (!window) throw new Error("policy_changed");
        for (const forecast of window.forecasts) {
          if (forecast.targetLap === observation.lap && forecast.session === observation.session) {
            const id = await db.call<string | null>("fuel_worker_example", [forecast.id, observation.revision]);
            if (id) result.examples++;
          }
        }
        const baseline = window.observations.filter(row => row.session === observation.session && row.knownAt <= observation.knownAt)
          .sort((a, b) => b.knownAt - a.knownAt).slice(0, 20).map(row => row.usedLitres);
        if (baseline.length >= 3) await db.call("fuel_worker_forecast", [observation.revision, baseline]);
        window = await db.call<Window | null>("fuel_worker_window", [observation.owner, observation.context]);
        if (!window) throw new Error("policy_changed");
        if (window.examples.length >= (window.minExamples ?? 100)) {
          const candidate = fitFuelCandidate(window.examples, window.asOf);
          if (candidate) {
            const saved = await db.call<string | null>("fuel_worker_save_model", [observation.owner, observation.context, candidate]);
            if (saved) result.candidates++;
          }
        }
      }
      const done = await db.call<{ ok: boolean }>("finish_job", [job.job_id, job.lease_token, "done", null]);
      if (!done.ok) throw new Error("finish_not_committed");
    } catch {
      // Never log payloads, account IDs, connection strings, lease tokens or SQL errors.
      result.retries++;
      await db.call("finish_job", [job.job_id, job.lease_token, "retry", "fuel_worker_error"]);
    }
  }
  return result;
}
