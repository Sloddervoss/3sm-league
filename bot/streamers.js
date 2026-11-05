import fs from 'fs';

// Streamers zetten hun titel zelden exact op "3stripe". In de praktijk staat er
// "3 Stripe Motorsport", "3-stripe" of "3stripe.nl", en dan viel de melding
// volledig weg. Deze vorm accepteert elke scheiding tussen 3 en Stripe, maar
// eist dat de 3 niet aan een cijfer of letter vastzit ("123 stripe" telt niet).
const THREE_STRIPE_PATTERN = /(?<![0-9a-z])3[\s._-]*stripe/i;

function clean(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeKey(value) {
  return clean(value).toLowerCase();
}

function requireSafeIdentifier(value, label) {
  if (!value) return value;
  if (!/^[A-Za-z0-9_.@-]+$/.test(value)) {
    throw new Error(`Ongeldige ${label}. Gebruik alleen letters, cijfers, _, ., @ of -.`);
  }
  return value;
}

export function titleContains3Stripe(title) {
  return THREE_STRIPE_PATTERN.test(clean(title));
}

export function normalizeStreamerProfile(input = {}, existing = null) {
  const profielNaam = clean(input.profiel_naam ?? input.name ?? existing?.profiel_naam);
  if (!profielNaam) throw new Error('Profielnaam is verplicht.');

  const profile = {
    profiel_naam: existing?.profiel_naam || profielNaam,
    kanaal: clean(input.kanaal ?? input.channel_id ?? existing?.kanaal),
    twitch_naam: requireSafeIdentifier(clean(input.twitch_naam ?? input.twitch ?? existing?.twitch_naam), 'Twitch gebruikersnaam'),
    kick_naam: requireSafeIdentifier(clean(input.kick_naam ?? input.kick ?? existing?.kick_naam), 'Kick gebruikersnaam'),
    youtube_id: requireSafeIdentifier(clean(input.youtube_id ?? input.youtube ?? existing?.youtube_id), 'YouTube kanaal'),
  };

  if (!profile.twitch_naam && !profile.kick_naam && !profile.youtube_id) {
    throw new Error('Minimaal één platform moet ingevuld zijn.');
  }

  return profile;
}

export function upsertStreamerProfile(profiles, input) {
  const list = Array.isArray(profiles) ? [...profiles] : [];
  const wanted = normalizeKey(input?.profiel_naam ?? input?.name);
  const index = list.findIndex(profile => normalizeKey(profile.profiel_naam) === wanted);
  const existing = index >= 0 ? list[index] : null;
  const profile = normalizeStreamerProfile(input, existing);

  if (index >= 0) {
    list[index] = profile;
    return { created: false, profile, profiles: list };
  }

  list.push(profile);
  return { created: true, profile, profiles: list };
}

export function deleteStreamerProfile(profiles, profielNaam) {
  const wanted = normalizeKey(profielNaam);
  const list = Array.isArray(profiles) ? profiles : [];
  const next = list.filter(profile => normalizeKey(profile.profiel_naam) !== wanted);
  return { deleted: next.length !== list.length, profiles: next };
}

export function profileAutocompleteChoices(profiles, query = '') {
  const needle = normalizeKey(query);
  return (Array.isArray(profiles) ? profiles : [])
    .filter(profile => !needle || normalizeKey(profile.profiel_naam).includes(needle))
    .slice(0, 25)
    .map(profile => ({ name: profile.profiel_naam, value: profile.profiel_naam }));
}

export function readStreamerProfiles(file) {
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    return Array.isArray(parsed) ? parsed : [];
  } catch (e) {
    if (e.code !== 'ENOENT') throw e;
    return [];
  }
}

export function writeStreamerProfiles(file, profiles) {
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(profiles, null, 2), { mode: 0o600 });
  fs.renameSync(tmp, file);
}

