import fs from 'fs';

const REQUIRED_TITLE_TEXT = '3stripe';

function clean(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeKey(value) {
  return clean(value).toLowerCase();
}

export function titleContains3Stripe(title) {
  return clean(title).toLowerCase().includes(REQUIRED_TITLE_TEXT);
}

export function normalizeStreamerProfile(input = {}, existing = null) {
  const profielNaam = clean(input.profiel_naam ?? input.name ?? existing?.profiel_naam);
  if (!profielNaam) throw new Error('Profielnaam is verplicht.');

  const profile = {
    profiel_naam: existing?.profiel_naam || profielNaam,
    kanaal: clean(input.kanaal ?? input.channel_id ?? existing?.kanaal),
    twitch_naam: clean(input.twitch_naam ?? input.twitch ?? existing?.twitch_naam),
    kick_naam: clean(input.kick_naam ?? input.kick ?? existing?.kick_naam),
    youtube_id: clean(input.youtube_id ?? input.youtube ?? existing?.youtube_id),
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
    }));

  return {
    key: normalizeKey(profile.profiel_naam),
    profile,
    shouldNotify: platforms.length > 0,
    platforms,
  };
}

export function updateActiveNotifications(activeNotifications, session) {
  if (!session?.shouldNotify) {
    activeNotifications.delete(session?.key);
    return 'reset';
  }

  if (activeNotifications.has(session.key)) return 'skip';
  activeNotifications.add(session.key);
  return 'notify';
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
  return {
    platform: 'Twitch',
    live: !!stream,
    title: stream?.title || '',
    url: `https://twitch.tv/${profile.twitch_naam}`,
  };
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

export function buildLiveEmbedPayload(session) {
  const description = session.platforms
    .map(platform => `**${platform.platform}** — [Kijk live](${platform.url})\n${platform.title}`)
    .join('\n\n');

  return {
    color: 0xef4444,
    title: `🔴 ${session.profile.profiel_naam} is live met 3Stripe!`,
    description,
    footer: '3 Stripe Motorsport',
  };
}
