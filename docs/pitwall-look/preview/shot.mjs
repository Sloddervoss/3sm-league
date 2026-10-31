/**
 * Screenshot-fixture: fotografeert de pitwall-look op 1920×1080.
 *
 * Start eerst de preview-server:
 *   npx vite --config vite.pitwall-look.config.ts
 * en dan:
 *   node docs/pitwall-look/preview/shot.mjs
 *
 * De pagina's komen uit preview/*.html: echte componenten, fixture-data. Zie de
 * kop van fixtures.ts voor waarom er geen live sessie op de foto staat.
 */
import { chromium } from "playwright";
import { mkdir } from "node:fs/promises";
import path from "node:path";

const OUT = path.resolve(process.cwd(), "docs/pitwall-look");
const BASE = "http://127.0.0.1:5199/docs/pitwall-look/preview";

const shots = [
  { page: "endurance.html", file: "pitwall-endurance-1920x1080.png" },
  { page: "test.html", file: "pitwall-test-1920x1080.png" },
];

await mkdir(OUT, { recursive: true });

// Deze werkboom heeft Playwright 1.64 maar de gedownloade browser is 1208.
// Liever die bestaande headless shell dan een download die hier niet kan.
const CHROME = process.env.PITWALL_CHROME ||
  path.join(process.env.HOME ?? "", ".cache/ms-playwright/chromium_headless_shell-1208/chrome-headless-shell-linux64/chrome-headless-shell");
const browser = await chromium.launch({ executablePath: CHROME });
for (const shot of shots) {
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
  const fouten = [];
  page.on("pageerror", (error) => fouten.push(String(error)));
  page.on("console", (message) => {
    if (message.type() === "error") fouten.push(message.text());
  });
  await page.goto(`${BASE}/${shot.page}`, { waitUntil: "networkidle" });
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(800);
  const hoogte = await page.evaluate(() => document.documentElement.scrollHeight);
  await page.screenshot({ path: path.join(OUT, shot.file) });
  console.log(`${shot.file} — viewport 1920×1080, documenthoogte ${hoogte}px${fouten.length ? ` — fouten: ${fouten.join(" | ")}` : ""}`);
  await page.close();
}
await browser.close();
