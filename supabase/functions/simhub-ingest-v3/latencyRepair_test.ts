// Exercise the real entry and fixed cached SDK. No external request is possible:
// fetch is replaced and the test runs without --allow-net.
import { parsePaceCapture } from "../_shared/paceCapture.ts";
import type { TelemetryContextClient } from "./context.ts";

const assert = (condition: unknown, message: string): void => {
  if (!condition) throw new Error(message);
};

Deno.test("context port accepts a then-only SDK-style result", async () => {
  const result = { data: null, error: null };
  const thenOnly: PromiseLike<typeof result> = {
    then: (onfulfilled, onrejected) => Promise.resolve(result).then(onfulfilled, onrejected),
  };
  const port: TelemetryContextClient = {
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: () => thenOnly }) }) }),
    rpc: () => thenOnly,
  };
  assert((await port.from("simhub_devices").select("id").eq("token_hash", "hash").maybeSingle()).data === null, "thenable data");
  assert(!("catch" in thenOnly), "control must not be a full Promise");
});

Deno.test("PACE extension tuple preserves nullable fields and strict keys", () => {
  const metric = { id: "car", observedSessionTimeSeconds: 2, sectorMismatchCount: 0, sectorDiagnostic: null, sectorCount: null };
  const body = { schemaRevision: 1, observedSessionId: "session", segmentId: "segment", opponentMetrics: [metric], opponentLaps: [], traceChunks: [] };
  const parsed = parsePaceCapture(body);
  assert(parsed?.opponentMetrics[0].sectorDiagnostic === null, "explicit null retained");
  assert(!Object.hasOwn(parsed!.opponentMetrics[0], "sectorSource"), "missing remains missing");
  assert(parsePaceCapture({ ...body, opponentMetrics: [{ ...metric, forged: true }] }) === null, "unknown keys still rejected");
});

Deno.test({ name: "real entry joins overlapped policy only after accepted core; errors, identity, timeout", fn: async () => {
  const originalFetch = globalThis.fetch;
  const originalServe = Deno.serve;
  const env = ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "SIMHUB_OBSERVATION_V1_ENABLED"];
  const previous = env.map(key => Deno.env.get(key));
  let handler: ((request: Request) => Response | Promise<Response>) | undefined;
  let mode = "allow";
  let calls: string[] = [];
  let policyStarted = false;
  let policyDone = false;
  let overlapSeen = false;
  const did = "d4000000-0000-4000-8000-000000000003";
  const token = "s2e4-synthetic-device-token-000000000000";
  const hash = [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token)))].map(x => x.toString(16).padStart(2, "0")).join("");
  const fixture = JSON.parse(await Deno.readTextFile(new URL("../../../tools/simhub-plugin/3SM.EnduranceConnector.DiagnosticsTests/Fixtures/v3-frame-baseline.json", import.meta.url)));
  try {
    Deno.env.set(env[0], "http://s2e4.invalid"); Deno.env.set(env[1], "synthetic-lab-service-key"); Deno.env.set(env[2], "true");
    // The assignment intentionally retains Deno.serve's actual overload type.
    Deno.serve = ((callback: typeof handler) => { handler = callback; return {}; }) as typeof Deno.serve;
    globalThis.fetch = async (input, init) => {
      const url = new URL(String(input));
      const name = url.pathname.split("/").at(-1)!;
      calls.push(name);
      const reply = (body: unknown) => new Response(JSON.stringify(body), { headers: { "Content-Type": "application/json" } });
      if (name === "simhub_observation_v1_available") return reply(true);
      if (name === "simhub_devices") return reply({ id: did, owner_user_id: "authenticated-owner", revoked_at: mode === "revoked" ? "now" : null, connector_id: "lab", endurance_event_id: null, endurance_team_id: null });
      const args = JSON.parse(String(init?.body));
      if (name === "simhub_persist_v3") {
        assert(args.p_token_hash === hash, "core token must be authenticated");
        return reply([{ result: mode === "core-fail" ? "replayed" : "accepted", received_at: "synthetic" }]);
      }
      if (name === "simhub_observation_policy_v1") {
        policyStarted = true;
        assert(args.p_token_hash === hash, "forged payload hash won");
        if (mode === "throw") throw new Error("synthetic rejection");
        await new Promise(resolve => setTimeout(resolve, mode.startsWith("late") ? 800 : 30));
        if (mode === "late-reject") throw new Error("synthetic late rejection");
        policyDone = true;
        if (mode === "missing") return new Response(JSON.stringify({ code: "PGRST202", message: "missing" }), { status: 404, headers: { "Content-Type": "application/json" } });
        return reply(mode === "deny" ? { captureAllowed: false, policyVersion: null } : { captureAllowed: true, policyVersion: 2 });
      }
      if (name === "simhub_record_tyre_observations") {
        overlapSeen = policyStarted && !policyDone;
        return reply(null);
      }
      throw new Error("unexpected URL " + url.pathname);
    };
    await import("./index.ts");
    assert(handler, "actual entry did not register handler");
    for (mode of ["allow", "deny", "missing", "throw", "late", "late-reject", "core-fail", "revoked"]) {
      calls = []; policyStarted = false; policyDone = false; overlapSeen = false;
      const body = { ...fixture, capturedAt: new Date().toISOString(), sequence: 1, ownerUserId: "forged", tokenHash: "f".repeat(64), deviceId: "forged" };
      const response = await handler!(new Request("http://s2e4.invalid/functions/v1/simhub-ingest-v3", { method: "POST", headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" }, body: JSON.stringify(body) }));
      const json = await response.json();
      if (mode === "core-fail" || mode === "revoked") {
        assert(response.status === (mode === "core-fail" ? 409 : 401), "core status changed");
        assert(!calls.includes("simhub_observation_policy_v1"), "lookup on failed core");
        assert(!json.observation, "policy on failed core");
      } else {
        assert(response.status === 202, "policy fault lost core");
        assert(overlapSeen, "policy remains serialized behind tyre write");
        assert(calls.filter(x => x === "simhub_observation_policy_v1").length === 1, "not exactly one policy read");
        if (mode === "allow") assert(json.observation.policy.policyVersion === 2, "valid allow control");
        else if (mode === "deny") assert(json.observation.policy.captureAllowed === false, "changed permission not read afresh");
        else assert(!json.observation.policy, "fault or timeout published policy");
      }
      if (mode.startsWith("late")) await new Promise(resolve => setTimeout(resolve, 100));
    }
  } finally {
    globalThis.fetch = originalFetch; Deno.serve = originalServe;
    env.forEach((key, i) => previous[i] === undefined ? Deno.env.delete(key) : Deno.env.set(key, previous[i]!));
  }
}});
