import 'dotenv/config';
import {
  Client, GatewayIntentBits, EmbedBuilder,
  ButtonBuilder, ButtonStyle, ActionRowBuilder,
  REST, Routes, SlashCommandBuilder,
} from 'discord.js';
import { createClient } from '@supabase/supabase-js';
import cron from 'node-cron';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SENT_FILE = path.join(__dirname, 'sent_notifications.json');

// ── Supabase ──────────────────────────────────────────────────────────────────
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

// ── Discord client ────────────────────────────────────────────────────────────
const client = new Client({ intents: [GatewayIntentBits.Guilds] });

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

async function getChannel() {
  const ch = await client.channels.fetch(process.env.DISCORD_CHANNEL_ID).catch(() => null);
  if (!ch) console.error('[bot] Channel niet gevonden');
  return ch;
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

  const channel = await getChannel();
  if (!channel) return;

  for (const race of races) {
    const diff = new Date(race.race_date).getTime() - now.getTime();
    for (const win of WINDOWS) {
      if (diff > 0 && diff <= win.ms && !wasSent(race.id, win.key)) {
        try {
          const embed = buildReminderEmbed(race, win.key);
          // 24h notification gets aanmelden buttons
          const components = win.key === '24h' ? [registrationRow(race.id)] : [];
          await channel.send({ embeds: [embed], components });
          markSent(race.id, win.key);
          console.log(`[${new Date().toISOString()}] ✓ ${win.key}: ${race.name}`);
        } catch (err) {
          console.error('[checkUpcoming]', err.message);
        }
      }
    }
  }
}

// ── Cron: live ────────────────────────────────────────────────────────────────
async function checkLive() {
  const { data: races, error } = await supabase.from('races').select('id, name, track, round, race_date').eq('status', 'live');
  if (error) { console.error('[checkLive]', error.message); return; }
  if (!races?.length) return;
  const channel = await getChannel(); if (!channel) return;
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
  const channel = await getChannel(); if (!channel) return;
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
  const channel = await getChannel(); if (!channel) return;
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

// ── Slash commands ────────────────────────────────────────────────────────────
const COMMANDS = [
  new SlashCommandBuilder()
    .setName('koppel')
    .setDescription('Koppel je Discord account aan je 3SM profiel')
    .addStringOption(o => o.setName('code').setDescription('De koppelcode van je profielpagina').setRequired(true)),
  new SlashCommandBuilder()
    .setName('races')
    .setDescription('Bekijk aankomende races en meld je aan'),
  new SlashCommandBuilder()
    .setName('aanmelden')
    .setDescription('Meld je aan voor de eerstvolgende race'),
  new SlashCommandBuilder()
    .setName('afmelden')
    .setDescription('Meld je af voor de eerstvolgende race'),
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
      if (interaction.commandName === 'koppel')    await handleKoppel(interaction);
      if (interaction.commandName === 'races')     await handleRaces(interaction);
      if (interaction.commandName === 'aanmelden') await handleRegister(interaction, 'register');
      if (interaction.commandName === 'afmelden')  await handleRegister(interaction, 'unregister');
    } else if (interaction.isButton()) {
      const [action, raceId] = interaction.customId.split('_');
      if (action === 'aanmelden') await handleButtonReg(interaction, raceId, 'register');
      if (action === 'afmelden')  await handleButtonReg(interaction, raceId, 'unregister');
    }
  } catch (e) { console.error('[interaction]', e.message); }
});

// /koppel <code>
async function handleKoppel(interaction) {
  const code      = interaction.options.getString('code').toUpperCase();
  const discordId = interaction.user.id;

  const { data, error } = await supabase.rpc('discord_link_account', { p_discord_id: discordId, p_code: code });

  if (error || data !== 'ok') {
    return interaction.reply({ content: '❌ Ongeldige of verlopen code. Genereer een nieuwe code op je profielpagina.', ephemeral: true });
  }
  interaction.reply({ content: '✅ Je Discord is gekoppeld aan je 3SM profiel! Je kan nu aanmelden via Discord.', ephemeral: true });
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

  // Check of gebruiker al aangemeld is
  const { data: profile } = await supabase
    .from('profiles').select('user_id').eq('discord_id', discordId).maybeSingle();

  let isRegistered = false;
  if (profile) {
    const { data: reg } = await supabase
      .from('race_registrations').select('id')
      .eq('race_id', next.id).eq('user_id', profile.user_id).maybeSingle();
    isRegistered = !!reg;
  }

  const statusLine = isRegistered
    ? `\n\n✅ **Je bent aangemeld voor ${nextRonde}**`
    : profile ? `\n\n⬜ Je bent nog niet aangemeld voor ${nextRonde}` : '';

  const embed = new EmbedBuilder()
    .setColor(isRegistered ? 0x22c55e : 0xf97316)
    .setTitle('🏁  Aankomende Races')
    .setDescription(races.map((r, i) => {
      const ronde = r.round != null ? `R${r.round} · ` : '';
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

  interaction.reply({ embeds: [embed], components: [row], ephemeral: true });
}

// /aanmelden of /afmelden (eerstvolgende race)
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
      content: '❌ Je Discord is nog niet gekoppeld. Ga naar je profielpagina op de site → Discord Koppeling → genereer een code → typ `/koppel <code>` hier.',
      ephemeral: true,
    });
  }

  const msg = data === 'registered'
    ? `✅ Je bent aangemeld voor **${raceName}**!`
    : `✅ Je bent afgemeld voor **${raceName}**.`;

  interaction.reply({ content: msg, ephemeral: true });
}

// ── Bot ready ─────────────────────────────────────────────────────────────────
client.once('ready', async () => {
  console.log(`[3SM Bot] Online als ${client.user.tag}`);
  const guild = client.guilds.cache.first();
  if (guild) await registerCommands(guild.id);
  cron.schedule('* * * * *', checkRaces);
  checkRaces();
});

client.login(process.env.DISCORD_BOT_TOKEN);
