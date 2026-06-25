import dotenv from 'dotenv';
import {
  Client, GatewayIntentBits, EmbedBuilder,
  AttachmentBuilder,
  ButtonBuilder, ButtonStyle, ActionRowBuilder,
  REST, Routes, SlashCommandBuilder,
  ChannelType, PermissionFlagsBits,
} from 'discord.js';
import { createClient } from '@supabase/supabase-js';
import cron from 'node-cron';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createRacePosterAttachment } from './racePoster.js';
import { createResultPosterAttachment } from './resultPoster.js';
import { describeError, formatLogArg, redactSensitiveText } from './logging.js';
import {
  createNetworkHealthTracker,
  createTimeoutFetch,
  isTransientNetworkErrorText,
  parseNetworkTimeoutMs,
} from './network.js';
import {
  buildLiveEmbedPayload,
  buildStreamerSession,
  deleteStreamerProfile,
  fetchPlatformStatuses,
  profileAutocompleteChoices,
  readStreamerProfiles,
  updateActiveNotifications,
  upsertStreamerProfile,
  writeStreamerProfiles,
} from './streamers.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SENT_FILE   = path.join(__dirname, 'sent_notifications.json');
const CONFIG_FILE = path.join(__dirname, 'config.json');
const STREAMERS_FILE = path.join(__dirname, 'streamers.json');

dotenv.config({ path: path.join(__dirname, '.env') });
dotenv.config();

function requireEnv(name) {
  const value = process.env[name];
  if (!value || value.trim() === '') {
    throw new Error(`[config] Missing required environment variable: ${name}`);
  }
  return value.trim();
}

const SUPABASE_URL = requireEnv('SUPABASE_URL');
const SUPABASE_KEY = requireEnv('SUPABASE_SERVICE_KEY');
const DISCORD_BOT_TOKEN = requireEnv('DISCORD_BOT_TOKEN');
const SITE_URL = requireEnv('SITE_URL').replace(/\/$/, '');
const ENABLE_RACE_POSTERS = process.env.DISCORD_RACE_POSTERS === 'true';
const ENABLE_RESULT_POSTERS = process.env.DISCORD_RESULT_POSTERS === 'true';
const SUPABASE_FETCH_TIMEOUT_MS = parseNetworkTimeoutMs(process.env.SUPABASE_FETCH_TIMEOUT_MS);
const RACE_SELECT = 'id, name, track, round, race_date, status, race_type, practice_duration, qualifying_duration, race_duration, start_type, weather, setup, leagues(name, car_class)';

// ── Supabase ──────────────────────────────────────────────────────────────────
const supabase = createClient(
  SUPABASE_URL,
  SUPABASE_KEY,
  {
    global: {
      fetch: createTimeoutFetch({ timeoutMs: SUPABASE_FETCH_TIMEOUT_MS }),
    },
  }
);

// ── Discord client ────────────────────────────────────────────────────────────
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
  ],
});

// ── Bot log helper ────────────────────────────────────────────────────────────
async function botLog(...args) {
  const message = redactSensitiveText(args.map(formatLogArg).join(' '));
  console.log(`[botLog] ${message}`);
  try {
    const cfg = loadConfig();
    if (!cfg.bot_logs_channel_id) return;
    const ch = await client.channels.fetch(cfg.bot_logs_channel_id).catch(() => null);
    if (ch) await ch.send(`\`${new Date().toISOString()}\` ${message}`).catch(() => {});
  } catch {}
}

const runningJobs = new Map();
const throttledLogs = new Map();
const missingSchemaWarnings = new Set();
const active_notifications = new Set();
const ERROR_LOG_THROTTLE_MS = 5 * 60 * 1000;
const NETWORK_ERROR_LOG_THROTTLE_MS = 15 * 60 * 1000;
const JOB_STUCK_WARNING_MS = 4 * 60 * 1000;
const DISCORD_LOGIN_TIMEOUT_MS = 60 * 1000;

function networkStatusLog(...args) {
  const message = redactSensitiveText(args.map(formatLogArg).join(' '));
  console.warn(`[network] ${message}`);
}

const networkHealth = createNetworkHealthTracker({
  // Transient Supabase/API outages are expected during short internet/DNS hiccups.
  // Keep them in systemd logs for diagnostics, but do not spam the Discord bot-logs channel.
  log: networkStatusLog,
  throttleMs: NETWORK_ERROR_LOG_THROTTLE_MS,
});

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function withTimeout(promise, ms, label) {
  let timeoutId = null;
  const timeout = new Promise((_, reject) => {
    timeoutId = setTimeout(() => reject(new Error(`${label} timeout na ${formatDuration(ms)}`)), ms);
  });

  try {
    return await Promise.race([promise, timeout]);
  } finally {
    clearTimeout(timeoutId);
  }
}

async function throttledBotLog(key, ...args) {
  const now = Date.now();
  const text = args.join(' ') || key;
  const normalizedKey = isTransientNetworkErrorText(`${key} ${text}`)
    ? 'network:transient-fetch-failed'
    : key;
  const throttleMs = normalizedKey === 'network:transient-fetch-failed'
    ? NETWORK_ERROR_LOG_THROTTLE_MS
    : ERROR_LOG_THROTTLE_MS;
  const last = throttledLogs.get(normalizedKey) || 0;
  if (now - last < throttleMs) return;
  throttledLogs.set(normalizedKey, now);

  if (normalizedKey === 'network:transient-fetch-failed') {
    await networkHealth.recordFailure('cron/network', text);
    return;
  }

  await botLog(...args);
}

function throttledConsoleLog(key, message, throttleMs = ERROR_LOG_THROTTLE_MS) {
  const now = Date.now();
  const last = throttledLogs.get(key) || 0;
  if (now - last < throttleMs) return;
  throttledLogs.set(key, now);
  console.warn(message);
}

function formatDuration(ms) {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return minutes ? `${minutes}m ${seconds}s` : `${seconds}s`;
}

async function retrySupabase(label, operation, attempts = 3) {
  let lastError = null;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const result = await operation();
      if (!result?.error) {
        await networkHealth.recordSuccess(label);
        return true;
      }
      lastError = result.error;
    } catch (e) {
      lastError = e;
    }

    if (attempt < attempts) await delay(500 * attempt);
  }

  await throttledBotLog(`${label}:${describeError(lastError)}`, `${label}: ${describeError(lastError)}`);
  return false;
}

async function supabaseStep(label, queryPromise) {
  try {
    const result = await queryPromise;
    if (result?.error) {
      await throttledBotLog(`${label}:${describeError(result.error)}`, `${label} fout:`, describeError(result.error));
    } else {
      await networkHealth.recordSuccess(label);
    }
    return result;
  } catch (e) {
    await throttledBotLog(`${label}:${describeError(e)}`, `${label} fout:`, describeError(e));
    return { data: null, error: e };
  }
}

async function deleteSentMessage(message, label) {
  if (!message?.delete) return;
  await message.delete().catch(e => throttledBotLog(`${label}:rollback:${describeError(e)}`, `${label} rollback delete fout: ${describeError(e)}`));
}

function cleanupPosterFile(filePath) {
  if (!filePath) return;
  fs.promises.unlink(filePath).catch(() => {});
}

async function runGuarded(name, task) {
  const existingJob = runningJobs.get(name);
  if (existingJob) {
    throttledConsoleLog(
      `cron:${name}:overlap`,
      `[cron:${name}] vorige run loopt nog sinds ${existingJob.startedAt.toISOString()} (${formatDuration(Date.now() - existingJob.startedAt.getTime())}); stap: ${existingJob.step}; deze run overgeslagen`
    );
    return;
  }

  const jobState = {
    startedAt: new Date(),
    step: 'gestart',
    warningTimer: null,
  };
  jobState.warningTimer = setTimeout(() => {
    throttledConsoleLog(
      `cron:${name}:stuck:${jobState.step}`,
      `[cron:${name}] draait al ${formatDuration(Date.now() - jobState.startedAt.getTime())}; huidige stap: ${jobState.step}`
    );
  }, JOB_STUCK_WARNING_MS);

  runningJobs.set(name, jobState);
  try {
    await task({
      setStep(step) {
        jobState.step = step || jobState.step;
      },
    });
  } catch (e) {
    await throttledBotLog(`cron:${name}:${describeError(e)}`, `[cron:${name}] ${describeError(e)}`);
  } finally {
    clearTimeout(jobState.warningTimer);
    runningJobs.delete(name);
  }
}

function scheduleGuarded(pattern, name, task) {
  cron.schedule(pattern, () => runGuarded(name, task));
}

// ── Config (channel/role IDs na /setup-server) ────────────────────────────────
function readJsonFile(file, fallback = {}) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (e) {
    if (e.code !== 'ENOENT') {
      const badFile = `${file}.bad-${Date.now()}`;
      try {
        fs.copyFileSync(file, badFile);
        fs.chmodSync(badFile, 0o600);
      } catch {}
      console.warn(`[json] ${path.basename(file)} kon niet worden gelezen; fallback gebruikt`);
    }
    return fallback;
  }
}

