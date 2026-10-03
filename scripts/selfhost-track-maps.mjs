/**
 * selfhost-track-maps.mjs — zet de Wikimedia-trackkaarten lokaal in de site.
 *
 * Waarom: `src/lib/trackData.ts` verwees voor 53 circuits naar
 * upload.wikimedia.org (hotlink). Dat kostte per bezoek een extra externe
 * verbinding, laat het IP van elke bezoeker bij Wikimedia achter, en gebruikt
 * CC BY-SA-materiaal zonder enige naamsvermelding — wat de licentie niet toestaat.
 *
 * Wat dit script doet (idempotent):
 *   1. leest de Wikimedia-URL's uit src/lib/trackData.ts;
 *   2. downloadt de 330px-thumbs naar public/tracks/wiki/<slug>.png;
 *   3. herschrijft trackData.ts naar de lokale paden;
 *   4. schrijft docs/operations/trackmap-attribution.md met per bestand de
 *      auteur, de licentie en de bron-URL (de naamsvermelding die CC BY-SA eist).
 *
 * Gebruik:
 *   node scripts/selfhost-track-maps.mjs            # alleen ontbrekende bestanden
 *   node scripts/selfhost-track-maps.mjs --force    # alles opnieuw ophalen
 */
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");
const TRACK_DATA_FILE = path.join(ROOT, "src/lib/trackData.ts");
const OUT_DIR = path.join(ROOT, "public/tracks/wiki");
const ATTRIBUTION_FILE = path.join(ROOT, "docs/operations/trackmap-attribution.md");
// Onthoudt welke Commons-bestanden lokaal staan, zodat de naamsvermelding ook
// klopt als trackData.ts daarna geen externe verwijzingen meer bevat.
const MANIFEST_FILE = path.join(ROOT, "scripts/trackmap-sources.json");
const UA = "3SM-trackmap-selfhost/1.0 (https://3stripemotorsport.cc; contact via Discord)";

const force = process.argv.includes("--force");

function slugFor(commonsFileName) {
  return commonsFileName
    .replace(/\.[a-z0-9]+$/i, "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Wikimedia begrenst snelle reeksen downloads (HTTP 429) en faalt soms tijdelijk (5xx). */
async function fetchBinary(url, poging = 1) {
  const res = await fetch(url, { headers: { "user-agent": UA } });
  if ((res.status === 429 || res.status >= 500) && poging <= 4) {
    const wacht = 2000 * poging;
    console.log(`  … HTTP ${res.status}, ${wacht / 1000}s wachten (poging ${poging})`);
    await sleep(wacht);
    return fetchBinary(url, poging + 1);
  }
  if (!res.ok) throw new Error(`HTTP ${res.status} voor ${url}`);
  return Buffer.from(await res.arrayBuffer());
}

async function licensesFor(commonsNames) {
  const out = {};
  for (let i = 0; i < commonsNames.length; i += 25) {
    const batch = commonsNames.slice(i, i + 25);
    const titles = batch.map((n) => `File:${n}`).join("|");
    const api =
      "https://commons.wikimedia.org/w/api.php?action=query&format=json&prop=imageinfo&iiprop=extmetadata" +
      `&titles=${encodeURIComponent(titles)}`;
    const res = await fetch(api, { headers: { "user-agent": UA } });
    const data = await res.json();
    for (const page of Object.values(data?.query?.pages ?? {})) {
      const name = (page.title ?? "").replace(/^File:/, "");
      const meta = page?.imageinfo?.[0]?.extmetadata ?? {};
      out[name] = {
        license: meta?.LicenseShortName?.value ?? "onbekend",
        licenseUrl: meta?.LicenseUrl?.value ?? "",
        author: (meta?.Artist?.value ?? "onbekend").replace(/<[^>]+>/g, "").trim().slice(0, 80),
      };
    }
  }
  return out;
}

const source = await fs.readFile(TRACK_DATA_FILE, "utf8");

const COMMONS_PREFIX = "https://upload.wikimedia.org/wikipedia/commons/";
// Let op: het patroon moet de openings-backtick meenemen. Zonder dat blijft er een
// losse backtick achter in het bestand en is trackData.ts niet meer te parsen.
const TEMPLATE_REF = /`\$\{WP\}([^`"']+?\.(?:png|svg|jpe?g|webp))`/gi;
const LITERAL_REF = /"(https:\/\/upload\.wikimedia\.org\/wikipedia\/commons\/[^"]+?\.(?:png|svg|jpe?g|webp))"/gi;

