/**
 * S2E2 — executable contract tests voor de policy-composer.
 *
 * Alleen synthetische antwoorden en een geïnjecteerde RPC. Geen netwerk,
 * database, SDK of Edge-runtime. De bronpin onderaan bewijst dat de echte
 * `simhub-ingest-v3`-route de composer in het geaccepteerde 202-pad gebruikt.
 */

// deno-lint-ignore-file no-explicit-any -- fixtures zijn bewust JSON-vormig

import {
  composeObservationPolicy,
  maybeComposeObservationPolicy,
  ObservationPolicyRpc,
  ObservationPolicyTimeoutMs,
  readObservationPolicy,
} from "./observationPolicyV1.ts";

const TOKEN_HASH = "a".repeat(64);
const OTHER_HASH = "b".repeat(64);

function assert(
  condition: unknown,
  message = "assertion failed",
): asserts condition {
  if (!condition) throw new Error(message);
}

function assertEqual(actual: unknown, expected: unknown, label = ""): void {
  const a = JSON.stringify(actual);
  const b = JSON.stringify(expected);
  if (a !== b) throw new Error(`${label}: expected ${b}, got ${a}`);
}

type Call = { fn: string; args: Record<string, unknown> };

function fakeRpc(
  result: { data?: unknown; error?: unknown } | (() => any),
): { rpc: (fn: string, args: Record<string, unknown>) => any; calls: Call[] } {
  const calls: Call[] = [];
  const rpc = (fn: string, args: Record<string, unknown>) => {
    calls.push({ fn, args });
    if (typeof result === "function") return result();
    return { data: result.data, error: result.error ?? null };
  };
  return { rpc, calls };
}

Deno.test("default off does zero RPC calls", async () => {
  const { rpc, calls } = fakeRpc({ data: { captureAllowed: true, policyVersion: 1 } });
  for (const mode of ["off", "unavailable", "", "OFF", "on "]) {
    const policy = await maybeComposeObservationPolicy(mode, TOKEN_HASH, rpc);
    assertEqual(policy, undefined, `mode ${JSON.stringify(mode)}`);
  }
  assertEqual(calls.length, 0, "off modes must not query");
});

Deno.test("on + allowed publishes exactly true/version", async () => {
  const { rpc, calls } = fakeRpc({ data: { captureAllowed: true, policyVersion: 1 } });
  const policy = await maybeComposeObservationPolicy("on", TOKEN_HASH, rpc);
  assertEqual(policy, { captureAllowed: true, policyVersion: 1 });
  assertEqual(calls.length, 1, "one lookup");
  assertEqual(calls[0].fn, ObservationPolicyRpc);
  assertEqual(calls[0].args, { p_token_hash: TOKEN_HASH });
});

Deno.test("on + deny publishes an explicit deny with null version", async () => {
  const { rpc } = fakeRpc({ data: { captureAllowed: false, policyVersion: null } });
  const policy = await maybeComposeObservationPolicy("on", TOKEN_HASH, rpc);
  assertEqual(policy, { captureAllowed: false, policyVersion: null });
});

Deno.test("unknown future version stays exactly 2", async () => {
  const { rpc } = fakeRpc({ data: { captureAllowed: true, policyVersion: 2 } });
  const policy = await maybeComposeObservationPolicy("on", TOKEN_HASH, rpc);
  assertEqual(policy, { captureAllowed: true, policyVersion: 2 });
  assert(policy!.policyVersion !== 1, "must never bless 2 as 1");
});

Deno.test("array-wrapped result is accepted only as a single object", async () => {
  assertEqual(
    readObservationPolicy([{ captureAllowed: true, policyVersion: 1 }]),
    { captureAllowed: true, policyVersion: 1 },
  );
  assertEqual(readObservationPolicy([]), undefined);
  assertEqual(
    readObservationPolicy([
      { captureAllowed: true, policyVersion: 1 },
      { captureAllowed: true, policyVersion: 1 },
    ]),
    undefined,
  );
});

Deno.test("malformed or unsupported policy shapes are omitted", () => {
  const cases: unknown[] = [
    null,
    undefined,
    "true",
    42,
    true,
    {},
    { captureAllowed: "true", policyVersion: 1 },
    { captureAllowed: 1, policyVersion: 1 },
    { captureAllowed: true },
    { captureAllowed: true, policyVersion: null },
    { captureAllowed: true, policyVersion: "1" },
    { captureAllowed: true, policyVersion: 0 },
    { captureAllowed: true, policyVersion: -1 },
    { captureAllowed: true, policyVersion: 1.5 },
    { captureAllowed: true, policyVersion: Number.NaN },
    { policyVersion: 1 },
  ];
  for (const value of cases) {
    assertEqual(readObservationPolicy(value), undefined, JSON.stringify(value) ?? "undefined");
  }
});

