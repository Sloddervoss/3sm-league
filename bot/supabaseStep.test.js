import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSupabaseStep } from './supabaseStep.js';

const stil = async () => {};

test('een trage query wordt na de deadline afgebroken en levert een gemarkeerde fout', async () => {
  const meldingen = [];
  let signaal = null;

  const stap = createSupabaseStep({ ms: 40, log: async (...args) => meldingen.push(args) });
  const uitkomst = await stap('[test] traag', (s) => {
    signaal = s;
    return new Promise(resolve => setTimeout(() => resolve({ data: null, error: null }), 200));
  });

  assert.equal(uitkomst.data, null);
  assert.equal(uitkomst.error?.name, 'SupabaseTimeoutError');
  assert.equal(uitkomst.error?.subsystem, 'supabase');
  assert.equal(uitkomst.error?.kind, 'timeout');
  assert.equal(signaal?.aborted, true, 'de onderliggende fetch hoort afgebroken te zijn');
  assert.equal(meldingen.length, 1);
  assert.match(String(meldingen[0][2]), /timeout na 40 ms: \[test\] traag/);
});

test('een snelle query levert het resultaat en meldt herstel', async () => {
  const hersteld = [];
  const stap = createSupabaseStep({
    ms: 200,
    log: stil,
    onSuccess: (label) => hersteld.push(label),
  });

  const uitkomst = await stap('[test] snel', async () => ({ data: [{ id: 1 }], error: null }));

  assert.deepEqual(uitkomst.data, [{ id: 1 }]);
  assert.deepEqual(hersteld, ['[test] snel']);
});

test('een late afronding na de deadline veroorzaakt geen tweede melding', async () => {
  const meldingen = [];
  const stap = createSupabaseStep({ ms: 30, log: async (...args) => meldingen.push(args) });

  await stap('[test] laat', () => new Promise(resolve => setTimeout(() => resolve({ data: [], error: null }), 120)));
  await new Promise(resolve => setTimeout(resolve, 150));

  assert.equal(meldingen.length, 1, 'de verlaten poging mag niet alsnog zelfstandig loggen');
});

test('de deadline is per aanroep te overschrijven', async () => {
  const stap = createSupabaseStep({ ms: 500, log: stil });
  const uitkomst = await stap(
    '[test] kort',
    () => new Promise(resolve => setTimeout(() => resolve({ data: null, error: new Error('traag') }), 200)),
    { ms: 20 }
  );

  assert.equal(uitkomst.error?.kind, 'timeout');
});
