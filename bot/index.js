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
  process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_ANON_KEY
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
  const message = args.join(' ');
  console.log(`[botLog] ${message}`);
  try {
    const cfg = loadConfig();
    if (!cfg.bot_logs_channel_id) return;
    const ch = await client.channels.fetch(cfg.bot_logs_channel_id).catch(() => null);
    if (ch) await ch.send(`\`${new Date().toISOString()}\` ${message}`).catch(() => {});
  } catch {}
}

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
  if (!channelId) { botLog('[bot] Geen meldingen channel geconfigureerd'); return null; }
  const ch = await client.channels.fetch(channelId).catch(() => null);
  if (!ch) botLog('[bot] Meldingen channel niet gevonden:', channelId);
  return ch;
}

async function getUitslagenChannel() {
  const cfg = loadConfig();
  const channelId = cfg.uitslagen_channel_id;
  if (!channelId) return null;
  return client.channels.fetch(channelId).catch(() => null);
}

async function getAankondigingenChannel() {
  const channelId = '1489621381548081276';
  return client.channels.fetch(channelId).catch(() => null);
}

async function getStewardDecisionsChannel() {
  return client.channels.fetch('1492662115553771530').catch(() => null);
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

  if (error) { botLog('[checkUpcoming]', error.message); return; }
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
      botLog(`🔔 Race melding verstuurd (${activeWindow.key}): **${race.name}**`);
    } catch (err) {
      botLog('[checkUpcoming]', err.message);
    }
  }
}

// ── Cron: live ────────────────────────────────────────────────────────────────
async function checkLive() {
  const { data: races, error } = await supabase.from('races').select('id, name, track, round, race_date').eq('status', 'live');
  if (error) { botLog('[checkLive]', error.message); return; }
  if (!races?.length) return;
  const channel = await getNotificationChannel(); if (!channel) return;
  for (const race of races) {
    if (wasSent(race.id, 'live')) continue;
    try { await channel.send({ embeds: [buildReminderEmbed(race, 'live')] }); markSent(race.id, 'live'); botLog(`🟢 Race gestart melding verstuurd: **${race.name}**`); } catch (e) { botLog(`❌ Live melding fout: ${e.message}`); }
  }
}

// ── Cron: cancelled ───────────────────────────────────────────────────────────
async function checkCancelled() {
  const { data: races, error } = await supabase.from('races').select('id, name, track, round, race_date').eq('status', 'cancelled');
  if (error) { botLog('[checkCancelled]', error.message); return; }
  if (!races?.length) return;
  const channel = await getNotificationChannel(); if (!channel) return;
  for (const race of races) {
    if (wasSent(race.id, 'cancelled')) continue;
    try { await channel.send({ embeds: [buildReminderEmbed(race, 'cancelled')] }); markSent(race.id, 'cancelled'); botLog(`❌ Race gecanceld melding verstuurd: **${race.name}**`); } catch (e) { botLog(`❌ Cancelled melding fout: ${e.message}`); }
  }
}

// ── Cron: completed / podium ──────────────────────────────────────────────────
async function checkCompleted() {
  const { data: races, error } = await supabase.from('races').select('id, name, track, round, race_date').eq('status', 'completed');
  if (error) { botLog('[checkCompleted]', error.message); return; }
  if (!races?.length) return;
  const channel = await getUitslagenChannel() || await getNotificationChannel();
  if (!channel) return;
  for (const race of races) {
    if (wasSent(race.id, 'podium')) continue;
    const { data: results, error: re } = await supabase
      .from('race_results').select('position, points, fastest_lap, dnf, gap_to_leader, profiles(display_name)')
      .eq('race_id', race.id).order('position', { ascending: true });
    if (re || !results?.length) continue;
    try { await channel.send({ embeds: [buildPodiumEmbed(race, results)] }); markSent(race.id, 'podium'); botLog(`🏆 Uitslag verstuurd: **${race.name}**`); } catch (e) { botLog(`❌ Podium fout: ${e.message}`); }
  }
}

