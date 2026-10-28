import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  Afgebroken,
  alleenAlsActief,
  begrensd,
  beschrijfNetwerkFout,
  dbStap,
  draaiMetEindverslag,
  isOnbekendLidFout,
  maakEindverslag,
  metNetwerkHerhaling,
  metTimeout,
  netwerkFoutSoort,
  NETWERK_POGINGEN,
  NETWERK_WACHT_MS,
  normaliseerNick,
  Overgeslagen,
  schrijfStilUit,
  TEAM_SYNC_ENTITEIT_BUDGET_MS,
  TEAM_SYNC_TIMEOUT_MS,
  voerPerEntiteitUit,
} from './teamSync.js';

const leesIndex = () => readFileSync(new URL('./index.js', import.meta.url), 'utf8');

// Alleen de body van syncTeamRoles, tot de volgende sectie. De functie bevat
// geen geneste `async function`, dus elke `await` in dit stuk hoort bij de sync.
const syncTeamRolesBody = () => {
  const ruw = leesIndex();
  const start = ruw.indexOf('async function syncTeamRoles');
  const eind = ruw.indexOf("client.on('guildMemberAdd'", start);
  assert.ok(start > 0 && eind > start, 'syncTeamRoles-body niet gevonden');
  return stripComments(ruw.slice(start, eind));
};

const stripComments = (bron) =>
  bron
    .split('\n')
    .map((regel) => regel.replace(/\/\/.*$/, ''))
    .join('\n');

const hangt = () => new Promise(() => {});

// ── Begrenzing en normalisatie ───────────────────────────────────────────────

test('de tijdsgrens is acht seconden en het entiteitsbudget is ruimer', () => {
  assert.equal(TEAM_SYNC_TIMEOUT_MS, 8000);
  assert.ok(
    TEAM_SYNC_ENTITEIT_BUDGET_MS > TEAM_SYNC_TIMEOUT_MS,
    'een team of lid moet meer dan één aanroep kunnen doen binnen zijn budget'
  );
});

test('metTimeout breekt een hangende aanroep af met het label erbij', async () => {
  const start = Date.now();
  await assert.rejects(
    () => metTimeout(hangt(), 30, 'lid ophalen 123'),
    (fout) => {
      assert.match(fout.message, /timeout na 30 ms: lid ophalen 123/);
      return true;
    }
  );
  assert.ok(Date.now() - start < 1000, 'de grens moet meteen afbreken, niet pas na seconden');
});

test('metTimeout laat een snelle aanroep gewoon door en ruimt zijn timer op', async () => {
  const voor = process.getActiveResourcesInfo().filter((r) => r === 'Timeout').length;

  assert.equal(await metTimeout(Promise.resolve('klaar'), 60_000, 'test'), 'klaar');
  await new Promise((resolve) => setTimeout(resolve, 20));

  const na = process.getActiveResourcesInfo().filter((r) => r === 'Timeout').length;
  assert.ok(na <= voor, `timer lekt: ${voor} voor, ${na} na`);
});

test('begrensd gooit nooit en meldt een time-out als resultaat', async () => {
  const gezien = [];
  const resultaat = await begrensd(hangt(), 'nickname zetten', {
    ms: 20,
    onError: (fout, label) => gezien.push(`${label}:${fout.message}`),
  });

  assert.equal(resultaat.ok, false);
  assert.ok(resultaat.fout instanceof Error);
  assert.equal(gezien.length, 1);
  assert.match(gezien[0], /^nickname zetten:timeout na 20 ms/);

  const gelukt = await begrensd(Promise.resolve(42), 'rol aanpassen');
  assert.deepEqual(gelukt, { ok: true, waarde: 42 });
});

test('normaliseerNick vergelijkt zoals Discord namen opslaat', () => {
  assert.equal(normaliseerNick('  Jan\u00A0 de  Vries\u200B '), 'Jan de Vries');
  assert.equal(normaliseerNick(null), '');
  assert.equal(normaliseerNick('x'.repeat(40)).length, 32);
});

test('Overgeslagen is een echte foutsoort met de reden erbij', () => {
  const fout = new Overgeslagen('lid niet gevonden');
  assert.ok(fout instanceof Error);
  assert.equal(fout.name, 'Overgeslagen');
  assert.equal(fout.reden, 'lid niet gevonden');
});

