import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildPaymentDmData, parseEuroAmount, parsePaymentActionId, paymentActionId } from './payments.js';

const id = '2a9ad46e-f4c1-4c77-94fd-cde7531b76d7';

test('payment component IDs are scoped and validated', () => {
  assert.equal(paymentActionId('review', id), `supportpay:review:${id}`);
  assert.deepEqual(parsePaymentActionId(`supportpay:confirm:${id}`), { action: 'confirm', intentId: id });
  assert.deepEqual(parsePaymentActionId(`supportpay:not_found:${id}`), { action: 'not_found', intentId: id });
  assert.equal(parsePaymentActionId('supportpay:confirm:not-a-uuid'), null);
  assert.equal(parsePaymentActionId(`race:confirm:${id}`), null);
});

test('payment amounts accept at most two EUR decimals', () => {
  assert.equal(parseEuroAmount('10,50'), 10.5);
  assert.equal(parseEuroAmount('10.999'), null);
  assert.equal(parseEuroAmount('0'), null);
  assert.equal(parseEuroAmount('0', { allowZero: true }), 0);
  assert.equal(parseEuroAmount('-1', { allowZero: true }), null);
});

test('DM copy says manual verification is required', () => {
  const data = buildPaymentDmData({
    requested_amount_eur: 10,
    payer_name_private: 'Vincent',
    created_at: '2026-08-01T18:42:00.000Z',
    show_supporter_name: true,
    show_amount: false,
  });
  assert.match(data.description, /Controleer altijd eerst/);
  assert.match(data.footer, /geen betalingsbewijs/);
  assert.equal(data.fields[0].value, '€ 10.00');
});

test('payment polling atomically claims intents and rolls back an unacknowledged DM', () => {
  const botSource = readFileSync(new URL('./index.js', import.meta.url), 'utf8');
  const poller = botSource.slice(botSource.indexOf('async function checkSupportPaymentIntents'), botSource.indexOf('async function requirePaymentAdmin'));
  assert.match(botSource, /rpc\('discord_claim_community_support_payment_intents'/);
  assert.match(botSource, /p_claim_token: intent\.notification_claim_token/);
  assert.match(botSource, /client\.users\.fetch\(intent\.payment_admin_discord_id\)/);
  assert.doesNotMatch(poller, /client\.users\.fetch\(config\.payment_admin_discord_id\)/);
  assert.match(botSource, /markAcknowledged !== true/);
  assert.doesNotMatch(botSource, /\.from\('community_support_payment_intents'\)[\s\S]{0,180}\.is\('discord_notified_at', null\)/);
  assert.match(botSource, /if \(sentMessage\) \{[\s\S]{0,100}sentMessage\.delete\(\)/);
  assert.ok(poller.indexOf(".update({ status: 'expired'") < poller.indexOf('if (!config.paypal_enabled'));
});

test('payment interactions acknowledge before I/O and require explicit not-found confirmation', () => {
  const botSource = readFileSync(new URL('./index.js', import.meta.url), 'utf8');
  const buttonHandler = botSource.slice(botSource.indexOf('async function handleSupportPaymentButton'), botSource.indexOf('async function handleSupportPaymentModal'));
  const modalHandler = botSource.slice(botSource.indexOf('async function handleSupportPaymentModal'), botSource.indexOf('async function checkAnnouncements'));
  assert.doesNotMatch(buttonHandler, /await requirePaymentAdmin|community_support_payment_intents/);
  assert.match(buttonHandler, /paymentActionId\('not_found'/);
  assert.match(buttonHandler, /Typ NIET ONTVANGEN ter bevestiging/);
  assert.match(buttonHandler, /setCustomId\('resolution_note'\)/);
  assert.ok(modalHandler.indexOf('await interaction.deferUpdate()') < modalHandler.indexOf('await requirePaymentAdmin(interaction)'));
  assert.match(modalHandler, /confirmation !== 'NIET ONTVANGEN'/);
  assert.match(modalHandler, /data === 'not_found_marked' \|\| data === 'already_not_found'/);
  assert.match(modalHandler, /data === 'already_confirmed'/);
  assert.match(modalHandler, /data !== 'confirmed'/);
  assert.match(botSource, /interaction\.user\?\.id === config\.payment_admin_discord_id/);
  assert.doesNotMatch(botSource, /config\?\.paypal_enabled && interaction\.user\?\.id === config\.payment_admin_discord_id/);
});
