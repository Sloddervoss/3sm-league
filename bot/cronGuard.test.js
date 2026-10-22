import test from 'node:test';
import assert from 'node:assert/strict';
import { createJobGuard, formatDuration, withTimeout } from './cronGuard.js';

test('formatDuration maakt leesbare tijden', () => {
  assert.equal(formatDuration(0), '0s');
  assert.equal(formatDuration(7_000), '7s');
  assert.equal(formatDuration(90_000), '1m 30s');
  assert.equal(formatDuration(3_600_000), '1u 0m 0s');
});

test('withTimeout geeft de waarde door als de promise op tijd klaar is', async () => {
  const result = await withTimeout(Promise.resolve('klaar'), 1000, 'test');
  assert.equal(result, 'klaar');
});

test('withTimeout geeft op na de termijn als de promise blijft hangen', async () => {
  const nooit = new Promise(() => {});
  await assert.rejects(
    () => withTimeout(nooit, 25, 'hangende aanroep'),
    /hangende aanroep timeout na/
  );
});

test('withTimeout laat een echte fout ongewijzigd door', async () => {
  await assert.rejects(
    () => withTimeout(Promise.reject(new Error('echte fout')), 1000, 'test'),
    /echte fout/
  );
});

test('jobGuard geeft na de harde grens op en laat de taak niet vaststaan', async () => {
  const guard = createJobGuard({ maxRuntimeMs: 30, stuckWarningMs: 0 });
  const hangend = new Promise(() => {});

  const result = await guard.run(() => hangend);

  assert.equal(result.ok, false);
  assert.equal(result.timedOut, true);
  assert.equal(guard.isRunning(), false, 'na een time-out mag de taak niet meer als lopend gelden');
});

test('jobGuard laat de volgende run toe na een time-out', async () => {
  const guard = createJobGuard({ maxRuntimeMs: 20, stuckWarningMs: 0 });

  await guard.run(() => new Promise(() => {}));
  const tweede = await guard.run(async () => 'gelukt');

  assert.equal(tweede.ok, true);
  assert.equal(tweede.error, null);
});

test('jobGuard ruimt de staat op na een geslaagde run', async () => {
  const guard = createJobGuard({ maxRuntimeMs: 1000, stuckWarningMs: 0 });

  await guard.run(async () => 'klaar');

  assert.equal(guard.isRunning(), false);
  assert.equal(guard.getState(), null);
});

test('jobGuard meldt de stap waarin de taak hangt', async () => {
  let gemeld = null;
  const guard = createJobGuard({
    maxRuntimeMs: 200,
    stuckWarningMs: 20,
    onStuck: (info) => { gemeld = info; },
  });

  await guard.run(async (ctx) => {
    ctx.setStep('team setup: Noaber Racing Team');
    await new Promise((resolve) => setTimeout(resolve, 120));
  });

  assert.ok(gemeld, 'de waarschuwing moet zijn afgegaan');
  assert.equal(gemeld.step, 'team setup: Noaber Racing Team');
});

test('jobGuard laat een eigen fout van de taak niet als time-out tellen', async () => {
  const guard = createJobGuard({ maxRuntimeMs: 1000, stuckWarningMs: 0 });

  const result = await guard.run(async () => {
    throw new Error('Discord 500');
  });

  assert.equal(result.ok, false);
  assert.equal(result.timedOut, false);
  assert.match(result.error.message, /Discord 500/);
});

test('jobGuard houdt de laatste stap vast zolang de taak loopt', async () => {
  const guard = createJobGuard({ maxRuntimeMs: 1000, stuckWarningMs: 0 });
  let stapTijdensRun = null;

  await guard.run(async (ctx) => {
    ctx.setStep('teams ophalen');
    stapTijdensRun = guard.getState().step;
  });

  assert.equal(stapTijdensRun, 'teams ophalen');
});