// ── H2: een PostgREST-antwoord met error is een mislukte schrijfactie ───────
// PostgREST rejectet niet; de client resolve't met { data, error }. Zonder
// controle werd zo'n update als succes geteld.

test('H2: dbStap maakt van een error-object een echte fout', async () => {
  const fout = { message: 'permission denied for table teams', code: '42501' };
  await assert.rejects(
    () => dbStap('db rol-id Alfa', async () => ({ data: null, error: fout })),
    (e) => {
      assert.match(e.message, /^\[db\] db rol-id Alfa: permission denied for table teams$/);
      assert.equal(e.code, '42501');
      assert.equal(e.cause, fout, 'de originele PostgREST-fout moet bewaard blijven');
      return true;
    }
  );
});

test('H2: dbStap levert de data bij een geslaagde schrijfactie', async () => {
  const waarde = await dbStap('db rol-id Alfa', async () => ({ data: [{ id: 'r1' }], error: null }));
  assert.deepEqual(waarde, { data: [{ id: 'r1' }], error: null });
});

test('H2: een team met een db-fout telt als teamfout en niet als verwerkt', async () => {
  const fouten = [];
  const uitkomst = await voerPerEntiteitUit({
    items: ['alfa', 'bravo'],
    label: 'team',
    taak: async (team) => {
      await dbStap(`db rol-id ${team}`, async () =>
        team === 'alfa'
          ? { data: null, error: { message: 'permission denied' } }
          : { data: [{ id: 'r1' }], error: null }
      );
    },
    onFout: (team, fout) => fouten.push(`${team}:${fout.message}`),
  });

  assert.equal(uitkomst.fouten, 1);
  assert.equal(uitkomst.verwerkt, 1);
  assert.equal(fouten.length, 1);
  assert.match(fouten[0], /^alfa:\[db\] db rol-id alfa: permission denied$/);
});

test('H2: een db-fout is geen geslaagde stap, ook al resolve\'t de aanroep', async () => {
  // Dit is precies het gedrag dat fout ging: `await` slaagt, dus `r.ok` was
  // waar en de sync ging verder met een id die nooit is opgeslagen.
  const resultaat = await begrensd(Promise.resolve({ data: null, error: { message: 'conflict' } }), 'db rol-id');
  assert.equal(resultaat.ok, true, 'begrensd alleen ziet geen fout — daarom bestaat dbStap');
  await assert.rejects(
    () => dbStap('db rol-id', async () => ({ data: null, error: { message: 'conflict' } })),
    /\[db\] db rol-id: conflict/
  );
});

// ── H3: elke run levert precies één eindverslag ────────────────────────────

test('H3: een vroege return levert alsnog precies één verslag', async () => {
  const gelogd = [];
  const gemeld = [];
  const stats = { teams: 0, memberErrors: 0, teamErrors: 0, cleanupErrors: 0 };

  const uitkomst = await draaiMetEindverslag({
    stats,
    // Precies wat syncTeamRoles doet bij 'geen guild': return zonder werk.
    werk: async () => undefined,
    log: (regel) => gelogd.push(regel),
    meld: async (regel) => gemeld.push(regel),
  });

  assert.equal(gelogd.length, 1, 'elke run, ook een lege, laat één regel achter');
  assert.match(gelogd[0], /^\[syncTeamRoles\] klaar in /);
  assert.match(gelogd[0], /teams=0/);
  assert.equal(gemeld.length, 0, 'een geslaagde ronde stuurt niets naar Discord');
  assert.deepEqual(uitkomst, { status: 'klaar', reden: null });
});

test('H3: een vroege return met reden komt met die reden in het verslag', async () => {
  const gelogd = [];
  const gemeld = [];

  const uitkomst = await draaiMetEindverslag({
    stats: { teams: 0 },
    werk: async ({ markeer }) => markeer('guild niet gevonden of niet bereikbaar'),
    log: (regel) => gelogd.push(regel),
    meld: async (regel) => gemeld.push(regel),
  });

  assert.equal(gelogd.length, 1);
  assert.match(gelogd[0], /^\[syncTeamRoles\] fout in /);
  assert.match(gelogd[0], /reden=guild niet gevonden of niet bereikbaar/);
  assert.equal(gemeld.length, 1, 'bij een fout gaat het verslag één keer naar Discord');
  assert.equal(gemeld[0], gelogd[0], 'hetzelfde verslag, niet een tweede tekst');
  assert.equal(uitkomst.status, 'fout');
});

