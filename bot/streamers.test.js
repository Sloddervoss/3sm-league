import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeStreamerProfile,
  upsertStreamerProfile,
  deleteStreamerProfile,
  profileAutocompleteChoices,
  titleContains3Stripe,
  buildStreamerSession,
  updateActiveNotifications,
  notificationDecision,
  markNotificationSent,
  buildLiveEmbedPayload,
} from './streamers.js';

test('normalizeStreamerProfile requires at least one platform name or id', () => {
  assert.throws(
    () => normalizeStreamerProfile({ profiel_naam: 'Vincent' }),
    /Minimaal één platform/i,
  );

  assert.deepEqual(normalizeStreamerProfile({
    profiel_naam: 'Vincent',
    kanaal: '1507715572178227310',
    twitch_naam: '  Sloddervoss ',
  }), {
    profiel_naam: 'Vincent',
    kanaal: '1507715572178227310',
    twitch_naam: 'Sloddervoss',
    kick_naam: '',
    youtube_id: '',
  });
});

test('normalizeStreamerProfile rejects unsafe platform identifiers before building live URLs', () => {
  assert.throws(
    () => normalizeStreamerProfile({ profiel_naam: 'Vincent', twitch_naam: 'slodder/voss' }),
    /Ongeldige Twitch gebruikersnaam/i,
  );
  assert.throws(
    () => normalizeStreamerProfile({ profiel_naam: 'Vincent', kick_naam: 'slodder?voss' }),
    /Ongeldige Kick gebruikersnaam/i,
  );
  assert.throws(
    () => normalizeStreamerProfile({ profiel_naam: 'Vincent', youtube_id: 'UC123) [klik](https://evil.example)' }),
    /Ongeldige YouTube kanaal/i,
  );
});

test('upsertStreamerProfile updates existing profile case-insensitively without duplicates', () => {
  const profiles = [normalizeStreamerProfile({ profiel_naam: 'Vincent', twitch_naam: 'old' })];

  const result = upsertStreamerProfile(profiles, {
    profiel_naam: 'vincent',
    kanaal: '1507715572178227310',
    kick_naam: 'newkick',
  });

  assert.equal(result.created, false);
  assert.equal(result.profiles.length, 1);
  assert.deepEqual(result.profile, {
    profiel_naam: 'Vincent',
    kanaal: '1507715572178227310',
    twitch_naam: 'old',
    kick_naam: 'newkick',
    youtube_id: '',
  });
});

test('deleteStreamerProfile removes profile case-insensitively', () => {
  const profiles = [
    normalizeStreamerProfile({ profiel_naam: 'Vincent', twitch_naam: 'sloddervoss' }),
    normalizeStreamerProfile({ profiel_naam: 'Other', kick_naam: 'other' }),
  ];

  const result = deleteStreamerProfile(profiles, 'vincent');

  assert.equal(result.deleted, true);
  assert.deepEqual(result.profiles.map(p => p.profiel_naam), ['Other']);
});

test('profileAutocompleteChoices filters existing profiles', () => {
  const profiles = [
    normalizeStreamerProfile({ profiel_naam: 'Vincent', twitch_naam: 'sloddervoss' }),
    normalizeStreamerProfile({ profiel_naam: 'Streamer Two', kick_naam: 'two' }),
  ];

  assert.deepEqual(profileAutocompleteChoices(profiles, 'vin'), [
    { name: 'Vincent', value: 'Vincent' },
  ]);
});

test('titleContains3Stripe is case-insensitive and exact to 3stripe text', () => {
  assert.equal(titleContains3Stripe('3stripe race night'), true);
  assert.equal(titleContains3Stripe('GT3 3Stripe practice'), true);
  assert.equal(titleContains3Stripe('3STRIPE endurance'), true);
  assert.equal(titleContains3Stripe('random league stream'), false);
  // De vorm die in het echt op Twitch staat: met een spatie, in een lange titel.
  assert.equal(titleContains3Stripe('NK Iracing SRVN - KNAF Split 3 3 Stripe Motorsport.'), true);
  assert.equal(titleContains3Stripe('3-stripe league race'), true);
  assert.equal(titleContains3Stripe('3_stripe league race'), true);
  assert.equal(titleContains3Stripe('3stripemotorsport.nl live'), true);
  // Geen valse positieven: de 3 mag niet aan iets vastzitten.
  assert.equal(titleContains3Stripe('Race 123 stripe challenge'), false);
  assert.equal(titleContains3Stripe('3 strijd om de titel'), false);
});