function writeJsonFile(file, data) {
  const tmpFile = `${file}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmpFile, JSON.stringify(data, null, 2), { mode: 0o600 });
  fs.renameSync(tmpFile, file);
}

function loadConfig() {
  return readJsonFile(CONFIG_FILE, {});
}
function saveConfig(data) {
  const current = loadConfig();
  writeJsonFile(CONFIG_FILE, { ...current, ...data });
}

// ── Sent-notification tracking ────────────────────────────────────────────────
function loadSent() {
  return readJsonFile(SENT_FILE, {});
}
function sentKey(raceId, type) {
  return `${raceId}_${type}`;
}
function markSent(raceId, type, meta = null) {
  const sent = loadSent();
  const sentAt = new Date().toISOString();
  sent[sentKey(raceId, type)] = meta ? { sent_at: sentAt, ...meta } : sentAt;
  writeJsonFile(SENT_FILE, sent);
}
function getSent(raceId, type) { return loadSent()[sentKey(raceId, type)]; }
function getSentMeta(raceId, type) {
  const entry = getSent(raceId, type);
  return entry && typeof entry === 'object' ? entry : null;
}
function wasSent(raceId, type) { return !!getSent(raceId, type); }

// ── Helpers ───────────────────────────────────────────────────────────────────
const WINDOWS = [
  { key: '24h', ms: 24 * 60 * 60 * 1000 },
  { key: '1h',  ms:      60 * 60 * 1000 },
  { key: '15m', ms:      15 * 60 * 1000 },
];
const MEDALS = ['🥇', '🥈', '🥉'];

function fmtDate(iso) {
  return new Date(iso).toLocaleDateString('nl-NL', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
    timeZone: 'Europe/Amsterdam',
  });
}
function fmtTime(iso) {
  return new Date(iso).toLocaleTimeString('nl-NL', {
    hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Amsterdam',
  });
}
function rondeName(race) {
  return race.round != null ? `Ronde ${race.round}` : race.name;
}

async function getNotificationChannel() {
  const cfg = loadConfig();
  const channelId = cfg.meldingen_channel_id || process.env.DISCORD_CHANNEL_ID;
  if (!channelId) { await throttledBotLog('notifications:no-channel', '[bot] Geen meldingen channel geconfigureerd'); return null; }
  const ch = await client.channels.fetch(channelId).catch(() => null);
  if (!ch) { await throttledBotLog(`notifications:channel-missing:${channelId}`, '[bot] Meldingen channel niet gevonden:', channelId); return null; }
  return ch;
}

function getLiveChannelId(profile = null) {
  const cfg = loadConfig();
  return profile?.kanaal
    || cfg.live_meldingen_channel_id
    || process.env.DISCORD_LIVE_CHANNEL_ID;
}

async function getLiveChannel(profile = null) {
  const channelId = getLiveChannelId(profile);
  if (!channelId) { await throttledBotLog('live-channel:missing', '[streams] Geen live kanaal geconfigureerd'); return null; }
  const ch = await client.channels.fetch(channelId).catch(() => null);
  if (!ch) await throttledBotLog(`live-channel:${channelId}`, '[streams] Live kanaal niet gevonden:', channelId);
  return ch;
}

async function ensureLiveChannelPermissions(guild = null, channelId = null) {
  const channel = channelId
    ? await client.channels.fetch(channelId).catch(() => null)
    : await getLiveChannel();
  if (!channel?.permissionOverwrites?.edit) return;

  const resolvedGuild = guild || channel.guild || await getConfiguredGuild();
  if (!resolvedGuild) return;

  try {
    const botMember = await resolvedGuild.members.fetchMe().catch(() => null);
    const botRoleId = botMember?.roles?.botRole?.id;
    const botUserId = botMember?.id;
    const cfg = loadConfig();
    const adminRole = cfg.admin_role_id ? await resolvedGuild.roles.fetch(cfg.admin_role_id).catch(() => null) : null;
    const overwrites = [
      { id: resolvedGuild.roles.everyone.id, type: 0, allow: [PermissionFlagsBits.ViewChannel], deny: [PermissionFlagsBits.SendMessages] },
      ...(botRoleId ? [{ id: botRoleId, type: 0, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages] }] : []),
      ...(!botRoleId && botUserId ? [{ id: botUserId, type: 1, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages] }] : []),
      ...(adminRole ? [{ id: adminRole.id, type: 0, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ManageChannels, PermissionFlagsBits.ManageMessages] }] : []),
    ];
    await channel.permissionOverwrites.set(overwrites, '3SM live kanaal permissies');
  } catch (e) {
    await throttledBotLog(`live-channel-perms:${describeError(e)}`, '[streams] Live kanaal permissies instellen mislukt:', describeError(e));
  }
}

function buildDiscordLiveEmbed(session) {
  const payload = buildLiveEmbedPayload(session);
  return new EmbedBuilder()
    .setColor(payload.color)
    .setTitle(payload.title)
    .setDescription(payload.description)
    .setFooter({ text: payload.footer })
    .setTimestamp();
}

async function checkStreams() {
  const profiles = readStreamerProfiles(STREAMERS_FILE);
  if (!profiles.length) return;

  for (const profile of profiles) {
    try {
      const statuses = await fetchPlatformStatuses(profile);
      const session = buildStreamerSession(profile, statuses);
      const action = updateActiveNotifications(active_notifications, session);
      if (action !== 'notify') continue;

      const channel = await getLiveChannel(profile);
      if (!channel) continue;
      await channel.send({ embeds: [buildDiscordLiveEmbed(session)] });
      await botLog(`[streams] Live melding gestuurd voor ${profile.profiel_naam}: ${session.platforms.map(p => p.platform).join(', ')}`);
    } catch (e) {
      await throttledBotLog(`streams:${profile.profiel_naam}:${describeError(e)}`, `[streams] ${profile.profiel_naam}: ${describeError(e)}`);
    }
  }
}

async function getUitslagenChannel() {
  const cfg = loadConfig();
  const channelId = cfg.uitslagen_channel_id;
  if (!channelId) return null;
  return client.channels.fetch(channelId).catch(() => null);
}

async function getAankondigingenChannel() {
  const cfg = loadConfig();
  const channelId = cfg.aankondigingen_channel_id || process.env.DISCORD_AANKONDIGINGEN_CHANNEL_ID;
  if (!channelId) { await throttledBotLog('announcements:no-channel', '[bot] Geen aankondigingen channel geconfigureerd'); return null; }
  return client.channels.fetch(channelId).catch(() => null);
}

async function getStewardDecisionsChannel() {
  const cfg = loadConfig();
  const channelId = cfg.steward_decisions_channel_id || process.env.DISCORD_STEWARD_DECISIONS_CHANNEL_ID;
  if (!channelId) { await throttledBotLog('steward-decisions:no-channel', '[bot] Geen steward decisions channel geconfigureerd'); return null; }
  return client.channels.fetch(channelId).catch(() => null);
}

async function getStewardChannel() {
  const cfg = loadConfig();
  const channelId = cfg.steward_channel_id;
  if (!channelId) return null;
  return client.channels.fetch(channelId).catch(() => null);
}

async function getCalendarChannel() {
  const cfg = loadConfig();
  if (!cfg.kalender_channel_id) return null;
  return client.channels.fetch(cfg.kalender_channel_id).catch(() => null);
}

async function getConfiguredGuild() {
  const cfg = loadConfig();
  const guildId = cfg.guild_id;
  if (!guildId) return null;
  return client.guilds.fetch(guildId).catch(() => null);
}

async function fetchProfilesByUserIds(userIds, columns = 'user_id, display_name, iracing_name, discord_id') {
  const ids = [...new Set((userIds || []).filter(Boolean))];
  if (!ids.length) return new Map();

  const { data, error } = await supabase
    .from('profiles')
    .select(columns)
    .in('user_id', ids);

  if (error) {
    await throttledBotLog(`profiles:${describeError(error)}`, '[profiles]', describeError(error));
    return new Map();
  }

  return new Map((data || []).map(profile => [profile.user_id, profile]));
}

function profileName(profile, fallback = 'Onbekend') {
  return profile?.display_name || profile?.iracing_name || fallback;
}

function deleteReplyLater(interaction, ms) {
  setTimeout(() => interaction.deleteReply().catch(() => {}), ms);
}

async function syncDiscordUser(userId, guild = null, teams = null, syncCfg = null) {
  const resolvedGuild = guild || await getConfiguredGuild();
  if (!resolvedGuild) return { synced: false, reason: 'guild_not_configured' };

  const cfg = syncCfg || loadConfig();

  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('user_id, discord_id, iracing_name, display_name')
    .eq('user_id', userId)
    .maybeSingle();
  if (profileError) throw profileError;
  if (!profile?.discord_id) return { synced: false, reason: 'discord_not_linked' };

  const member = await resolvedGuild.members.fetch(profile.discord_id).catch(() => null);
  if (!member) return { synced: false, reason: 'member_not_found' };

  const { data: allTeams, error: teamsError } = teams
    ? { data: teams, error: null }
    : await supabase.from('teams').select('id, discord_role_id');
  if (teamsError) throw teamsError;

  const { data: memberships, error: membershipsError } = await supabase
    .from('team_memberships')
    .select('team_id')
    .eq('user_id', userId);
  if (membershipsError) throw membershipsError;

  const { data: userRoles, error: userRolesError } = await supabase
    .from('user_roles')
    .select('role')
    .eq('user_id', userId)
    .in('role', ['admin', 'super_admin', 'moderator']);
  if (userRolesError) throw userRolesError;

  if (cfg.rijder_role_id && !member.roles.cache.has(cfg.rijder_role_id)) {
    await member.roles.add(cfg.rijder_role_id).catch(() => {});
  }

  const nickname = profile.iracing_name || profile.display_name;
  if (nickname && member.displayName !== nickname) {
    await member.setNickname(nickname).catch(() => {});
  }

  const teamIds = new Set((memberships || []).map(m => m.team_id));
  const expectedTeamRoleIds = new Set((allTeams || [])
    .filter(team => team.discord_role_id && teamIds.has(team.id))
    .map(team => team.discord_role_id));

  for (const team of allTeams || []) {
    if (!team.discord_role_id) continue;
    const hasRole = member.roles.cache.has(team.discord_role_id);
    const shouldHave = expectedTeamRoleIds.has(team.discord_role_id);
    if (shouldHave && !hasRole) await member.roles.add(team.discord_role_id).catch(() => {});
    if (!shouldHave && hasRole) await member.roles.remove(team.discord_role_id).catch(() => {});
  }

  const roleNames = new Set((userRoles || []).map(r => r.role));
  if (cfg.admin_role_id) {
    const isAdmin = roleNames.has('admin') || roleNames.has('super_admin');
    const hasAdminRole = member.roles.cache.has(cfg.admin_role_id);
    if (isAdmin && !hasAdminRole) await member.roles.add(cfg.admin_role_id).catch(() => {});
    if (!isAdmin && hasAdminRole) await member.roles.remove(cfg.admin_role_id).catch(() => {});
  }

  if (cfg.steward_role_id) {
    const isSteward = roleNames.has('moderator');
    const hasStewardRole = member.roles.cache.has(cfg.steward_role_id);
    if (isSteward && !hasStewardRole) await member.roles.add(cfg.steward_role_id).catch(() => {});
    if (!isSteward && hasStewardRole) await member.roles.remove(cfg.steward_role_id).catch(() => {});
  }

  return { synced: true, discordId: profile.discord_id };
}

// ── Registration buttons ──────────────────────────────────────────────────────
function registrationRow(raceId) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`aanmelden_${raceId}`)
      .setLabel('✅  Aanmelden')
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId(`afmelden_${raceId}`)
      .setLabel('❌  Afmelden')
      .setStyle(ButtonStyle.Danger),
  );
}

// ── Reminder embed ────────────────────────────────────────────────────────────
function buildReminderEmbed(race, key) {
  const ronde = rondeName(race);
  const raceDay = new Date(race.race_date).toLocaleDateString('nl-NL', { weekday: 'long', timeZone: 'Europe/Amsterdam' });
  const todayDay = new Date().toLocaleDateString('nl-NL', { weekday: 'long', timeZone: 'Europe/Amsterdam' });
  const dagLabel = raceDay === todayDay ? 'vanavond' : 'morgen';
  const configs = {
    '24h':      { color: 0x3b82f6, title: `🏁  Race ${dagLabel} — ${race.name}`,         description: `**${ronde}** gaat ${dagLabel} van start.\nZorg dat je klaarstaat en je setup klaar hebt!` },
    '1h':       { color: 0xf97316, title: `⏱️  Race over 1 uur — ${race.name}`,      description: `**${ronde}** begint over een uur.\nOpen iRacing en warm op!` },
    '15m':      { color: 0xef4444, title: `🚨  Race over 15 minuten — ${race.name}`, description: `**${ronde}** begint zo!\nGa naar de grid — succes allemaal!` },
    'live':     { color: 0x22c55e, title: `🟢  Race gestart — ${race.name}`,         description: `**${ronde}** is officieel van start gegaan!\nVeel succes op de baan! 🏎️` },
    'cancelled':{ color: 0x6b7280, title: `❌  Race gecanceld — ${race.name}`,        description: `**${ronde}** is helaas gecanceld.\nHoud de site in de gaten voor meer informatie.` },
  };
  const cfg = configs[key];
  return new EmbedBuilder()
    .setColor(cfg.color).setTitle(cfg.title).setDescription(cfg.description)
    .addFields(
      { name: '🗓️ Datum',   value: fmtDate(race.race_date), inline: true },
      { name: '🕐 Tijd',    value: fmtTime(race.race_date), inline: true },
      { name: '🏎️ Circuit', value: race.track,              inline: true },
    )
    .setFooter({ text: '3 Stripe Motorsport' }).setTimestamp();
}

async function sendRaceReminder(channel, race, key, options = {}) {
  const embed = buildReminderEmbed(race, key);
  const payload = { embeds: [embed] };
  if (options.components) payload.components = options.components;

  if (!ENABLE_RACE_POSTERS) {
    return channel.send(payload);
  }

  try {
    const poster = await createRacePosterAttachment(race, key);
    try {
      const attachment = new AttachmentBuilder(poster.outputPath, { name: poster.fileName });
      const posterPayload = { files: [attachment] };
      if (options.components) posterPayload.components = options.components;
      return await channel.send(posterPayload);
    } finally {
      cleanupPosterFile(poster.outputPath);
    }
  } catch (e) {
    await throttledBotLog(`race-poster:${race.id}:${key}:${describeError(e)}`, '[racePoster]', `${race.name}: ${describeError(e)}`);
    return channel.send(payload);
  }
}

// ── Podium embed ──────────────────────────────────────────────────────────────
function buildPodiumEmbed(race, results, options = {}) {
  const finishers = results.filter(r => !r.dnf);
  const podium    = finishers.slice(0, 3);
  const fastest   = results.find(r => r.fastest_lap);

  const podiumLines = podium.map((r, i) => {
    const name = r.profiles?.display_name || 'Onbekend';
    const pts  = r.points > 0 ? ` · **${r.points} pts**` : '';
    const gap  = i > 0 && r.gap_to_leader ? ` · +${r.gap_to_leader}` : '';
    return `${MEDALS[i]} **${name}**${pts}${gap}`;
  }).join('\n');

  const embed = new EmbedBuilder()
    .setColor(0xf59e0b)
    .setTitle(`🏆  Race uitslag — ${race.name}`)
    .setDescription(options.updated
      ? `**${rondeName(race)}** is aangepast na een steward beslissing. Bekijk de volledige uitslag op de site.`
      : `**${rondeName(race)}** is afgelopen! Bekijk de volledige uitslag op de site.`)
    .addFields(
      { name: '🗓️ Circuit', value: `${race.track} · ${fmtDate(race.race_date)}`, inline: false },
      { name: '🏅 Podium',  value: podiumLines || 'Geen resultaten',             inline: false },
    );

  if (fastest) {
    const flTime = fastest.best_lap ? `  ${fastest.best_lap}` : '';
    embed.addFields({ name: '⚡ Snelste ronde', value: `**${fastest.profiles?.display_name || 'Onbekend'}**${flTime}`, inline: true });
  }

  // Cleanste rijder — laagste incidents onder finishers; bij gelijkstand beste positie
  const finishersWithInc = finishers.filter(r => r.incidents != null);
  if (finishersWithInc.length) {
    const cleanest = finishersWithInc.reduce((best, r) =>
      r.incidents < best.incidents || (r.incidents === best.incidents && r.position < best.position) ? r : best
    );
    embed.addFields({ name: '🧊 Clean drive', value: `**${cleanest.profiles?.display_name || 'Onbekend'}**  ${cleanest.incidents} inc`, inline: true });
  }

  const dnfCount = results.filter(r => r.dnf).length;
  const totalInc = results.reduce((sum, r) => sum + (r.incidents ?? 0), 0);
  const incResults = results.filter(r => r.incidents != null);

  const statsLine = [
    finishers.length ? `👥 ${finishers.length} finishers` : null,
    dnfCount         ? `🔴 ${dnfCount} DNF`               : null,
    incResults.length ? `⚠️ ${totalInc} inc totaal`       : null,
  ].filter(Boolean).join('  ·  ');

  if (statsLine) embed.addFields({ name: '\u200b', value: statsLine, inline: false });
  if (options.updated) {
    embed.addFields({ name: '⚖️ Update', value: 'Uitslag aangepast na steward beslissing.', inline: false });
  }

  embed.setFooter({ text: '3 Stripe Motorsport' }).setTimestamp();

  return embed;
}

async function sendResultPoster(channel, race, results) {
  const embed = buildPodiumEmbed(race, results);

  if (!ENABLE_RESULT_POSTERS) {
    return channel.send({ embeds: [embed] });
  }

  try {
    const poster = await createResultPosterAttachment(race, results);
    try {
      const attachment = new AttachmentBuilder(poster.outputPath, { name: poster.fileName });
      return await channel.send({
        files: [attachment],
      });
    } finally {
      cleanupPosterFile(poster.outputPath);
    }
  } catch (e) {
    await throttledBotLog(`result-poster:${race.id}:${describeError(e)}`, '[resultPoster]', `${race.name}: ${describeError(e)}`);
    return channel.send({ embeds: [embed] });
  }
}

async function fetchRaceResults(raceId) {
  return supabase
    .from('race_results')
    .select('position, points, fastest_lap, best_lap, dnf, gap_to_leader, incidents, laps, profiles(display_name)')
    .eq('race_id', raceId)
    .order('position', { ascending: true });
}

async function refreshResultMessage(raceId, reason = 'steward') {
  if (!raceId) return false;
  const sent = getSentMeta(raceId, 'podium');
  if (!sent?.message_id || !sent?.channel_id) return false;

  const { data: race, error: raceError } = await supabase
    .from('races')
    .select(RACE_SELECT)
    .eq('id', raceId)
    .maybeSingle();
  if (raceError || !race) {
    await throttledBotLog(`result-refresh:race:${raceId}:${describeError(raceError || 'not found')}`, '[resultRefresh]', describeError(raceError || 'Race niet gevonden'));
    return false;
  }

  const { data: results, error: resultsError } = await fetchRaceResults(raceId);
  if (resultsError || !results?.length) {
    await throttledBotLog(`result-refresh:results:${raceId}:${describeError(resultsError || 'geen resultaten')}`, '[resultRefresh]', describeError(resultsError || 'Geen resultaten'));
    return false;
  }

  const channel = await client.channels.fetch(sent.channel_id).catch(() => null);
  if (!channel) {
    await throttledBotLog(`result-refresh:channel:${sent.channel_id}`, '[resultRefresh] Uitslagenbericht kanaal niet gevonden');
    return false;
  }

  const message = await channel.messages.fetch(sent.message_id).catch(() => null);
  if (!message) {
    await throttledBotLog(`result-refresh:message:${sent.message_id}`, '[resultRefresh] Uitslagenbericht niet gevonden');
    return false;
  }

  if (ENABLE_RESULT_POSTERS) {
    try {
      const poster = await createResultPosterAttachment(race, results, { updated: true, reason });
      try {
        const attachment = new AttachmentBuilder(poster.outputPath, { name: poster.fileName });
        await message.edit({ content: null, embeds: [], attachments: [], files: [attachment] });
      } finally {
        cleanupPosterFile(poster.outputPath);
      }
      markSent(raceId, 'podium', {
        ...sent,
        message_id: message.id,
        channel_id: channel.id,
        mode: 'poster',
        updated_at: new Date().toISOString(),
        update_reason: reason,
      });
      botLog(`🏆 Uitslagposter bijgewerkt na steward beslissing: **${race.name}**`);
      return true;
    } catch (e) {
      await throttledBotLog(`result-refresh-poster:${raceId}:${describeError(e)}`, '[resultRefresh]', describeError(e));
    }
  }

  const embed = buildPodiumEmbed(race, results, { updated: true });
  await message.edit({ content: null, embeds: [embed], attachments: [] }).catch(async e => {
    await throttledBotLog(`result-refresh-embed:${raceId}:${describeError(e)}`, '[resultRefresh]', describeError(e));
  });
  markSent(raceId, 'podium', {
    ...sent,
    message_id: message.id,
    channel_id: channel.id,
    mode: 'embed',
    updated_at: new Date().toISOString(),
    update_reason: reason,
  });
  return true;
}

// ── Kalender embed ────────────────────────────────────────────────────────────
async function buildCalendarEmbed() {
  const { data: races, error } = await supabase
    .from('races')
    .select('id, name, track, round, race_date, status, leagues(name)')
    .in('status', ['upcoming', 'live'])
    .order('race_date', { ascending: true })
    .limit(15);

  if (error) {
    await throttledBotLog(`calendar:${describeError(error)}`, '[kalender]', describeError(error));
    return new EmbedBuilder()
      .setColor(0xef4444)
      .setTitle('Racekalender')
      .setDescription('Kalender kon niet worden opgehaald. Probeer het later opnieuw.')
      .setFooter({ text: '3 Stripe Motorsport · automatisch bijgewerkt' })
      .setTimestamp();
  }

  if (!races?.length) {
    return new EmbedBuilder()
      .setColor(0x1e293b)
      .setTitle('📅  Racekalender')
      .setDescription('Geen aankomende races gepland.')
      .setFooter({ text: '3 Stripe Motorsport · automatisch bijgewerkt' })
      .setTimestamp();
  }

  const lines = races.map(r => {
    const ronde  = r.round != null ? `R${r.round}` : '';
    const status = r.status === 'live' ? ' 🟢 **LIVE**' : '';
    const label  = [ronde, r.name].filter(Boolean).join(' · ');
    return `**${label}**${status}\n🏎️ ${r.track} · ${fmtDate(r.race_date)} ${fmtTime(r.race_date)}`;
  }).join('\n\n');

  return new EmbedBuilder()
    .setColor(0x3b82f6)
    .setTitle('📅  Racekalender')
    .setDescription(lines)
    .setFooter({ text: '3 Stripe Motorsport · automatisch bijgewerkt' })
    .setTimestamp();
}

async function updateCalendarEmbed() {
  const ch = await getCalendarChannel();
  if (!ch) return;

  const cfg = loadConfig();
  const embed = await buildCalendarEmbed();

  if (cfg.kalender_message_id) {
    try {
      const msg = await ch.messages.fetch(cfg.kalender_message_id);
      await msg.edit({ embeds: [embed] });
      return;
    } catch {
      // bericht bestaat niet meer, maak nieuw aan
    }
  }

  const msg = await ch.send({ embeds: [embed] });
  saveConfig({ kalender_message_id: msg.id });
}

// ── Cron: upcoming (24h/1h/15m) ──────────────────────────────────────────────
async function checkUpcoming() {
  const now      = new Date();
  const lookahead = new Date(now.getTime() + 25 * 60 * 60 * 1000);

  const { data: races, error } = await supabase
    .from('races').select(RACE_SELECT)
    .eq('status', 'upcoming')
    .gte('race_date', now.toISOString())
    .lte('race_date', lookahead.toISOString());

  if (error) { await throttledBotLog(`checkUpcoming:${describeError(error)}`, '[checkUpcoming]', describeError(error)); return; }
  if (!races?.length) return;

  const channel = await getNotificationChannel();
  if (!channel) return;

  for (const race of races) {
    const diff = new Date(race.race_date).getTime() - now.getTime();
    const activeWindow = [...WINDOWS].reverse().find(win => diff > 0 && diff <= win.ms && !wasSent(race.id, win.key));
    if (!activeWindow) continue;
    for (const win of WINDOWS) {
      if (win.ms > activeWindow.ms && !wasSent(race.id, win.key)) {
        markSent(race.id, win.key);
      }
    }
    try {
      await sendRaceReminder(channel, race, activeWindow.key, { components: [registrationRow(race.id)] });
      markSent(race.id, activeWindow.key);
      botLog(`🔔 Race melding verstuurd (${activeWindow.key}): **${race.name}**`);
    } catch (err) {
      botLog('[checkUpcoming]', describeError(err));
    }
  }
}

// ── Cron: live ────────────────────────────────────────────────────────────────
async function checkLive() {
  const { data: races, error } = await supabase.from('races').select(RACE_SELECT).eq('status', 'live');
  if (error) { await throttledBotLog(`checkLive:${describeError(error)}`, '[checkLive]', describeError(error)); return; }
  if (!races?.length) return;
  const channel = await getNotificationChannel(); if (!channel) return;
  for (const race of races) {
    if (wasSent(race.id, 'live')) continue;
    try { await sendRaceReminder(channel, race, 'live'); markSent(race.id, 'live'); botLog(`🟢 Race gestart melding verstuurd: **${race.name}**`); } catch (e) { botLog(`❌ Live melding fout: ${describeError(e)}`); }
  }
}

// ── Cron: cancelled ───────────────────────────────────────────────────────────
async function checkCancelled() {
  const { data: races, error } = await supabase.from('races').select(RACE_SELECT).eq('status', 'cancelled');
  if (error) { await throttledBotLog(`checkCancelled:${describeError(error)}`, '[checkCancelled]', describeError(error)); return; }
  if (!races?.length) return;
  const channel = await getNotificationChannel(); if (!channel) return;
  for (const race of races) {
    if (wasSent(race.id, 'cancelled')) continue;
    try { await sendRaceReminder(channel, race, 'cancelled'); markSent(race.id, 'cancelled'); botLog(`❌ Race gecanceld melding verstuurd: **${race.name}**`); } catch (e) { botLog(`❌ Cancelled melding fout: ${describeError(e)}`); }
  }
}

// ── Cron: completed / podium ──────────────────────────────────────────────────
async function checkCompleted() {
  const { data: races, error } = await supabase.from('races').select(RACE_SELECT).eq('status', 'completed');
  if (error) { await throttledBotLog(`checkCompleted:${describeError(error)}`, '[checkCompleted]', describeError(error)); return; }
  if (!races?.length) return;
  const channel = await getUitslagenChannel() || await getNotificationChannel();
  if (!channel) return;
  for (const race of races) {
    if (wasSent(race.id, 'podium')) continue;
    const { data: results, error: re } = await fetchRaceResults(race.id);
    if (re || !results?.length) continue;
    try {
      const msg = await sendResultPoster(channel, race, results);
      markSent(race.id, 'podium', {
        message_id: msg.id,
        channel_id: channel.id,
        mode: ENABLE_RESULT_POSTERS ? 'poster' : 'embed',
      });
      botLog(`🏆 Uitslag verstuurd: **${race.name}**`);
    } catch (e) { botLog(`❌ Podium fout: ${describeError(e)}`); }
  }
}

async function checkRaces() {
  const results = await Promise.allSettled([checkUpcoming(), checkLive(), checkCancelled(), checkCompleted()]);
  for (const result of results) {
    if (result.status === 'rejected') {
      await throttledBotLog(`checkRaces:${describeError(result.reason)}`, '[checkRaces]', describeError(result.reason));
    }
  }
}

// ── Cron: nieuwe race aanmeldingen ────────────────────────────────────────────
async function checkNewRegistrations() {
  const { data, error } = await supabase
    .from('race_registrations')
    .select('id, user_id, races(name)')
    .order('created_at', { ascending: false })
    .limit(20);
  if (error) { await throttledBotLog(`checkRegistrations:${describeError(error)}`, '[checkRegistrations]', describeError(error)); return; }
  if (!data?.length) return;

  const profilesByUserId = await fetchProfilesByUserIds(data.map(reg => reg.user_id), 'user_id, display_name, iracing_name');
  for (const reg of data) {
    const key = `reg_${reg.id}`;
    if (wasSent(key, 'notified')) continue;
    markSent(key, 'notified');
    const profile = profilesByUserId.get(reg.user_id);
    const driver = profile?.iracing_name || profile?.display_name || reg.user_id;
    const race = reg.races?.name || 'Onbekende race';
    botLog(`📋 Nieuwe aanmelding: **${driver}** → ${race}`);
  }
}

// ── Cron: nieuwe Discord koppelingen ─────────────────────────────────────────
async function checkNewLinks() {
  const { data, error } = await supabase
    .from('discord_link_tokens')
    .select('discord_id, discord_tag, used')
    .eq('used', true)
    .gte('expires_at', new Date(Date.now() - 30 * 60 * 1000).toISOString()); // token nog niet te oud
  if (error) { await throttledBotLog(`checkLinks:${describeError(error)}`, '[checkLinks]', describeError(error)); return; }
  if (!data?.length) return;
  for (const token of data) {
    const key = `link_${token.discord_id}`;
    if (wasSent(key, 'notified')) continue;
    markSent(key, 'notified');
    botLog(`🔗 Discord gekoppeld: **${token.discord_tag || token.discord_id}**`);
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

async function processDiscordSyncQueue() {
  const { data: items, error } = await supabase
    .from('discord_sync_queue')
    .select('id, user_id, reason, attempts')
    .is('processed_at', null)
    .lt('attempts', 5)
    .order('created_at', { ascending: true })
    .limit(25);

  if (error) {
    if (error.code === 'PGRST205' || /schema cache|discord_sync_queue/i.test(error.message || '')) {
      if (!missingSchemaWarnings.has('discord_sync_queue')) {
        missingSchemaWarnings.add('discord_sync_queue');
        await botLog('[discordSyncQueue] Tabel ontbreekt nog in Supabase. Voer migration 20260425160000_discord_sync_queue.sql uit en herstart daarna de bot.');
      }
      return;
    }
    await throttledBotLog(`discordSyncQueue:${describeError(error)}`, '[discordSyncQueue]', describeError(error));
    return;
  }
  if (!items?.length) return;

  const guild = await getConfiguredGuild();
  if (!guild) {
    await throttledBotLog('discordSyncQueue:no-guild', '[discordSyncQueue] Guild niet geconfigureerd');
    return;
  }

  const cfg = loadConfig();
  const { data: teams, error: teamsError } = await supabase.from('teams').select('id, discord_role_id');
  if (teamsError) {
    await throttledBotLog(`discordSyncQueue:teams:${describeError(teamsError)}`, '[discordSyncQueue:teams]', describeError(teamsError));
    return;
  }

  for (const item of items) {
    const attempts = (item.attempts || 0) + 1;
    await supabase.from('discord_sync_queue').update({ attempts }).eq('id', item.id);

    try {
      const result = await syncDiscordUser(item.user_id, guild, teams || [], cfg);
      const { error: updateError } = await supabase
        .from('discord_sync_queue')
        .update({
          processed_at: new Date().toISOString(),
          attempts,
          last_error: result.synced ? null : result.reason,
        })
        .eq('id', item.id);

      if (updateError) {
        await throttledBotLog(`discordSyncQueue:update:${describeError(updateError)}`, '[discordSyncQueue:update]', describeError(updateError));
      }

      if (result.synced) {
        botLog(`🔁 Discord sync verwerkt: **${item.user_id}** (${item.reason})`);
      }
    } catch (e) {
      const message = describeError(e);
      await supabase
        .from('discord_sync_queue')
        .update({ attempts, last_error: message })
        .eq('id', item.id);
      await throttledBotLog(`discordSyncQueue:item:${item.user_id}:${message}`, `[discordSyncQueue] ${item.user_id}: ${message}`);
    }
  }
}

const penaltyLabels = {
  warning:          'Waarschuwing',
  points_deduction: 'Puntenaftrek',
  disqualification: 'Diskwalificatie',
  time_penalty:     'Tijdstraf',
  grid_penalty:     'Gridstraf',
  race_ban:         'Race ban',
  pit_lane_start:   'Pitlane start',
};

function buildPenaltyText(type, data = {}) {
  if (!type) return 'Geen straf';
  let text = penaltyLabels[type] || type;
  if (type === 'time_penalty' && data.time_penalty_seconds) text += ` (+${data.time_penalty_seconds} sec)`;
  if (type === 'grid_penalty' && data.grid_penalty_places)  text += ` (${data.grid_penalty_places} plaatsen)`;
  if (type === 'points_deduction' && data.penalty_points > 0) text += ` (-${data.penalty_points} punten)`;
  if (type === 'points_deduction' && data.points_deduction > 0) text += ` (-${data.points_deduction} punten)`;
  if (data.race_ban_next) text += ' — volgende race gemist';
  return text;
}

function buildCategoryBadge(category) {
  const map = { A: '🔵 Cat. A — Licht', B: '🟡 Cat. B — Matig', C: '🟠 Cat. C — Ernstig', D: '🔴 Cat. D — Zwaar' };
  return category ? map[category] || `Cat. ${category}` : null;
}

// ── Cron: nieuwe protesten ────────────────────────────────────────────────────
async function checkProtests() {
  const { data, error } = await supabase
    .from('protests')
    .select('id, race_id, status, notified, created_at, decided_at, penalty_type, penalty_points, penalty_category, time_penalty_seconds, grid_penalty_places, race_ban_next, steward_notes, races(name, track), accused:profiles!protests_accused_user_id_fkey(display_name, iracing_name)')
    .order('created_at', { ascending: false })
    .limit(20);
  if (error) { await throttledBotLog(`checkProtests:${describeError(error)}`, '[checkProtests]', describeError(error)); return; }
  if (!data?.length) return;

  for (const protest of data) {
    // Nieuw protest melding (naar steward kanaal)
    const newKey = `protest_new_${protest.id}`;
    if (!wasSent(newKey, 'notified')) {
      const stewardCh = await getStewardChannel();
      if (stewardCh) {
        const btn = new ButtonBuilder()
          .setLabel('Bekijk protest')
          .setURL('https://3stripemotorsport.cc/stewards')
          .setStyle(ButtonStyle.Link);
        const row = new ActionRowBuilder().addComponents(btn);
        const msg = await stewardCh.send({ content: '⚖️ Er is een nieuw protest ingediend.', components: [row] }).catch(e => {
          throttledBotLog(`protest-new:${describeError(e)}`, `⚠️ Steward protest ping mislukt: ${describeError(e)}`);
          return null;
        });
        if (!msg) continue;
        markSent(newKey, 'notified');
      } else {
        await throttledBotLog('protest-new:no-channel', '[checkProtests] Steward kanaal niet gevonden');
        continue;
      }
      botLog(`⚖️ Nieuw protest ingediend: **${protest.races?.name}**`);
    }

    // Beslissing melding — DB kolom als bron zodat bot herstart geen duplicaat stuurt
    if ((protest.status === 'resolved' || protest.status === 'dismissed') && !protest.notified) {
      const channel = await getStewardDecisionsChannel();
      if (!channel) continue;

      const accusedName = protest.accused?.iracing_name || protest.accused?.display_name || 'Onbekend';
      const penaltyText = protest.status === 'dismissed'
        ? 'Protest afgewezen'
        : buildPenaltyText(protest.penalty_type, protest);

      const embed = new EmbedBuilder()
        .setColor(protest.status === 'dismissed' ? 0x6b7280 : 0xf97316)
        .setTitle(`⚖️ Steward Beslissing — ${protest.races?.name}`)
        .setDescription(`**${accusedName}** — ${penaltyText}`)
        .addFields({ name: '🏎️ Circuit', value: protest.races?.track || '—', inline: true });

      const catBadge = buildCategoryBadge(protest.penalty_category);
      if (catBadge) embed.addFields({ name: '📊 Categorie', value: catBadge, inline: true });
      if (protest.steward_notes) embed.addFields({ name: '📋 Motivatie', value: protest.steward_notes, inline: false });

      if (protest.penalty_type === 'grid_penalty' && protest.grid_penalty_places > 0) {
        embed.addFields({
          name: '📍 Hoe uitvoeren',
          value: `Driver start op de normale kwalificatiepositie. Bij het groene licht moeten **${protest.grid_penalty_places} rijder${protest.grid_penalty_places > 1 ? 's' : ''} worden doorgelaten** voordat de driver mag racen.\n\n⛔ Niet nakomen = automatische diskwalificatie.`,
          inline: false,
        });
      }

      if (protest.penalty_type === 'pit_lane_start') {
        embed.addFields({
          name: '📍 Hoe uitvoeren',
          value: `Driver start vanuit de **pitlane**. Wachten totdat het volledige startveld voorbij is, daarna de baan op.\n\n⛔ Niet nakomen = automatische diskwalificatie.`,
          inline: false,
        });
      }

      if (protest.race_ban_next) {
        embed.addFields({
          name: '🚫 Race ban',
          value: `Driver mag de **eerstvolgende race niet deelnemen**.\n\n⛔ Toch deelnemen = verdere maatregelen.`,
          inline: false,
        });
      }

      embed.setFooter({ text: '3 Stripe Motorsport · Stewards' }).setTimestamp();

      const msg = await channel.send({ embeds: [embed] }).catch(e => {
        botLog(`❌ Protest beslissing melding fout: ${describeError(e)}`);
        return null;
      });
      if (!msg) continue;

      const saved = await retrySupabase('[checkProtests] notified update fout', () =>
        supabase.from('protests').update({ notified: true }).eq('id', protest.id).eq('notified', false)
      );
      if (!saved) {
        await deleteSentMessage(msg, '[checkProtests]');
        continue;
      }
      botLog(`⚖️ Steward beslissing verstuurd: **${protest.races?.name}** → ${accusedName} — ${penaltyText}`);
      if (protest.status === 'resolved') {
        await refreshResultMessage(protest.race_id, 'protest_resolved');
      }
    }
  }
}

// ── Cron: steward-initiated penalties (zonder protest) ────────────────────────
async function checkStewardPenalties() {
  let data;
  let error;
  try {
    ({ data, error } = await supabase
      .from('penalties')
      .select('id, race_id, user_id, penalty_type, penalty_category, penalty_sp, time_penalty_seconds, grid_penalty_places, race_ban_next, points_deduction, steward_description, races(name, track)')
      .eq('steward_initiated', true)
      .eq('notified', false)
      .eq('revoked', false));
  } catch (e) {
    await throttledBotLog(`checkStewardPenalties:${describeError(e)}`, '[checkStewardPenalties]', describeError(e));
    return;
  }
  if (error) { await throttledBotLog(`checkStewardPenalties:${describeError(error)}`, '[checkStewardPenalties]', describeError(error)); return; }
  if (!data?.length) return;

  const channel = await getStewardDecisionsChannel();
  if (!channel) {
    await throttledBotLog('steward-penalties:no-channel', '[checkStewardPenalties] Steward decisions kanaal niet gevonden');
    return;
  }

  const profilesByUserId = await fetchProfilesByUserIds(data.map(penalty => penalty.user_id));
  const guild = await getConfiguredGuild();
  for (const penalty of data) {
    const raceName = penalty.races?.name || 'Onbekende race';

    const profile = profilesByUserId.get(penalty.user_id);
    const driverName = profileName(profile);
    const penaltyText = buildPenaltyText(penalty.penalty_type, penalty);
    const catBadge = buildCategoryBadge(penalty.penalty_category);

    const embed = new EmbedBuilder()
      .setColor(0xf97316)
      .setTitle(`⚡ Steward Actie — ${raceName}`)
      .setDescription(`**${driverName}** — ${penaltyText}`)
      .addFields({ name: '🏎️ Circuit', value: penalty.races?.track || '—', inline: true });

    if (catBadge) embed.addFields({ name: '📊 Categorie', value: catBadge, inline: true });
    if (penalty.penalty_sp > 0) embed.addFields({ name: '⚠️ Strafpunten', value: `+${penalty.penalty_sp} SP`, inline: true });
    if (penalty.steward_description) embed.addFields({ name: '📋 Motivatie', value: penalty.steward_description, inline: false });

    // Handhavingsinstructies per straf type
    if (penalty.penalty_type === 'grid_penalty' && penalty.grid_penalty_places > 0) {
      embed.addFields({
        name: '📍 Hoe uitvoeren',
        value: `Je start op je normale kwalificatiepositie. Bij het groene licht laat je **${penalty.grid_penalty_places} rijder${penalty.grid_penalty_places > 1 ? 's' : ''}** passeren voordat je mag racen.\n\n⛔ Niet nakomen = automatische diskwalificatie.`,
        inline: false,
      });
    }

    if (penalty.penalty_type === 'pit_lane_start') {
      embed.addFields({
        name: '📍 Hoe uitvoeren',
        value: `Je start vanuit de **pitlane**. Blijf in de pitlane totdat het volledige startveld voorbij is gereden, daarna mag je de baan op.\n\n⛔ Niet nakomen = automatische diskwalificatie.`,
        inline: false,
      });
    }

    if (penalty.race_ban_next) {
      embed.addFields({
        name: '🚫 Race ban',
        value: `Je mag de **eerstvolgende race niet deelnemen**. Neem geen contact op met de race organisatie hierover — de beslissing staat vast.\n\n⛔ Toch deelnemen = verdere maatregelen.`,
        inline: false,
      });
    }

    embed.setFooter({ text: '3 Stripe Motorsport · Stewards (zonder protest)' }).setTimestamp();

    const msg = await channel.send({ embeds: [embed] }).catch(e => { botLog(`❌ Steward penalty melding fout: ${describeError(e)}`); return null; });
    if (!msg) continue;

    const saved = await retrySupabase('[checkStewardPenalties] notified update fout', () =>
      supabase.from('penalties')
        .update({ notified: true, discord_message_id: msg.id })
        .eq('id', penalty.id)
        .eq('notified', false)
    );
    if (!saved) {
      await deleteSentMessage(msg, '[checkStewardPenalties]');
      continue;
    }

    // DM als driver Discord heeft gekoppeld
    if (profile?.discord_id && guild) {
      const member = await guild.members.fetch(profile.discord_id).catch(() => null);
      if (member) await member.send({ embeds: [embed] }).catch(() => {});
    }

    botLog(`⚡ Steward actie verstuurd: **${driverName}** — ${raceName} (${penaltyText})`);
    await refreshResultMessage(penalty.race_id, 'steward_penalty');
  }
}

// ── Cron: steward penalty correcties (na intrekken) ───────────────────────────
async function checkStewardCorrections() {
  const { data, error } = await supabase
    .from('penalties')
    .select('id, race_id, user_id, discord_message_id, races(name)')
    .eq('steward_initiated', true)
    .eq('revoked', true)
    .eq('notified', true)
    .eq('correction_sent', false);
  if (error) { await throttledBotLog(`checkStewardCorrections:${describeError(error)}`, '[checkStewardCorrections]', describeError(error)); return; }
  if (!data?.length) return;

  const channel = await getStewardDecisionsChannel();
  if (!channel) {
    await throttledBotLog('steward-corrections:no-channel', '[checkStewardCorrections] Steward decisions kanaal niet gevonden');
    return;
  }

  const profilesByUserId = await fetchProfilesByUserIds(data.map(penalty => penalty.user_id), 'user_id, display_name, iracing_name');
  for (const penalty of data) {
    const raceName = penalty.races?.name || 'Onbekende race';

    const profile = profilesByUserId.get(penalty.user_id);
    const driverName = profileName(profile);

    if (penalty.discord_message_id) {
      await channel.messages.delete(penalty.discord_message_id).catch(() => {});
    }

    const embed = new EmbedBuilder()
      .setColor(0x6b7280)
      .setTitle(`✏️ Correctie — ${raceName}`)
      .setDescription(`De eerder gemelde steward actie voor **${driverName}** is ingetrokken.`)
      .setFooter({ text: '3 Stripe Motorsport · Stewards' })
      .setTimestamp();
    const msg = await channel.send({ embeds: [embed] }).catch(e => {
      botLog(`❌ Steward correctie fout: ${describeError(e)}`);
      return null;
    });
    if (!msg) continue;

    const saved = await retrySupabase('[checkStewardCorrections] correction update fout', () =>
      supabase.from('penalties').update({ correction_sent: true }).eq('id', penalty.id).eq('correction_sent', false)
    );
    if (!saved) {
      await deleteSentMessage(msg, '[checkStewardCorrections]');
      continue;
    }

    botLog(`✏️ Steward correctie verstuurd: **${driverName}** — ${raceName}`);
    await refreshResultMessage(penalty.race_id, 'steward_correction');
  }
}

// ── Cron: abandon penalties ───────────────────────────────────────────────────
async function checkAbandonPenalties() {
  const { data, error } = await supabaseStep(
    '[checkAbandonPenalties]',
    supabase
      .from('penalties')
      .select('id, race_id, user_id, points_deduction, races(name)')
      .eq('source', 'abandon')
      .eq('notified', false)
      .eq('revoked', false) // nooit sturen als al ingetrokken vóór versturen
  );
  if (error) return;
  if (!data?.length) return;

  const channel = await getStewardDecisionsChannel();
  if (!channel) {
    await throttledBotLog('abandon-penalties:no-channel', '[checkAbandonPenalties] Steward decisions kanaal niet gevonden');
    return;
  }

  const profilesByUserId = await fetchProfilesByUserIds(data.map(penalty => penalty.user_id));
  const guild = await getConfiguredGuild();
  for (const penalty of data) {
    const raceName = penalty.races?.name || 'Onbekende race';
    const deduction = penalty.points_deduction || 0;

    const profile = profilesByUserId.get(penalty.user_id);
    const driverName = profileName(profile);

    const embed = new EmbedBuilder()
      .setColor(0xf97316)
      .setTitle(`⚠️ Disciplinaire maatregel — ${raceName}`)
      .setDescription(`**${driverName}**\n\nReden: Race vroegtijdig verlaten zonder geldige reden.\nStraf: -${deduction} punt${deduction !== 1 ? 'en' : ''}`)
      .addFields({ name: '⚠️ Let op', value: 'Herhaald gedrag kan leiden tot zwaardere straffen.', inline: false })
      .setFooter({ text: '3 Stripe Motorsport · Stewards' })
      .setTimestamp();

    const msg = await channel.send({ embeds: [embed] }).catch(e => { botLog(`❌ Abandon melding fout: ${describeError(e)}`); return null; });
    if (!msg) continue;

    const saved = await retrySupabase('[checkAbandonPenalties] notified update fout', () =>
      supabase.from('penalties')
        .update({ notified: true, discord_message_id: msg.id })
        .eq('id', penalty.id)
        .eq('notified', false)
    );
    if (!saved) {
      await deleteSentMessage(msg, '[checkAbandonPenalties]');
      continue;
    }

    // Stuur ook een DM als de driver Discord heeft gekoppeld
    if (profile?.discord_id && guild) {
      const member = await guild.members.fetch(profile.discord_id).catch(() => null);
      if (member) await member.send({ embeds: [embed] }).catch(() => {});
    }

    botLog(`⚠️ Abandon melding verstuurd: **${driverName}** — ${raceName} (-${deduction}pts)`);
    await refreshResultMessage(penalty.race_id, 'abandon_penalty');
  }
}

// ── Cron: abandon correcties (na misclick undo) ───────────────────────────────
async function checkAbandonCorrections() {
  const { data, error } = await supabaseStep(
    '[checkAbandonCorrections]',
    supabase
      .from('penalties')
      .select('id, race_id, user_id, discord_message_id, races(name)')
      .eq('source', 'abandon')
      .eq('revoked', true)
      .eq('notified', true)
      .eq('correction_sent', false)
  );
  if (error) return;
  if (!data?.length) return;

  const channel = await getStewardDecisionsChannel();
  if (!channel) {
    await throttledBotLog('abandon-corrections:no-channel', '[checkAbandonCorrections] Steward decisions kanaal niet gevonden');
    return;
  }

  const profilesByUserId = await fetchProfilesByUserIds(data.map(penalty => penalty.user_id), 'user_id, display_name, iracing_name');
  for (const penalty of data) {
    const raceName = penalty.races?.name || 'Onbekende race';

    const profile = profilesByUserId.get(penalty.user_id);
    const driverName = profileName(profile);

    // Verwijder origineel bericht als we het ID hebben
    if (penalty.discord_message_id) {
      await channel.messages.delete(penalty.discord_message_id).catch(() => {});
    }

    const embed = new EmbedBuilder()
      .setColor(0x6b7280)
      .setTitle(`✏️ Correctie — ${raceName}`)
      .setDescription(`De eerder gemelde disciplinaire maatregel voor **${driverName}** is ingetrokken wegens een vergissing. Onze excuses.`)
      .setFooter({ text: '3 Stripe Motorsport · Stewards' })
      .setTimestamp();
    const msg = await channel.send({ embeds: [embed] }).catch(e => {
      botLog(`❌ Correctie melding fout: ${describeError(e)}`);
      return null;
    });
    if (!msg) continue;

    const saved = await retrySupabase('[checkAbandonCorrections] correction update fout', () =>
      supabase.from('penalties').update({ correction_sent: true }).eq('id', penalty.id).eq('correction_sent', false)
    );
    if (!saved) {
      await deleteSentMessage(msg, '[checkAbandonCorrections]');
      continue;
    }

    botLog(`✏️ Correctie verstuurd: **${driverName}** — ${raceName}`);
    await refreshResultMessage(penalty.race_id, 'abandon_correction');
  }
}

// ── Cron: aankondigingen ──────────────────────────────────────────────────────
async function checkAnnouncements() {
  const { data, error } = await supabase
    .from('announcements')
    .select('*')
    .eq('sent', false)
    .order('created_at', { ascending: true });
  if (error) { await throttledBotLog(`checkAnnouncements:${describeError(error)}`, '[checkAnnouncements]', describeError(error)); return; }
  if (!data?.length) return;

  const channel = await getAankondigingenChannel();
  if (!channel) { await throttledBotLog('checkAnnouncements:no-channel', '[checkAnnouncements] Aankondigingen channel niet gevonden'); return; }

  const { data: teams, error: teamsError } = await supabase.from('teams').select('id, name, color, discord_role_id');
  if (teamsError) {
    await throttledBotLog(`checkAnnouncements:teams:${describeError(teamsError)}`, '[checkAnnouncements:teams]', describeError(teamsError));
  }

  for (const ann of data) {
    const tags = (ann.tag || 'none').split(',').map(t => t.trim()).filter(t => t && t !== 'none');
    const mentions = tags.map(tag => {
      if (tag === 'everyone') return '@everyone';
      if (tag === 'here') return '@here';
      if (tag.startsWith('team_')) {
        const teamId = tag.replace('team_', '');
        const team = teams?.find(t => t.id === teamId);
        return team?.discord_role_id ? `<@&${team.discord_role_id}>` : null;
      }
      return null;
    }).filter(Boolean);
    const mentionText = mentions.join(' ');

    // Bepaal kleur: als team-tag, gebruik teamkleur; anders oranje (3SM brand)
    let embedColor = 0xf97316;
    const teamTag = (ann.tag || '').trim();
    if (teamTag.startsWith('team_')) {
      const teamId = teamTag.replace('team_', '');
      const team = teams?.find(t => t.id === teamId);
      if (team?.color) embedColor = parseInt(team.color.replace('#', ''), 16);
    }

    const embed = {
      color: embedColor,
      title: ann.title,
      description: ann.message,
      footer: { text: '3 Stripe Motorsport' },
      timestamp: new Date().toISOString(),
    };
    if (ann.image_url) embed.image = { url: ann.image_url };

    const msg = await channel.send({ content: mentionText || undefined, embeds: [embed] }).catch(e => {
      botLog(`❌ Aankondiging send mislukt: ${describeError(e)}`);
      return null;
    });
    if (!msg) continue;

    const saved = await retrySupabase('[checkAnnouncements] sent update fout', () =>
      supabase.from('announcements').update({ sent: true }).eq('id', ann.id).eq('sent', false)
    );
    if (!saved) {
      await deleteSentMessage(msg, '[checkAnnouncements]');
      continue;
    }
    botLog(`📢 Aankondiging verstuurd: **${ann.title}**`);
  }
}

// ── Cron: team rol sync ───────────────────────────────────────────────────────
async function syncTeamRoles(ctx = {}) {
  const setStep = ctx.setStep || (() => {});
  const startedAt = Date.now();
  const stats = {
    teams: 0,
    profiles: 0,
    membersProcessed: 0,
    membersMissing: 0,
    nicknamesUpdated: 0,
    rolesAdded: 0,
    rolesRemoved: 0,
    memberErrors: 0,
  };

  setStep('config/guild laden');
  const cfg = loadConfig();
  const guild = await getConfiguredGuild();
  if (!guild) return;

  setStep('teams ophalen uit Supabase');
  const { data: teams, error: teamsError } = await supabaseStep(
    '[syncTeamRoles] teams',
    supabase.from('teams').select('id, name, color, discord_role_id, discord_category_id')
  );
  if (teamsError) return;
  if (!teams?.length) return;
  stats.teams = teams.length;

  const everyoneId = guild.roles.everyone.id;
  const managedRoleIds = new Set(cfg.managed_team_role_ids || []);
  const managedCategoryIds = new Set(cfg.managed_team_category_ids || []);

  // Maak ontbrekende team-rollen + categorie + kanalen aan
  for (const team of teams) {
    setStep(`team setup: ${team.name}`);
    const colorInt = team.color ? parseInt(team.color.replace('#', ''), 16) : 0xf97316;

    // ── Rol ──────────────────────────────────────────────────────────────────
    if (!team.discord_role_id) {
      const existing = guild.roles.cache.find(r => r.name === team.name);
      if (existing) {
        await existing.edit({ color: colorInt, hoist: true }).catch(() => {});
        await supabase.from('teams').update({ discord_role_id: existing.id }).eq('id', team.id);
        team.discord_role_id = existing.id;
        managedRoleIds.add(existing.id);
        botLog(`✅ Teamrol gevonden en bijgewerkt: **${team.name}**`);
      } else {
        try {
          const role = await guild.roles.create({ name: team.name, color: colorInt, hoist: true, mentionable: false, reason: '3SM team rol auto-aanmaak' });
          await supabase.from('teams').update({ discord_role_id: role.id }).eq('id', team.id);
          team.discord_role_id = role.id;
          managedRoleIds.add(role.id);
          botLog(`➕ Teamrol aangemaakt: **${team.name}**`);
        } catch (e) {
          botLog(`❌ Kon rol niet aanmaken voor ${team.name}: ${describeError(e)}`);
          continue;
        }
      }
    } else {
      const existing = guild.roles.cache.get(team.discord_role_id);
      if (existing) await existing.edit({ color: colorInt, hoist: true }).catch(() => {});
      managedRoleIds.add(team.discord_role_id);
    }

    // ── Categorie + kanalen ───────────────────────────────────────────────────
    if (!team.discord_role_id) continue;

    const syncCfgTeam = loadConfig();
    const permOverwrites = [
      { id: everyoneId,             deny:  [PermissionFlagsBits.ViewChannel] },
      { id: team.discord_role_id,   allow: [PermissionFlagsBits.ViewChannel] },
      ...(syncCfgTeam.admin_role_id   ? [{ id: syncCfgTeam.admin_role_id,   allow: [PermissionFlagsBits.ViewChannel] }] : []),
      ...(syncCfgTeam.steward_role_id ? [{ id: syncCfgTeam.steward_role_id, allow: [PermissionFlagsBits.ViewChannel] }] : []),
    ];

    let categoryId = team.discord_category_id;

    // Zoek altijd op ID of naam — update altijd naam + permissies
    let existingCat = categoryId
      ? guild.channels.cache.get(categoryId)
      : guild.channels.cache.find(c =>
          c.type === ChannelType.GuildCategory &&
          (c.name === team.name || c.name === `━━━━━━━| ${team.name} |━━━━━━━`)
        );

    if (existingCat) {
      categoryId = existingCat.id;
      await existingCat.edit({ name: `━━━━━━━| ${team.name} |━━━━━━━`, permissionOverwrites: permOverwrites }).catch(() => {});
    } else {
      try {
        const cat = await guild.channels.create({
          name: `━━━━━━━| ${team.name} |━━━━━━━`,
          type: ChannelType.GuildCategory,
          permissionOverwrites: permOverwrites,
          reason: '3SM team sectie',
        });
        categoryId = cat.id;
        managedCategoryIds.add(cat.id);
        botLog(`➕ Team sectie aangemaakt: **${team.name}**`);
      } catch (e) {
        botLog(`❌ Kon sectie niet aanmaken voor ${team.name}: ${describeError(e)}`);
        continue;
      }
    }

    if (categoryId !== team.discord_category_id) {
      await supabase.from('teams').update({ discord_category_id: categoryId }).eq('id', team.id);
      team.discord_category_id = categoryId;
    }
    if (categoryId) managedCategoryIds.add(categoryId);

    // Maak ontbrekende kanalen aan binnen de team-categorie
    const teamChannels = [
      { name: '💬・team-chat',        type: ChannelType.GuildText  },
      { name: '🏁・race-lobby',        type: ChannelType.GuildVoice },
      { name: '🏎️・endurance-lobby',  type: ChannelType.GuildVoice },
      { name: '🔧・pit-wall',          type: ChannelType.GuildVoice },
    ];

    for (const chDef of teamChannels) {
      const exists = guild.channels.cache.find(c => c.name === chDef.name && c.parentId === categoryId);
      if (exists) {
        // Update permissies van bestaande kanalen
        await exists.permissionOverwrites.set(permOverwrites).catch(() => {});
      } else {
        await guild.channels.create({
          name: chDef.name,
          type: chDef.type,
          parent: categoryId,
          permissionOverwrites: permOverwrites,
          reason: '3SM team kanaal',
        }).catch(e => botLog(`❌ Kanaal aanmaken fout (${chDef.name}): ${describeError(e)}`));
      }
    }
  }

  // Verwijder Discord rollen + categorie + kanalen van verwijderde teams
  setStep('oude teamrollen opruimen');
  const teamRoleIds     = teams.map(t => t.discord_role_id).filter(Boolean);
  const teamCategoryIds = teams.map(t => t.discord_category_id).filter(Boolean);
  for (const [roleId, role] of guild.roles.cache) {
    if (managedRoleIds.has(roleId) && !teamRoleIds.includes(role.id)) {
      const wasTeamRole = await supabase.from('teams').select('id').eq('discord_role_id', role.id).maybeSingle();
      if (!wasTeamRole.data) {
        const deleted = await role.delete('3SM team verwijderd').then(() => true).catch(e => {
          botLog(`❌ Teamrol verwijderen fout (${role.name}): ${describeError(e)}`);
          return false;
        });
        if (!deleted) continue;
        managedRoleIds.delete(role.id);
        botLog(`🗑️ Teamrol verwijderd: **${role.name}**`);
      }
    }
  }

  for (const [categoryId, ch] of guild.channels.cache) {
    if (managedCategoryIds.has(categoryId) && ch.type === ChannelType.GuildCategory && !teamCategoryIds.includes(ch.id)) {
      const wasTeamCat = await supabase.from('teams').select('id').eq('discord_category_id', ch.id).maybeSingle();
      if (wasTeamCat.data === null && ch.name.includes('━━━') && !ch.name.includes('INFORMATIE') && !ch.name.includes('RACING') && !ch.name.includes('COMMUNITY') && !ch.name.includes('SPRAAK') && !ch.name.includes('ADMIN')) {
        // Verwijder eerst alle kanalen in de categorie
        for (const [, child] of guild.channels.cache) {
          if (child.parentId === ch.id) await child.delete('3SM team verwijderd').catch(() => {});
        }
        const deleted = await ch.delete('3SM team verwijderd').then(() => true).catch(e => {
          botLog(`❌ Team sectie verwijderen fout (${ch.name}): ${describeError(e)}`);
          return false;
        });
        if (!deleted) continue;
        managedCategoryIds.delete(ch.id);
        botLog(`🗑️ Team sectie verwijderd: **${ch.name}**`);
      }
    }
  }

  saveConfig({
    managed_team_role_ids: [...managedRoleIds].filter(id => teamRoleIds.includes(id)),
    managed_team_category_ids: [...managedCategoryIds].filter(id => teamCategoryIds.includes(id)),
  });

  // Sync Discord-rollen voor alle gekoppelde leden
  setStep('profiles ophalen uit Supabase');
  const { data: profiles, error: profilesError } = await supabaseStep(
    '[syncTeamRoles] profiles',
    supabase
      .from('profiles').select('user_id, discord_id, iracing_name, display_name')
      .not('discord_id', 'is', null)
  );
  if (profilesError) return;

  if (!profiles?.length) return;
  stats.profiles = profiles.length;

  setStep('team memberships ophalen uit Supabase');
  const { data: memberships, error: membershipsError } = await supabaseStep(
    '[syncTeamRoles] memberships',
    supabase.from('team_memberships').select('user_id, team_id')
  );
  if (membershipsError) return;

  setStep('admin/steward rollen ophalen uit Supabase');
  const { data: adminRoles, error: adminRolesError } = await supabaseStep(
    '[syncTeamRoles] user_roles',
    supabase
      .from('user_roles').select('user_id, role')
      .in('role', ['admin', 'super_admin', 'moderator'])
  );
  if (adminRolesError) return;

  const syncCfg = loadConfig();
  const teamsById = new Map(teams.map(team => [team.id, team]));
  const membershipsByUserId = new Map();
  for (const membership of memberships || []) {
    const current = membershipsByUserId.get(membership.user_id) || [];
    current.push(membership);
    membershipsByUserId.set(membership.user_id, current);
  }
  const rolesByUserId = new Map();
  for (const role of adminRoles || []) {
    const current = rolesByUserId.get(role.user_id) || [];
    current.push(role.role);
    rolesByUserId.set(role.user_id, current);
  }

  for (const profile of profiles) {
    try {
      setStep(`Discord lid ophalen: ${profile.display_name || profile.iracing_name || profile.discord_id}`);
      const member = await guild.members.fetch(profile.discord_id).catch(() => null);
      if (!member) {
        stats.membersMissing += 1;
        continue;
      }
      stats.membersProcessed += 1;

      // Nickname instellen op iRacing naam (of display_name als fallback)
      const nickname = profile.iracing_name || profile.display_name;
      if (nickname && member.displayName !== nickname) {
        const result = await member.setNickname(nickname).catch(e => e);
        if (result instanceof Error) {
          if (result.message !== 'Missing Permissions') console.error(`[syncTeamRoles] Nickname fout voor ${member.user.tag}: ${result.message}`);
        } else {
          stats.nicknamesUpdated += 1;
          console.log(`[syncTeamRoles] Nickname gezet: ${member.user.tag} → ${nickname}`);
        }
      }

      // Team rollen
      const userTeams = membershipsByUserId.get(profile.user_id) || [];
      const expectedRoleIds = userTeams.map(m => teamsById.get(m.team_id)?.discord_role_id).filter(Boolean);

      for (const team of teams) {
        if (!team.discord_role_id) continue;
        const shouldHave = expectedRoleIds.includes(team.discord_role_id);
        const hasIt = member.roles.cache.has(team.discord_role_id);
        if (shouldHave && !hasIt) {
          const updated = await member.roles.add(team.discord_role_id).then(() => true).catch(() => false);
          if (updated) stats.rolesAdded += 1;
        }
        if (!shouldHave && hasIt) {
          const updated = await member.roles.remove(team.discord_role_id).then(() => true).catch(() => false);
          if (updated) stats.rolesRemoved += 1;
        }
      }

      // Admin rol sync
      if (syncCfg.admin_role_id) {
        const userRoles = rolesByUserId.get(profile.user_id) || [];
        const isAdmin = userRoles.some(role => ['admin', 'super_admin'].includes(role));
        const hasAdminRole = member.roles.cache.has(syncCfg.admin_role_id);
        if (isAdmin && !hasAdminRole) {
          const updated = await member.roles.add(syncCfg.admin_role_id).then(() => true).catch(() => false);
          if (updated) stats.rolesAdded += 1;
        }
        if (!isAdmin && hasAdminRole) {
          const updated = await member.roles.remove(syncCfg.admin_role_id).then(() => true).catch(() => false);
          if (updated) stats.rolesRemoved += 1;
        }
      }

      // Steward rol sync
      if (syncCfg.steward_role_id) {
        const userRoles = rolesByUserId.get(profile.user_id) || [];
        const isSteward = userRoles.includes('moderator');
        const hasStewardRole = member.roles.cache.has(syncCfg.steward_role_id);
        if (isSteward && !hasStewardRole) {
          const updated = await member.roles.add(syncCfg.steward_role_id).then(() => true).catch(() => false);
          if (updated) stats.rolesAdded += 1;
        }
        if (!isSteward && hasStewardRole) {
          const updated = await member.roles.remove(syncCfg.steward_role_id).then(() => true).catch(() => false);
          if (updated) stats.rolesRemoved += 1;
        }
      }
    } catch (e) {
      stats.memberErrors += 1;
      botLog('[syncTeamRoles] lid fout:', describeError(e));
    }
  }

  setStep('klaar');
  const summary = `[syncTeamRoles] klaar in ${formatDuration(Date.now() - startedAt)}: teams=${stats.teams}, profiles=${stats.profiles}, verwerkt=${stats.membersProcessed}, niet_gevonden=${stats.membersMissing}, nicknames=${stats.nicknamesUpdated}, rollen_plus=${stats.rolesAdded}, rollen_min=${stats.rolesRemoved}, fouten=${stats.memberErrors}`;
  if (stats.memberErrors) {
    await botLog(summary);
  } else if (stats.nicknamesUpdated || stats.rolesAdded || stats.rolesRemoved || Date.now() - startedAt > 60_000) {
    console.log(summary);
  }
}

// ── guildMemberAdd: Rijder rol + team rollen ──────────────────────────────────
const MIN_ACCOUNT_AGE_DAYS = 7;

client.on('guildMemberAdd', async (member) => {
  const cfg = loadConfig();

  // Account leeftijd check — kick als jonger dan 7 dagen
  const accountAgeDays = (Date.now() - member.user.createdTimestamp) / (1000 * 60 * 60 * 24);
  if (accountAgeDays < MIN_ACCOUNT_AGE_DAYS) {
    try {
      await member.send(`❌ Je Discord account is te nieuw om deze server te joinen. Accounts moeten minimaal **${MIN_ACCOUNT_AGE_DAYS} dagen** oud zijn.`).catch(() => {});
      await member.kick(`Account te nieuw (${Math.floor(accountAgeDays)} dagen oud)`);
      botLog(`🚫 Gekickt: **${member.user.tag}** — account slechts ${Math.floor(accountAgeDays)} dagen oud`);
    } catch (e) {
      botLog('[guildMemberAdd] Kick fout:', describeError(e));
    }
    return;
  }

  if (!cfg.rijder_role_id) return;

  botLog(`👋 Nieuw lid: **${member.user.tag}** (account ${Math.floor(accountAgeDays)} dagen oud)`);

  try {
    await member.roles.add(cfg.rijder_role_id);
  } catch (e) {
    botLog(`❌ Rijder rol fout voor ${member.user.tag}: ${describeError(e)}`);
  }

  try {
    // Geef ook team-rollen als discord al gekoppeld is
    const { data: profile } = await supabase
      .from('profiles').select('user_id, iracing_name, display_name').eq('discord_id', member.user.id).maybeSingle();

    if (profile) {
      const nickname = profile.iracing_name || profile.display_name;
      if (nickname) await member.setNickname(nickname).catch(() => {});
    }
    if (!profile) return;

    const { data: memberships } = await supabase
      .from('team_memberships').select('team_id').eq('user_id', profile.user_id);
    if (!memberships?.length) return;

    const teamIds = memberships.map(m => m.team_id);
    const { data: teams } = await supabase
      .from('teams').select('discord_role_id').in('id', teamIds);

    for (const team of teams || []) {
      if (team.discord_role_id) {
        await member.roles.add(team.discord_role_id).catch(() => {});
      }
    }
  } catch (e) {
    botLog('[guildMemberAdd] Teamrollen koppelen fout:', describeError(e));
  }
});

// ── /setup-server ─────────────────────────────────────────────────────────────
async function handleSetupServer(interaction) {
  await interaction.deferReply({ flags: 64 });
  const guild = interaction.guild;
  const log = (msg) => console.log(`[setup] ${msg}`);

  // Helper: zoek bestaande rol op naam, anders aanmaken
  async function getOrCreateRole(name, options) {
    const existing = guild.roles.cache.find(r => r.name === name);
    if (existing) { log(`Rol bestaat al: ${name}`); return existing; }
    const role = await guild.roles.create({ name, ...options, reason: '3SM setup' });
    log(`Rol aangemaakt: ${name}`);
    return role;
  }

  // Helper: zoek bestaande categorie op naam, anders aanmaken
  async function getOrCreateCategory(name, overwrites) {
    const existing = guild.channels.cache.find(c => c.type === ChannelType.GuildCategory && c.name === name);
    if (existing) { log(`Categorie bestaat al: ${name}`); return existing; }
    const cat = await guild.channels.create({ name, type: ChannelType.GuildCategory, permissionOverwrites: overwrites, reason: '3SM setup' });
    log(`Categorie aangemaakt: ${name}`);
    return cat;
  }

  // Helper: zoek bestaand kanaal op naam, anders aanmaken
  async function getOrCreateChannel(name, type, parentId, overwrites) {
    const existing = guild.channels.cache.find(c => c.name === name && c.parentId === parentId);
    if (existing) { log(`Kanaal bestaat al: ${name}`); return existing; }
    const ch = await guild.channels.create({ name, type, parent: parentId, permissionOverwrites: overwrites, reason: '3SM setup' });
    log(`Kanaal aangemaakt: ${name}`);
    return ch;
  }

  // Guild_id direct opslaan zodat syncTeamRoles de juiste server pakt
  saveConfig({ guild_id: guild.id });

  const resolvedChannels = {};
  const resolvedRoles    = {};

  // ── Rollen ────────────────────────────────────────────────────────────────
  const ROLE_DEFS = [
    { key: 'admin_role',   name: 'Admin',   color: 0xef4444, hoist: true },
    { key: 'steward_role', name: 'Steward', color: 0xf97316, hoist: true },
    { key: 'rijder_role',  name: 'Rijder',  color: 0x3b82f6, hoist: true },
  ];
  for (const def of ROLE_DEFS) {
    const role = await getOrCreateRole(def.name, { color: def.color, hoist: def.hoist });
    resolvedRoles[def.key] = role.id;
  }

  // ── Structuur ─────────────────────────────────────────────────────────────
  const STRUCTURE = [
    {
      label: '📢 INFORMATIE',
      channels: [
        { key: 'welkom',         name: '👋・welkom',          type: ChannelType.GuildText },
        { key: 'aankondigingen', name: '📣・aankondigingen',  type: ChannelType.GuildText },
        { key: 'reglement',      name: '📋・reglement',       type: ChannelType.GuildText },
      ],
    },
    {
      label: '🏎️ RACING',
      channels: [
        { key: 'meldingen',       name: '🔔・meldingen',       type: ChannelType.GuildText },
        { key: 'uitslagen',       name: '🏆・uitslagen',       type: ChannelType.GuildText },
        { key: 'kalender',        name: '📅・kalender',        type: ChannelType.GuildText },
        { key: 'livery_showcase', name: '🎨・livery-showcase', type: ChannelType.GuildForum },
        { key: 'racelaps',        name: '🏎️・racelaps',        type: ChannelType.GuildText },
      ],
    },
    {
      label: '💬 COMMUNITY',
      channels: [
        { key: 'algemeen',   name: '💬・algemeen',   type: ChannelType.GuildText },
        { key: 'setup_hulp', name: '🔧・setup-hulp', type: ChannelType.GuildText },
        { key: 'media',      name: '📸・media',      type: ChannelType.GuildText },
      ],
    },
    {
      label: '🎙️ ALGEMEEN SPRAAK',
      channels: [
        { key: 'race_lobby',      name: '🏁・race-lobby',      type: ChannelType.GuildVoice },
        { key: 'endurance_lobby', name: '🏎️・endurance-lobby', type: ChannelType.GuildVoice },
        { key: 'pit_wall',        name: '🔧・pit-wall',        type: ChannelType.GuildVoice },
        { key: 'algemeen_spraak', name: '💬・algemeen-spraak', type: ChannelType.GuildVoice },
      ],
    },
    {
      label: '🔒 ADMIN',
      channels: [
        { key: 'admin_chat',    name: '💼・admin-chat',    type: ChannelType.GuildText },
        { key: 'steward_chat',  name: '⚖️・steward-chat',  type: ChannelType.GuildText },
        { key: 'bot_logs',      name: '🤖・bot-logs',      type: ChannelType.GuildText },
      ],
    },
  ];

  // Bot krijgt altijd toegang tot bot-logs
  const botMember = await guild.members.fetchMe().catch(() => null);
  const botRoleId = botMember?.roles.botRole?.id;

  for (const section of STRUCTURE) {
    const separatorName = `━━━━━━━| ${section.label} |━━━━━━━`;
    const category = await getOrCreateCategory(separatorName, []);

    for (const chDef of section.channels) {
      let overwrites = [];
      if (chDef.key === 'bot_logs' && botRoleId) {
        overwrites = [{ id: botRoleId, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages] }];
      } else if (chDef.key === 'steward_chat') {
        // Alleen admin + steward + bot
        overwrites = [
          { id: guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
          ...(resolvedRoles.admin_role   ? [{ id: resolvedRoles.admin_role,   allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages] }] : []),
          ...(resolvedRoles.steward_role ? [{ id: resolvedRoles.steward_role, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages] }] : []),
          ...(botRoleId                  ? [{ id: botRoleId,                  allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages] }] : []),
        ];
      }
      const ch = await getOrCreateChannel(chDef.name, chDef.type, category.id, overwrites);
      resolvedChannels[chDef.key] = ch.id;
    }
  }

  // Sla config op
  saveConfig({
    guild_id:                   guild.id,
    meldingen_channel_id:       resolvedChannels.meldingen,
    uitslagen_channel_id:       resolvedChannels.uitslagen,
    kalender_channel_id:        resolvedChannels.kalender,
    welkom_channel_id:          resolvedChannels.welkom,
    aankondigingen_channel_id:   resolvedChannels.aankondigingen,
    bot_logs_channel_id:        resolvedChannels.bot_logs,
    steward_decisions_channel_id: resolvedChannels.steward_chat,
    rijder_role_id:             resolvedRoles.rijder_role,
    admin_role_id:              resolvedRoles.admin_role,
    steward_role_id:            resolvedRoles.steward_role,
  });

  // ── Reglement embed (alleen sturen als kanaal leeg is) ───────────────────
  const regelementCh = await client.channels.fetch(resolvedChannels.reglement).catch(() => null);
  if (regelementCh) {
    const messages = await regelementCh.messages.fetch({ limit: 1 });
    if (messages.size === 0) {
      const regelementEmbed = new EmbedBuilder()
        .setColor(0xf97316)
        .setTitle('📋  3 Stripe Motorsport — Serverregels')
        .setDescription('Welkom bij **3 Stripe Motorsport**. Dit is een community voor simracers die houden van competitie, respect en plezier.\nDoor deel te nemen aan deze Discord ga je akkoord met onderstaande regels.')
        .addFields(
          { name: '📜 1. Algemeen gedrag', value: '• Behandel iedereen met respect.\n• Geen haatdragend, racistisch of discriminerend gedrag.\n• Geen toxic gedrag (onnodig schelden, rage, provoceren).\n• Discussies mogen, maar houd het normaal.', inline: false },
          { name: '🚫 2. Verboden content', value: '• Geen spam of self-promo zonder toestemming.\n• Geen NSFW content.\n• Geen illegale content of cheats/hacks.\n• Geen misleidende info verspreiden.', inline: false },
          { name: '🎙️ 3. Voice chat regels', value: '• Geen geschreeuw of mic spam.\n• Gebruik push-to-talk als je veel achtergrondgeluid hebt.\n• Respecteer racers tijdens races (geen onnodig praten in race voice).', inline: false },
          { name: '🏎️ 4. Racing etiquette', value: '• Clean racing staat centraal.\n• Geen intentional wrecking of brake checks.\n• Geef positie terug bij unfair voordeel.\n• Respecteer blue flags en snellere rijders.\n• Incidenten? Meld via de juiste kanalen, niet in chat ruzie maken.', inline: false },
          { name: '📅 5. League & deelname', value: '• Zorg dat je op tijd bent voor races.\n• Meld je af als je niet kunt.\n• Admins beslissen bij conflicten.\n• Beslissingen van stewards zijn leidend.', inline: false },
          { name: '🛠️ 6. Discord gebruik', value: '• Gebruik kanalen waarvoor ze bedoeld zijn.\n• Geen onnodige ping spam (@everyone / @here).\n• Volg instructies van staff altijd op.', inline: false },
          { name: '👮 7. Staff & handhaving', value: '• Staff heeft altijd het laatste woord.\n• Overtredingen kunnen leiden tot:\n  → Waarschuwing → Mute → Kick → Ban', inline: false },
          { name: '🔒 8. Account & veiligheid', value: '• Gebruik geen alt accounts om bans te omzeilen.\n• Houd je account veilig (niet delen).', inline: false },
          { name: '⚠️ 9. Aanvullingen', value: '• Regels kunnen aangepast worden.\n• Onvoorziene situaties worden door staff beoordeeld.', inline: false },
          { name: '✅ Akkoord', value: 'Door in deze server te blijven ga je akkoord met deze regels.', inline: false },
        )
        .setFooter({ text: '3 Stripe Motorsport' })
        .setTimestamp();
      await regelementCh.send({ embeds: [regelementEmbed] });
      log('Reglement embed geplaatst');
    } else {
      log('Reglement embed al aanwezig, overgeslagen');
    }
  }

  // ── Welkom embed (alleen sturen als kanaal leeg is) ───────────────────────
  const welkomCh = await client.channels.fetch(resolvedChannels.welkom).catch(() => null);
  if (welkomCh) {
    const messages = await welkomCh.messages.fetch({ limit: 1 });
    if (messages.size === 0) {
      const welcomeEmbed = new EmbedBuilder()
        .setColor(0x3b82f6)
        .setTitle('👋  Welkom bij 3 Stripe Motorsport!')
        .setDescription('Fijn dat je er bent! Hier vind je alles over onze iRacing league.')
        .addFields(
          { name: '🏎️ Races bekijken',    value: 'Typ `/races` om aankomende races te zien en je aan te melden.', inline: false },
          { name: '🔗 Account koppelen',  value: `Koppel je Discord aan je 3SM account:\n1. Maak een account aan op **3stripemotorsport.cc**\n2. Typ \`/koppel\` hier in Discord\n3. De bot stuurt je een persoonlijke link\n4. Open de link en log in — koppeling is automatisch klaar!\n\nJe krijgt daarna automatisch je teamrol en nickname.`, inline: false },
          { name: '📋 Reglement',         value: `Lees het reglement in <#${resolvedChannels.reglement}> voordat je meedoet.`, inline: false },
          { name: '❓ Hulp nodig?',       value: `Stel je vraag in <#${resolvedChannels.setup_hulp}>.`, inline: false },
        )
        .setFooter({ text: '3 Stripe Motorsport' })
        .setTimestamp();
      await welkomCh.send({ embeds: [welcomeEmbed] });
      log('Welkom embed geplaatst');
    } else {
      log('Welkom embed al aanwezig, overgeslagen');
    }
  }

  // ── Kalender + team rollen ────────────────────────────────────────────────
  await updateCalendarEmbed().catch(e => log('Kalender fout: ' + describeError(e)));
  await syncTeamRoles().catch(e => log('Sync fout: ' + describeError(e)));

  botLog(`🛠️ \`/setup-server\` uitgevoerd door **${interaction.user.tag}**`);

  await interaction.editReply({
    content: `✅ **Server opgezet!**\n\nKanalen en rollen zijn aangemaakt (bestaande zijn hergebruikt).\n\nJe kan \`/setup-server\` veilig opnieuw uitvoeren — er wordt nooit iets verwijderd.`,
  }).catch(() => {});
}