test('H3: een gegooide fout levert één verslag met de reden en één melding', async () => {
  const gelogd = [];
  const gemeld = [];

  await draaiMetEindverslag({
    stats: { teams: 2, teamErrors: 1 },
    werk: async () => {
      throw new Error('teams ophalen: timeout na 8000 ms');
    },
    log: (regel) => gelogd.push(regel),
    meld: async (regel) => gemeld.push(regel),
  });

  assert.equal(gelogd.length, 1);
  assert.match(gelogd[0], /^\[syncTeamRoles\] fout in /);
  assert.match(gelogd[0], /team_fout=1/);
  assert.match(gelogd[0], /reden=teams ophalen: timeout na 8000 ms/);
  assert.equal(gemeld.length, 1);
});

test('H3: een afgebroken run heet afgebroken, niet klaar', async () => {
  const gelogd = [];

  const uitkomst = await draaiMetEindverslag({
    stats: { teams: 3 },
    werk: async () => {
      throw new Afgebroken('run afgebroken');
    },
    log: (regel) => gelogd.push(regel),
  });

  assert.match(gelogd[0], /^\[syncTeamRoles\] afgebroken in /);
  assert.match(gelogd[0], /reden=run afgebroken/);
  assert.equal(uitkomst.status, 'afgebroken');
});

test('H3: een verslag dat blijft hangen houdt de run niet vast', async () => {
  const gelogd = [];

  await draaiMetEindverslag({
    stats: { teamErrors: 1 },
    werk: async () => undefined,
    log: (regel) => gelogd.push(regel),
    meld: () => hangt(),
    ms: 20,
  });

  assert.equal(gelogd.length, 1, 'het consoleverslag is er al vóór de Discord-melding');
});

test('H3: een run die de bewaker al afbrak meldt alleen nog op de console', async () => {
  const gelogd = [];
  const gemeld = [];
  let actief = true;

  await draaiMetEindverslag({
    stats: { teamErrors: 2 },
    werk: async () => {
      actief = false; // de bewaker heeft de run hier afgebroken
    },
    isActief: () => actief,
    log: (regel) => gelogd.push(regel),
    meld: async (regel) => gemeld.push(regel),
  });

  assert.equal(gelogd.length, 1, 'het late werk laat wel één consoleregel achter');
  assert.equal(gemeld.length, 0, 'maar geen tweede Discord-bericht over een oude run');
});

test('H3: een gooiende Discord-melding of log mag de run niet laten klappen', async () => {
  const verslagFouten = [];

  await draaiMetEindverslag({
    stats: { memberErrors: 1 },
    werk: async () => undefined,
    log: () => {
      throw new Error('console kapot');
    },
    meld: async () => {
      throw new Error('discord kapot');
    },
    onVerslagFout: (fout) => verslagFouten.push(fout.message),
  });

  assert.deepEqual(verslagFouten, ['console kapot', 'discord kapot']);
});

test('het verslag telt alle statistieken en zet de duur erin', () => {
  const verslag = maakEindverslag({
    stats: {
      teams: 4,
      teamErrors: 1,
      teamsSkipped: 2,
      profiles: 9,
      membersProcessed: 8,
      membersMissing: 1,
      membersSkipped: 1,
      nicknamesUpdated: 3,
      rolesAdded: 5,
      rolesRemoved: 2,
      memberErrors: 2,
      cleanupErrors: 1,
    },
    duurMs: 62_000,
    status: 'klaar',
  });

  assert.match(
    verslag,
    /^\[syncTeamRoles\] klaar in 1m 2s: teams=4, team_fout=1, team_overgeslagen=2, profiles=9, verwerkt=8, niet_gevonden=1, lid_overgeslagen=1, nicknames=3, rollen_plus=5, rollen_min=2, fouten=2, opruim_fout=1$/
  );
  assert.doesNotMatch(verslag, /reden=/);
});

// ── H1: na afbreken wordt er niets meer geschreven ─────────────────────────