export function buildStreamerSession(profile, platformStatuses) {
  const platforms = (platformStatuses || [])
    .filter(status => status?.live && titleContains3Stripe(status.title || status.name || ''))
    .map(status => ({
      platform: status.platform,
      title: status.title || status.name || '3Stripe live',
      url: status.url,
      // Verrijking voor de kaart. Ontbreekt een veld, dan valt dat onderdeel weg.
      game: status.game || null,
      startedAt: status.startedAt || null,
      viewers: status.viewers ?? null,
      thumbnailUrl: status.thumbnailUrl || null,
      streamId: status.streamId || null,
      avatarUrl: status.avatarUrl || null,
    }));

  return {
    key: normalizeKey(profile.profiel_naam),
    profile,
    shouldNotify: platforms.length > 0,
    platforms,
    // Uniek per uitzending, niet per profiel: dezelfde streamer die na een
    // kwartier opnieuw begint is een nieuwe melding, een herstart van de bot niet.
    streamKey: platforms
      .map(platform => `${platform.platform}:${platform.streamId || platform.startedAt || platform.url}`)
      .sort()
      .join('|'),
  };
}

// ---------------------------------------------------------------------------
// Wat er in het kanaal staat
// ---------------------------------------------------------------------------
// De bot onthoudt per melding welk bericht hij plaatste, zodat hij het bij een
// livegang kan opruimen. Zonder dat geheugen blijft elke oude kaart staan (en
// verdubbelt een herstart van de bot de melding, want de sessie is dan "nieuw").
export function upsertNotice(notices, record) {
  const list = (Array.isArray(notices) ? notices : [])
    .filter(notice => notice && notice.key && notice.key !== record.key);
  list.push({ ...record });
  return list;
}

export function removeNotices(notices, key) {
  return (Array.isArray(notices) ? notices : [])
    .filter(notice => notice && notice.key && notice.key !== key);
}

// Een oude melding mag weg als hij niet bij de nu lopende uitzending hoort.
export function noticesToClear(notices, session) {
  return (Array.isArray(notices) ? notices : []).filter((notice) => {
    if (!notice || !notice.key || notice.key !== session?.key) return false;
    if (!session.shouldNotify) return true;               // streamer is offline
    return notice.streamKey !== session.streamKey;        // andere uitzending
  });
}

// Na een week is een melding sowieso oud genoeg, ook als de streamer zijn
// kanaal nooit meer live zet.
export function staleNotices(notices, now = Date.now(), maxAgeMs = 7 * 24 * 60 * 60 * 1000) {
  return (Array.isArray(notices) ? notices : []).filter(notice =>
    notice && notice.sentAt && now - Date.parse(notice.sentAt) > maxAgeMs);
}

// Bepaal wat er moet gebeuren zonder de sessie al als "gemeld" te markeren.
// Dat markeren gebeurde eerder vóór kanaalopzoeking en channel.send(), waardoor
// één mislukte verzending (kanaal weg, rechten, rate limit) het profiel voor de
// rest van de sessie stil hield: elke volgende poll gaf 'skip'.
export function notificationDecision(activeNotifications, session) {
  if (!session?.shouldNotify) {
    activeNotifications.delete(session?.key);
    return 'reset';
  }
  return activeNotifications.has(session.key) ? 'skip' : 'notify';
}

export function markNotificationSent(activeNotifications, session) {
  if (session?.shouldNotify && session?.key) activeNotifications.add(session.key);
  return activeNotifications;
}

export function updateActiveNotifications(activeNotifications, session) {
  const action = notificationDecision(activeNotifications, session);
  if (action === 'notify') markNotificationSent(activeNotifications, session);
  return action;
}

