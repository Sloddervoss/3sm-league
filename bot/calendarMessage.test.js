import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createCalendarMessageUpdater } from './calendarMessage.js';

const missing = Object.assign(new Error('unknown message'), { status: 404, code: 10008 });
function setup({ id = 'old', fetchError, editError, saveError = false } = {}) {
  const calls = [];
  const config = { kalender_channel_id: 'calendar', kalender_message_id: id };
  const update = createCalendarMessageUpdater({
    loadConfig: () => config,
    saveConfig: next => {
      calls.push(['save', next.kalender_message_id]);
      if (saveError) { saveError = false; throw Error('disk'); }
      Object.assign(config, next);
    },
    buildEmbed: async () => 'embed',
    fetchChannel: async () => ({
      messages: { fetch: async opts => {
        calls.push(['fetch', opts]);
        if (opts.message === 'old' && fetchError) throw fetchError;
        return { edit: async () => { calls.push(['edit', opts.message]); if (editError) throw editError; } };
      } },
      send: async () => { calls.push(['send']); return { id: 'new' }; },
    }),
  });
  return { update, calls, config };
}

test('edits the configured message using a fresh fetch', async () => {
  const { update, calls } = setup();
  await update();
  assert.deepEqual(calls, [['fetch', { message: 'old', force: true, cache: false }], ['edit', 'old']]);
});
for (const [label, error] of Object.entries({ network: Error('timeout'), permissions: { status: 403, code: 50013 }, other404: { status: 404, code: 10003 } })) {
  test(`fetch ${label} never sends a replacement`, async () => {
    const { update, calls } = setup({ fetchError: error });
    await assert.rejects(update(), err => err === error);
    assert.deepEqual(calls.map(([name]) => name), ['fetch']);
  });
}
test('edit failure, even unknown message, does not send in the same run', async () => {
  const { update, calls } = setup({ editError: missing });
  await assert.rejects(update(), err => err === missing);
  assert.deepEqual(calls.map(([name]) => name), ['fetch', 'edit']);
});
test('confirmed deletion sends once across concurrent runs and persists replacement', async () => {
  const { update, calls, config } = setup({ fetchError: missing });
  await Promise.all([update(), update()]);
  assert.equal(config.kalender_message_id, 'new');
  await update();
  assert.deepEqual(calls.map(([name]) => name), ['fetch', 'send', 'save', 'fetch', 'edit']);
});
test('failed persistence is retried on the same posted message', async () => {
  const { update, calls, config } = setup({ fetchError: missing, saveError: true });
  await assert.rejects(update(), /disk/);
  await update();
  assert.equal(config.kalender_message_id, 'new');
  assert.deepEqual(calls.map(([name]) => name), ['fetch', 'send', 'save', 'fetch', 'edit', 'save']);
});
test('production entry shares the updater between startup and hourly maintenance', () => {
  const src = readFileSync(new URL('./index.js', import.meta.url), 'utf8');
  assert.match(src, /const updateCalendarEmbed = createCalendarMessageUpdater\(/);
  assert.match(src, /runGuarded\('startupCalendar', updateCalendarEmbed\)/);
  assert.match(src, /'hourlyMaintenance', async \(\) => \{\s*await updateCalendarEmbed\(\)/);
});