test('H1: een schrijfactie waarvan de run is afgebroken wordt niet aangemaakt', () => {
  const geschreven = [];
  let actief = true;
  const schrijf = (wat, maakAanroep) => alleenAlsActief(() => actief, wat, maakAanroep);

  schrijf('rol bewerken Alfa', () => geschreven.push('voor'));
  actief = false;

  assert.throws(
    () => schrijf('rol bewerken Alfa', () => geschreven.push('na')),
    (fout) => {
      assert.ok(fout instanceof Afgebroken);
      assert.equal(fout.message, 'run afgebroken vóór rol bewerken Alfa');
      return true;
    }
  );
  assert.deepEqual(geschreven, ['voor'], 'de aanroep is niet eens gemaakt, dus niet verstuurd');
});

test('H1: een team dat zijn budget overschreed schrijft daarna niets meer', async () => {
  const geschreven = [];
  const naAfbreken = [];
  let loslaten = () => {};

  const uitkomst = await voerPerEntiteitUit({
    items: ['traag-team'],
    label: 'team',
    budgetMs: 25,
    taak: async (team, { isActief }) => {
      geschreven.push('voor-de-timeout');
      await new Promise((resolve) => {
        loslaten = resolve;
      });
      // Dit is het laat-afgeronde werk: de run is hier al afgekapt.
      try {
        alleenAlsActief(isActief, 'rol aanmaken', () => geschreven.push('na-de-timeout'));
      } catch (fout) {
        naAfbreken.push(fout.name);
      }
    },
  });

  assert.equal(uitkomst.fouten, 1, 'een team dat over zijn budget gaat telt als fout');
  assert.equal(uitkomst.verwerkt, 0);

  // Laat het achtergebleven werk alsnog afronden.
  loslaten();
  await new Promise((resolve) => setTimeout(resolve, 10));

  assert.deepEqual(geschreven, ['voor-de-timeout'], 'na de time-out wordt er niets meer geschreven');
  assert.deepEqual(naAfbreken, ['Afgebroken']);
});

test('H1: de stille schrijfvariant slikt een Discord-fout maar niet een afbreking', async () => {
  let aangeroepen = false;

  assert.equal(
    await schrijfStilUit(() => true, 'kanaalrechten', () => Promise.reject(new Error('Missing Permissions'))),
    undefined,
    'een rechtenfout mag de rest van het team niet blokkeren'
  );

  await assert.rejects(
    () =>
      schrijfStilUit(
        () => false,
        'kanaalrechten',
        () => {
          aangeroepen = true;
          return Promise.resolve();
        }
      ),
    (fout) => fout instanceof Afgebroken
  );
  assert.equal(aangeroepen, false, 'na afbreken wordt de aanroep niet gedaan');
});

test('H1: een afgebroken entiteit stopt de lus en telt niet als fout', async () => {
  const gedaan = [];

  const uitkomst = await voerPerEntiteitUit({
    items: ['een', 'twee', 'drie'],
    label: 'team',
    taak: async (team) => {
      gedaan.push(team);
      throw new Afgebroken(`run afgebroken vóór rol ${team}`);
    },
  });

  assert.deepEqual(gedaan, ['een'], 'na een afbreking start geen nieuwe entiteit');
  assert.equal(uitkomst.afgebroken, true);
  assert.equal(uitkomst.fouten, 0, 'afbreken is geen teamfout');
  assert.match(uitkomst.reden, /afgebroken vóór rol een/);
});

// ── M1: een gooiende callback stopt de lus niet ────────────────────────────

test('M1: een gooiende onFout-callback stopt de lus niet', async () => {
  const verwerkt = [];

  const uitkomst = await voerPerEntiteitUit({
    items: ['een', 'twee', 'drie'],
    label: 'team',
    taak: async (team) => {
      verwerkt.push(team);
      throw new Error('rol aanmaken mislukt');
    },
    onFout: () => {
      throw new Error('teller kapot');
    },
  });

  assert.deepEqual(verwerkt, ['een', 'twee', 'drie']);
  assert.equal(uitkomst.fouten, 3, 'de telling blijft kloppen ondanks de gooiende callback');
});