export async function fetchTwitchStatus(profile, options = {}) {
  if (!profile.twitch_naam) return null;
  const fetchImpl = options.fetch || globalThis.fetch;
  const env = options.env || process.env;
  const clientId = clean(env.TWITCH_CLIENT_ID);
  const clientSecret = clean(env.TWITCH_CLIENT_SECRET);
  if (!clientId || !clientSecret) return { platform: 'Twitch', live: false, missingConfig: true, url: `https://twitch.tv/${profile.twitch_naam}` };

  const tokenResponse = await fetchImpl('https://id.twitch.tv/oauth2/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, grant_type: 'client_credentials' }),
  });
  if (!tokenResponse.ok) throw new Error(`Twitch token fout: HTTP ${tokenResponse.status}`);
  const tokenData = await tokenResponse.json();
  const token = tokenData.access_token;
  if (!token) throw new Error('Twitch token ontbreekt in response.');

  const streamResponse = await fetchImpl(`https://api.twitch.tv/helix/streams?user_login=${encodeURIComponent(profile.twitch_naam)}`, {
    headers: { 'Client-ID': clientId, Authorization: `Bearer ${token}` },
  });
  if (!streamResponse.ok) throw new Error(`Twitch streams fout: HTTP ${streamResponse.status}`);
  const streamData = await streamResponse.json();
  const stream = streamData?.data?.[0];
  if (!stream) {
    return { platform: 'Twitch', live: false, title: '', url: `https://twitch.tv/${profile.twitch_naam}` };
  }

  // De avatar is een extra aanroep; één keer per login per proces is genoeg.
  // Faalt hij, dan is de melding nog steeds compleet (het merklogo valt in).
  const avatarUrl = await fetchTwitchAvatar(profile.twitch_naam, clientId, token, fetchImpl);

  return {
    platform: 'Twitch',
    live: true,
    title: stream.title || '',
    url: `https://twitch.tv/${profile.twitch_naam}`,
    game: clean(stream.game_name) || null,
    startedAt: stream.started_at || null,
    viewers: Number.isFinite(stream.viewer_count) ? stream.viewer_count : null,
    // {width}x{height} is een sjabloon in de URL; Discord haalt het beeld zelf op.
    thumbnailUrl: clean(stream.thumbnail_url).replace('{width}', '1280').replace('{height}', '720') || null,
    streamId: stream.id || null,
    avatarUrl,
  };
  }

  const twitchAvatarCache = new Map();

  async function fetchTwitchAvatar(login, clientId, token, fetchImpl, now = Date.now()) {
  const key = String(login || '').toLowerCase();
  if (!key) return null;
  const hit = twitchAvatarCache.get(key);
  if (hit && now - hit.at < 6 * 60 * 60 * 1000) return hit.url;

  try {
    const response = await fetchImpl(`https://api.twitch.tv/helix/users?login=${encodeURIComponent(login)}`, {
      headers: { 'Client-ID': clientId, Authorization: `Bearer ${token}` },
    });
    if (!response.ok) return null;
    const data = await response.json();
    const url = clean(data?.data?.[0]?.profile_image_url) || null;
    if (url) twitchAvatarCache.set(key, { url, at: now });
    return url;
  } catch {
    return null;
  }
  }

export async function fetchYouTubeStatus(profile, options = {}) {
  if (!profile.youtube_id) return null;
  const fetchImpl = options.fetch || globalThis.fetch;
  const env = options.env || process.env;
  const apiKey = clean(env.YOUTUBE_API_KEY);
  if (!apiKey) return { platform: 'YouTube', live: false, missingConfig: true, url: `https://www.youtube.com/channel/${profile.youtube_id}/live` };

  const params = new URLSearchParams({
    part: 'snippet',
    channelId: profile.youtube_id,
    eventType: 'live',
    type: 'video',
    maxResults: '1',
    key: apiKey,
  });
  const response = await fetchImpl(`https://www.googleapis.com/youtube/v3/search?${params.toString()}`);
  if (!response.ok) throw new Error(`YouTube live search fout: HTTP ${response.status}`);
  const data = await response.json();
  const item = data?.items?.[0];
  const videoId = item?.id?.videoId;
  return {
    platform: 'YouTube',
    live: !!item,
    title: item?.snippet?.title || '',
    url: videoId ? `https://www.youtube.com/watch?v=${videoId}` : `https://www.youtube.com/channel/${profile.youtube_id}/live`,
  };
}

export async function fetchKickStatus(profile, options = {}) {
  if (!profile.kick_naam) return null;
  const fetchImpl = options.fetch || globalThis.fetch;
  const url = `https://kick.com/${profile.kick_naam}`;
  const response = await fetchImpl(`https://kick.com/api/v2/channels/${encodeURIComponent(profile.kick_naam)}`, {
    headers: {
      accept: 'application/json,text/plain,*/*',
      'user-agent': '3SM Discord Bot stream checker (+https://3stripemotorsport.cc)',
    },
  });
  if (!response.ok) throw new Error(`Kick channel fout: HTTP ${response.status}`);
  const data = await response.json();
  const livestream = data?.livestream;
  return {
    platform: 'Kick',
    live: !!livestream,
    title: livestream?.session_title || livestream?.title || '',
    url,
  };
}

