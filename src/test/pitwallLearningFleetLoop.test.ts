import { runFuelCycle } from "../../workers/pitwall-learning/loop";

/**
 * The SQL gate returns NULL for an old device on a mixed-version account.
 * The worker must treat that as "nothing to learn from" and finish the job,
 * not retry it forever or fall through to fuel_worker_record.
 */
describe("pitwall learning fuel cycle fleet gate", () => {
  it("finishes a source job without recording when the device is not eligible", async () => {
    const calls: Array<{ name: string; args: unknown[] }> = [];
    const db = {
      async call<T>(name: string, args: unknown[]): Promise<T> {
        calls.push({ name, args });
        if (name === "claim_jobs") {
          return [{ job_id: "job-1", lease_token: "lease-1", kind: "source_validate" }] as T;
        }
        if (name === "fuel_worker_source") return null as T;
        if (name === "finish_job") return { ok: true } as T;
        throw new Error(`unexpected operation: ${name}`);
      },
    };

    const result = await runFuelCycle(db);

    expect(result.jobs).toBe(1);
    expect(result.observations).toBe(0);
    expect(result.retries).toBe(0);
    expect(calls.some((call) => call.name === "fuel_worker_record")).toBe(false);
    expect(calls).toContainEqual({
      name: "finish_job",
      args: ["job-1", "lease-1", "done", null],
    });
  });
});
