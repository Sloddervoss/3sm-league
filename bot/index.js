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

// ── Build Discord embed ───────────────────────────────────────────────────────
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

  const configs = {
    '24h': {
      color: 0x3b82f6,
      title: `🏁  Race morgen — ${race.name}`,
      description: `**Ronde ${race.round}** gaat morgen van start.\nZorg dat je klaarstaat en je setup klaar hebt!`,
    },
    '1h': {
      color: 0xf97316,
      title: `⏱️  Race over 1 uur — ${race.name}`,
      description: `**Ronde ${race.round}** begint over een uur.\nOpen iRacing en warm op!`,
    },
    '15m': {
      color: 0xef4444,
      title: `🚨  Race over 15 minuten — ${race.name}`,
      description: `**Ronde ${race.round}** begint zo!\nGa naar de grid — succes allemaal!`,
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

// ── Main check — runs every minute ───────────────────────────────────────────
async function checkRaces() {
  const now = new Date();
  // Only look at races in the next 25 hours
  const lookahead = new Date(now.getTime() + 25 * 60 * 60 * 1000);

  const { data: races, error } = await supabase
    .from('races')
    .select('id, name, track, round, race_date')
    .eq('status', 'upcoming')
    .gte('race_date', now.toISOString())
    .lte('race_date', lookahead.toISOString());

  if (error) {
    console.error('[checkRaces] Supabase error:', error.message);
    return;
  }
  if (!races || races.length === 0) return;

  const channel = await client.channels.fetch(process.env.DISCORD_CHANNEL_ID).catch(() => null);
  if (!channel) {
    console.error('[checkRaces] Channel niet gevonden:', process.env.DISCORD_CHANNEL_ID);
    return;
  }

  for (const race of races) {
    const diff = new Date(race.race_date).getTime() - now.getTime();

    for (const win of WINDOWS) {
      // Fire as soon as diff drops at or below the threshold, but race hasn't started yet
      if (diff > 0 && diff <= win.ms && !wasSent(race.id, win.key)) {
        try {
          await channel.send({ embeds: [buildEmbed(race, win.key)] });
          markSent(race.id, win.key);
          console.log(`[${new Date().toISOString()}] ✓ ${win.key} melding verstuurd voor: ${race.name}`);
        } catch (err) {
          console.error(`[checkRaces] Fout bij versturen embed:`, err.message);
        }
      }
    }
  }
}

// ── Bot ready ─────────────────────────────────────────────────────────────────
client.once('ready', () => {
  console.log(`[3SM Bot] Online als ${client.user.tag}`);
  // Run every minute
  cron.schedule('* * * * *', checkRaces);
  // Also run immediately on startup
  checkRaces();
});

client.login(process.env.DISCORD_BOT_TOKEN);
