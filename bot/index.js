import 'dotenv/config';
import {
  Client, GatewayIntentBits, EmbedBuilder,
  ButtonBuilder, ButtonStyle, ActionRowBuilder,
  REST, Routes, SlashCommandBuilder,
  ChannelType, PermissionFlagsBits,
} from 'discord.js';
import { createClient } from '@supabase/supabase-js';
import cron from 'node-cron';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SENT_FILE   = path.join(__dirname, 'sent_notifications.json');
const CONFIG_FILE = path.join(__dirname, 'config.json');

// ── Supabase ──────────────────────────────────────────────────────────────────
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

// ── Discord client ────────────────────────────────────────────────────────────
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
  ],
});

// ── Config (channel/role IDs na /setup-server) ────────────────────────────────
function loadConfig() {
  try { return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8')); }
  catch { return {}; }
}
function saveConfig(data) {
  const current = loadConfig();
  fs.writeFileSync(CONFIG_FILE, JSON.stringify({ ...current, ...data }, null, 2));
}

// ── Sent-notification tracking ────────────────────────────────────────────────
function loadSent() {
  try { return JSON.parse(fs.readFileSync(SENT_FILE, 'utf8')); }
  catch { return {}; }
}
function markSent(raceId, type) {
  const sent = loadSent();
  sent[`${raceId}_${type}`] = new Date().toISOString();
  fs.writeFileSync(SENT_FILE, JSON.stringify(sent, null, 2));
}
function wasSent(raceId, type) { return !!loadSent()[`${raceId}_${type}`]; }

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
  if (!channelId) { console.error('[bot] Geen meldingen channel geconfigureerd'); return null; }
  const ch = await client.channels.fetch(channelId).catch(() => null);
  if (!ch) console.error('[bot] Meldingen channel niet gevonden:', channelId);
  return ch;
}

async function getUitslagenChannel() {
  const cfg = loadConfig();
  const channelId = cfg.uitslagen_channel_id;
  if (!channelId) return null;
  return client.channels.fetch(channelId).catch(() => null);
}

async function getCalendarChannel() {
  const cfg = loadConfig();
  if (!cfg.kalender_channel_id) return null;
  return client.channels.fetch(cfg.kalender_channel_id).catch(() => null);
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
  const configs = {
    '24h':      { color: 0x3b82f6, title: `🏁  Race morgen — ${race.name}`,         description: `**${ronde}** gaat morgen van start.\nZorg dat je klaarstaat en je setup klaar hebt!` },
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

// ── Podium embed ──────────────────────────────────────────────────────────────
function buildPodiumEmbed(race, results) {
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
    .setDescription(`**${rondeName(race)}** is afgelopen! Bekijk de volledige uitslag op de site.`)
    .addFields(
      { name: '🗓️ Circuit', value: `${race.track} · ${fmtDate(race.race_date)}`, inline: false },
      { name: '🏅 Podium',  value: podiumLines || 'Geen resultaten',             inline: false },
    );

  if (fastest) embed.addFields({ name: '⚡ Snelste ronde', value: `**${fastest.profiles?.display_name || 'Onbekend'}**`, inline: true });
  const dnfCount = results.filter(r => r.dnf).length;
  if (dnfCount) embed.addFields({ name: '🔴 DNF', value: `${dnfCount}`, inline: true });
  embed.addFields({ name: '👥 Finishers', value: `${finishers.length}`, inline: true })
    .setFooter({ text: '3 Stripe Motorsport' }).setTimestamp();

  return embed;
}

// ── Kalender embed ────────────────────────────────────────────────────────────
async function buildCalendarEmbed() {
  const { data: races } = await supabase
    .from('races')
    .select('id, name, track, round, race_date, status, leagues(name)')
    .in('status', ['upcoming', 'live'])
    .order('race_date', { ascending: true })
    .limit(15);

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
    .from('races').select('id, name, track, round, race_date')
    .eq('status', 'upcoming')
    .gte('race_date', now.toISOString())
    .lte('race_date', lookahead.toISOString());

  if (error) { console.error('[checkUpcoming]', error.message); return; }
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
      const embed = buildReminderEmbed(race, activeWindow.key);
      await channel.send({ embeds: [embed], components: [registrationRow(race.id)] });
      markSent(race.id, activeWindow.key);
      console.log(`[${new Date().toISOString()}] ✓ ${activeWindow.key}: ${race.name}`);
    } catch (err) {
      console.error('[checkUpcoming]', err.message);
    }
  }
}