test('M1: een gooiende onOvergeslagen-callback stopt de lus niet', async () => {
  const verwerkt = [];

  const uitkomst = await voerPerEntiteitUit({
    items: ['onbekend', 'gewoon'],
    label: 'lid',
    taak: async (lid, { overslaan }) => {
      verwerkt.push(lid);
      if (lid === 'onbekend') overslaan('lid niet gevonden');
    },
    onOvergeslagen: () => {
      throw new Error('teller kapot');
    },
  });

  assert.deepEqual(verwerkt, ['onbekend', 'gewoon']);
  assert.equal(uitkomst.overgeslagen, 1);
  assert.equal(uitkomst.verwerkt, 1);
});

// ── Isolatie per entiteit en overslaan ─────────────────────────────────────

test('één kapot team stopt de andere teams niet', async () => {
  const gedaan = [];
  const fouten = [];

  const uitkomst = await voerPerEntiteitUit({
    items: ['alfa', 'bravo', 'charlie'],
    label: 'team',
    taak: async (team) => {
      if (team === 'bravo') throw new Error('rol aanmaken mislukt');
      gedaan.push(team);
    },
    onFout: (team, fout) => fouten.push(`${team}:${fout.message}`),
  });

  assert.deepEqual(gedaan, ['alfa', 'charlie']);
  assert.deepEqual(fouten, ['bravo:rol aanmaken mislukt']);
  assert.deepEqual(uitkomst, { verwerkt: 2, fouten: 1, overgeslagen: 0, afgebroken: false, reden: null });
});

test('een hangend team wordt afgekapt en de rest loopt door', async () => {
  const gedaan = [];

  const uitkomst = await voerPerEntiteitUit({
    items: ['alfa', 'blijft-hangen', 'charlie'],
    label: 'team',
    budgetMs: 30,
    taak: async (team) => {
      if (team === 'blijft-hangen') return hangt();
      gedaan.push(team);
    },
  });

  assert.deepEqual(gedaan, ['alfa', 'charlie']);
  assert.equal(uitkomst.fouten, 1);
  assert.equal(uitkomst.verwerkt, 2);
});

test('een lid dat niets te doen heeft telt als overgeslagen, niet als fout', async () => {
  const overgeslagen = [];
  const fouten = [];
  const na = [];

  const uitkomst = await voerPerEntiteitUit({
    items: ['onbekend', 'gewoon'],
    label: 'lid',
    taak: async (lid, { overslaan }) => {
      if (lid === 'onbekend') overslaan('lid niet gevonden');
      na.push(lid);
    },
    onOvergeslagen: (lid, reden) => overgeslagen.push(`${lid}:${reden}`),
    onFout: (lid) => fouten.push(lid),
  });

  assert.deepEqual(overgeslagen, ['onbekend:lid niet gevonden']);
  assert.deepEqual(fouten, []);
  assert.deepEqual(na, ['gewoon'], 'na overslaan mag de rest van de taak niet meer lopen');
  assert.deepEqual(uitkomst, { verwerkt: 1, fouten: 0, overgeslagen: 1, afgebroken: false, reden: null });
});

test('een afgebroken run stopt meteen met de volgende entiteiten', async () => {
  let actief = true;
  const gedaan = [];

  const uitkomst = await voerPerEntiteitUit({
    items: ['een', 'twee', 'drie'],
    label: 'lid',
    isActief: () => actief,
    taak: async (lid) => {
      gedaan.push(lid);
      actief = false;
    },
  });

  assert.deepEqual(gedaan, ['een']);
  assert.equal(uitkomst.afgebroken, true);
  assert.equal(uitkomst.verwerkt, 1);
});

// ── Structuur van index.js ────────────────────────────────────────────────
// De tests hierboven bewijzen het gedrag van de hulpmiddelen; deze controleren
// dat index.js ze ook echt gebruikt. Zonder deze controle kan de sync stil
// terugvallen op een rauwe schrijfactie of een eigen summary-blok.

