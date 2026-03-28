import 'dotenv/config';
import { Client, GatewayIntentBits, EmbedBuilder } from 'discord.js';
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

// ── Sent-notification tracking (persisted to disk) ────────────────────────────
function loadSent() {
  try {
    return JSON.parse(fs.readFileSync(SENT_FILE, 'utf8'));
  } catch {
    return {};
  }
}

function markSent(raceId, type) {
  const sent = loadSent();
  sent[`${raceId}_${type}`] = new Date().toISOString();
  fs.writeFileSync(SENT_FILE, JSON.stringify(sent, null, 2));
}

function wasSent(raceId, type) {
  return !!loadSent()[`${raceId}_${type}`];
}

// ── Notification windows ──────────────────────────────────────────────────────
const WINDOWS = [
  { key: '24h', ms: 24 * 60 * 60 * 1000 },
  { key: '1h',  ms:      60 * 60 * 1000 },
  { key: '15m', ms:      15 * 60 * 1000 },
];

const MEDALS = ['🥇', '🥈', '🥉'];

// ── Build reminder embed ──────────────────────────────────────────────────────
function buildEmbed(race, windowKey) {
  const raceDate = new Date(race.race_date);
  const dateStr = raceDate.toLocaleDateString('nl-NL', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
    timeZone: 'Europe/Amsterdam',
  });
  const timeStr = raceDate.toLocaleTimeString('nl-NL', {
    hour: '2-digit', minute: '2-digit',
    timeZone: 'Europe/Amsterdam',
  });

  const ronde = race.round != null ? `Ronde ${race.round}` : race.name;

  const configs = {
    '24h': {
      color: 0x3b82f6,
      title: `🏁  Race morgen — ${race.name}`,
      description: `**${ronde}** gaat morgen van start.\nZorg dat je klaarstaat en je setup klaar hebt!`,
    },
    '1h': {
      color: 0xf97316,
      title: `⏱️  Race over 1 uur — ${race.name}`,
      description: `**${ronde}** begint over een uur.\nOpen iRacing en warm op!`,
    },
    '15m': {
      color: 0xef4444,
      title: `🚨  Race over 15 minuten — ${race.name}`,
      description: `**${ronde}** begint zo!\nGa naar de grid — succes allemaal!`,
    },
    'live': {
      color: 0x22c55e,
      title: `🟢  Race gestart — ${race.name}`,
      description: `**${ronde}** is officieel van start gegaan!\nVeel succes op de baan! 🏎️`,
    },
    'cancelled': {
      color: 0x6b7280,
      title: `❌  Race gecanceld — ${race.name}`,
      description: `**${ronde}** is helaas gecanceld.\nHoud de site in de gaten voor meer informatie.`,
    },
  };

  const cfg = configs[windowKey];

  return new EmbedBuilder()
    .setColor(cfg.color)
    .setTitle(cfg.title)
    .setDescription(cfg.description)
    .addFields(
      { name: '🗓️ Datum',   value: dateStr,   inline: true },
      { name: '🕐 Tijd',    value: timeStr,   inline: true },
      { name: '🏎️ Circuit', value: race.track, inline: true },
    )
    .setFooter({ text: '3 Stripe Motorsport' })
    .setTimestamp();
}

// ── Build podium embed ────────────────────────────────────────────────────────
function buildPodiumEmbed(race, results) {
  const ronde = race.round != null ? `Ronde ${race.round}` : race.name;
  const raceDate = new Date(race.race_date);
  const dateStr = raceDate.toLocaleDateString('nl-NL', {
    day: 'numeric', month: 'long', year: 'numeric',
    timeZone: 'Europe/Amsterdam',
  });

  const finishers = results.filter(r => !r.dnf);
  const podium = finishers.slice(0, 3);
  const fastestLap = results.find(r => r.fastest_lap);

  // Podium lines
  const podiumLines = podium.map((r, i) => {
    const name = r.profiles?.display_name || 'Onbekend';
    const pts = r.points > 0 ? ` · **${r.points} pts**` : '';
    const gap = i > 0 && r.gap_to_leader ? ` · +${r.gap_to_leader}` : '';
    return `${MEDALS[i]} **${name}**${pts}${gap}`;
  }).join('\n');

  const embed = new EmbedBuilder()
    .setColor(0xf59e0b)
    .setTitle(`🏆  Race uitslag — ${race.name}`)
    .setDescription(`**${ronde}** is afgelopen! Bekijk de volledige uitslag op de site.`)
    .addFields(
      { name: '🗓️ Circuit', value: `${race.track} · ${dateStr}`, inline: false },
      { name: '🏅 Podium', value: podiumLines || 'Geen resultaten', inline: false },
    );

  if (fastestLap) {
    const flName = fastestLap.profiles?.display_name || 'Onbekend';
    embed.addFields({ name: '⚡ Snelste ronde', value: `**${flName}**`, inline: true });
  }

  const dnfCount = results.filter(r => r.dnf).length;
  if (dnfCount > 0) {
    embed.addFields({ name: '🔴 DNF', value: `${dnfCount}`, inline: true });
  }

  embed
    .addFields({ name: '👥 Finishers', value: `${finishers.length}`, inline: true })
    .setFooter({ text: '3 Stripe Motorsport' })
    .setTimestamp();

  return embed;
}

