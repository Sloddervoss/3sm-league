import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  TimeoutError,
  createGuardedRunner,
  createJobGuard,
  formatDuration,
  withTimeout,
} from './cronGuard.js';

// ---------------------------------------------------------------------------
// formatDuration
// ---------------------------------------------------------------------------

test('formatDuration maakt leesbare tijden', () => {
  assert.equal(formatDuration(0), '0s');
  assert.equal(formatDuration(7_000), '7s');
  assert.equal(formatDuration(90_000), '1m 30s');
  assert.equal(formatDuration(3_600_000), '1u 0m 0s');
});

test('formatDuration valt niet om op onzin-invoer', () => {
  assert.equal(formatDuration(Number.NaN), 'onbekend');
  assert.equal(formatDuration(-1), 'onbekend');
});

// ---------------------------------------------------------------------------
// withTimeout
// ---------------------------------------------------------------------------

test('withTimeout geeft de waarde door als de promise op tijd klaar is', async () => {
  assert.equal(await withTimeout(Promise.resolve('klaar'), 1000, 'test'), 'klaar');
});

test('withTimeout gooit een TimeoutError, geen gewone Error', async () => {
  const nooit = new Promise(() => {});
  await assert.rejects(
    () => withTimeout(nooit, 25, 'hangende aanroep'),
    (error) => {
      assert.ok(error instanceof TimeoutError);
      assert.equal(error.code, 'ETIMEOUT');
      assert.match(error.message, /hangende aanroep timeout na/);
      return true;
    }
  );
});

test('withTimeout laat een echte fout ongewijzigd door', async () => {
  const echteFout = new Error('fetch timeout na 25s');
  await assert.rejects(
    () => withTimeout(Promise.reject(echteFout), 1000, 'test'),
    (error) => {
      // Een fout die toevallig "timeout na" in de tekst heeft, mag NIET als
      // time-out gelden. Dat was de stringmatch-bug.
      assert.equal(error, echteFout);
      assert.ok(!(error instanceof TimeoutError));
      return true;
    }
  );
});

test('withTimeout weigert een ongeldige termijn', async () => {
  await assert.rejects(() => withTimeout(Promise.resolve(1), 0, 'test'), TypeError);
  await assert.rejects(() => withTimeout(Promise.resolve(1), Number.NaN, 'test'), TypeError);
});

// ---------------------------------------------------------------------------
// createJobGuard
// ---------------------------------------------------------------------------

test('jobGuard geeft na de harde grens op en laat de taak niet vaststaan', async () => {
  const guard = createJobGuard({ maxRuntimeMs: 30 });
  const result = await guard.run(() => new Promise(() => {}));

  assert.equal(result.ok, false);
  assert.equal(result.timedOut, true);
  assert.equal(guard.isRunning(), false, 'na een time-out mag de taak niet meer als lopend gelden');
});

test('jobGuard laat de volgende run toe na een time-out', async () => {
  const guard = createJobGuard({ maxRuntimeMs: 20 });
  await guard.run(() => new Promise(() => {}));
  const tweede = await guard.run(async () => 'gelukt');

  assert.equal(tweede.ok, true);
  assert.equal(guard.isRunning(), false);
});

test('jobGuard weigert een tweede run terwijl de eerste loopt', async () => {
  const guard = createJobGuard({ maxRuntimeMs: 1000 });
  let binnen = null;

  await guard.run(async () => {
    binnen = await guard.run(async () => 'tweede');
  });

  assert.equal(binnen.skipped, true, 'overlap moet geweigerd worden, niet uitgevoerd');
});

