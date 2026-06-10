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

test('buildLiveEmbedPayload adds a dynamic support message before platform links', () => {
  const session = buildStreamerSession(
    normalizeStreamerProfile({ profiel_naam: 'SmoothieBroers', twitch_naam: 'SmoothieBroers' }),
    [{ platform: 'Twitch', live: true, title: 'GT3 race | 3stripe practice', url: 'https://twitch.tv/SmoothieBroers' }],
  );

  const payload = buildLiveEmbedPayload(session);

  assert.equal(payload.title, '🔴 SmoothieBroers is live met 3Stripe!');
  assert.equal(payload.footer, '3 Stripe Motorsport');
  assert.match(payload.description, /SmoothieBroers rijdt live voor 3 Stripe Motorsport — kom even supporten in de chat 👊/);
  assert.match(payload.description, /\*\*Twitch\*\* — \[Kijk live\]\(https:\/\/twitch\.tv\/SmoothieBroers\)/);
  assert.match(payload.description, /GT3 race \| 3stripe practice/);
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