// ── Slash commands ────────────────────────────────────────────────────────────
const COMMANDS = [
  new SlashCommandBuilder()
    .setName('koppel')
    .setDescription('Koppel je Discord account aan je 3SM profiel (stuur je een link)'),
  new SlashCommandBuilder()
    .setName('races')
    .setDescription('Bekijk aankomende races en meld je aan'),
  new SlashCommandBuilder()
    .setName('site')
    .setDescription('Toon de link naar de 3SM website'),
  new SlashCommandBuilder()
    .setName('aanmelden')
    .setDescription('Meld je aan voor de eerstvolgende race'),
  new SlashCommandBuilder()
    .setName('afmelden')
    .setDescription('Meld je af voor de eerstvolgende race'),
  new SlashCommandBuilder()
    .setName('setup-server')
    .setDescription('Maak de volledige 3SM serverstructuur aan (alleen voor admins)')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
  new SlashCommandBuilder()
    .setName('setprofile')
    .setDescription('Maak of update een streamer-profiel voor live meldingen')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addStringOption(option => option
      .setName('profiel_naam')
      .setDescription('Naam van het streamer-profiel')
      .setRequired(true)
      .setAutocomplete(true))
    .addChannelOption(option => option
      .setName('kanaal')
      .setDescription('Discord kanaal voor live meldingen (standaard live-kanaal)')
      .addChannelTypes(ChannelType.GuildText)
      .setRequired(false))
    .addStringOption(option => option
      .setName('twitch_naam')
      .setDescription('Twitch gebruikersnaam')
      .setRequired(false))
    .addStringOption(option => option
      .setName('kick_naam')
      .setDescription('Kick gebruikersnaam')
      .setRequired(false))
    .addStringOption(option => option
      .setName('youtube_id')
      .setDescription('YouTube channel ID')
      .setRequired(false)),
  new SlashCommandBuilder()
    .setName('deleteprofile')
    .setDescription('Verwijder een streamer-profiel')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addStringOption(option => option
      .setName('profiel_naam')
      .setDescription('Naam van het streamer-profiel')
      .setRequired(true)
      .setAutocomplete(true)),
  new SlashCommandBuilder()
    .setName('invite')
    .setDescription('Genereer een Discord invite link voor de 3SM server'),
].map(c => c.toJSON());