// ── Helper: fetch channel ─────────────────────────────────────────────────────
async function getChannel() {
  const channel = await client.channels.fetch(process.env.DISCORD_CHANNEL_ID).catch(() => null);
  if (!channel) console.error('[bot] Channel niet gevonden:', process.env.DISCORD_CHANNEL_ID);
  return channel;
}

// ── Check upcoming races (24h / 1h / 15m reminders) ──────────────────────────
async function checkUpcoming() {
  const now = new Date();
  const lookahead = new Date(now.getTime() + 25 * 60 * 60 * 1000);

  const { data: races, error } = await supabase
    .from('races')
    .select('id, name, track, round, race_date')
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
          await channel.send({ embeds: [buildEmbed(race, win.key)] });
          markSent(race.id, win.key);
          console.log(`[${new Date().toISOString()}] ✓ ${win.key} melding: ${race.name}`);
        } catch (err) {
          console.error('[checkUpcoming] Versturen mislukt:', err.message);
        }
      }
    }
  }
}

// ── Check live races ──────────────────────────────────────────────────────────
async function checkLive() {
  const { data: races, error } = await supabase
    .from('races')
    .select('id, name, track, round, race_date')
    .eq('status', 'live');

  if (error) { console.error('[checkLive]', error.message); return; }
  if (!races?.length) return;

  const channel = await getChannel();
  if (!channel) return;

  for (const race of races) {
    if (!wasSent(race.id, 'live')) {
      try {
        await channel.send({ embeds: [buildEmbed(race, 'live')] });
        markSent(race.id, 'live');
        console.log(`[${new Date().toISOString()}] ✓ Live melding: ${race.name}`);
      } catch (err) {
        console.error('[checkLive] Versturen mislukt:', err.message);
      }
    }
  }
}

// ── Check cancelled races ─────────────────────────────────────────────────────
async function checkCancelled() {
  const { data: races, error } = await supabase
    .from('races')
    .select('id, name, track, round, race_date')
    .eq('status', 'cancelled');

  if (error) { console.error('[checkCancelled]', error.message); return; }
  if (!races?.length) return;

  const channel = await getChannel();
  if (!channel) return;

  for (const race of races) {
    if (!wasSent(race.id, 'cancelled')) {
      try {
        await channel.send({ embeds: [buildEmbed(race, 'cancelled')] });
        markSent(race.id, 'cancelled');
        console.log(`[${new Date().toISOString()}] ✓ Cancel melding: ${race.name}`);
      } catch (err) {
        console.error('[checkCancelled] Versturen mislukt:', err.message);
      }
    }
  }
}

// ── Check completed races — podium embed ──────────────────────────────────────
async function checkCompleted() {
  const { data: races, error } = await supabase
    .from('races')
    .select('id, name, track, round, race_date')
    .eq('status', 'completed');

  if (error) { console.error('[checkCompleted]', error.message); return; }
  if (!races?.length) return;

  const channel = await getChannel();
  if (!channel) return;

  for (const race of races) {
    if (wasSent(race.id, 'podium')) continue;

    // Fetch results with driver names
    const { data: results, error: re } = await supabase
      .from('race_results')
      .select('position, points, fastest_lap, dnf, gap_to_leader, profiles(display_name)')
      .eq('race_id', race.id)
      .order('position', { ascending: true });

    if (re) { console.error('[checkCompleted] Results error:', re.message); continue; }
    if (!results?.length) continue; // Geen resultaten geïmporteerd, wachten

    try {
      await channel.send({ embeds: [buildPodiumEmbed(race, results)] });
      markSent(race.id, 'podium');
      console.log(`[${new Date().toISOString()}] ✓ Podium embed: ${race.name}`);
    } catch (err) {
      console.error('[checkCompleted] Versturen mislukt:', err.message);
    }
  }
}

// ── Main check ────────────────────────────────────────────────────────────────
async function checkRaces() {
  await Promise.all([checkUpcoming(), checkLive(), checkCancelled(), checkCompleted()]);
}

// ── Bot ready ─────────────────────────────────────────────────────────────────
client.once('ready', () => {
  console.log(`[3SM Bot] Online als ${client.user.tag}`);
  cron.schedule('* * * * *', checkRaces);
  checkRaces();
});

client.login(process.env.DISCORD_BOT_TOKEN);
