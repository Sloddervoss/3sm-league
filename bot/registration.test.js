import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const botSource = readFileSync(new URL('./index.js', import.meta.url), 'utf8');

const slice = (startMarker, endMarker) => {
  const start = botSource.indexOf(startMarker);
  assert.notEqual(start, -1, `${startMarker} niet gevonden`);
  const end = botSource.indexOf(endMarker, start);
  assert.notEqual(end, -1, `${endMarker} niet gevonden na ${startMarker}`);
  return botSource.slice(start, end);
};

test('aanmelden antwoordt eerst en raadpleegt daarna pas de database', () => {
  const buttonHandler = slice('async function handleButtonReg', 'async function doRegistration');
  const commandHandler = slice('async function handleRegister', 'async function handleButtonReg');

  for (const [naam, handler] of [['knop', buttonHandler], ['commando', commandHandler]]) {
    const defer = handler.indexOf('deferReply');
    const db = handler.indexOf('supabase');
    assert.notEqual(defer, -1, `${naam}-handler moet deferReply gebruiken`);
    assert.ok(defer < db, `${naam}-handler moet zich eerst melden bij Discord en dan pas de database bevragen`);
  }
});

test('een geslaagde inschrijving komt niet in de log, een mislukte wel', () => {
  const registratie = slice('async function doRegistration', '// ── Bot ready');

  // De logregel staat binnen een controle op het resultaat: alleen als het niet
  // "registered" of "unregistered" is, wordt er gelogd.
  assert.match(registratie, /if \(data !== 'registered' && data !== 'unregistered'\) \{/);
  const log = registratie.indexOf('botLog(');
  const controle = registratie.indexOf("if (data !== 'registered'");
  assert.ok(controle < log, 'de logregel moet binnen de foutcontrole staan');

  assert.match(registratie, /actie: \$\{action\}/);
  assert.match(registratie, /resultaat: \$\{data\}/);
  assert.match(registratie, /interaction\.user\?\.id/);
  assert.match(registratie, /editReply/);
  assert.doesNotMatch(registratie, /interaction\.reply\(/, 'na deferReply moet het antwoord via editReply gaan');
});

test('elke resultaatcode van de database krijgt zijn eigen antwoord', () => {
  const vertaling = slice('function registrationReplyFor', 'client.on(\'interactionCreate\'');

  for (const code of ['registered', 'unregistered', 'not_linked', 'registration_closed', 'race_not_found', 'unknown_action']) {
    assert.match(vertaling, new RegExp(`case '${code}':`), `${code} ontbreekt`);
  }
  assert.match(vertaling, /default:/, 'een onbekende code mag niet stilzwijgend als succes doorgaan');
});

test('de vertaling geeft per resultaatcode echt een ander antwoord', () => {
  const bron = slice('function registrationReplyFor', 'client.on(\'interactionCreate\'');
  const registrationReplyFor = new Function(`${bron}; return registrationReplyFor;`)();

  assert.match(registrationReplyFor('registered', 'Free Race 2'), /aangemeld voor \*\*Free Race 2\*\*/);
  assert.match(registrationReplyFor('unregistered', 'Free Race 2'), /afgemeld voor \*\*Free Race 2\*\*/);
  assert.match(registrationReplyFor('not_linked', 'Free Race 2'), /\/koppel/);
  assert.match(registrationReplyFor('registration_closed', 'Free Race 2'), /gesloten/);
  assert.match(registrationReplyFor('race_not_found', 'Free Race 2'), /bestaat niet/);
  assert.match(registrationReplyFor('unknown_action', 'Free Race 2'), /Onbekende actie/);
  assert.match(registrationReplyFor('iets_raars', 'Free Race 2'), /Onbekend resultaat van de inschrijving/);
});

test('het label van een klik noemt de knop, de gebruiker en het kanaal', () => {
  const bron = slice('function interactionKind', 'function registrationReplyFor');
  const { interactionKind, interactionWho } = new Function(`${bron}; return { interactionKind, interactionWho };`)();

  const klik = {
    type: 3,
    customId: 'aanmelden_525e2628-b868-4776-8e35-d4b8e2b955c4',
    user: { tag: 'marnix', id: '407898030772322304' },
    guild: { name: '3 Stripe Motorsport' },
    channel: { name: 'race-meldingen' },
    isChatInputCommand: () => false,
    isAutocomplete: () => false,
    isButton: () => true,
    isModalSubmit: () => false,
    isUserContextMenuCommand: () => false,
    isMessageContextMenuCommand: () => false,
  };

  assert.equal(interactionKind(klik), 'knop aanmelden_525e2628-b868-4776-8e35-d4b8e2b955c4');
  assert.match(interactionWho(klik), /marnix/);
  assert.match(interactionWho(klik), /#race-meldingen/);
  assert.match(interactionWho(klik), /3 Stripe Motorsport/);

  const commando = { ...klik, customId: undefined, commandName: 'aanmelden', isButton: () => false, isChatInputCommand: () => true };
  assert.equal(interactionKind(commando), 'commando /aanmelden');

  const zonderTag = { ...klik, user: { username: 'marnix', id: '407898030772322304' } };
  assert.match(interactionWho(zonderTag), /marnix \(407898030772322304\)/);
});

test('een mislukte interactie is herleidbaar tot persoon en knop', () => {
  const handler = slice("client.on('interactionCreate'", '// /setprofile');

  assert.match(handler, /const label = `\$\{interactionKind\(interaction\)\} door \$\{interactionWho\(interaction\)\}`/);
  assert.match(handler, /interactie mislukt: \$\{label\}/);
  assert.match(handler, /10062/, 'de te-laat-fout hoort een eigen uitleg te krijgen');
  assert.doesNotMatch(handler, /trage interactie/, 'geslaagde interacties horen niet in de log');
  assert.match(botSource, /function interactionKind\(interaction\)/);
  assert.match(botSource, /function interactionWho\(interaction\)/);
});

test('een knop-id met underscores wordt niet verkeerd gesplitst', () => {
  const handler = slice("client.on('interactionCreate'", '// /setprofile');

  assert.match(handler, /const \[action, raceId\] = interaction\.customId\.split\('_'\);/);
});

// Deze test voert de echte doRegistration uit met namaak-Supabase en namaak-Discord,
// zodat "alleen loggen bij fouten" ook echt gedrag is en niet alleen een regel code.
test('doRegistration logt niets bij succes en wel bij een mislukte inschrijving', async () => {
  const vertaling = slice('function registrationReplyFor', 'client.on(\'interactionCreate\'');
  const registrationReplyFor = new Function(`${vertaling}; return registrationReplyFor;`)();
  const registratieBron = slice('async function doRegistration', '// ── Bot ready');

  const maakDoRegistration = (rpcResultaat) => {
    const logs = [];
    const antwoorden = [];
    const interaction = {
      user: { id: '123456789012345678', tag: 'han.' },
      editReply: async (payload) => { antwoorden.push(payload.content); },
    };
    const fn = new Function(
      'supabase', 'botLog', 'throttledBotLog', 'describeError', 'deleteReplyLater', 'registrationReplyFor',
      `${registratieBron}; return doRegistration;`,
    )(
      { rpc: async () => ({ data: rpcResultaat, error: null }) },
      async (bericht) => { logs.push(bericht); },
      async () => {},
      (e) => String(e),
      () => {},
      registrationReplyFor,
    );
    return { fn, logs, antwoorden, interaction };
  };

  for (const geslaagd of ['registered', 'unregistered']) {
    const run = maakDoRegistration(geslaagd);
    await run.fn(run.interaction, 'race-1', 'Free Race 2', geslaagd === 'registered' ? 'register' : 'unregister');
    assert.deepEqual(run.logs, [], `${geslaagd} mag geen logregel opleveren`);
    assert.equal(run.antwoorden.length, 1);
  }

  for (const mislukt of ['not_linked', 'registration_closed', 'race_not_found', 'iets_raars']) {
    const run = maakDoRegistration(mislukt);
    await run.fn(run.interaction, 'race-1', 'Free Race 2', 'register');
    assert.equal(run.logs.length, 1, `${mislukt} moet één logregel opleveren`);
    assert.match(run.logs[0], /inschrijving niet uitgevoerd/);
    assert.match(run.logs[0], /han\./);
    assert.match(run.logs[0], /123456789012345678/);
    assert.match(run.logs[0], /Free Race 2/);
    assert.match(run.logs[0], new RegExp(`resultaat: ${mislukt}`));
  }
});