test('buildStreamerSession combines multiple live platforms into one session only when 3stripe is present', () => {
  const profile = normalizeStreamerProfile({
    profiel_naam: 'Vincent',
    twitch_naam: 'sloddervoss',
    kick_naam: 'slodderkick',
    youtube_id: 'UC123',
  });

  const session = buildStreamerSession(profile, [
    { platform: 'Twitch', live: true, title: '3Stripe race', url: 'https://twitch.tv/sloddervoss' },
    { platform: 'Kick', live: true, title: '3stripe race mirrored', url: 'https://kick.com/slodderkick' },
    { platform: 'YouTube', live: true, title: 'unrelated stream', url: 'https://youtube.com/watch?v=123' },
  ]);

  assert.equal(session.shouldNotify, true);
  assert.deepEqual(session.platforms.map(p => p.platform), ['Twitch', 'Kick']);
  assert.equal(session.key, 'vincent');
});

test('buildLiveEmbedPayload bouwt de broadcast-kaart met merk, velden, beeld en knop', () => {
  const session = buildStreamerSession(
    normalizeStreamerProfile({ profiel_naam: 'Jaimy', twitch_naam: 'jaimsjourney' }),
    [{
      platform: 'Twitch',
      live: true,
      title: 'NK Iracing SRVN - KNAF Split 3 3 Stripe Motorsport.',
      url: 'https://twitch.tv/jaimsjourney',
      game: 'iRacing',
      thumbnailUrl: 'https://static-cdn.jtvnw.net/previews-ttv/live_user_jaimsjourney-1280x720.jpg',
      streamId: '123456789',
      avatarUrl: 'https://static-cdn.jtvnw.net/jtv_user_pictures/avatar-300x300.png',
    }],
  );

  const payload = buildLiveEmbedPayload(session);

  assert.equal(payload.color, 0xf97316);
  assert.equal(payload.author.name, '3 Stripe Motorsport');
  assert.equal(payload.title, '🔴 Jaimy is live met 3Stripe!');
  assert.equal(payload.description, 'Jaimy rijdt live voor 3 Stripe Motorsport — kom even supporten in de chat 👊');
  assert.equal(payload.url, 'https://twitch.tv/jaimsjourney');
  assert.deepEqual(payload.thumbnail, { url: 'https://static-cdn.jtvnw.net/jtv_user_pictures/avatar-300x300.png' });
  assert.match(payload.image.url, /3sm_session=123456789$/);
  assert.deepEqual(payload.fields.map(f => f.name), ['Twitch', 'Spel']);
  assert.match(payload.fields[0].value, /KNAF Split 3 3 Stripe Motorsport/);
  assert.match(payload.fields[0].value, /\[Kijk live\]\(https:\/\/twitch\.tv\/jaimsjourney\)/);
  assert.deepEqual(payload.buttons, [{ label: 'Kijk op Twitch', url: 'https://twitch.tv/jaimsjourney' }]);
});

test('buildLiveEmbedPayload laat de titel ongelinkt bij een multistream en kiest één beeld', () => {
  const session = buildStreamerSession(
    normalizeStreamerProfile({ profiel_naam: 'Vincent', twitch_naam: 'sloddervoss', kick_naam: 'slodderkick' }),
    [
      { platform: 'Twitch', live: true, title: '3stripe endurance', url: 'https://twitch.tv/sloddervoss', game: 'iRacing', thumbnailUrl: 'https://static-cdn.jtvnw.net/p-1280x720.jpg' },
      { platform: 'Kick', live: true, title: '3stripe endurance', url: 'https://kick.com/slodderkick', game: 'iRacing' },
    ],
  );

  const payload = buildLiveEmbedPayload(session);

  assert.equal(payload.url, undefined);
  assert.deepEqual(payload.fields.map(f => f.name), ['Twitch', 'Kick', 'Spel']);
  assert.deepEqual(payload.buttons.map(b => b.label), ['Kijk op Twitch', 'Kijk op Kick']);
  assert.equal(payload.image.url, 'https://static-cdn.jtvnw.net/p-1280x720.jpg?3sm_session=Twitch-Vincent');
});