async function registerCommands(guildId) {
  const rest = new REST().setToken(DISCORD_BOT_TOKEN);
  try {
    await rest.put(Routes.applicationGuildCommands(client.application.id, guildId), { body: COMMANDS });
    console.log('[3SM Bot] Slash commands geregistreerd');
  } catch (e) { botLog('[3SM Bot] Commands registreren mislukt:', describeError(e)); }
}

async function requireDiscordAdmin(interaction) {
  if (interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)) return true;

  const response = { content: '❌ Alleen Discord admins kunnen dit commando gebruiken.', flags: 64 };
  if (interaction.deferred || interaction.replied) {
    await interaction.followUp(response).catch(() => {});
  } else {
    await interaction.reply(response).catch(() => {});
  }
  await botLog(`🚫 Admin-command geweigerd voor **${interaction.user?.tag || interaction.user?.id || 'onbekend'}**: ${interaction.commandName}`);
  return false;
}

// ── Interaction handler ───────────────────────────────────────────────────────
client.on('interactionCreate', async (interaction) => {
  try {
    if (interaction.isAutocomplete()) {
      if (['setprofile', 'deleteprofile'].includes(interaction.commandName)) {
        if (!interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)) {
          await interaction.respond([]).catch(() => {});
          return;
        }
        const focused = interaction.options.getFocused();
        const profiles = readStreamerProfiles(STREAMERS_FILE);
        await interaction.respond(profileAutocompleteChoices(profiles, focused));
      }
    } else if (interaction.isChatInputCommand()) {
      switch (interaction.commandName) {
        case 'koppel':
          await handleKoppel(interaction);
          break;
        case 'races':
          await handleRaces(interaction);
          break;
        case 'site':
          await handleSite(interaction);
          break;
        case 'aanmelden':
          await handleRegister(interaction, 'register');
          break;
        case 'afmelden':
          await handleRegister(interaction, 'unregister');
          break;
        case 'setup-server':
          if (!(await requireDiscordAdmin(interaction))) break;
          await handleSetupServer(interaction);
          break;
        case 'setprofile':
          if (!(await requireDiscordAdmin(interaction))) break;
          await handleSetProfile(interaction);
          break;
        case 'deleteprofile':
          if (!(await requireDiscordAdmin(interaction))) break;
          await handleDeleteProfile(interaction);
          break;
        case 'invite':
          await handleInvite(interaction);
          break;
      }
    } else if (interaction.isButton()) {
      const [action, raceId] = interaction.customId.split('_');
      if (action === 'aanmelden') await handleButtonReg(interaction, raceId, 'register');
      else if (action === 'afmelden')  await handleButtonReg(interaction, raceId, 'unregister');
    }
  } catch (e) { botLog('[interaction]', describeError(e)); }
});

