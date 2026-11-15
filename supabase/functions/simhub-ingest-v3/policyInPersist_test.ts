// S2E5 — real-entry regression for the policy-in-persist package.
//
// Exercises the actual `simhub-ingest-v3` entry and the fixed cached SDK. No
// external request is possible: fetch is replaced and the test runs without
// --allow-net.
//
// Invariants proven here:
//   a) exactly one persist call and ZERO separate policy RPCs when the persist
//      result carries `observation_policy`;
//   b) the published policy is correct for allow and deny;
//   c) absent / null / malformed / error results omit the policy and keep the
//      accepted 202 (fail-closed);
//   d) a failed, revoked or replayed core, and the flag being off, do zero
//      policy work;
//   e) a forged body owner/device/hash never wins: the persist call carries the
//      hash of the authenticated bearer token;
//   f) the bounded separate lookup still works when the field is absent (older
//      database without the additive migration), including its 750ms deadline.
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

type Mode =
  | "embedded-allow"
  | "embedded-deny"
  | "embedded-null"
  | "embedded-malformed"
  | "embedded-future-version"
  | "absent-fallback-allow"
  | "absent-fallback-missing"
  | "absent-fallback-throw"
  | "absent-fallback-late"
  | "absent-fallback-late-reject"
  | "core-failed"
  | "core-replayed"
  | "core-rate-limited"
  | "revoked"
  | "flag-off";

const PERSIST = "simhub_persist_v3";
const POLICY = "simhub_observation_policy_v1";

type Reply = {
  observation: {
    enabled: boolean;
    mode: string;
    available: boolean;
    policy: { captureAllowed: boolean; policyVersion: number | null };
  };
};

