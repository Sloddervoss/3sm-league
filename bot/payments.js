const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PREFIX = 'supportpay';

export function paymentActionId(action, intentId) {
  if (!['review', 'missing', 'confirm', 'not_found'].includes(action) || !UUID_PATTERN.test(intentId)) return null;
  return `${PREFIX}:${action}:${intentId}`;
}

export function parsePaymentActionId(customId) {
  const [prefix, action, intentId, ...rest] = String(customId || '').split(':');
  if (prefix !== PREFIX || rest.length || !['review', 'missing', 'confirm', 'not_found'].includes(action) || !UUID_PATTERN.test(intentId)) return null;
  return { action, intentId };
}

export function parseEuroAmount(value, { allowZero = false } = {}) {
  const normalized = String(value ?? '').trim().replace(',', '.');
  if (!/^\d+(?:\.\d{1,2})?$/.test(normalized)) return null;
  const amount = Math.round(Number(normalized) * 100) / 100;
  if (!Number.isFinite(amount) || amount > 1000 || (allowZero ? amount < 0 : amount <= 0)) return null;
  return amount;
}

export function buildPaymentDmData(intent) {
  return {
    title: 'Nieuwe PayPal-controle',
    description: 'De bezoeker geeft aan de PayPal.Me-betaling te hebben afgerond. Controleer altijd eerst het PayPal-saldo.',
    fields: [
      { name: 'Opgegeven bedrag', value: `€ ${Number(intent.requested_amount_eur).toFixed(2)}`, inline: true },
      { name: 'Naam in PayPal', value: String(intent.payer_name_private || 'Onbekend').slice(0, 100), inline: true },
      { name: 'Aangevraagd', value: new Date(intent.created_at).toLocaleString('nl-NL', { timeZone: 'Europe/Amsterdam' }), inline: false },
      { name: 'Openbaar na bevestiging', value: `Naam: ${intent.show_supporter_name ? 'ja' : 'nee'} · bedrag: ${intent.show_amount ? 'ja' : 'nee'}`, inline: false },
    ],
    footer: 'PayPal.Me-klik is geen betalingsbewijs · alleen handmatig bevestigen',
  };
}
