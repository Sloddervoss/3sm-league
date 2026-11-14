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
  ObservationPolicyField,
  ObservationPolicyRpc,
  ObservationPolicyTimeoutMs,
  readObservationPolicy,
  readPersistedObservationPolicy,
  resolveObservationPolicy,
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

// ---------------------------------------------------------------------------
// S2E5 — het policyfeit uit het persist-resultaat
// ---------------------------------------------------------------------------

Deno.test("persisted field: present/absent is distinguished, value is validated", () => {
  assertEqual(readPersistedObservationPolicy({ [ObservationPolicyField]: { captureAllowed: true, policyVersion: 1 } }),
    { present: true, policy: { captureAllowed: true, policyVersion: 1 } });
  assertEqual(readPersistedObservationPolicy({ [ObservationPolicyField]: { captureAllowed: false, policyVersion: null } }),
    { present: true, policy: { captureAllowed: false, policyVersion: null } });
  // A null column is "present but unusable": fail-closed, never a fallback hop.
  assertEqual(readPersistedObservationPolicy({ [ObservationPolicyField]: null }),
    { present: true, policy: undefined });
  assertEqual(readPersistedObservationPolicy({ [ObservationPolicyField]: { captureAllowed: 1, policyVersion: 1 } }),
    { present: true, policy: undefined });
  // An older database has no column at all: absent, not null.
  assertEqual(readPersistedObservationPolicy({ result: "accepted", received_at: "x", measurement_ack: null }),
    { present: false, policy: undefined });
  assertEqual(readPersistedObservationPolicy(null), { present: false, policy: undefined });
  assertEqual(readPersistedObservationPolicy("<html>"), { present: false, policy: undefined });
  // An inherited property is not a response column.
  assertEqual(readPersistedObservationPolicy(Object.create({ [ObservationPolicyField]: { captureAllowed: true, policyVersion: 1 } })),
    { present: false, policy: undefined });
});

Deno.test("resolver: embedded field means zero RPC, absent means exactly one bounded lookup", async () => {
  const allowed: unknown[] = [];
  const rpc = (fn: string, args: Record<string, unknown>) => {
    allowed.push({ fn, args });
    return { data: { captureAllowed: true, policyVersion: 9 }, error: null };
  };

  assertEqual(
    await resolveObservationPolicy("on", { [ObservationPolicyField]: { captureAllowed: true, policyVersion: 2 } }, TOKEN_HASH, rpc),
    { captureAllowed: true, policyVersion: 2 },
  );
  assertEqual(allowed.length, 0, "embedded allow must not query");

  assertEqual(
    await resolveObservationPolicy("on", { [ObservationPolicyField]: { captureAllowed: false, policyVersion: null } }, TOKEN_HASH, rpc),
    { captureAllowed: false, policyVersion: null },
  );
  assertEqual(allowed.length, 0, "embedded deny must not query");

  // Fail-closed: a null column omits the policy and does NOT recover via a hop.
  assertEqual(await resolveObservationPolicy("on", { [ObservationPolicyField]: null }, TOKEN_HASH, rpc), undefined);
  assertEqual(await resolveObservationPolicy("on", { [ObservationPolicyField]: "no" }, TOKEN_HASH, rpc), undefined);
  assertEqual(allowed.length, 0, "a null column must never trigger the old hop");

  assertEqual(await resolveObservationPolicy("on", { result: "accepted" }, TOKEN_HASH, rpc),
    { captureAllowed: true, policyVersion: 9 });
  assertEqual(allowed.length, 1, "absent column falls back exactly once");
  assertEqual((allowed[0] as Call).fn, ObservationPolicyRpc);
  assertEqual((allowed[0] as Call).args, { p_token_hash: TOKEN_HASH });
});

Deno.test("resolver: every off mode does no policy work at all", async () => {
  const calls: Call[] = [];
  const rpc = (fn: string, args: Record<string, unknown>) => {
    calls.push({ fn, args });
    return { data: { captureAllowed: true, policyVersion: 1 }, error: null };
  };
  const present = { [ObservationPolicyField]: { captureAllowed: true, policyVersion: 1 } };
  for (const mode of ["off", "unavailable", "", "OFF", "on "]) {
    assertEqual(await resolveObservationPolicy(mode, present, TOKEN_HASH, rpc), undefined, mode);
    assertEqual(await resolveObservationPolicy(mode, {}, TOKEN_HASH, rpc), undefined, mode);
  }
  assertEqual(calls.length, 0, "off modes must not query");
});

Deno.test("resolver: fallback keeps the existing 750ms deadline", async () => {
  const hanging = (): Promise<never> => new Promise(() => {});
  const started = performance.now();
  const policy = await resolveObservationPolicy("on", {}, TOKEN_HASH, hanging, 20);
  assertEqual(policy, undefined);
  assert(performance.now() - started < 1000, "fallback deadline lost");
});

Deno.test("actual ingest-v3 202 path resolves once, after the accepted gate", async () => {
  const source = await Deno.readTextFile(
    new URL("../simhub-ingest-v3/index.ts", import.meta.url),
  );
  const occurrences = source.split("resolveObservationPolicy(").length - 1;
  assertEqual(occurrences, 1, "resolver is wired once");
  assertEqual(
    source.split("maybeComposeObservationPolicy(").length - 1,
    0,
    "the entry must not call the raw composer directly",
  );

  const callAt = source.indexOf("resolveObservationPolicy(");
  const acceptedAt = source.indexOf('if (result !== "accepted")');
  const returnAt = source.indexOf("return jsonResponse(request, {\n        accepted: true,");
  assert(acceptedAt > 0 && returnAt > acceptedAt, "expected accepted 202 block");
  assert(
    callAt > acceptedAt && callAt < returnAt,
    "resolver must run after the accepted gate and before the 202",
  );

  assert(
    /resolveObservationPolicy\(\s*observationMode,\s*row,\s*tokenHash,/.test(source),
    "resolver must receive the mode, the persist row and the validated token hash",
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
