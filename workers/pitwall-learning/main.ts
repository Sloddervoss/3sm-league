import { runFuelCycle, type FuelDatabase } from "./loop.ts";

const operations = new Set(["claim_jobs", "materialize_capture_batch", "fuel_worker_source", "fuel_worker_server_source", "fuel_worker_record",
  "fuel_worker_window", "fuel_worker_example", "fuel_worker_forecast", "fuel_worker_save_model", "fuel_worker_provision", "fuel_worker_retention", "finish_job"]);
const psql = Deno.env.get("PSQL_BIN") ?? "/usr/lib/postgresql/15/bin/psql";
if (Deno.env.get("PGUSER") !== "pitwall_learning_worker") throw new Error("Dedicated worker role required");
if (!Deno.env.get("PGHOST") || !Deno.env.get("PGDATABASE")) throw new Error("Explicit database target required");
function literal(v: unknown): string {
  if (v === null) return "NULL";
  if (typeof v === "number") { if (!Number.isFinite(v)) throw new Error("Nonfinite argument"); return String(v); }
  if (typeof v === "boolean") return v ? "true" : "false";
  const text = typeof v === "string" ? v : JSON.stringify(v);
  if (typeof text !== "string" || text.length > 262144) throw new Error("Invalid argument");
  return "'" + text.replaceAll("'", "''") + "'" + (typeof v === "object" ? "::jsonb" : "");
}
const database: FuelDatabase = {
  async call<T>(name: string, args: unknown[]): Promise<T> {
    if (!operations.has(name)) throw new Error("Unapproved operation");
    const query = "SET standard_conforming_strings=on; SELECT to_jsonb(pitwall_learning.\"" + name + "\"(" + args.map(literal).join(",") + "));";
    const child = new Deno.Command(psql, { args: ["-X", "-q", "-A", "-t", "-v", "ON_ERROR_STOP=1"],
      stdin: "piped", stdout: "piped", stderr: "piped" }).spawn();
    const deadline = setTimeout(() => { try { child.kill("SIGTERM"); } catch { /* already settled */ } }, 10000);
    try {
      const writer = child.stdin.getWriter(); await writer.write(new TextEncoder().encode(query)); await writer.close();
      const result = await child.output();
      if (!result.success) throw new Error("Bounded database operation failed");
      const text = new TextDecoder().decode(result.stdout).trim();
      return (text ? JSON.parse(text) : null) as T;
    } finally { clearTimeout(deadline); }
  },
};
let provisionAfter = 0;
let failures = 0;
const once = Deno.args.includes("--once");
do {
  try {
    if (Date.now() >= provisionAfter) {
      await database.call("fuel_worker_retention", [1000]);
      await database.call("fuel_worker_provision", [100]); provisionAfter = Date.now() + 60000;
    }
    const result = await runFuelCycle(database);
    failures = 0;
    if (result.jobs || once) console.log(JSON.stringify(result));
    if (!once) await new Promise(resolve => setTimeout(resolve, result.jobs ? 100 : 5000));
  } catch {
    failures++;
    console.error("fuel_worker_cycle_failed");
    if (once) Deno.exit(1);
    await new Promise(resolve => setTimeout(resolve, Math.min(60000, 1000 * 2 ** Math.min(failures, 6))));
  }
} while (!once);