Deno.test({
  name: "real entry: policy comes from the persist result, never a second hop",
  fn: async () => {
    const originalFetch = globalThis.fetch;
    const originalServe = Deno.serve;
    const env = ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "SIMHUB_OBSERVATION_V1_ENABLED"];
    const previous = env.map(key => Deno.env.get(key));
    let handler: ((request: Request) => Response | Promise<Response>) | undefined;
    let mode: Mode = "embedded-allow";
    let calls: string[] = [];
    let persistArgs: Record<string, unknown> | null = null;
    let policyArgs: Record<string, unknown> | null = null;
    let policyPending = false;
    let historyOverlapped = false;
    const did = "d5000000-0000-4000-8000-000000000003";
    const token = "s2e5-synthetic-device-token-000000000000";
    const hash = [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token)))]
      .map(x => x.toString(16).padStart(2, "0")).join("");
    const fixture = JSON.parse(await Deno.readTextFile(
      new URL("../../../tools/simhub-plugin/3SM.EnduranceConnector.DiagnosticsTests/Fixtures/v3-frame-baseline.json", import.meta.url),
    ));
    try {
      Deno.env.set(env[0], "http://s2e5.invalid");
      Deno.env.set(env[1], "synthetic-lab-service-key");
      Deno.env.set(env[2], "true");
      // The assignment intentionally retains Deno.serve's actual overload type.
      Deno.serve = ((callback: typeof handler) => { handler = callback; return {}; }) as typeof Deno.serve;
      globalThis.fetch = async (input, init) => {
        const url = new URL(String(input));
        const name = url.pathname.split("/").at(-1)!;
        calls.push(name);
        const reply = (body: unknown) =>
          new Response(JSON.stringify(body), { headers: { "Content-Type": "application/json" } });
        if (name === "simhub_observation_v1_available") return reply(true);
        if (name === "simhub_devices") {
          return reply({
            id: did,
            owner_user_id: "authenticated-owner",
            revoked_at: mode === "revoked" ? "now" : null,
            connector_id: "lab",
            endurance_event_id: null,
            endurance_team_id: null,
          });
        }
        const args = JSON.parse(String(init?.body));
        if (name === PERSIST) {
          persistArgs = args;
          assert(args.p_token_hash === hash, "persist must use the authenticated token hash");
          assert(args.p_v3_normalized.observationPolicyRequested === true, "ON intent missing at SQL boundary");
          if (mode === "core-failed") {
            return new Response(JSON.stringify({ code: "XX000", message: "synthetic" }),
              { status: 500, headers: { "Content-Type": "application/json" } });
          }
          const result = mode === "core-replayed"
            ? "replayed"
            : (mode === "core-rate-limited" ? "rate_limited" : "accepted");
          const row: Record<string, unknown> = { result, received_at: "synthetic" };
          if (mode.startsWith("embedded-")) {
            if (mode === "embedded-allow") row.observation_policy = { captureAllowed: true, policyVersion: 2 };
            else if (mode === "embedded-deny") row.observation_policy = { captureAllowed: false, policyVersion: null };
            else if (mode === "embedded-null") row.observation_policy = null;
            else if (mode === "embedded-malformed") row.observation_policy = { captureAllowed: "yes", policyVersion: 1 };
            else row.observation_policy = { captureAllowed: true, policyVersion: 3 };
          }
          return reply([row]);
        }
        if (name === POLICY) {
          policyArgs = args;
          assert(args.p_token_hash === hash, "forged payload hash won");
          if (mode === "absent-fallback-throw") throw new Error("synthetic rejection");
          if (mode === "absent-fallback-missing") {
            return new Response(JSON.stringify({ code: "PGRST202", message: "missing" }),
              { status: 404, headers: { "Content-Type": "application/json" } });
          }
          if (mode === "absent-fallback-late") {
            policyPending = true;
            await new Promise(resolve => setTimeout(resolve, 900));
            policyPending = false;
          }
          if (mode === "absent-fallback-late-reject") {
            await new Promise(resolve => setTimeout(resolve, 900));
            throw new Error("synthetic late rejection");
          }
          return reply({ captureAllowed: true, policyVersion: 4 });
        }
        if (name === "simhub_record_lap_times") {
          historyOverlapped = policyPending;
          return reply(null);
        }
        if (name === "simhub_record_tyre_observations") return reply(null);
        throw new Error("unexpected URL " + url.pathname);
      };
      await import("./index.ts");
      assert(handler, "actual entry did not register handler");

      const run = async (current: Mode, enabled = true) => {
        mode = current;
        calls = [];
        persistArgs = null;
        policyArgs = null;
        Deno.env.set(env[2], enabled ? "true" : "false");
        const body = {
          ...fixture,
          capturedAt: new Date().toISOString(),
          sequence: 1,
          ownerUserId: "forged-owner",
          tokenHash: "f".repeat(64),
          deviceId: "forged-device",
          observationPolicyRequested: { owner: "forged-owner", mode: "on" },
          ...(current === "absent-fallback-late" ? {
            lapTimes: [{ carId: "synthetic", sessionKey: "synthetic:1:0", lap: 7, seconds: 121.456, source: "sdk" }],
          } : {}),
        };
        const response = await handler!(new Request("http://s2e5.invalid/functions/v1/simhub-ingest-v3", {
          method: "POST",
          headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" },
          body: JSON.stringify(body),
        }));
        return { response, json: (await response.json()) as unknown as Reply };
      };
      const count = (name: string) => calls.filter(x => x === name).length;

      // (e) forged body values never win, in every successful mode.
      for (const current of ["embedded-allow", "absent-fallback-allow"] as Mode[]) {
        const { response, json } = await run(current);
        assert(response.status === 202, `${current}: accepted core lost`);
        assert(persistArgs!.p_token_hash === hash, `${current}: forged body hash won`);
        assert(!JSON.stringify(persistArgs).includes("forged-owner"), `${current}: body owner forwarded`);
        assert(!JSON.stringify(persistArgs).includes("forged-device"), `${current}: body device forwarded`);
        assert(JSON.stringify(json.observation.policy) === JSON.stringify(
          current === "embedded-allow"
            ? { captureAllowed: true, policyVersion: 2 }
            : { captureAllowed: true, policyVersion: 4 },
        ), `${current}: wrong policy`);
      }

      // (a)+(b) embedded allow: one persist, zero policy RPCs.
      {
        const { response, json } = await run("embedded-allow");
        assert(response.status === 202, "embedded allow lost core");
        assert(count(PERSIST) === 1, `exactly one persist call, got ${count(PERSIST)}`);
        assert(count(POLICY) === 0, `policy hop still used: ${count(POLICY)}`);
        assert(json.observation.enabled === true && json.observation.mode === "on", "observation flags changed");
        assert(json.observation.available === true, "availability changed");
        assert(json.observation.policy.captureAllowed === true, "allow not published");
        assert(json.observation.policy.policyVersion === 2, "version not published");
      }

      // (b) embedded deny: explicit deny, still zero hops.
      {
        const { response, json } = await run("embedded-deny");
        assert(response.status === 202, "embedded deny lost core");
        assert(count(PERSIST) === 1 && count(POLICY) === 0, "deny must not add a hop");
        assert(json.observation.policy.captureAllowed === false, "deny not published");
        assert(json.observation.policy.policyVersion === null, "deny must carry null version");
      }

      // Unknown future version is published verbatim, never blessed as 1.
      {
        const { json } = await run("embedded-future-version");
        assert(json.observation.policy.policyVersion === 3, "future version rewritten");
        assert(count(POLICY) === 0, "future version added a hop");
      }

      // (c) null and malformed embedded values: omit, never an extra hop.
      for (const current of ["embedded-null", "embedded-malformed"] as Mode[]) {
        const { response, json } = await run(current);
        assert(response.status === 202, `${current}: fail-closed lost the core`);
        assert(!("policy" in json.observation), `${current}: unusable policy published`);
        assert(count(PERSIST) === 1, `${current}: persist count changed`);
        assert(count(POLICY) === 0, `${current}: null must not trigger a second hop`);
      }

      // (f) absent field: the old bounded lookup still works, exactly once.
      {
        const { response, json } = await run("absent-fallback-allow");
        assert(response.status === 202, "fallback lost core");
        assert(count(POLICY) === 1, `fallback must read exactly once, got ${count(POLICY)}`);
        assert(policyArgs!.p_token_hash === hash, "fallback used the wrong hash");
        assert(json.observation.policy.policyVersion === 4, "fallback policy not published");
      }
      for (const current of ["absent-fallback-missing", "absent-fallback-throw"] as Mode[]) {
        const { response, json } = await run(current);
        assert(response.status === 202, `${current}: fallback fault lost core`);
        assert(count(POLICY) === 1, `${current}: fallback not attempted exactly once`);
        assert(!("policy" in json.observation), `${current}: fault published a policy`);
      }
      {
        const started = performance.now();
        const { response, json } = await run("absent-fallback-late");
        const elapsed = performance.now() - started;
        assert(response.status === 202, "late fallback lost core");
        assert(!("policy" in json.observation), "late fallback published a policy");
        assert(elapsed < 5000, `fallback deadline lost: ${elapsed}ms`);
        assert(count(POLICY) === 1, "late fallback must read exactly once");
        assert(count("simhub_record_lap_times") === 1 && historyOverlapped, "policy/history no longer overlap");
        await new Promise(resolve => setTimeout(resolve, 250));
      }

      // (d) failed or replayed core: zero policy work, no observation block.
      {
        const { response, json } = await run("absent-fallback-late-reject");
        assert(response.status === 202, "late rejecting fallback lost core");
        assert(!("policy" in json.observation), "late rejection published policy");
        await new Promise(resolve => setTimeout(resolve, 250));
        assert(count(POLICY) === 1, "late rejection retried");
      }
      for (const [current, status] of [["core-replayed", 409], ["core-rate-limited", 429], ["core-failed", 500]] as [Mode, number][]) {
        const { response, json } = await run(current);
        assert(response.status === status, `${current}: core status changed`);
        assert(count(POLICY) === 0, `${current}: policy read on a failed core`);
        assert(!json.observation, `${current}: policy published on a failed core`);
      }

      // (d) revoked device: refused before any persist or policy call.
      {
        const { response, json } = await run("revoked");
        assert(response.status === 401, "revoked status changed");
        assert(count(PERSIST) === 0, "revoked device reached persist");
        assert(count(POLICY) === 0, "revoked device reached the policy lookup");
        assert(!json.observation, "revoked device published a policy");
      }
    } finally {
      globalThis.fetch = originalFetch;
      Deno.serve = originalServe;
      env.forEach((key, i) => previous[i] === undefined ? Deno.env.delete(key) : Deno.env.set(key, previous[i]!));
    }
  },
});