/** Pad na /commons/ -> bestandsnaam op Commons.
 *  Drie vormen komen voor in trackData.ts:
 *    thumb/5/54/Naam.svg/330px-Naam.svg.png   -> "Naam.svg"
 *    thumb/7/7e/Naam.png/330px-Naam.png       -> "Naam.png"
 *    7/79/Naam.png                            -> "Naam.png"
 *  Het formaat met een grootte-prefix (330px-) wordt herkend aan dat prefix. */
function commonsNameOf(remotePath) {
  const parts = remotePath.split("/").filter(Boolean);
  const last = decodeURIComponent(parts[parts.length - 1] ?? "");
  if (/^\d+px-/.test(last) && parts.length >= 2) {
    return decodeURIComponent(parts[parts.length - 2]);
  }
  return last;
}

const refs = [];
for (const m of source.matchAll(TEMPLATE_REF)) {
  refs.push({ form: "template", full: m[0], remotePath: m[1], commonsName: commonsNameOf(m[1]) });
}
for (const m of source.matchAll(LITERAL_REF)) {
  refs.push({
    form: "literal",
    full: m[0],
    remotePath: m[1].replace(COMMONS_PREFIX, ""),
    commonsName: commonsNameOf(m[1].replace(COMMONS_PREFIX, "")),
  });
}
// Geen verwijzingen meer? Dan alleen de administratie bijwerken (zie onder).
const unique = [...new Set(refs.map((r) => r.commonsName))];
console.log(`${refs.length} verwijzingen (${refs.filter((r) => r.form === "template").length} template, ` +
  `${refs.filter((r) => r.form === "literal").length} volledige URL), ${unique.length} unieke bestanden.`);

await fs.mkdir(OUT_DIR, { recursive: true });
const slugByName = new Map();
const overgeslagen = [];
let downloaded = 0;
let skipped = 0;

for (const commonsName of unique) {
  const slug = slugFor(commonsName);
  const fileName = `${slug}.png`;
  const target = path.join(OUT_DIR, fileName);
  if (!force) {
    try {
      await fs.access(target);
      slugByName.set(commonsName, fileName);
      skipped += 1;
      continue;
    } catch {
      /* nog niet aanwezig */
    }
  }
  const remote = refs.find((r) => r.commonsName === commonsName).remotePath;
  const url = `${COMMONS_PREFIX}${remote}`;
  // Sommige thumb-URL's bestaan niet (verkeerd formaat in de oude data). Val dan
  // terug op het originele bestand; dat is wat de pagina ook had moeten laden.
  const originalUrl = `${COMMONS_PREFIX}${remote.replace(/^thumb\//, "").replace(/\/\d+px-[^/]+$/, "")}`;
  try {
    let body;
    try {
      body = await fetchBinary(url);
    } catch {
      body = await fetchBinary(originalUrl);
      console.log(`  ~ thumb ontbrak, origineel gebruikt voor ${fileName}`);
    }
    await fs.writeFile(target, body);
    slugByName.set(commonsName, fileName);
    downloaded += 1;
    console.log(`  ↓ ${fileName} (${(body.length / 1024).toFixed(1)} kB)`);
  } catch (error) {
    // Eén onbereikbaar bestand mag de rest niet tegenhouden; die entry blijft dan
    // voorlopig naar Wikimedia wijzen en komt in de samenvatting te staan.
    overgeslagen.push(`${commonsName} (${error.message.split(" ").slice(0, 2).join(" ")})`);
    continue;
  }
  await sleep(400); // vriendelijk blijven voor Wikimedia
}

// trackData.ts herschrijven: zowel `${WP}…` als de volledige URL -> lokaal pad
const rewriteAll = (text) =>
  text
    .replace(TEMPLATE_REF, (full, remote) => {
      const local = slugByName.get(commonsNameOf(remote));
      return local ? `"/tracks/wiki/${local}"` : full;
    })
    .replace(LITERAL_REF, (full, url) => {
      const local = slugByName.get(commonsNameOf(url.replace(COMMONS_PREFIX, "")));
      return local ? `"/tracks/wiki/${local}"` : full;
    });

const rewritten = rewriteAll(source);
await fs.writeFile(TRACK_DATA_FILE, rewritten);