// ── Cron: live ────────────────────────────────────────────────────────────────
async function checkLive() {
  const { data: races, error } = await supabase.from('races').select('id, name, track, round, race_date').eq('status', 'live');
  if (error) { console.error('[checkLive]', error.message); return; }
  if (!races?.length) return;
  const channel = await getNotificationChannel(); if (!channel) return;
  for (const race of races) {
    if (wasSent(race.id, 'live')) continue;
    try { await channel.send({ embeds: [buildReminderEmbed(race, 'live')] }); markSent(race.id, 'live'); } catch (e) { console.error(e.message); }
  }
}

// ── Cron: cancelled ───────────────────────────────────────────────────────────
async function checkCancelled() {
  const { data: races, error } = await supabase.from('races').select('id, name, track, round, race_date').eq('status', 'cancelled');
  if (error) { console.error('[checkCancelled]', error.message); return; }
  if (!races?.length) return;
  const channel = await getNotificationChannel(); if (!channel) return;
  for (const race of races) {
    if (wasSent(race.id, 'cancelled')) continue;
    try { await channel.send({ embeds: [buildReminderEmbed(race, 'cancelled')] }); markSent(race.id, 'cancelled'); } catch (e) { console.error(e.message); }
  }
}

// ── Cron: completed / podium ──────────────────────────────────────────────────
async function checkCompleted() {
  const { data: races, error } = await supabase.from('races').select('id, name, track, round, race_date').eq('status', 'completed');
  if (error) { console.error('[checkCompleted]', error.message); return; }
  if (!races?.length) return;
  const channel = await getUitslagenChannel() || await getNotificationChannel();
  if (!channel) return;
  for (const race of races) {
    if (wasSent(race.id, 'podium')) continue;
    const { data: results, error: re } = await supabase
      .from('race_results').select('position, points, fastest_lap, dnf, gap_to_leader, profiles(display_name)')
      .eq('race_id', race.id).order('position', { ascending: true });
    if (re || !results?.length) continue;
    try { await channel.send({ embeds: [buildPodiumEmbed(race, results)] }); markSent(race.id, 'podium'); console.log(`[${new Date().toISOString()}] ✓ Podium: ${race.name}`); } catch (e) { console.error(e.message); }
  }
}

async function checkRaces() {
  await Promise.all([checkUpcoming(), checkLive(), checkCancelled(), checkCompleted()]);
}