test('buildLiveEmbedPayload valt terug op het merklogo en laat Spel weg bij verschillende games', () => {
  const session = buildStreamerSession(
    normalizeStreamerProfile({ profiel_naam: 'Sanne', twitch_naam: 'sanne', kick_naam: 'sannekick' }),
    [
      { platform: 'Twitch', live: true, title: '3 Stripe race', url: 'https://twitch.tv/sanne', game: 'iRacing' },
      { platform: 'Kick', live: true, title: '3 Stripe race', url: 'https://kick.com/sannekick', game: 'Assetto Corsa' },
    ],
  );

  const payload = buildLiveEmbedPayload(session);

  assert.deepEqual(payload.thumbnail, { url: 'https://3stripemotorsport.cc/favicon-512x512.png' });
  assert.equal(payload.image, undefined);
  assert.deepEqual(payload.fields.map(f => f.name), ['Twitch', 'Kick']);
});

test('buildLiveEmbedPayload ontsnapt markdown in de streamtitel', () => {
  const session = buildStreamerSession(
    normalizeStreamerProfile({ profiel_naam: 'Jaimy', twitch_naam: 'jaimsjourney' }),
    [{ platform: 'Twitch', live: true, title: '**gratis** _wins_ 3stripe', url: 'https://twitch.tv/jaimsjourney' }],
  );

  const payload = buildLiveEmbedPayload(session);
  assert.match(payload.fields[0].value, /\\\*\\\*gratis\\\*\\\*/);
});

test('updateActiveNotifications sends once while live and resets after fully offline', () => {
  const active = new Set();
  const online = buildStreamerSession(
    normalizeStreamerProfile({ profiel_naam: 'Vincent', twitch_naam: 'sloddervoss' }),
    [{ platform: 'Twitch', live: true, title: '3stripe live', url: 'https://twitch.tv/sloddervoss' }],
  );
  const offline = buildStreamerSession(
    normalizeStreamerProfile({ profiel_naam: 'Vincent', twitch_naam: 'sloddervoss' }),
    [{ platform: 'Twitch', live: false, title: '', url: 'https://twitch.tv/sloddervoss' }],
  );

  assert.equal(updateActiveNotifications(active, online), 'notify');
  assert.equal(updateActiveNotifications(active, online), 'skip');
  assert.equal(updateActiveNotifications(active, offline), 'reset');
  assert.equal(updateActiveNotifications(active, online), 'notify');
});

test('een mislukte verzending houdt de volgende poll open', () => {
  // De oude volgorde markeerde "gemeld" vóór channel.send(). Faalt die send, dan
  // gaf elke volgende poll 'skip' en kwam de melding nooit meer. Deze test legt
  // vast dat de beslissing pas na een geslaagde send definitief wordt.
  const active = new Set();
  const session = buildStreamerSession(
    normalizeStreamerProfile({ profiel_naam: 'Jaimy', twitch_naam: 'jaimsjourney' }),
    [{ platform: 'Twitch', live: true, title: 'NK Iracing SRVN - KNAF Split 3 3 Stripe Motorsport.', url: 'https://twitch.tv/jaimsjourney' }],
  );

  assert.equal(notificationDecision(active, session), 'notify');
  // send mislukt: er wordt niets gemarkeerd, dus de volgende poll mag het opnieuw.
  assert.equal(notificationDecision(active, session), 'notify');

  markNotificationSent(active, session);
  assert.equal(notificationDecision(active, session), 'skip');
});
