/**
 * fetchTrackImages.js — EENMALIG script om track images te downloaden
 *
 * ⚠️  Dit script is NIET gekoppeld aan de website.
 * ⚠️  NIET automatisch uitvoeren. Alleen handmatig starten als je lokale images wil.
 *
 * Gebruik:
 *   node scripts/fetchTrackImages.js
 *
 * Downloadt alle circuit images naar:
 *   public/tracks/{slug}.png
 *
 * Vereisten:
 *   Node.js 18+ (heeft ingebouwde fetch)
 */

import https from "https";
import http from "http";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ── Track data (kopie van src/lib/trackData.ts URLs) ─────────────────────────
const WP = "https://upload.wikimedia.org/wikipedia/commons/thumb/";

const TRACKS = {
  "Circuit de Spa-Francorchamps": `${WP}5/54/Spa-Francorchamps_of_Belgium.svg/330px-Spa-Francorchamps_of_Belgium.svg.png`,
  "Circuit Zolder": `${WP}e/e2/Zolder.svg/330px-Zolder.svg.png`,
  "Autodromo Nazionale Monza": `${WP}f/f8/Monza_track_map.svg/330px-Monza_track_map.svg.png`,
  "Silverstone Circuit": `${WP}b/bd/Silverstone_Circuit_2020.png/330px-Silverstone_Circuit_2020.png`,
  "Circuit de Monaco": `${WP}3/36/Monte_Carlo_Formula_1_track_map.svg/330px-Monte_Carlo_Formula_1_track_map.svg.png`,
  "Circuit de Barcelona-Catalunya": `${WP}8/87/Circuit_de_Catalunya_moto_2021.svg/330px-Circuit_de_Catalunya_moto_2021.svg.png`,
  "Circuit Zandvoort": `${WP}7/78/Zandvoort_Circuit.png/330px-Zandvoort_Circuit.png`,
  "Nürburgring Combined": `${WP}3/36/Circuit_N%C3%BCrburgring-2013-GP.svg/330px-Circuit_N%C3%BCrburgring-2013-GP.svg.png`,
  "Hockenheimring Baden-Württemberg": `${WP}6/66/Hockenheim.svg/330px-Hockenheim.svg.png`,
  "Red Bull Ring": `${WP}f/f5/Red_Bull_Ring_Austria.svg/330px-Red_Bull_Ring_Austria.svg.png`,
  "Hungaroring": `${WP}4/43/Hungaroring.svg/330px-Hungaroring.svg.png`,
  "Circuit de Nevers Magny-Cours": `${WP}6/63/Magny_Cours.svg/330px-Magny_Cours.svg.png`,
  "Circuit Paul Ricard": `${WP}4/42/Paul_Ricard.svg/330px-Paul_Ricard.svg.png`,
  "Circuit de la Sarthe": `${WP}7/74/Le_Mans_circuit_2018.svg/330px-Le_Mans_circuit_2018.svg.png`,
  "Autodromo Enzo e Dino Ferrari": `${WP}2/22/Imola_2009.svg/330px-Imola_2009.svg.png`,
  "Brands Hatch Circuit": `${WP}e/e4/Brands_Hatch.svg/330px-Brands_Hatch.svg.png`,
  "Indianapolis Motor Speedway": `${WP}b/b1/Indianapolis_Motor_Speedway_-_road_course.svg/330px-Indianapolis_Motor_Speedway_-_road_course.svg.png`,
  "Watkins Glen International": `${WP}6/69/Watkins_Glen.svg/330px-Watkins_Glen.svg.png`,
  "Road America": `${WP}e/e3/Road_America_track_map.svg/330px-Road_America_track_map.svg.png`,
};

// ── Output folder ────────────────────────────────────────────────────────────
const OUTPUT_DIR = path.join(__dirname, "../public/tracks");

if (!fs.existsSync(OUTPUT_DIR)) {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  console.log(`📁 Map aangemaakt: ${OUTPUT_DIR}`);
}

// ── Helpers ─────────────────────────────────────────────────────────────────
function trackSlug(name) {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function download(url, dest) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(dest);
    const protocol = url.startsWith("https") ? https : http;

    const req = protocol.get(url, { headers: { "User-Agent": "Mozilla/5.0 TrackImageFetcher/1.0" } }, (res) => {
      if (res.statusCode === 301 || res.statusCode === 302) {
        file.close();
        fs.unlinkSync(dest);
        return download(res.headers.location, dest).then(resolve).catch(reject);
      }
      if (res.statusCode !== 200) {
        file.close();
        fs.unlinkSync(dest);
        return reject(new Error(`HTTP ${res.statusCode}`));
      }
      res.pipe(file);
      file.on("finish", () => { file.close(); resolve(); });
    });

    req.on("error", (err) => {
      fs.unlink(dest, () => {});
      reject(err);
    });
  });
}

// ── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  const tracks = Object.entries(TRACKS);
  console.log(`\n🏁 Track image downloader`);
  console.log(`📦 ${tracks.length} tracks te downloaden naar ${OUTPUT_DIR}\n`);

  let ok = 0, skip = 0, fail = 0;

  for (const [name, url] of tracks) {
    const slug = trackSlug(name);
    const dest = path.join(OUTPUT_DIR, `${slug}.png`);

    if (fs.existsSync(dest)) {
      console.log(`⏭  Skip (bestaat al): ${slug}.png`);
      skip++;
      continue;
    }

    process.stdout.write(`⬇  ${name.padEnd(45)} `);
    let success = false;
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        await download(url, dest);
        success = true;
        break;
      } catch (err) {
        if (attempt < 3 && err.message.includes("429")) {
          process.stdout.write(`⏳ retry ${attempt}... `);
          await new Promise((r) => setTimeout(r, 5000 * attempt));
        } else {
          console.log(`✗  ${err.message}`);
          fail++;
          break;
        }
      }
    }
    if (success) { console.log(`✓`); ok++; }

    // Pauze om rate limiting te vermijden
    await new Promise((r) => setTimeout(r, 2000));
  }

  console.log(`\n──────────────────────────────`);
  console.log(`✓ Gedownload:  ${ok}`);
  console.log(`⏭ Overgeslagen: ${skip}`);
  console.log(`✗ Mislukt:     ${fail}`);
  console.log(`\nKlaar! Images staan in: ${OUTPUT_DIR}`);
  console.log(`\nVoeg toe aan vite.config.ts als je ze wil serveren:`);
  console.log(`  assetsDir: 'tracks'  (of zet ze in public/tracks/)\n`);
}

main().catch(console.error);