// /setprofile → streamer-profiel aanmaken/updaten
async function handleSetProfile(interaction) {
  const profiles = readStreamerProfiles(STREAMERS_FILE);
  const channel = interaction.options.getChannel('kanaal');
  const input = {
    profiel_naam: interaction.options.getString('profiel_naam', true),
    kanaal: channel?.id || undefined,
    twitch_naam: interaction.options.getString('twitch_naam') || undefined,
    kick_naam: interaction.options.getString('kick_naam') || undefined,
    youtube_id: interaction.options.getString('youtube_id') || undefined,
  };

  try {
    const result = upsertStreamerProfile(profiles, input);
    writeStreamerProfiles(STREAMERS_FILE, result.profiles);
    await ensureLiveChannelPermissions(interaction.guild, result.profile.kanaal).catch(() => {});

    const platforms = [
      result.profile.twitch_naam ? `Twitch: ${result.profile.twitch_naam}` : null,
      result.profile.kick_naam ? `Kick: ${result.profile.kick_naam}` : null,
      result.profile.youtube_id ? `YouTube: ${result.profile.youtube_id}` : null,
    ].filter(Boolean).join('\n');

    return interaction.reply({
      content: `${result.created ? '✅ Profiel aangemaakt' : '✅ Profiel bijgewerkt'}: **${result.profile.profiel_naam}**\nKanaal: ${result.profile.kanaal ? `<#${result.profile.kanaal}>` : 'standaard live-kanaal'}\n${platforms}`,
      flags: 64,
    });
  } catch (e) {
    return interaction.reply({ content: `❌ ${describeError(e)}`, flags: 64 });
  }
}