Deno.test("extra result keys are ignored (no owner/token/hash passthrough)", async () => {
  const { rpc } = fakeRpc({
    data: {
      captureAllowed: true,
      policyVersion: 1,
      ownerUserId: "a0000000-0000-4000-8000-0000000000a1",
      tokenHash: TOKEN_HASH,
      deviceId: "d0000000-0000-4000-8000-0000000000a1",
    },
  });
  const policy = await maybeComposeObservationPolicy("on", TOKEN_HASH, rpc);
  assertEqual(Object.keys(policy!).sort(), ["captureAllowed", "policyVersion"]);
  const text = JSON.stringify(policy);
  assert(!text.includes(TOKEN_HASH), "token hash leaked");
  assert(!text.includes("a0000000"), "owner leaked");
});

Deno.test("RPC error, throw, missing function and malformed data omit policy", async () => {
  const missing = fakeRpc({ error: { code: "PGRST202", message: "missing" } });
  assertEqual(await maybeComposeObservationPolicy("on", TOKEN_HASH, missing.rpc), undefined);

  const thrown = fakeRpc((): any => {
    throw new Error("network down");
  });
  assertEqual(await maybeComposeObservationPolicy("on", TOKEN_HASH, thrown.rpc), undefined);

  const rejected = fakeRpc((): any => Promise.reject(new Error("boom")));
  assertEqual(await maybeComposeObservationPolicy("on", TOKEN_HASH, rejected.rpc), undefined);

  const malformed = fakeRpc({ data: "<html>" });
  assertEqual(await maybeComposeObservationPolicy("on", TOKEN_HASH, malformed.rpc), undefined);
});

Deno.test("slow or hanging RPC is bounded and omitted", async () => {
  const hanging = fakeRpc(() => new Promise(() => {}));
  const started = performance.now();
  const policy = await maybeComposeObservationPolicy("on", TOKEN_HASH, hanging.rpc, 20);
  const elapsed = performance.now() - started;
  assertEqual(policy, undefined);
  assert(elapsed < 1000, `timeout did not bound: ${elapsed}ms`);
  assert(ObservationPolicyTimeoutMs > 0 && ObservationPolicyTimeoutMs <= 2000);
});

Deno.test("invalid token hash never reaches the RPC", async () => {
  const { rpc, calls } = fakeRpc({ data: { captureAllowed: true, policyVersion: 1 } });
  const bad = [
    "",
    " ",
    TOKEN_HASH.toUpperCase(),
    TOKEN_HASH.slice(1),
    TOKEN_HASH + "a",
    "g".repeat(64),
    `0x${TOKEN_HASH.slice(2)}`,
    `${TOKEN_HASH} `,
  ];
  for (const value of bad) {
    assertEqual(await composeObservationPolicy(value, rpc), undefined, JSON.stringify(value));
  }
  assertEqual(calls.length, 0, "invalid hashes must not query");
});

Deno.test("the composer performs no caching between calls", async () => {
  let allowed = true;
  const calls: Call[] = [];
  const rpc = (fn: string, args: Record<string, unknown>) => {
    calls.push({ fn, args });
    return { data: { captureAllowed: allowed, policyVersion: 1 }, error: null };
  };
  assertEqual(
    await maybeComposeObservationPolicy("on", TOKEN_HASH, rpc),
    { captureAllowed: true, policyVersion: 1 },
  );
  allowed = false;
  assertEqual(
    await maybeComposeObservationPolicy("on", TOKEN_HASH, rpc),
    { captureAllowed: false, policyVersion: null },
  );
  assertEqual(calls.length, 2, "each eligible answer asks once, nothing cached");
});

Deno.test("actual ingest-v3 202 path uses the composer exactly once, optionally", async () => {
  const source = await Deno.readTextFile(
    new URL("../simhub-ingest-v3/index.ts", import.meta.url),
  );
  const occurrences = source.split("maybeComposeObservationPolicy(").length - 1;
  assertEqual(occurrences, 1, "composer is wired once");

  const callAt = source.indexOf("maybeComposeObservationPolicy(");
  const acceptedAt = source.indexOf('if (result !== "accepted")');
  const returnAt = source.indexOf("return jsonResponse(request, {\n        accepted: true,");
  assert(acceptedAt > 0 && returnAt > acceptedAt, "expected accepted 202 block");
  assert(
    callAt > acceptedAt && callAt < returnAt,
    "composer must run after the accepted gate and before the 202",
  );

  assert(
    source.includes("observationMode,\n        tokenHash,") ||
      source.includes("observationMode, tokenHash") ||
      /maybeComposeObservationPolicy\(\s*observationMode,\s*tokenHash,/.test(source),
    "composer must receive the resolved mode and validated token hash",
  );
  assert(
    source.includes("p_token_hash: tokenHash,"),
    "the same token hash must feed the persist RPC",
  );
  assert(
    !source.includes('p_token_hash: await sha256Hex(token),') ||
      source.indexOf("p_token_hash: tokenHash,") > 0,
    "accepted path must not recompute a second hash",
  );

  const observationBlock = source.slice(returnAt, returnAt + 500);
  assert(observationBlock.includes("enabled: OBSERVATION_V1_ENABLED,"), "enabled preserved");
  assert(observationBlock.includes("mode: observationMode,"), "mode preserved");
  assert(observationBlock.includes("available: observationCapability.available,"), "available preserved");
  assert(
    observationBlock.includes("...(policy ? { policy } : {}),"),
    "policy is added optionally without replacing the three existing fields",
  );
});
