/**
 * Echte-browserbewijs dat Mijn Pitwall en de admin-pitwalltest dezelfde
 * gemeten laatste stop tonen.
 *
 * Run: bash scripts/ensure-playwright-runtime.sh node docs/pitwall-look/preview/pit-duration-parity-shot.mjs
 * Vereist: npx vite --config vite.pitwall-look.config.ts
 */
import assert from "node:assert/strict";
import { chromium } from "playwright";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const OUT = process.env.PIT_DURATION_PARITY_OUT || "/tmp/pit-duration-parity";
const BASE = process.env.PITWALL_PREVIEW_BASE || "http://127.0.0.1:5199/docs/pitwall-look/preview";
const CHROME = process.env.PITWALL_CHROME ||
  path.join(process.env.HOME ?? "", ".cache/ms-playwright/chromium_headless_shell-1208/chrome-headless-shell-linux64/chrome-headless-shell");

await mkdir(OUT, { recursive: true });
const browser = await chromium.launch({ executablePath: CHROME });
const page = await browser.newPage({ viewport: { width: 900, height: 420 }, deviceScaleFactor: 1 });
const errors = [];
page.on("pageerror", (error) => errors.push(String(error)));
page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });

try {
  await page.goto(`${BASE}/pit-duration-parity.html`, { waitUntil: "domcontentloaded" });
  await page.evaluate(() => document.fonts.ready);
  await page.waitForSelector('[data-fixture-side="personal"] [data-pit-duration]');
  await page.waitForSelector('[data-fixture-side="admin"] [data-pit-duration]');

  const readSide = (side) => page.evaluate((target) => {
    const root = document.querySelector(`[data-fixture-side="${target}"]`);
    const card = root?.querySelector("[data-pit-visit]");
    return {
      seconds: card?.querySelector("[data-pit-duration]")?.getAttribute("data-pit-duration") ?? null,
      source: card?.getAttribute("data-pit-source") ?? null,
      benchmark: card?.getAttribute("data-pit-benchmark") ?? null,
      slot: card?.closest("[data-pit-strategy-benchmark]")?.getAttribute("data-pit-strategy-benchmark") ?? null,
      text: card?.textContent?.replace(/\s+/g, " ").trim() ?? "",
    };
  }, side);

  const personal = await readSide("personal");
  const admin = await readSide("admin");

  assert.deepEqual(admin, personal);
  assert.equal(personal.seconds, "38.125");
  assert.equal(personal.source, "measurement_event_pit_edges");
  assert.equal(personal.benchmark, "gross");
  assert.equal(personal.slot, "gross");
  assert.match(personal.text, /38\.125 s/);
  assert.match(personal.text, /Laatste gemeten stop · bruto benchmark · niet in het strategiemodel\./);
  assert.match(personal.text, /Bruto pitstraattijd, service inbegrepen\. Geen netto raceverlies\./);
  assert.deepEqual(errors, []);

  const screenshot = "pitwall-personal-admin-parity.png";
  await page.screenshot({ path: path.join(OUT, screenshot), fullPage: true });
  await writeFile(path.join(OUT, "evidence.json"), JSON.stringify({ ok: true, personal, admin, errors }, null, 2));
  console.log(JSON.stringify({ ok: true, personal, admin, screenshot }, null, 2));
} finally {
  await browser.close();
}