// /deleteprofile → streamer-profiel verwijderen
async function handleDeleteProfile(interaction) {
  const profiles = readStreamerProfiles(STREAMERS_FILE);
  const profielNaam = interaction.options.getString('profiel_naam', true);
  const result = deleteStreamerProfile(profiles, profielNaam);
  if (!result.deleted) {
    return interaction.reply({ content: `❌ Profiel **${profielNaam}** niet gevonden.`, flags: 64 });
  }

  writeStreamerProfiles(STREAMERS_FILE, result.profiles);
  active_notifications.delete(profielNaam.trim().toLowerCase());
  return interaction.reply({ content: `✅ Profiel **${profielNaam}** verwijderd.`, flags: 64 });
}

// /site
async function handleSite(interaction) {
  const url = SITE_URL || 'https://3stripemotorsport.cc';
  return interaction.reply({
    content: `**3 Stripe Motorsport website**\n${url}/`,
  });
}

// /invite → Discord invite link
async function handleInvite(interaction) {
  try {
    const guild = interaction.guild;
    if (!guild) {
      return interaction.reply({ content: '❌ Dit commando werkt alleen in een server.', flags: 64 });
    }

    // Gebruik systemChannel (algemeen) als die bestaat, anders guild's standaardkanaal
    const channel = guild.systemChannel || guild.channels.cache.find(
      c => c.type === 0 && c.permissionsFor(client.user.id)?.has(PermissionFlagsBits.CreateInstantInvite)
    );

    if (!channel) {
      return interaction.reply({ content: '❌ Geen geschikt kanaal gevonden om een invite voor te maken.', flags: 64 });
    }

    const invite = await channel.createInvite({
      maxAge: 0,          // nooit verlopend
      maxUses: 0,         // onbeperkt gebruik
      reason: 'Aangemaakt via /invite commando',
    });

    botLog(`🔗 Invite link gegenereerd door **${interaction.user.tag}**: ${invite.url}`);
    return interaction.reply({
      content: `**3 Stripe Motorsport** — nodig vrienden uit!\n${invite.url}\n\n> Invite is permanent geldig.`,
    });
  } catch (e) {
    await throttledBotLog(`invite:${describeError(e)}`, '[invite]', describeError(e));
    return interaction.reply({ content: `❌ Kon geen invite aanmaken. Check of de bot permissie heeft in het kanaal.`, flags: 64 });
  }
}