const SCHRIJF_PATRONEN = [
  /\.edit\(/,
  /\.create\(/,
  /\.delete\('3SM/,
  /setPosition\(/,
  /permissionOverwrites\.set\(/,
  /setNickname\(/,
  /roles\.(add|remove)\(/,
  /saveConfig\(/,
  /\.update\(/,
];
const WRAPPER = /schrijf|pasRolAan|dbSchrijf|alleenAlsActief/;

test('elke schrijfactie in syncTeamRoles staat achter een isActief-controle', () => {
  const regels = syncTeamRolesBody().split('\n');
  const onbeschermd = [];

  regels.forEach((regel, index) => {
    const kaal = regel.trim();
    if (!kaal || kaal.startsWith('*')) return;
    if (!SCHRIJF_PATRONEN.some((patroon) => patroon.test(kaal))) return;
    // De wrapper staat op dezelfde regel of op de regel erboven (meerregige
    // aanroepen zoals schrijfTeamStil(`...`, () =>\n  existing.edit({...})).
    const venster = [regels[index - 1] || '', regel].join('\n');
    if (!WRAPPER.test(venster)) onbeschermd.push(kaal);
  });

  assert.deepEqual(onbeschermd, [], `schrijfacties zonder isActief-controle:\n${onbeschermd.join('\n')}`);
});

test('de team- en ledenlus lopen via de geïsoleerde uitvoer', () => {
  const body = syncTeamRolesBody();

  const lussen = body.match(/voerPerEntiteitUit\(\{/g) || [];
  assert.equal(lussen.length, 2, 'team- en ledenlus moeten beide via voerPerEntiteitUit lopen');

  assert.match(body, /label: 'team'/, 'de teamlus moet als team geteld worden');
  assert.match(body, /label: 'lid'/, 'de ledenlus moet als lid geteld worden');
  assert.match(body, /stats\.teamErrors \+= 1/);
  assert.match(body, /stats\.teamsSkipped \+= 1/);
  assert.match(body, /stats\.membersSkipped \+= 1/);
  assert.match(body, /stats\.memberErrors \+= 1/);
});

test('geen enkele await in syncTeamRoles staat onbegrensd', () => {
  const body = syncTeamRolesBody();
  assert.ok(body.length > 1000, 'syncTeamRoles-body niet gevonden');

  const onbegrensd = body
    .split('\n')
    .map((regel) => regel.trim())
    .filter((regel) => /\bawait\b/.test(regel))
    .filter(
      (regel) =>
        !/metTimeout\(|metNetwerkHerhaling\(|discordCall\(|begrensd\(|voerPerEntiteitUit\(|supabaseStep\(|botLog\(|schrijfStil\(|schrijfTeamStil\(|dbSchrijfTeam\(|pasRolAan\(|draaiMetEindverslag\(/.test(
          regel
        )
    );

  assert.deepEqual(onbegrensd, [], `onbegrensde awaits in syncTeamRoles:\n${onbegrensd.join('\n')}`);
});

test('M5: een dode discord_role_id wordt op null gezet in de database', () => {
  const body = syncTeamRolesBody();

  assert.match(
    body,
    /guild\.roles\.cache\.has\(team\.discord_role_id\)/,
    'de sync moet controleren of de opgeslagen rol nog bestaat'
  );
  assert.match(
    body,
    /dbSchrijfTeam\(`db dode rol-id wissen[\s\S]{0,160}discord_role_id: null/,
    'een rol-id die niet meer bestaat moet op null gezet worden'
  );
  assert.match(body, /managedRoleIds\.delete\(dodeRolId\)/);
});

test('het eindverslag gaat via draaiMetEindverslag en niet via een eigen blok', () => {
  const body = syncTeamRolesBody();

  assert.match(body, /await draaiMetEindverslag\(\{/);
  assert.match(body, /meld: \(regel\) => botLogDiscordOnly\(regel\)/);
  assert.doesNotMatch(body, /console\.log\(summary\)/, 'er mag geen tweede, eigen summary-blok zijn');
});

// ── Netwerk-hik: korte herhaling en eerlijke logging ─────────────────────────

// Zoals undici hem gooit: AggregateError met de echte code één laag dieper.
const etimedout = () => {
  const oorzaak = Object.assign(new Error('connect ETIMEDOUT 1.2.3.4:443'), { code: 'ETIMEDOUT' });
  return new AggregateError([oorzaak], '');
};

const snel = { wachtMs: [1, 2] };

test('de herhaling is twee keer met 1s en 3s', () => {
  assert.equal(NETWERK_POGINGEN, 3, 'eerste poging plus twee herhalingen');
  assert.deepEqual(NETWERK_WACHT_MS, [1000, 3000]);
});

test('netwerkFoutSoort herkent AggregateError [ETIMEDOUT] van undici', () => {
  assert.equal(netwerkFoutSoort(etimedout()), 'ETIMEDOUT');
  assert.equal(
    netwerkFoutSoort(Object.assign(new Error('fetch failed'), { cause: { code: 'ECONNRESET' } })),
    'ECONNRESET'
  );
  assert.equal(netwerkFoutSoort(new Error('timeout na 8000 ms: guild laden')), 'timeout');
  assert.equal(netwerkFoutSoort({ message: 'TypeError: fetch failed', code: '' }), 'netwerkfout');
});

test('beschrijfNetwerkFout maakt van een AggregateError een leesbare reden', () => {
  const reden = beschrijfNetwerkFout(etimedout());
  assert.match(reden, /AggregateError/);
  assert.match(reden, /ETIMEDOUT/);
  assert.match(reden, /connect ETIMEDOUT 1\.2\.3\.4:443/, 'het adres en de syscall horen erbij');

  assert.match(beschrijfNetwerkFout(new Error('timeout na 8000 ms: guild laden')), /timeout na 8000 ms/);
  assert.equal(beschrijfNetwerkFout(null), 'Unknown error');
});

test('geen rechten of een onbekend lid is geen netwerkfout', () => {
  assert.equal(netwerkFoutSoort(new Error('Missing Permissions')), null);
  assert.equal(
    netwerkFoutSoort(Object.assign(new Error('Unknown Member'), { code: 10007 })),
    null
  );
  assert.equal(isOnbekendLidFout(Object.assign(new Error('Unknown Member'), { code: 10007 })), true);
  assert.equal(isOnbekendLidFout(etimedout()), false);
});

test('een netwerk-hik wordt herhaald en de geslaagde poging levert het resultaat', async () => {
  let pogingen = 0;
  const regels = [];

  const waarde = await metNetwerkHerhaling(
    async () => {
      pogingen += 1;
      if (pogingen < 3) throw etimedout();
      return { naam: 'guild' };
    },
    { label: 'guild laden', ...snel, log: (regel) => regels.push(regel) }
  );

  assert.deepEqual(waarde, { naam: 'guild' });
  assert.equal(pogingen, 3);
  assert.equal(regels.length, 2, 'elke mislukte poging één regel, de geslaagde geen');
  assert.match(regels[0], /guild laden: poging 1\/3 mislukt \(ETIMEDOUT\), opnieuw/);
  assert.match(regels[1], /guild laden: poging 2\/3 mislukt \(ETIMEDOUT\), opnieuw/);
  assert.ok(!regels.some((regel) => /definitief/.test(regel)), 'een geslaagde run meldt geen definitieve fout');
});

test('de wachttijd voor de volgende poging staat in de logregel', async () => {
  const regels = [];
  let pogingen = 0;

  await metNetwerkHerhaling(
    async () => {
      pogingen += 1;
      if (pogingen === 1) throw etimedout();
      return 'ok';
    },
    { label: 'guild laden', pogingen: 2, wachtMs: [1000], log: (regel) => regels.push(regel) }
  );

  assert.equal(regels.length, 1);
  assert.match(regels[0], /poging 1\/2 mislukt \(ETIMEDOUT\), opnieuw over 1s$/);
});

test('succes wordt niet gelogd', async () => {
  const regels = [];
  const waarde = await metNetwerkHerhaling(async () => 42, { ...snel, log: (regel) => regels.push(regel) });

  assert.equal(waarde, 42);
  assert.deepEqual(regels, []);
});

test('definitief falen geeft één echte foutregel en gooit de laatste fout door', async () => {
  let pogingen = 0;
  const regels = [];

  await assert.rejects(
    () =>
      metNetwerkHerhaling(
        async () => {
          pogingen += 1;
          throw etimedout();
        },
        { label: 'teams ophalen', ...snel, log: (regel) => regels.push(regel) }
      ),
    (fout) => netwerkFoutSoort(fout) === 'ETIMEDOUT'
  );

  assert.equal(pogingen, 3, 'na drie pogingen is het klaar');
  assert.equal(regels.length, 3, 'twee hik-regels en één echte foutregel');
  assert.match(regels[0], /poging 1\/3 mislukt/);
  assert.match(regels[1], /poging 2\/3 mislukt/);
  assert.match(regels[2], /teams ophalen: definitief mislukt na 3 pogingen \(ETIMEDOUT\)/);
});

test('een echte fout wordt niet herhaald en geeft geen eigen logregel', async () => {
  let pogingen = 0;
  const regels = [];

  await assert.rejects(
    () =>
      metNetwerkHerhaling(
        async () => {
          pogingen += 1;
          throw Object.assign(new Error('Missing Permissions'), { code: 50013 });
        },
        { label: 'rol aanpassen', ...snel, log: (regel) => regels.push(regel) }
      ),
    /Missing Permissions/
  );

  assert.equal(pogingen, 1);
  assert.deepEqual(regels, [], 'de aanroeper logt deze fout, niet de herhaling');
});

test('een hangende aanroep telt als time-out en wordt herhaald', async () => {
  const regels = [];
  let pogingen = 0;

  await assert.rejects(
    () =>
      metNetwerkHerhaling(
        () => {
          pogingen += 1;
          return hangt();
        },
        { label: 'lid ophalen 1', pogingen: 2, ms: 20, wachtMs: [1], log: (regel) => regels.push(regel) }
      ),
    /timeout na 20 ms: lid ophalen 1/
  );

  assert.equal(pogingen, 2);
  assert.match(regels[0], /poging 1\/2 mislukt \(timeout\)/);
  assert.match(regels[1], /definitief mislukt na 2 pogingen \(timeout\)/);
});

test('een PostgREST-resultaat met error telt als mislukte poging', async () => {
  let pogingen = 0;
  const regels = [];

  const uitslag = await metNetwerkHerhaling(
    async () => {
      pogingen += 1;
      if (pogingen === 1) return { data: null, error: { message: 'TypeError: fetch failed' } };
      return { data: [{ id: 'team-1' }], error: null };
    },
    { label: 'teams ophalen', ...snel, log: (regel) => regels.push(regel), alsFout: (r) => r?.error || null }
  );

  assert.equal(pogingen, 2);
  assert.deepEqual(uitslag.data, [{ id: 'team-1' }]);
  assert.match(regels[0], /poging 1\/3 mislukt \(netwerkfout\)/);
});

test('een afgebroken run wacht niet nog eens en doet geen tweede poging', async () => {
  let pogingen = 0;
  let actief = true;

  await assert.rejects(
    () =>
      metNetwerkHerhaling(
        async () => {
          pogingen += 1;
          actief = false; // de run wordt tijdens deze poging afgebroken
          throw etimedout();
        },
        { label: 'guild laden', ...snel, log: () => {}, isActief: () => actief || pogingen === 0 }
      ),
    (fout) => fout instanceof Afgebroken
  );

  assert.equal(pogingen, 1, 'na de afbreking volgt geen nieuwe poging');
});

test('de sync herhaalt de eerste fetch en het leden ophalen, met eerlijke logging', () => {
  const body = syncTeamRolesBody();

  assert.match(
    body,
    /metNetwerkHerhaling\(\(\) => getConfiguredGuild\(\{ gooiFout: true \}\)/,
    'de guild-load (eerste fetch) moet herhaald worden en zijn fout doorgeven'
  );
  assert.match(body, /label: 'guild laden'/);
  assert.match(body, /label: 'teams ophalen'[\s\S]{0,200}alsFout:/);
  assert.match(
    body,
    /metNetwerkHerhaling\(\s*\(\) => guild\.members\.fetch\(profile\.discord_id\)/,
    'het lid ophalen moet herhaald worden'
  );
  assert.match(body, /isOnbekendLidFout\(fout\)/, 'een onbekend lid blijft "niet gevonden"');
  assert.doesNotMatch(
    body,
    /members\.fetch\(profile\.discord_id\)\.catch\(\(\) => null\)/,
    'een netwerkfout mag niet als ontbrekend lid verdwijnen'
  );
  assert.match(body, /geen guild geconfigureerd/, 'de reden moet guild-fout en geen-guild onderscheiden');
});

test('getConfiguredGuild geeft de fout alleen door als de sync erom vraagt', () => {
  const bron = leesIndex();
  const start = bron.indexOf('async function getConfiguredGuild');
  const eind = bron.indexOf('async function fetchProfilesByUserIds', start);
  assert.ok(start > 0 && eind > start, 'getConfiguredGuild niet gevonden');

  const body = bron.slice(start, eind);
  assert.match(body, /\{ gooiFout = false \} = \{\}/);
  assert.match(body, /return gooiFout \? ophalen : ophalen\.catch\(\(\) => null\)/);
});

