import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {
  createNetworkHealthTracker,
  createTimeoutFetch,
  isTransientNetworkErrorText,
  parseNetworkTimeoutMs,
} from './network.js';

test('parseNetworkTimeoutMs keeps sane defaults and accepts positive overrides', () => {
  assert.equal(parseNetworkTimeoutMs(undefined, 1234), 1234);
  assert.equal(parseNetworkTimeoutMs('0', 1234), 1234);
  assert.equal(parseNetworkTimeoutMs('-1', 1234), 1234);
  assert.equal(parseNetworkTimeoutMs('2500', 1234), 2500);
});

test('isTransientNetworkErrorText recognises timeout and fetch/network failures', () => {
  assert.equal(isTransientNetworkErrorText('TypeError: fetch failed'), true);
  assert.equal(isTransientNetworkErrorText('TimeoutError: fetch timeout na 25s'), true);
  assert.equal(isTransientNetworkErrorText('cause: ETIMEDOUT api.example.test'), true);
  assert.equal(isTransientNetworkErrorText('Supabase/PostgREST empty error response (likely upstream 5xx/empty response)'), true);
  assert.equal(isTransientNetworkErrorText('Cloudflare Error code 502 Bad Gateway'), true);
  assert.equal(isTransientNetworkErrorText('validation failed'), false);
});

test('createTimeoutFetch aborts slow requests with a clear timeout error', async () => {
  const timeoutFetch = createTimeoutFetch({
    timeoutMs: 20,
    fetchImpl: (_input, init) => new Promise((_resolve, reject) => {
      init.signal.addEventListener('abort', () => reject(init.signal.reason), { once: true });
    }),
  });

  await assert.rejects(
    timeoutFetch('https://api.example.test/slow'),
    /fetch timeout na 0s/
  );
});

test('network health tracker logs first failure, throttles repeats, and logs recovery once', async () => {
  const logs = [];
  let clock = 1_000;
  const tracker = createNetworkHealthTracker({
    throttleMs: 10_000,
    now: () => clock,
    log: async (...args) => logs.push(args),
  });

  assert.equal(await tracker.recordFailure('teams', 'TypeError: fetch failed'), true);
  assert.equal(await tracker.recordFailure('profiles', 'TypeError: fetch failed'), false);
  clock += 10_001;
  assert.equal(await tracker.recordFailure('memberships', 'TypeError: fetch failed'), true);
  assert.equal(await tracker.recordSuccess('teams'), true);
  assert.equal(await tracker.recordSuccess('profiles'), false);

  assert.equal(logs.length, 3);
  assert.match(logs[0][0], /tijdelijk onbereikbaar/);
  assert.match(logs[2][0], /verbinding hersteld/);
});

test('bot network health logs stay out of Discord botLog channel', async () => {
  const indexSource = await fs.readFile(new URL('./index.js', import.meta.url), 'utf8');
  assert.match(indexSource, /function networkStatusLog\(/);
  assert.match(indexSource, /log:\s*networkStatusLog/);
  assert.doesNotMatch(indexSource, /createNetworkHealthTracker\(\{\s*log:\s*botLog/s);
});