// /koppel → magic link
async function handleKoppel(interaction) {
  const discordId  = interaction.user.id;
  const discordTag = interaction.user.tag;

  // Maak een token aan in Supabase
  const { data, error } = await supabase
    .from('discord_link_tokens')
    .insert({ discord_id: discordId, discord_tag: discordTag })
    .select('token')
    .single();

  if (error || !data?.token) {
    if (error) await throttledBotLog(`koppel:${describeError(error)}`, '[koppel]', describeError(error));
    return interaction.reply({ content: '❌ Er ging iets mis bij het aanmaken van de koppellink. Probeer het opnieuw.', flags: 64 });
  }

  const link = `${SITE_URL}/koppel?token=${data.token}`;
  botLog(`🔗 Koppellink aangevraagd door **${discordTag}**`);

  return interaction.reply({
    content: `🔗 **Koppel je account**\n\nKlik op onderstaande link om je Discord te koppelen aan je 3SM profiel. De link is **30 minuten** geldig.\n\n${link}\n\n> Je moet ingelogd zijn op de site om de koppeling te voltooien.`,
    flags: 64,
  });
}

// /races
async function handleRaces(interaction) {
  const discordId = interaction.user.id;

  const { data: races, error: racesError } = await supabase
    .from('races').select('id, name, track, round, race_date')
    .eq('status', 'upcoming').gte('race_date', new Date().toISOString())
    .order('race_date', { ascending: true }).limit(5);
  if (racesError) {
    await throttledBotLog(`races-command:${describeError(racesError)}`, '[races]', describeError(racesError));
    return interaction.reply({ content: '❌ Races konden niet worden opgehaald. Probeer het later opnieuw.', flags: 64 });
  }

  if (!races?.length) {
    return interaction.reply({ content: 'Geen aankomende races gevonden.', flags: 64 });
  }

  const next = races[0];
  const nextRonde = next.round != null ? `R${next.round} — ${next.name}` : next.name;

  const { data: profile, error: profileError } = await supabase
    .from('profiles').select('user_id').eq('discord_id', discordId).maybeSingle();
  if (profileError) {
    await throttledBotLog(`races-profile:${describeError(profileError)}`, '[races:profile]', describeError(profileError));
  }

  let isRegistered = false;
  if (profile && !profileError) {
    const { data: raceReg, error: raceRegError } = await supabase
      .from('race_registrations').select('id')
      .eq('race_id', next.id).eq('user_id', profile.user_id).maybeSingle();
    if (raceRegError) await throttledBotLog(`races-registration:${describeError(raceRegError)}`, '[races:registration]', describeError(raceRegError));

    if (raceReg) {
      isRegistered = true;
    } else if (!raceRegError) {
      const { data: race, error: raceError } = await supabase
        .from('races').select('league_id').eq('id', next.id).maybeSingle();
      if (raceError) await throttledBotLog(`races-league:${describeError(raceError)}`, '[races:league]', describeError(raceError));
      if (race?.league_id && !raceError) {
        const { data: seasonReg, error: seasonRegError } = await supabase
          .from('season_registrations').select('id')
          .eq('league_id', race.league_id).eq('user_id', profile.user_id).maybeSingle();
        if (seasonRegError) await throttledBotLog(`races-season:${describeError(seasonRegError)}`, '[races:season]', describeError(seasonRegError));
        isRegistered = !!seasonReg;
      }
    }
  }

  const statusLine = isRegistered
    ? `\n\n✅ **Je bent aangemeld voor ${nextRonde}**`
    : profile ? `\n\n⬜ Je bent nog niet aangemeld voor ${nextRonde}` : '';

  const embed = new EmbedBuilder()
    .setColor(isRegistered ? 0x22c55e : 0xf97316)
    .setTitle('🏁  Aankomende Races')
    .setDescription(races.map((r, i) => {
      const ronde  = r.round != null ? `R${r.round} · ` : '';
      const prefix = i === 0 ? '**→ ' : '';
      const suffix = i === 0 ? '** *(eerstvolgende)*' : '';
      return `${prefix}${ronde}${r.name}${suffix}\n🏎️ ${r.track} · ${fmtDate(r.race_date)} ${fmtTime(r.race_date)}`;
    }).join('\n\n') + statusLine)
    .setFooter({ text: '3 Stripe Motorsport' });

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`aanmelden_${next.id}`)
      .setLabel(`✅  Aanmelden voor ${nextRonde}`)
      .setStyle(ButtonStyle.Success)
      .setDisabled(isRegistered),
    new ButtonBuilder()
      .setCustomId(`afmelden_${next.id}`)
      .setLabel(`❌  Afmelden voor ${nextRonde}`)
      .setStyle(ButtonStyle.Danger)
      .setDisabled(!isRegistered),
  );

  await interaction.reply({ embeds: [embed], components: [row], flags: 64 });
  deleteReplyLater(interaction, 20_000);
}

