// S2E3 lab client: no dependencies, mocks, alternate backend or retries.
const q = JSON.parse(await new Response(Deno.stdin.readable).text());
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
const last: Record<string, number> = {base: -Infinity, cand: -Infinity};
let previous = -Infinity;
for (const pair of q.pairs) {
  for (const arm of pair.order) {
    const delay = Math.max(0, q.globalSpacingMs - (performance.now() - previous), q.armSpacingMs - (performance.now() - last[arm]));
    await wait(delay);
    const path = arm === 'base' ? '/functions/v1/simhub-ingest-v3' : '/candidate-functions/v1/simhub-ingest-v3';
    const host = arm === 'base' ? 'kong' : 'kong-cand';
    const body = structuredClone(pair.body);
    body.capturedAt = new Date().toISOString();
    const start = performance.now();
    previous = start;
    last[arm] = start;
    let response = null, status = null, error = null;
    try {
      const r = await fetch(`http://${host}:8000${path}`, {
        method: 'POST', headers: {'apikey': q.apikey, 'Authorization': `Bearer ${q.token}`, 'Content-Type': 'application/json'},
        body: JSON.stringify(body), signal: AbortSignal.timeout(q.timeoutMs),
      });
      status = r.status;
      response = await r.text();
    } catch (e) { error = String(e); }
    const elapsedMs = performance.now() - start;
    // Receipt happens before the response completes. A completion-based arm
    // gap remains safe even when a cold request takes longer than its cadence.
    if (q.completionGap) last[arm] = performance.now();
    console.log(JSON.stringify({pair:pair.index, phase:pair.phase, arm, traffic:pair.traffic, startMs:start, elapsedMs, status, response, error, request:body}));
    // Preserve all preceding samples. Never replace failures with a successful retry.
    if (error || status !== 202) Deno.exit(3);
  }
}