// ── Cron: team rol sync ───────────────────────────────────────────────────────
async function syncTeamRoles() {
  const cfg = loadConfig();
  const guildId = cfg.guild_id || client.guilds.cache.first()?.id;
  if (!guildId) return;
  const guild = await client.guilds.fetch(guildId).catch(() => null);
  if (!guild) return;

  const { data: teams } = await supabase.from('teams').select('id, name, color, discord_role_id');
  if (!teams?.length) return;

  // Maak ontbrekende team-rollen aan (controleer eerst op naam in Discord)
  for (const team of teams) {
    const colorInt = team.color ? parseInt(team.color.replace('#', ''), 16) : 0xf97316;
    if (!team.discord_role_id) {
      // Zoek bestaande rol op naam om duplicaten te voorkomen
      const existing = guild.roles.cache.find(r => r.name === team.name);
      if (existing) {
        await existing.edit({ color: colorInt, hoist: true }).catch(() => {});
        await supabase.from('teams').update({ discord_role_id: existing.id }).eq('id', team.id);
        team.discord_role_id = existing.id;
        console.log(`[syncTeamRoles] Bestaande rol gevonden: ${team.name}`);
        continue;
      }
      try {
        const role = await guild.roles.create({ name: team.name, color: colorInt, hoist: true, mentionable: false, reason: '3SM team rol auto-aanmaak' });
        await supabase.from('teams').update({ discord_role_id: role.id }).eq('id', team.id);
        team.discord_role_id = role.id;
        console.log(`[syncTeamRoles] Rol aangemaakt: ${team.name}`);
      } catch (e) {
        console.error(`[syncTeamRoles] Kon rol niet aanmaken voor ${team.name}:`, e.message);
        continue;
      }
    } else {
      // Update kleur/hoist van bestaande rol als die afwijkt
      const existing = guild.roles.cache.get(team.discord_role_id);
      if (existing) {
        await existing.edit({ color: colorInt, hoist: true }).catch(() => {});
      }
    }
  }

  // Sync Discord-rollen voor alle gekoppelde leden
  const { data: profiles } = await supabase
    .from('profiles').select('user_id, discord_id, iracing_name, display_name')
    .not('discord_id', 'is', null);

  if (!profiles?.length) return;

  const { data: memberships } = await supabase
    .from('team_memberships').select('user_id, team_id');

  for (const profile of profiles) {
    try {
      const member = await guild.members.fetch(profile.discord_id).catch(() => null);
      if (!member) continue;

      // Nickname instellen op iRacing naam (of display_name als fallback)
      const nickname = profile.iracing_name || profile.display_name;
      if (nickname && member.displayName !== nickname) {
        await member.setNickname(nickname).catch(() => {});
      }

      const userTeams = memberships?.filter(m => m.user_id === profile.user_id) || [];
      const expectedRoleIds = userTeams.map(m => teams.find(t => t.id === m.team_id)?.discord_role_id).filter(Boolean);

      for (const team of teams) {
        if (!team.discord_role_id) continue;
        const shouldHave = expectedRoleIds.includes(team.discord_role_id);
        const hasIt = member.roles.cache.has(team.discord_role_id);
        if (shouldHave && !hasIt) await member.roles.add(team.discord_role_id).catch(() => {});
        if (!shouldHave && hasIt) await member.roles.remove(team.discord_role_id).catch(() => {});
      }
    } catch (e) {
      console.error('[syncTeamRoles] lid fout:', e.message);
    }
  }
}

// ── guildMemberAdd: Rijder rol + team rollen ──────────────────────────────────
client.on('guildMemberAdd', async (member) => {
  const cfg = loadConfig();
  if (!cfg.rijder_role_id) return;

  try {
    await member.roles.add(cfg.rijder_role_id);
  } catch (e) {
    console.error('[guildMemberAdd] Rijder rol:', e.message);
  }

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
});