for (const setting of ["false", "absent", "unavailable"]) Deno.test({
  name: `real entry: ${setting} overrides forged intent before SQL and does no policy hop`,
  fn: async () => {
    const originalFetch = globalThis.fetch;
    const originalServe = Deno.serve;
    const env = ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "SIMHUB_OBSERVATION_V1_ENABLED"];
    const previous = env.map(key => Deno.env.get(key));
    let handler: ((request: Request) => Response | Promise<Response>) | undefined;
    const calls: string[] = [];
    const token = "s2e5-synthetic-device-token-000000000000";
    const fixture = JSON.parse(await Deno.readTextFile(
      new URL("../../../tools/simhub-plugin/3SM.EnduranceConnector.DiagnosticsTests/Fixtures/v3-frame-baseline.json", import.meta.url),
    ));
    try {
      Deno.env.set(env[0], "http://s2e5.invalid");
      Deno.env.set(env[1], "synthetic-lab-service-key");
      if (setting === "absent") Deno.env.delete(env[2]);
      else Deno.env.set(env[2], setting === "unavailable" ? "true" : "false");
      Deno.serve = ((callback: typeof handler) => { handler = callback; return {}; }) as typeof Deno.serve;
      globalThis.fetch = async (input, init) => {
        const url = new URL(String(input));
        const name = url.pathname.split("/").at(-1)!;
        calls.push(name);
        const reply = (body: unknown) =>
          new Response(JSON.stringify(body), { headers: { "Content-Type": "application/json" } });
        if (name === "simhub_observation_v1_available") return reply(false);
        if (name === "simhub_devices") {
          return reply({ id: "d5000000-0000-4000-8000-000000000004", owner_user_id: "owner", revoked_at: null, connector_id: "lab", endurance_event_id: null, endurance_team_id: null });
        }
        if (name === "simhub_persist_v3") {
          const args = JSON.parse(String(init?.body));
          assert(args.p_v3_normalized.observationPolicyRequested === false, "forged intent reached SQL");
          // The database would still return the column; the Edge must not use it.
          return reply([{ result: "accepted", received_at: "synthetic", observation_policy: { captureAllowed: true, policyVersion: 2 } }]);
        }
        if (name === "simhub_observation_policy_v1") return reply({ captureAllowed: true, policyVersion: 2 });
        if (name === "simhub_record_tyre_observations") return reply(null);
        throw new Error("unexpected URL " + url.pathname);
      };
      // A distinct module instance so the env flag is read as "false".
      await import(new URL(`./index.ts?s2e5-mode-${setting}`, import.meta.url).href);
      assert(handler, "actual entry did not register handler");
      const response = await handler!(new Request("http://s2e5.invalid/functions/v1/simhub-ingest-v3", {
        method: "POST",
        headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" },
        body: JSON.stringify({ ...fixture, observationPolicyRequested: true, capturedAt: new Date().toISOString(), sequence: 1 }),
      }));
      const json = (await response.json()) as unknown as Reply;
      assert(response.status === 202, "flag off lost core");
      assert(!calls.includes("simhub_observation_policy_v1"), "flag off queried the policy RPC");
      assert(calls.includes("simhub_observation_v1_available") === (setting === "unavailable"), "mode probe mismatch");
      assert(json.observation.enabled === (setting === "unavailable"), "flag not reported");
      assert(json.observation.mode !== "on", "mode not off");
      assert(!("policy" in json.observation), "flag off published a policy");
    } finally {
      globalThis.fetch = originalFetch;
      Deno.serve = originalServe;
      env.forEach((key, i) => previous[i] === undefined ? Deno.env.delete(key) : Deno.env.set(key, previous[i]!));
    }
  },
});
