/**
 * fetchIRacingTrackImages.js
 *
 * Haalt track images op van iracing.com/tracks/ en slaat ze lokaal op.
 * Genereert ook een mapping file (trackPhotoMap.json) met track naam → lokaal pad.
 *
 * Gebruik:
 *   node scripts/fetchIRacingTrackImages.js
 *
 * Output:
 *   public/tracks/photos/{track-slug}.jpg
 *   scripts/trackPhotoMap.json  (voor in trackPhotos.ts)
 */

import https from "https";
import http from "http";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUTPUT_DIR = path.join(__dirname, "../public/tracks/photos");
const MAP_FILE = path.join(__dirname, "trackPhotoMap.json");

if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR, { recursive: true });

// ── Fetch helpers ─────────────────────────────────────────────────────────────
function fetchText(url) {
  return new Promise((resolve, reject) => {
    const protocol = url.startsWith("https") ? https : http;
    let data = "";
    const req = protocol.get(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml,*/*",
        "Accept-Language": "en-US,en;q=0.9",
      }
    }, (res) => {
      if (res.statusCode === 301 || res.statusCode === 302) {
        return fetchText(res.headers.location).then(resolve).catch(reject);
      }
      res.setEncoding("utf8");
      res.on("data", chunk => data += chunk);
      res.on("end", () => resolve(data));
    });
    req.on("error", reject);
    req.setTimeout(15000, () => { req.destroy(); reject(new Error("Timeout")); });
  });
}

function downloadFile(url, dest) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(dest);
    const protocol = url.startsWith("https") ? https : http;
    const req = protocol.get(url, {
      headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36" }
    }, (res) => {
      if (res.statusCode === 301 || res.statusCode === 302) {
        file.close();
        if (fs.existsSync(dest)) fs.unlinkSync(dest);
        return downloadFile(res.headers.location, dest).then(resolve).catch(reject);
      }
      if (res.statusCode !== 200) {
        file.close();
        if (fs.existsSync(dest)) fs.unlinkSync(dest);
        return reject(new Error(`HTTP ${res.statusCode}`));
      }
      res.pipe(file);
      file.on("finish", () => { file.close(); resolve(); });
    });
    req.on("error", err => { if (fs.existsSync(dest)) fs.unlinkSync(dest); reject(err); });
    req.setTimeout(20000, () => { req.destroy(); reject(new Error("Timeout")); });
  });
}

function slug(name) {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

// ── Parse track cards from HTML ───────────────────────────────────────────────
function parseTrackCards(html) {
  const tracks = [];

  // iRacing track cards hebben een data-src of src in een img, plus een titel
  // Patroon: <article ...> of <div class="...track..."> met img en h2/h3
  // We zoeken naar s100.iracing.com image URLs + bijbehorende namen

  // Match alle track card blokken
  const cardRegex = /<(?:article|div)[^>]*class="[^"]*track[^"]*"[^>]*>([\s\S]*?)<\/(?:article|div)>/gi;
  const imgRegex = /(?:src|data-src|data-lazy-src)="(https:\/\/s100\.iracing\.com\/wp-content\/uploads\/[^"]+\.(?:jpg|jpeg|png|webp))"/i;
  const nameRegex = /<(?:h[1-6]|a)[^>]*>([^<]{3,80})<\/(?:h[1-6]|a)>/i;

  // Simpelere benadering: vind alle s100 image URLs met context
  const allImgPattern = /(https:\/\/s100\.iracing\.com\/wp-content\/uploads\/\d{4}\/\d{2}\/[^"'\s]+(?:feature|thumb|header)[^"'\s]*\.(?:jpg|jpeg|png|webp))/gi;
  const titlePattern = /["']track_name["']\s*:\s*["']([^"']+)["']/gi;

  // Methode 1: zoek JSON data in de pagina (vaak in script tags)
  const jsonDataMatch = html.match(/var\s+tracksData\s*=\s*(\[[\s\S]*?\]);/);
  if (jsonDataMatch) {
    try {
      const data = JSON.parse(jsonDataMatch[1]);
      data.forEach(t => {
        if (t.name && t.image) tracks.push({ name: t.name, imageUrl: t.image });
      });
    } catch {}
  }

  if (tracks.length > 0) return tracks;

  // Methode 2: zoek img tags met s100.iracing.com + nabijgelegen titel
  const imgUrlMatches = [...html.matchAll(/(https:\/\/s100\.iracing\.com\/wp-content\/uploads\/[^"'\s]+\.(?:jpg|jpeg|png|webp))/gi)];

  imgUrlMatches.forEach(match => {
    const url = match[1];
    if (!url.includes("feature") && !url.includes("thumb") && !url.includes("350x")) return;

    // Vind de context rondom deze URL (500 chars voor en na)
    const pos = match.index;
    const context = html.substring(Math.max(0, pos - 500), pos + 200);

    // Zoek een track naam in de context
    const titleMatch = context.match(/<(?:h[1-6]|span|div)[^>]*class="[^"]*(?:title|name|track)[^"]*"[^>]*>([^<]{3,60})<\//i)
      || context.match(/alt="([^"]{3,60})"/i)
      || context.match(/<h\d[^>]*>([^<]{3,60})<\/h\d>/i);

    if (titleMatch) {
      const name = titleMatch[1].trim().replace(/&#\d+;/g, "").replace(/&amp;/g, "&").replace(/&nbsp;/g, " ");
      if (name && name.length > 2) {
        tracks.push({ name, imageUrl: url });
      }
    } else {
      // Gebruik URL als naam fallback
      const urlName = url.split("/").pop().replace(/-feature.*/, "").replace(/-\d+x\d+.*/, "").replace(/-/g, " ");
      tracks.push({ name: urlName, imageUrl: url });
    }
  });

  return tracks;
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  console.log("\n🏎  iRacing Track Image Downloader");
  console.log("═══════════════════════════════════\n");

  console.log("⬇  Fetching iracing.com/tracks/ ...");
  let html;
  try {
    html = await fetchText("https://www.iracing.com/tracks/");
  } catch (err) {
    console.error("✗  Kon pagina niet laden:", err.message);
    process.exit(1);
  }

  console.log(`✓  Pagina geladen (${Math.round(html.length / 1024)} KB)\n`);

  const tracks = parseTrackCards(html);

  if (tracks.length === 0) {
    console.log("⚠  Geen track images gevonden in de pagina HTML.");
    console.log("   iRacing laadt mogelijk images via JavaScript (SPA).");
    console.log("\n📝 Alternatief: open iracing.com/tracks/ in je browser,");
    console.log("   druk F12 → Network tab → filter op '.jpg' → kopieer de URLs.\n");
    process.exit(0);
  }

  console.log(`📦 ${tracks.length} tracks gevonden\n`);

  const map = {};
  let ok = 0, skip = 0, fail = 0;

  for (const track of tracks) {
    const trackSlug = slug(track.name);
    const ext = path.extname(track.imageUrl).split("?")[0] || ".jpg";
    const dest = path.join(OUTPUT_DIR, `${trackSlug}${ext}`);
    const localPath = `/tracks/photos/${trackSlug}${ext}`;

    map[track.name] = localPath;

    if (fs.existsSync(dest)) {
      console.log(`⏭  Skip: ${track.name}`);
      skip++;
      continue;
    }

    process.stdout.write(`⬇  ${track.name.padEnd(50)} `);
    try {
      await downloadFile(track.imageUrl, dest);
      console.log("✓");
      ok++;
    } catch (err) {
      console.log(`✗  ${err.message}`);
      fail++;
    }

    await sleep(500);
  }

  // Sla mapping op
  fs.writeFileSync(MAP_FILE, JSON.stringify(map, null, 2));

  console.log(`\n──────────────────────────────`);
  console.log(`✓ Gedownload:   ${ok}`);
  console.log(`⏭ Overgeslagen: ${skip}`);
  console.log(`✗ Mislukt:      ${fail}`);
  console.log(`\n📄 Mapping opgeslagen: ${MAP_FILE}`);
  console.log(`🖼  Images in: ${OUTPUT_DIR}`);
  console.log("\nKlaar! Voer nu 'node scripts/generateTrackPhotoImports.js' uit");
  console.log("om trackPhotos.ts automatisch bij te werken.\n");
}

main().catch(console.error);