async function checkRaces() {
  await Promise.all([checkUpcoming(), checkLive(), checkCancelled(), checkCompleted()]);
}

// ── Cron: nieuwe race aanmeldingen ────────────────────────────────────────────
async function checkNewRegistrations() {
  const { data, error } = await supabase
    .from('race_registrations')
    .select('id, user_id, races(name)')
    .order('created_at', { ascending: false })
    .limit(20);
  if (error) { botLog('[checkRegistrations]', error.message); return; }
  if (!data?.length) return;
  for (const reg of data) {
    const key = `reg_${reg.id}`;
    if (wasSent(key, 'notified')) continue;
    markSent(key, 'notified');
    const { data: profile } = await supabase.from('profiles').select('display_name, iracing_name').eq('user_id', reg.user_id).maybeSingle();
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
  if (error) { botLog('[checkLinks]', error.message); return; }
  if (!data?.length) return;
  for (const token of data) {
    const key = `link_${token.discord_id}`;
    if (wasSent(key, 'notified')) continue;
    markSent(key, 'notified');
    botLog(`🔗 Discord gekoppeld: **${token.discord_tag || token.discord_id}**`);
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

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
    .select('id, status, notified, created_at, decided_at, penalty_type, penalty_points, penalty_category, time_penalty_seconds, grid_penalty_places, race_ban_next, steward_notes, races(name, track), accused:profiles!protests_accused_user_id_fkey(display_name, iracing_name)')
    .order('created_at', { ascending: false })
    .limit(20);
  if (error) { botLog('[checkProtests]', error.message); return; }
  if (!data?.length) return;

  for (const protest of data) {
    // Nieuw protest melding (naar steward kanaal)
    const newKey = `protest_new_${protest.id}`;
    if (!wasSent(newKey, 'notified')) {
      markSent(newKey, 'notified');
      const stewardCh = await getStewardChannel();
      if (stewardCh) {
        const btn = new ButtonBuilder()
          .setLabel('Bekijk protest')
          .setURL('https://3stripemotorsport.cc/stewards')
          .setStyle(ButtonStyle.Link);
        const row = new ActionRowBuilder().addComponents(btn);
        await stewardCh.send({ content: '⚖️ Er is een nieuw protest ingediend.', components: [row] }).catch(() => {});
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

      await channel.send({ embeds: [embed] }).catch(e => botLog(`❌ Protest beslissing melding fout: ${e.message}`));
      await supabase.from('protests').update({ notified: true }).eq('id', protest.id);
      botLog(`⚖️ Steward beslissing verstuurd: **${protest.races?.name}** → ${accusedName} — ${penaltyText}`);
    }
  }
}

// ── Cron: steward-initiated penalties (zonder protest) ────────────────────────
async function checkStewardPenalties() {
  const { data, error } = await supabase
    .from('penalties')
    .select('id, race_id, user_id, penalty_type, penalty_category, penalty_sp, time_penalty_seconds, grid_penalty_places, race_ban_next, points_deduction, steward_description, races(name, track)')
    .eq('steward_initiated', true)
    .eq('notified', false)
    .eq('revoked', false);
  if (error) { botLog('[checkStewardPenalties]', error.message); return; }
  if (!data?.length) return;

  const channel = await getStewardDecisionsChannel();

  for (const penalty of data) {
    const raceName = penalty.races?.name || 'Onbekende race';

    const { data: profile } = await supabase
      .from('profiles')
      .select('display_name, iracing_name, discord_id')
      .eq('user_id', penalty.user_id)
      .maybeSingle();

    const driverName = profile?.display_name || profile?.iracing_name || 'Onbekend';
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

    let messageId = null;
    if (channel) {
      const msg = await channel.send({ embeds: [embed] }).catch(e => { botLog(`❌ Steward penalty melding fout: ${e.message}`); return null; });
      if (!msg) continue;
      messageId = msg.id;
    }

    // DM als driver Discord heeft gekoppeld
    if (profile?.discord_id) {
      const member = await client.guilds.cache.first()?.members.fetch(profile.discord_id).catch(() => null);
      if (member) await member.send({ embeds: [embed] }).catch(() => {});
    }

    await supabase.from('penalties').update({ notified: true, discord_message_id: messageId }).eq('id', penalty.id);
    botLog(`⚡ Steward actie verstuurd: **${driverName}** — ${raceName} (${penaltyText})`);
  }
}

// ── Cron: steward penalty correcties (na intrekken) ───────────────────────────
async function checkStewardCorrections() {
  const { data, error } = await supabase
    .from('penalties')
    .select('id, user_id, discord_message_id, races(name)')
    .eq('steward_initiated', true)
    .eq('revoked', true)
    .eq('notified', true)
    .eq('correction_sent', false);
  if (error) { botLog('[checkStewardCorrections]', error.message); return; }
  if (!data?.length) return;

  const channel = await getStewardDecisionsChannel();

  for (const penalty of data) {
    const raceName = penalty.races?.name || 'Onbekende race';

    const { data: profile } = await supabase
      .from('profiles')
      .select('display_name, iracing_name')
      .eq('user_id', penalty.user_id)
      .maybeSingle();
    const driverName = profile?.display_name || profile?.iracing_name || 'Onbekend';

    if (penalty.discord_message_id && channel) {
      await channel.messages.delete(penalty.discord_message_id).catch(() => {});
    }

    if (channel) {
      const embed = new EmbedBuilder()
        .setColor(0x6b7280)
        .setTitle(`✏️ Correctie — ${raceName}`)
        .setDescription(`De eerder gemelde steward actie voor **${driverName}** is ingetrokken.`)
        .setFooter({ text: '3 Stripe Motorsport · Stewards' })
        .setTimestamp();
      await channel.send({ embeds: [embed] }).catch(e => botLog(`❌ Steward correctie fout: ${e.message}`));
    }

    await supabase.from('penalties').update({ correction_sent: true }).eq('id', penalty.id);
    botLog(`✏️ Steward correctie verstuurd: **${driverName}** — ${raceName}`);
  }
}

// ── Cron: abandon penalties ───────────────────────────────────────────────────
async function checkAbandonPenalties() {
  const { data, error } = await supabase
    .from('penalties')
    .select('id, race_id, user_id, points_deduction, races(name)')
    .eq('source', 'abandon')
    .eq('notified', false)
    .eq('revoked', false); // nooit sturen als al ingetrokken vóór versturen
  if (error) { botLog('[checkAbandonPenalties]', error.message); return; }
  if (!data?.length) return;

  const channel = await getStewardDecisionsChannel();

  for (const penalty of data) {
    const raceName = penalty.races?.name || 'Onbekende race';
    const deduction = penalty.points_deduction || 0;

    // Profiel apart ophalen (user_id → auth.users, geen directe FK naar profiles)
    const { data: profile } = await supabase
      .from('profiles')
      .select('display_name, iracing_name, discord_id')
      .eq('user_id', penalty.user_id)
      .maybeSingle();

    const driverName = profile?.display_name || profile?.iracing_name || 'Onbekend';

    const embed = new EmbedBuilder()
      .setColor(0xf97316)
      .setTitle(`⚠️ Disciplinaire maatregel — ${raceName}`)
      .setDescription(`**${driverName}**\n\nReden: Race vroegtijdig verlaten zonder geldige reden.\nStraf: -${deduction} punt${deduction !== 1 ? 'en' : ''}`)
      .addFields({ name: '⚠️ Let op', value: 'Herhaald gedrag kan leiden tot zwaardere straffen.', inline: false })
      .setFooter({ text: '3 Stripe Motorsport · Stewards' })
      .setTimestamp();

    // Verstuur naar kanaal en sla message ID op
    let messageId = null;
    if (channel) {
      const msg = await channel.send({ embeds: [embed] }).catch(e => { botLog(`❌ Abandon melding fout: ${e.message}`); return null; });
      if (!msg) continue; // sturen mislukt, niet als notified markeren anders spam
      messageId = msg.id;
    }

    // Stuur ook een DM als de driver Discord heeft gekoppeld
    if (profile?.discord_id) {
      const member = await client.guilds.cache.first()?.members.fetch(profile.discord_id).catch(() => null);
      if (member) await member.send({ embeds: [embed] }).catch(() => {});
    }

    // Markeer als notified + sla message ID op voor eventuele correctie later
    const { error: updErr } = await supabase.from('penalties')
      .update({ notified: true, discord_message_id: messageId })
      .eq('id', penalty.id);
    if (updErr) { botLog(`❌ Abandon notified update fout: ${updErr.message}`); continue; }
    botLog(`⚠️ Abandon melding verstuurd: **${driverName}** — ${raceName} (-${deduction}pts)`);
  }
}

// ── Cron: abandon correcties (na misclick undo) ───────────────────────────────
async function checkAbandonCorrections() {
  const { data, error } = await supabase
    .from('penalties')
    .select('id, user_id, discord_message_id, races(name)')
    .eq('source', 'abandon')
    .eq('revoked', true)
    .eq('notified', true)
    .eq('correction_sent', false);
  if (error) { botLog('[checkAbandonCorrections]', error.message); return; }
  if (!data?.length) return;

  const channel = await getStewardDecisionsChannel();

  for (const penalty of data) {
    const raceName = penalty.races?.name || 'Onbekende race';

    const { data: profile } = await supabase
      .from('profiles')
      .select('display_name, iracing_name')
      .eq('user_id', penalty.user_id)
      .maybeSingle();
    const driverName = profile?.display_name || profile?.iracing_name || 'Onbekend';

    // Verwijder origineel bericht als we het ID hebben
    if (penalty.discord_message_id && channel) {
      await channel.messages.delete(penalty.discord_message_id).catch(() => {});
    }

    // Stuur correctiebericht
    if (channel) {
      const embed = new EmbedBuilder()
        .setColor(0x6b7280)
        .setTitle(`✏️ Correctie — ${raceName}`)
        .setDescription(`De eerder gemelde disciplinaire maatregel voor **${driverName}** is ingetrokken wegens een vergissing. Onze excuses.`)
        .setFooter({ text: '3 Stripe Motorsport · Stewards' })
        .setTimestamp();
      await channel.send({ embeds: [embed] }).catch(e => botLog(`❌ Correctie melding fout: ${e.message}`));
    }

    const { error: updErr } = await supabase.from('penalties').update({ correction_sent: true }).eq('id', penalty.id);
    if (updErr) { botLog(`❌ Correctie update fout: ${updErr.message}`); continue; }
    botLog(`✏️ Correctie verstuurd: **${driverName}** — ${raceName}`);
  }
}

// ── Cron: aankondigingen ──────────────────────────────────────────────────────
async function checkAnnouncements() {
  const { data, error } = await supabase
    .from('announcements')
    .select('*')
    .eq('sent', false)
    .order('created_at', { ascending: true });
  if (error) { botLog('[checkAnnouncements]', error.message); return; }
  if (!data?.length) return;

  const channel = await getAankondigingenChannel();
  if (!channel) { botLog('[checkAnnouncements] Aankondigingen channel niet gevonden'); return; }

  const { data: teams } = await supabase.from('teams').select('id, name, discord_role_id');

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

    const embed = {
      color: 0xf97316,
      title: ann.title,
      description: ann.message,
      footer: { text: '3 Stripe Motorsport' },
      timestamp: new Date().toISOString(),
    };
    if (ann.image_url) embed.image = { url: ann.image_url };

    try {
      await channel.send({ content: mentionText || undefined, embeds: [embed] });
      await supabase.from('announcements').update({ sent: true }).eq('id', ann.id);
      botLog(`📢 Aankondiging verstuurd: **${ann.title}**`);
    } catch (e) {
      botLog(`❌ Aankondiging fout: ${e.message}`);
    }
  }
}

// ── Cron: team rol sync ───────────────────────────────────────────────────────
async function syncTeamRoles() {
  const cfg = loadConfig();
  const guildId = cfg.guild_id || client.guilds.cache.first()?.id;
  if (!guildId) return;
  const guild = await client.guilds.fetch(guildId).catch(() => null);
  if (!guild) return;

  const { data: teams } = await supabase.from('teams').select('id, name, color, discord_role_id, discord_category_id');
  if (!teams?.length) return;

  const everyoneId = guild.roles.everyone.id;

  // Maak ontbrekende team-rollen + categorie + kanalen aan
  for (const team of teams) {
    const colorInt = team.color ? parseInt(team.color.replace('#', ''), 16) : 0xf97316;

    // ── Rol ──────────────────────────────────────────────────────────────────
    if (!team.discord_role_id) {
      const existing = guild.roles.cache.find(r => r.name === team.name);
      if (existing) {
        await existing.edit({ color: colorInt, hoist: true }).catch(() => {});
        await supabase.from('teams').update({ discord_role_id: existing.id }).eq('id', team.id);
        team.discord_role_id = existing.id;
        botLog(`✅ Teamrol gevonden en bijgewerkt: **${team.name}**`);
      } else {
        try {
          const role = await guild.roles.create({ name: team.name, color: colorInt, hoist: true, mentionable: false, reason: '3SM team rol auto-aanmaak' });
          await supabase.from('teams').update({ discord_role_id: role.id }).eq('id', team.id);
          team.discord_role_id = role.id;
          botLog(`➕ Teamrol aangemaakt: **${team.name}**`);
        } catch (e) {
          botLog(`❌ Kon rol niet aanmaken voor ${team.name}: ${e.message}`);
          continue;
        }
      }
    } else {
      const existing = guild.roles.cache.get(team.discord_role_id);
      if (existing) await existing.edit({ color: colorInt, hoist: true }).catch(() => {});
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
        botLog(`➕ Team sectie aangemaakt: **${team.name}**`);
      } catch (e) {
        botLog(`❌ Kon sectie niet aanmaken voor ${team.name}: ${e.message}`);
        continue;
      }
    }

    if (categoryId !== team.discord_category_id) {
      await supabase.from('teams').update({ discord_category_id: categoryId }).eq('id', team.id);
      team.discord_category_id = categoryId;
    }

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
        }).catch(e => botLog(`❌ Kanaal aanmaken fout (${chDef.name}): ${e.message}`));
      }
    }
  }

  // Verwijder Discord rollen + categorie + kanalen van verwijderde teams
  const teamRoleIds     = teams.map(t => t.discord_role_id).filter(Boolean);
  const teamCategoryIds = teams.map(t => t.discord_category_id).filter(Boolean);
  const protectedRoles  = ['Admin', 'Steward', 'Rijder'];

  for (const [, role] of guild.roles.cache) {
    if (role.hoist && !protectedRoles.includes(role.name) && !teamRoleIds.includes(role.id)) {
      const wasTeamRole = await supabase.from('teams').select('id').eq('discord_role_id', role.id).maybeSingle();
      if (!wasTeamRole.data) {
        await role.delete('3SM team verwijderd').catch(() => {});
        botLog(`🗑️ Teamrol verwijderd: **${role.name}**`);
      }
    }
  }

  for (const [, ch] of guild.channels.cache) {
    if (ch.type === ChannelType.GuildCategory && !teamCategoryIds.includes(ch.id)) {
      const wasTeamCat = await supabase.from('teams').select('id').eq('discord_category_id', ch.id).maybeSingle();
      if (wasTeamCat.data === null && ch.name.includes('━━━') && !ch.name.includes('INFORMATIE') && !ch.name.includes('RACING') && !ch.name.includes('COMMUNITY') && !ch.name.includes('SPRAAK') && !ch.name.includes('ADMIN')) {
        // Verwijder eerst alle kanalen in de categorie
        for (const [, child] of guild.channels.cache) {
          if (child.parentId === ch.id) await child.delete('3SM team verwijderd').catch(() => {});
        }
        await ch.delete('3SM team verwijderd').catch(() => {});
        botLog(`🗑️ Team sectie verwijderd: **${ch.name}**`);
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

  const { data: adminRoles } = await supabase
    .from('user_roles').select('user_id, role')
    .in('role', ['admin', 'super_admin', 'moderator']);

  const syncCfg = loadConfig();

  for (const profile of profiles) {
    try {
      const member = await guild.members.fetch(profile.discord_id).catch(() => null);
      if (!member) continue;

      // Nickname instellen op iRacing naam (of display_name als fallback)
      const nickname = profile.iracing_name || profile.display_name;
      if (nickname && member.displayName !== nickname) {
        const result = await member.setNickname(nickname).catch(e => e);
        if (result instanceof Error) {
          if (result.message !== 'Missing Permissions') console.error(`[syncTeamRoles] Nickname fout voor ${member.user.tag}: ${result.message}`);
        } else {
          console.log(`[syncTeamRoles] Nickname gezet: ${member.user.tag} → ${nickname}`);
        }
      }

      // Team rollen
      const userTeams = memberships?.filter(m => m.user_id === profile.user_id) || [];
      const expectedRoleIds = userTeams.map(m => teams.find(t => t.id === m.team_id)?.discord_role_id).filter(Boolean);

      for (const team of teams) {
        if (!team.discord_role_id) continue;
        const shouldHave = expectedRoleIds.includes(team.discord_role_id);
        const hasIt = member.roles.cache.has(team.discord_role_id);
        if (shouldHave && !hasIt) await member.roles.add(team.discord_role_id).catch(() => {});
        if (!shouldHave && hasIt) await member.roles.remove(team.discord_role_id).catch(() => {});
      }

      // Admin rol sync
      if (syncCfg.admin_role_id) {
        const isAdmin = adminRoles?.some(r => r.user_id === profile.user_id && ['admin', 'super_admin'].includes(r.role));
        const hasAdminRole = member.roles.cache.has(syncCfg.admin_role_id);
        if (isAdmin && !hasAdminRole) await member.roles.add(syncCfg.admin_role_id).catch(() => {});
        if (!isAdmin && hasAdminRole) await member.roles.remove(syncCfg.admin_role_id).catch(() => {});
      }

      // Steward rol sync
      if (syncCfg.steward_role_id) {
        const isSteward = adminRoles?.some(r => r.user_id === profile.user_id && r.role === 'moderator');
        const hasStewardRole = member.roles.cache.has(syncCfg.steward_role_id);
        if (isSteward && !hasStewardRole) await member.roles.add(syncCfg.steward_role_id).catch(() => {});
        if (!isSteward && hasStewardRole) await member.roles.remove(syncCfg.steward_role_id).catch(() => {});
      }
    } catch (e) {
      botLog('[syncTeamRoles] lid fout:', e.message);
    }
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
      botLog('[guildMemberAdd] Kick fout:', e.message);
    }
    return;
  }

  if (!cfg.rijder_role_id) return;

  botLog(`👋 Nieuw lid: **${member.user.tag}** (account ${Math.floor(accountAgeDays)} dagen oud)`);

  try {
    await member.roles.add(cfg.rijder_role_id);
  } catch (e) {
    botLog(`❌ Rijder rol fout voor ${member.user.tag}: ${e.message}`);
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
    guild_id:               guild.id,
    meldingen_channel_id:   resolvedChannels.meldingen,
    uitslagen_channel_id:   resolvedChannels.uitslagen,
    kalender_channel_id:    resolvedChannels.kalender,
    welkom_channel_id:      resolvedChannels.welkom,
    bot_logs_channel_id:    resolvedChannels.bot_logs,
    steward_channel_id:     resolvedChannels.steward_chat,
    rijder_role_id:         resolvedRoles.rijder_role,
    admin_role_id:          resolvedRoles.admin_role,
    steward_role_id:        resolvedRoles.steward_role,
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
  await updateCalendarEmbed().catch(e => log('Kalender fout: ' + e.message));
  await syncTeamRoles().catch(e => log('Sync fout: ' + e.message));

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
  } catch (e) { botLog('[3SM Bot] Commands registreren mislukt:', e.message); }
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
  } catch (e) { botLog('[interaction]', e.message); }
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
    return interaction.reply({ content: '❌ Er ging iets mis bij het aanmaken van de koppellink. Probeer het opnieuw.', flags: 64 });
  }

  const link = `${siteUrl}/koppel?token=${data.token}`;
  botLog(`🔗 Koppellink aangevraagd door **${discordTag}**`);

  return interaction.reply({
    content: `🔗 **Koppel je account**\n\nKlik op onderstaande link om je Discord te koppelen aan je 3SM profiel. De link is **30 minuten** geldig.\n\n${link}\n\n> Je moet ingelogd zijn op de site om de koppeling te voltooien.`,
    flags: 64,
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
    return interaction.reply({ content: 'Geen aankomende races gevonden.', flags: 64 });
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

  await interaction.reply({ embeds: [embed], components: [row], flags: 64 });
  setTimeout(() => interaction.deleteReply().catch(() => {}), 20_000);
}

// /aanmelden of /afmelden
async function handleRegister(interaction, action) {
  const { data: race } = await supabase
    .from('races').select('id, name').eq('status', 'upcoming')
    .gte('race_date', new Date().toISOString())
    .order('race_date', { ascending: true }).limit(1).maybeSingle();

  if (!race) return interaction.reply({ content: 'Geen aankomende race gevonden.', flags: 64 });
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

  if (error) return interaction.reply({ content: '❌ Er ging iets mis.', flags: 64 });

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
  setTimeout(() => interaction.deleteReply().catch(() => {}), 2_000);
}

// ── Bot ready ─────────────────────────────────────────────────────────────────
client.once('ready', async () => {
  console.log(`[3SM Bot] Online als ${client.user.tag}`);
  setTimeout(() => botLog(`✅ Bot online als **${client.user.tag}**`), 3000);
  for (const [, guild] of client.guilds.cache) {
    await registerCommands(guild.id);
  }

  // Elke minuut: race checks + aanmeldingen + koppelingen
  cron.schedule('* * * * *', () => checkRaces().catch(e => botLog(`[cron:checkRaces] ${e.message}`)));
  cron.schedule('* * * * *', () => checkAnnouncements().catch(e => botLog(`[cron:announcements] ${e.message}`)));
  cron.schedule('* * * * *', () => checkNewRegistrations().catch(e => botLog(`[cron:checkRegistrations] ${e.message}`)));
  cron.schedule('* * * * *', () => checkNewLinks().catch(e => botLog(`[cron:checkLinks] ${e.message}`)));
  cron.schedule('* * * * *', () => checkProtests().catch(e => botLog(`[cron:checkProtests] ${e.message}`)));
  cron.schedule('* * * * *', () => checkAbandonPenalties().catch(e => botLog(`[cron:checkAbandon] ${e.message}`)));
  cron.schedule('* * * * *', () => checkAbandonCorrections().catch(e => botLog(`[cron:checkAbandonCorrections] ${e.message}`)));
  cron.schedule('* * * * *', () => checkStewardPenalties().catch(e => botLog(`[cron:checkStewardPenalties] ${e.message}`)));
  cron.schedule('* * * * *', () => checkStewardCorrections().catch(e => botLog(`[cron:checkStewardCorrections] ${e.message}`)));
  // Elke 5 minuten: team rol sync
  cron.schedule('*/5 * * * *', () => syncTeamRoles().catch(e => botLog(`[cron:syncTeamRoles] ${e.message}`)));
  // Elk uur: kalender update + token cleanup
  cron.schedule('0 * * * *', async () => {
    await updateCalendarEmbed().catch(e => botLog(`[cron:kalender] ${e.message}`));
    const { error } = await supabase.from('discord_link_tokens')
      .delete()
      .or(`used.eq.true,expires_at.lt.${new Date().toISOString()}`);
    if (error) botLog(`❌ Token cleanup fout: ${error.message}`);
  });

  checkRaces().catch(() => {});
  updateCalendarEmbed().catch(() => {});
  syncTeamRoles().catch(() => {});
});

client.login(process.env.DISCORD_BOT_TOKEN);