test('jobGuard meldt de stap waarin de taak hangt', async () => {
  let gemeld = null;
  const guard = createJobGuard({
    maxRuntimeMs: 300,
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
  const guard = createJobGuard({ maxRuntimeMs: 1000 });
  const result = await guard.run(async () => { throw new Error('Discord 500'); });

  assert.equal(result.timedOut, false);
  assert.match(result.error.message, /Discord 500/);
});

test('een achtergebleven run kan de stap van de nieuwe run niet overschrijven', async () => {
  const guard = createJobGuard({ maxRuntimeMs: 30 });
  let lateCtx = null;

  await guard.run(async (ctx) => {
    lateCtx = ctx;
    ctx.setStep('run A: team setup');
    await new Promise(() => {}); // hangt, wordt na 30 ms afgebroken
  });

  await guard.run(async (ctx) => {
    ctx.setStep('run B: leden verwerken');
    lateCtx.setStep('run A: zombie');
    assert.equal(ctx.isStale(), false);
    assert.equal(guard.getState().step, 'run B: leden verwerken');
  });
});

test('isStale vertelt een afgebroken run dat hij moet stoppen', async () => {
  const guard = createJobGuard({ maxRuntimeMs: 25 });
  let staleNaTimeOut = null;

  guard.run(async (ctx) => {
    await new Promise((resolve) => setTimeout(resolve, 60));
    staleNaTimeOut = ctx.isStale();
  }).catch(() => {});

  await new Promise((resolve) => setTimeout(resolve, 120));
  assert.equal(staleNaTimeOut, true, 'een afgebroken run moet zichzelf als stale zien');
});

test('een gooiende onStuck-callback doodt het proces niet', async () => {
  const guard = createJobGuard({
    maxRuntimeMs: 200,
    stuckWarningMs: 10,
    onStuck: () => { throw new Error('CALLBACK BOOM'); },
  });

  const result = await guard.run(async () => {
    await new Promise((resolve) => setTimeout(resolve, 60));
  });

  assert.equal(result.ok, true, 'de taak zelf is geslaagd');
});

test('een gooiende onTimeout-callback verandert de uitkomst niet', async () => {
  const guard = createJobGuard({
    maxRuntimeMs: 20,
    onTimeout: () => { throw new Error('CALLBACK BOOM'); },
  });

  const result = await guard.run(() => new Promise(() => {}));
  assert.equal(result.timedOut, true);
  assert.equal(result.ok, false);
});

test('jobGuard weigert ongeldige configuratie', () => {
  assert.throws(() => createJobGuard({}), TypeError);
  assert.throws(() => createJobGuard({ maxRuntimeMs: 0 }), TypeError);
});

// ---------------------------------------------------------------------------
// createGuardedRunner — dit is wat de bot gebruikt
// ---------------------------------------------------------------------------

test('runner weigert overlap en logt dat', async () => {
  const overlappen = [];
  const runner = createGuardedRunner({
    maxRuntimeMs: 1000,
    logOverlap: (name, state) => overlappen.push({ name, step: state.step }),
  });

  let binnen = null;
  await runner.runGuarded('syncTeamRoles', async (ctx) => {
    ctx.setStep('team setup');
    binnen = await runner.runGuarded('syncTeamRoles', async () => 'tweede');
  });

  assert.equal(binnen.skipped, true);
  assert.equal(overlappen.length, 1);
  assert.equal(overlappen[0].step, 'team setup');
});

test('runner geeft de lock vrij na een time-out, zodat de volgende run start', async () => {
  const runner = createGuardedRunner({ maxRuntimeMs: 25 });

  const eerste = await runner.runGuarded('syncTeamRoles', () => new Promise(() => {}));
  assert.equal(eerste.timedOut, true);
  assert.equal(runner.isRunning('syncTeamRoles'), false);

  let gedraaid = false;
  const tweede = await runner.runGuarded('syncTeamRoles', async () => { gedraaid = true; });

  assert.equal(tweede.ok, true);
  assert.equal(gedraaid, true);
});

test('runner meldt een time-out apart van een gewone fout', async () => {
  const timeouts = [];
  const fouten = [];
  const runner = createGuardedRunner({
    maxRuntimeMs: 20,
    logTimeout: (name) => timeouts.push(name),
    logError: (name, error) => fouten.push(error.message),
  });

  await runner.runGuarded('a', () => new Promise(() => {}));
  await runner.runGuarded('b', async () => { throw new Error('echte fout'); });

  assert.deepEqual(timeouts, ['a']);
  assert.deepEqual(fouten, ['echte fout']);
});

test('twee verschillende taken blokkeren elkaar niet', async () => {
  const runner = createGuardedRunner({ maxRuntimeMs: 200 });

  let andereKlaar = false;
  await runner.runGuarded('traag', () => new Promise(() => {}));
  await runner.runGuarded('snel', async () => { andereKlaar = true; });

  assert.equal(andereKlaar, true);
});

// ---------------------------------------------------------------------------
// De bedrading in index.js — anders bewijst niets dat de fix live gaat
// ---------------------------------------------------------------------------

test('index.js gebruikt de geteste planner en niet een eigen kopie', () => {
  const bron = readFileSync(new URL('./index.js', import.meta.url), 'utf8');

  assert.match(
    bron,
    /import\s*\{[^}]*createGuardedRunner[^}]*\}\s*from\s*'\.\/cronGuard\.js'/,
    'index.js moet createGuardedRunner importeren'
  );
  assert.match(
    bron,
    /const guardedRunner = createGuardedRunner\(/,
    'index.js moet de planner uit cronGuard.js instantieren'
  );
  assert.match(
    bron,
    /function runGuarded\(name, task\) \{\s*return guardedRunner\.runGuarded\(name, task\);/,
    'runGuarded moet delegeren naar de geteste planner'
  );
});

test('de tijdsgrenzen in index.js zijn begrensd en zinvol', () => {
  const bron = readFileSync(new URL('./index.js', import.meta.url), 'utf8');

  const taakgrens = bron.match(/const JOB_MAX_RUNTIME_MS = ([^;]+);/);
  const discordgrens = bron.match(/const DISCORD_CALL_TIMEOUT_MS = ([^;]+);/);

  assert.ok(taakgrens, 'JOB_MAX_RUNTIME_MS moet bestaan');
  assert.ok(discordgrens, 'DISCORD_CALL_TIMEOUT_MS moet bestaan');

  // eslint-disable-next-line no-eval
  const taakMs = eval(taakgrens[1]);
  // eslint-disable-next-line no-eval
  const discordMs = eval(discordgrens[1]);

  assert.ok(taakMs > 0 && taakMs <= 15 * 60 * 1000, 'de taakgrens moet hooguit 15 minuten zijn');
  assert.ok(discordMs > 0 && discordMs <= 60 * 1000, 'de Discord-grens moet hooguit 60 seconden zijn');
});

test('elke kanaal- en rolcreatie in index.js loopt via discordCall', () => {
  const bron = readFileSync(new URL('./index.js', import.meta.url), 'utf8');
  const regels = bron.split('\n');

  const onbeschermd = [];
  regels.forEach((regel, index) => {
    const isCreatie = /guild\.(roles|channels)\.create\(/.test(regel);
    if (!isCreatie) return;

    // Beschermd als discordCall op dezelfde regel ervoor staat, of op de regel
    // erboven (de meerregelige vorm).
    const voorDeCreatie = regel.slice(0, regel.indexOf('guild.'));
    const isAlBeschermd =
      /discordCall\(/.test(voorDeCreatie) ||
      /discordCall\(\s*$/.test(regels[index - 1] || '');

    if (!isAlBeschermd) {
      onbeschermd.push(`${index + 1}: ${regel.trim()}`);
    }
  });

  assert.deepEqual(onbeschermd, [], `onbeschermde creaties:\n${onbeschermd.join('\n')}`);
});