// ── /setup-server ─────────────────────────────────────────────────────────────
async function handleSetupServer(interaction) {
  await interaction.deferReply({ ephemeral: true });
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
      label: '🎙️ SPRAAK',
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
        { key: 'admin_chat', name: '💼・admin-chat', type: ChannelType.GuildText },
        { key: 'bot_logs',   name: '🤖・bot-logs',  type: ChannelType.GuildText },
      ],
    },
  ];

  for (const section of STRUCTURE) {
    const separatorName = `━━━━━━━| ${section.label} |━━━━━━━`;
    const category = await getOrCreateCategory(separatorName, []);

    for (const chDef of section.channels) {
      const ch = await getOrCreateChannel(chDef.name, chDef.type, category.id, []);
      resolvedChannels[chDef.key] = ch.id;
    }
  }

  // Sla config op
  saveConfig({
    guild_id:              guild.id,
    meldingen_channel_id:  resolvedChannels.meldingen,
    uitslagen_channel_id:  resolvedChannels.uitslagen,
    kalender_channel_id:   resolvedChannels.kalender,
    welkom_channel_id:     resolvedChannels.welkom,
    bot_logs_channel_id:   resolvedChannels.bot_logs,
    rijder_role_id:        resolvedRoles.rijder_role,
    admin_role_id:         resolvedRoles.admin_role,
    steward_role_id:       resolvedRoles.steward_role,
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
          { name: '🔗 Account koppelen',  value: `Koppel je Discord aan je 3SM account:\n1. Typ \`/koppel\` hier in Discord\n2. De bot stuurt je een persoonlijke link\n3. Open de link — log in als je dat nog niet hebt gedaan\n4. Koppeling is automatisch klaar!\n\nJe krijgt daarna automatisch je teamrol en nickname.`, inline: false },
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
  await updateCalendarEmbed();
  await syncTeamRoles();

  await interaction.editReply({
    content: `✅ **Server opgezet!**\n\nKanalen en rollen zijn aangemaakt (bestaande zijn hergebruikt).\n\nJe kan \`/setup-server\` veilig opnieuw uitvoeren — er wordt nooit iets verwijderd.`,
  });
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
    .setName('aanmelden')
    .setDescription('Meld je aan voor de eerstvolgende race'),
  new SlashCommandBuilder()
    .setName('afmelden')
    .setDescription('Meld je af voor de eerstvolgende race'),
  new SlashCommandBuilder()
    .setName('setup-server')
    .setDescription('Maak de volledige 3SM serverstructuur aan (alleen voor admins)')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
].map(c => c.toJSON());

async function registerCommands(guildId) {
  const rest = new REST().setToken(process.env.DISCORD_BOT_TOKEN);
  try {
    await rest.put(Routes.applicationGuildCommands(client.application.id, guildId), { body: COMMANDS });
    console.log('[3SM Bot] Slash commands geregistreerd');
  } catch (e) { console.error('[3SM Bot] Commands registreren mislukt:', e.message); }
}

// ── Interaction handler ───────────────────────────────────────────────────────
client.on('interactionCreate', async (interaction) => {
  try {
    if (interaction.isChatInputCommand()) {
      if (interaction.commandName === 'koppel')        await handleKoppel(interaction);
      if (interaction.commandName === 'races')         await handleRaces(interaction);
      if (interaction.commandName === 'aanmelden')     await handleRegister(interaction, 'register');
      if (interaction.commandName === 'afmelden')      await handleRegister(interaction, 'unregister');
      if (interaction.commandName === 'setup-server')  await handleSetupServer(interaction);
    } else if (interaction.isButton()) {
      const [action, raceId] = interaction.customId.split('_');
      if (action === 'aanmelden') await handleButtonReg(interaction, raceId, 'register');
      if (action === 'afmelden')  await handleButtonReg(interaction, raceId, 'unregister');
    }
  } catch (e) { console.error('[interaction]', e.message); }
});

// /koppel → magic link
async function handleKoppel(interaction) {
  const discordId  = interaction.user.id;
  const discordTag = interaction.user.tag;
  const siteUrl    = process.env.SITE_URL || 'https://jouw-site.nl';

  // Maak een token aan in Supabase
  const { data, error } = await supabase
    .from('discord_link_tokens')
    .insert({ discord_id: discordId, discord_tag: discordTag })
    .select('token')
    .single();

  if (error || !data?.token) {
    return interaction.reply({ content: '❌ Er ging iets mis bij het aanmaken van de koppellink. Probeer het opnieuw.', ephemeral: true });
  }

  const link = `${siteUrl}/koppel?token=${data.token}`;

  return interaction.reply({
    content: `🔗 **Koppel je account**\n\nKlik op onderstaande link om je Discord te koppelen aan je 3SM profiel. De link is **30 minuten** geldig.\n\n${link}\n\n> Je moet ingelogd zijn op de site om de koppeling te voltooien.`,
    ephemeral: true,
  });
}

// /races
async function handleRaces(interaction) {
  const discordId = interaction.user.id;

  const { data: races } = await supabase
    .from('races').select('id, name, track, round, race_date')
    .eq('status', 'upcoming').gte('race_date', new Date().toISOString())
    .order('race_date', { ascending: true }).limit(5);

  if (!races?.length) {
    return interaction.reply({ content: 'Geen aankomende races gevonden.', ephemeral: true });
  }

  const next = races[0];
  const nextRonde = next.round != null ? `R${next.round} — ${next.name}` : next.name;

  const { data: profile } = await supabase
    .from('profiles').select('user_id').eq('discord_id', discordId).maybeSingle();

  let isRegistered = false;
  if (profile) {
    const { data: raceReg } = await supabase
      .from('race_registrations').select('id')
      .eq('race_id', next.id).eq('user_id', profile.user_id).maybeSingle();

    if (raceReg) {
      isRegistered = true;
    } else {
      const { data: race } = await supabase
        .from('races').select('league_id').eq('id', next.id).maybeSingle();
      if (race?.league_id) {
        const { data: seasonReg } = await supabase
          .from('season_registrations').select('id')
          .eq('league_id', race.league_id).eq('user_id', profile.user_id).maybeSingle();
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

  await interaction.reply({ embeds: [embed], components: [row], ephemeral: true });
  setTimeout(() => interaction.deleteReply().catch(() => {}), 20_000);
}

// /aanmelden of /afmelden
async function handleRegister(interaction, action) {
  const { data: race } = await supabase
    .from('races').select('id, name').eq('status', 'upcoming')
    .gte('race_date', new Date().toISOString())
    .order('race_date', { ascending: true }).limit(1).maybeSingle();

  if (!race) return interaction.reply({ content: 'Geen aankomende race gevonden.', ephemeral: true });
  await doRegistration(interaction, race.id, race.name, action);
}

// Button aanmelden/afmelden
async function handleButtonReg(interaction, raceId, action) {
  const { data: race } = await supabase.from('races').select('name').eq('id', raceId).maybeSingle();
  await doRegistration(interaction, raceId, race?.name || 'race', action);
}

async function doRegistration(interaction, raceId, raceName, action) {
  const { data, error } = await supabase.rpc('discord_register_race', {
    p_discord_id: interaction.user.id,
    p_race_id:    raceId,
    p_action:     action,
  });

  if (error) return interaction.reply({ content: '❌ Er ging iets mis.', ephemeral: true });

  if (data === 'not_linked') {
    return interaction.reply({
      content: '❌ Je Discord is nog niet gekoppeld. Typ `/koppel` om een koppellink te ontvangen.',
      ephemeral: true,
    });
  }

  const msg = data === 'registered'
    ? `✅ Je bent aangemeld voor **${raceName}**!`
    : `✅ Je bent afgemeld voor **${raceName}**.`;

  await interaction.reply({ content: msg, ephemeral: true });
  setTimeout(() => interaction.deleteReply().catch(() => {}), 2_000);
}

// ── Bot ready ─────────────────────────────────────────────────────────────────
client.once('ready', async () => {
  console.log(`[3SM Bot] Online als ${client.user.tag}`);
  for (const [, guild] of client.guilds.cache) {
    await registerCommands(guild.id);
  }

  // Elke minuut: race checks
  cron.schedule('* * * * *', checkRaces);
  // Elk uur: team rol sync + kalender update
  cron.schedule('0 * * * *', async () => {
    await syncTeamRoles();
    await updateCalendarEmbed();
  });

  checkRaces();
  updateCalendarEmbed();
  syncTeamRoles();
});

client.login(process.env.DISCORD_BOT_TOKEN);