// De WP-constante is nu nergens meer nodig.
if (!rewritten.includes("${WP}")) {
  const withoutConst = rewritten.replace(
    /const WP = "https:\/\/upload\.wikimedia\.org\/wikipedia\/commons\/thumb\/";\n?/,
    "",
  );
  await fs.writeFile(TRACK_DATA_FILE, withoutConst);
}

// De naamsvermelding moet álle lokaal aanwezige kaarten dekken, niet alleen wat
// deze run is gedownload; anders raakt het bestand incompleet bij een tweede run.
let manifest = {};
try {
  manifest = JSON.parse(await fs.readFile(MANIFEST_FILE, "utf8"));
} catch {
  /* nog geen manifest */
}
for (const ref of refs) {
  const fileName = `${slugFor(ref.commonsName)}.png`;
  try {
    await fs.access(path.join(OUT_DIR, fileName));
    manifest[ref.commonsName] = fileName;
  } catch {
    /* niet lokaal: blijft naar Wikimedia wijzen */
  }
}
const aanwezig = new Map(Object.entries(manifest).sort(([a], [b]) => a.localeCompare(b)));
await fs.writeFile(MANIFEST_FILE, JSON.stringify(manifest, null, 2) + "\n");

const licenses = await licensesFor([...aanwezig.keys()]);
const rows = [...aanwezig.entries()]
  .map(([commonsName, fileName]) => {
    // De Commons-API geeft bestandsnamen met spaties terug, terwijl in de URL's
    // underscores staan. Probeer beide sleutels.
    const info = licenses[commonsName] ?? licenses[commonsName.replace(/_/g, " ")] ?? {};
    const src = `https://commons.wikimedia.org/wiki/File:${encodeURIComponent(commonsName)}`;
    return `| \`/tracks/wiki/${fileName}\` | ${info.author ?? "onbekend"} | ${info.license ?? "onbekend"} | [Commons](${src}) |`;
  })
  .join("\n");

await fs.mkdir(path.dirname(ATTRIBUTION_FILE), { recursive: true });
await fs.writeFile(
  ATTRIBUTION_FILE,
  `# Naamsvermelding trackkaarten (Wikimedia Commons)\n\n` +
    `Deze kaarten staan sinds de self-hosting-wijziging in \`public/tracks/wiki/\` en worden\n` +
    `vanaf de eigen server geleverd. Ze zijn afkomstig van Wikimedia Commons en vallen onder\n` +
    `de licentie die per bestand hieronder staat.\n\n` +
    `De afbeeldingen zijn uitsluitend als **terugvaloptie** in gebruik: \`TrackMap\` kiest eerst\n` +
    `de eigen iRacing-layered-map uit \`public/tracks/layered/\`. Alleen voor circuits waarvoor\n` +
    `geen eigen kaart bestaat, wordt de kaart hieronder getoond.\n\n` +
    `Opnieuw ophalen: \`node scripts/selfhost-track-maps.mjs --force\`\n\n` +
    `| bestand | auteur | licentie | bron |\n| --- | --- | --- | --- |\n${rows}\n`,
  "utf8",
);

// Ook een publiek leesbare versie, waar de footer naar kan linken: CC BY-SA eist
// dat de naamsvermelding voor bezoekers vindbaar is, niet alleen in de repo.
await fs.writeFile(
  path.join(OUT_DIR, "ATTRIBUTION.txt"),
  "Circuitkaarten op deze site (terugvaloptie naast de eigen iRacing-layered-kaarten)\n" +
    "zijn afkomstig van Wikimedia Commons. Per bestand: auteur | licentie | bronpagina.\n\n" +
    [...aanwezig.entries()]
      .map(([commonsName, fileName]) => {
        const info =
          licenses[commonsName] ?? licenses[commonsName.replace(/_/g, " ")] ?? {};
        return `${fileName} | ${info.author ?? "onbekend"} | ${info.license ?? "onbekend"} | ` +
          `https://commons.wikimedia.org/wiki/File:${encodeURIComponent(commonsName)}`;
      })
      .join("\n") +
    "\n",
  "utf8",
);

console.log(`\nKlaar: ${downloaded} gedownload, ${skipped} al aanwezig.`);
console.log(`trackData.ts herschreven naar /tracks/wiki/ (${slugByName.size} kaarten).`);
if (overgeslagen.length > 0) {
  console.log(`\nNiet opgehaald (blijft voorlopig naar Wikimedia wijzen):`);
  for (const item of overgeslagen) console.log(`  ! ${item}`);
}
console.log(`Naamsvermelding: ${path.relative(ROOT, ATTRIBUTION_FILE)}`);