export async function fetchPlatformStatuses(profile, options = {}) {
  const checks = [
    fetchTwitchStatus(profile, options),
    fetchKickStatus(profile, options),
    fetchYouTubeStatus(profile, options),
  ];
  const settled = await Promise.allSettled(checks);
  return settled
    .map(result => result.status === 'fulfilled' ? result.value : { live: false, error: result.reason })
    .filter(Boolean);
}

// ---------------------------------------------------------------------------
// De live-kaart
// ---------------------------------------------------------------------------
// Ontwerp (na review): merk bovenaan, de streamer als hoofdpersoon, per live
// platform één blok met de echte titel en een kijklink, één groot racebeeld uit
// de uitzending en één kijkknop. Geen kijkertellers: die verouderen sneller dan
// de melding en zeggen niets als er niemand kijkt.
const BRAND_COLOR = 0xf97316; // 3SM-oranje; rood is alleen nog de 🔴 in de titel
const BRAND_SITE = 'https://3stripemotorsport.cc';
const BRAND_ICON = 'https://3stripemotorsport.cc/favicon-512x512.png';
const PREVIEW_FOOTER = '3 Stripe Motorsport • Preview is een momentopname';

const truncateText = (value, max) => {
  const text = String(value ?? '');
  return text.length <= max ? text : `${text.slice(0, Math.max(0, max - 1)).trimEnd()}…`;
};

// Een streamtitel is vrije tekst: **bold** of _cursief_ van de streamer zou de
// opmaak van de kaart overnemen. Backslashes en markers ontsnappen.
const escapeMarkdown = (value) => String(value ?? '').replace(/([*_`~\\])/g, '\\$1');

export function buildLiveEmbedPayload(session) {
  const platforms = session.platforms || [];
  const profileName = truncateText(session.profile?.profiel_naam || 'Een 3SM-coureur', 80);
  const single = platforms.length === 1 ? platforms[0] : null;

  // Eén beeld per melding, in een vaste orde: Twitch heeft het breedste beeld,
  // daarna YouTube, dan Kick. Alleen van een platform dat écht meetelt.
  const imagePlatform = ['Twitch', 'YouTube', 'Kick']
    .map(name => platforms.find(platform => platform.platform === name && platform.thumbnailUrl))
    .find(Boolean) || null;

  const games = platforms.map(platform => platform.game).filter(Boolean);
  const game = games.length && new Set(games).size === 1 ? games[0] : null;

  const fields = platforms.map((platform) => ({
    name: platform.platform,
    // Ruim onder de 1024 van Discord, zodat de kijklink altijd past.
    value: `${escapeMarkdown(truncateText(platform.title, 400))}\n[Kijk live](${platform.url})`,
    inline: false,
  }));
  if (game) fields.push({ name: 'Spel', value: escapeMarkdown(game), inline: false });

  const payload = {
    color: BRAND_COLOR,
    author: { name: '3 Stripe Motorsport', url: BRAND_SITE, icon_url: BRAND_ICON },
    title: `🔴 ${profileName} is live met 3Stripe!`,
    description: `${profileName} rijdt live voor 3 Stripe Motorsport — kom even supporten in de chat 👊`,
    fields,
    thumbnail: { url: single?.avatarUrl || BRAND_ICON },
    footer: PREVIEW_FOOTER,
    buttons: platforms.map(platform => ({ label: `Kijk op ${platform.platform}`, url: platform.url })),
    allowedMentions: { parse: [] },
  };

  // Eén platform: de titel is zelf de link. Bij een multistream mag de titel geen
  // voorkeursplatform kiezen; de knoppen doen dat.
  if (single) payload.url = single.url;

  if (imagePlatform?.thumbnailUrl) {
    // Stabiele sessiesleutel: geen nieuwe URL per poll (dat is een nieuwe
    // Discord-cache-entry zonder dat het beeld actueler wordt), maar wel uniek
    // per uitzending, zodat een volgende stream geen oude preview erft.
    const key = imagePlatform.streamId || imagePlatform.startedAt || `${imagePlatform.platform}-${profileName}`;
    const separator = imagePlatform.thumbnailUrl.includes('?') ? '&' : '?';
    payload.image = { url: `${imagePlatform.thumbnailUrl}${separator}3sm_session=${encodeURIComponent(String(key))}` };
  }

  return payload;
}