// /aanmelden of /afmelden
async function handleRegister(interaction, action) {
  const { data: race, error } = await supabase
    .from('races').select('id, name').eq('status', 'upcoming')
    .gte('race_date', new Date().toISOString())
    .order('race_date', { ascending: true }).limit(1).maybeSingle();

  if (error) {
    await throttledBotLog(`register-race:${describeError(error)}`, '[register:race]', describeError(error));
    return interaction.reply({ content: '❌ Race kon niet worden opgehaald. Probeer het later opnieuw.', flags: 64 });
  }
  if (!race) return interaction.reply({ content: 'Geen aankomende race gevonden.', flags: 64 });
  await doRegistration(interaction, race.id, race.name, action);
}

// Button aanmelden/afmelden
async function handleButtonReg(interaction, raceId, action) {
  const { data: race, error } = await supabase.from('races').select('name').eq('id', raceId).maybeSingle();
  if (error) await throttledBotLog(`button-race:${describeError(error)}`, '[button:race]', describeError(error));
  await doRegistration(interaction, raceId, race?.name || 'race', action);
}

async function doRegistration(interaction, raceId, raceName, action) {
  const { data, error } = await supabase.rpc('discord_register_race', {
    p_discord_id: interaction.user.id,
    p_race_id:    raceId,
    p_action:     action,
  });

  if (error) {
    await throttledBotLog(`registration-rpc:${describeError(error)}`, '[registration:rpc]', describeError(error));
    return interaction.reply({ content: '❌ Er ging iets mis.', flags: 64 });
  }

  if (data === 'not_linked') {
    return interaction.reply({
      content: '❌ Je Discord is nog niet gekoppeld. Typ `/koppel` om een koppellink te ontvangen.',
      flags: 64,
    });
  }

  const msg = data === 'registered'
    ? `✅ Je bent aangemeld voor **${raceName}**!`
    : `✅ Je bent afgemeld voor **${raceName}**.`;

  await interaction.reply({ content: msg, flags: 64 });
  deleteReplyLater(interaction, 2_000);
}

// ── Bot ready ─────────────────────────────────────────────────────────────────
client.once('clientReady', async () => {
  console.log(`[3SM Bot] Online als ${client.user.tag}`);
  setTimeout(() => botLog(`✅ Bot online als **${client.user.tag}**`), 3000);
  for (const [, guild] of client.guilds.cache) {
    await registerCommands(guild.id);
    await ensureLiveChannelPermissions(guild);
  }

  // Elke minuut, gespreid over de minuut: race checks + aanmeldingen + koppelingen
  scheduleGuarded('0 * * * * *', 'checkRaces', checkRaces);
  scheduleGuarded('6 * * * * *', 'announcements', checkAnnouncements);
  scheduleGuarded('12 * * * * *', 'checkRegistrations', checkNewRegistrations);
  scheduleGuarded('18 * * * * *', 'checkLinks', checkNewLinks);
  scheduleGuarded('20 */2 * * * *', 'checkStreams', checkStreams);
  scheduleGuarded('24 * * * * *', 'discordSyncQueue', processDiscordSyncQueue);
  scheduleGuarded('30 * * * * *', 'checkProtests', checkProtests);
  scheduleGuarded('36 * * * * *', 'checkAbandon', checkAbandonPenalties);
  scheduleGuarded('42 * * * * *', 'checkAbandonCorrections', checkAbandonCorrections);
  scheduleGuarded('48 * * * * *', 'checkStewardPenalties', checkStewardPenalties);
  scheduleGuarded('54 * * * * *', 'checkStewardCorrections', checkStewardCorrections);
  // Elke 5 minuten: team rol sync
  scheduleGuarded('*/5 * * * *', 'syncTeamRoles', syncTeamRoles);
  // Elk uur: kalender update + token cleanup
  scheduleGuarded('0 * * * *', 'hourlyMaintenance', async () => {
    await updateCalendarEmbed().catch(e => botLog(`[cron:kalender] ${describeError(e)}`));
    try {
      const { error } = await supabase.from('discord_link_tokens')
        .delete()
        .or(`used.eq.true,expires_at.lt.${new Date().toISOString()}`);
      if (error) botLog(`❌ Token cleanup fout: ${describeError(error)}`);
    } catch (e) {
      botLog(`❌ Token cleanup fout: ${describeError(e)}`);
    }
  });

  runGuarded('checkRaces', checkRaces);
  runGuarded('discordSyncQueue', processDiscordSyncQueue);
  runGuarded('checkStreams', checkStreams);
  runGuarded('startupCalendar', updateCalendarEmbed);
  runGuarded('syncTeamRoles', syncTeamRoles);
});

client.on('error', (e) => {
  console.error(`[3SM Bot] Discord client error: ${describeError(e)}`);
});

client.on('warn', (message) => {
  console.warn(`[3SM Bot] Discord warning: ${message}`);
});

client.on('shardError', (e, shardId) => {
  console.error(`[3SM Bot] Discord shard ${shardId} error: ${describeError(e)}`);
});

client.on('shardDisconnect', (event, shardId) => {
  console.warn(`[3SM Bot] Discord shard ${shardId} disconnected: ${event?.code || 'unknown'} ${event?.reason || ''}`.trim());
});

async function loginWithRetry(attempt = 1) {
  try {
    console.log(`[3SM Bot] Discord login poging ${attempt}...`);
    await withTimeout(client.login(DISCORD_BOT_TOKEN), DISCORD_LOGIN_TIMEOUT_MS, 'Discord login');
  } catch (e) {
    const status = e?.status;
    const errorText = describeError(e);
    const retryable = status === 429 || status >= 500 || isTransientNetworkErrorText(errorText) || /timeout/i.test(errorText);
    const delayMs = Math.min(5 * 60 * 1000, 10_000 * attempt);
    const message = `[3SM Bot] Discord login fout: ${errorText}${retryable ? `; nieuwe poging over ${formatDuration(delayMs)}` : ''}`;
    console.error(message);

    if (!retryable) {
      process.exitCode = 1;
      return;
    }

    try { client.destroy(); } catch {}
    setTimeout(() => loginWithRetry(attempt + 1), delayMs);
  }
}

loginWithRetry();
