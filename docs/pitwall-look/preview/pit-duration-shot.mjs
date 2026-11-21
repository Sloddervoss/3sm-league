/**
 * Echte-browserbewijs voor de persoonlijke pitduurkaart.
 *
 * Run: bash scripts/ensure-playwright-runtime.sh node docs/pitwall-look/preview/pit-duration-shot.mjs
 * Vereist: npx vite --config vite.pitwall-look.config.ts
 */
import assert from "node:assert/strict";
import { chromium } from "playwright";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const OUT = process.env.PIT_DURATION_OUT || "/tmp/pit-duration";
const BASE = process.env.PITWALL_PREVIEW_BASE || "http://127.0.0.1:5199/docs/pitwall-look/preview";
const CHROME = process.env.PITWALL_CHROME ||
  path.join(process.env.HOME ?? "", ".cache/ms-playwright/chromium_headless_shell-1208/chrome-headless-shell-linux64/chrome-headless-shell");

await mkdir(OUT, { recursive: true });
const browser = await chromium.launch({ executablePath: CHROME });
const page = await browser.newPage({ viewport: { width: 700, height: 420 }, deviceScaleFactor: 1 });
const errors = [];
page.on("pageerror", (error) => errors.push(String(error)));
page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });

try {
  await page.goto(`${BASE}/pit-duration.html`, { waitUntil: "domcontentloaded" });
  await page.evaluate(() => document.fonts.ready);
  await page.waitForSelector("[data-pit-duration]");

  const card = await page.evaluate(() => {
    const node = document.querySelector("[data-pit-duration]");
    return {
      seconds: node?.getAttribute("data-pit-duration"),
      text: document.querySelector("[data-pit-visit]")?.textContent?.replace(/\s+/g, " ").trim(),
      source: document.querySelector("[data-pit-visit]")?.getAttribute("data-pit-source"),
    };
  });
  assert.equal(card.seconds, "38.125");
  assert.equal(card.source, "tyre_observation_pit_edges");
  assert.match(card.text ?? "", /38\.125 s/);
  assert.match(card.text ?? "", /Bruto pitstraattijd, service inbegrepen\. Geen netto raceverlies\./);
  assert.deepEqual(errors, []);

  await page.screenshot({ path: path.join(OUT, "personal-pit-duration.png"), fullPage: true });
  await writeFile(path.join(OUT, "evidence.json"), JSON.stringify({ ok: true, card, errors }, null, 2));
  console.log(JSON.stringify({ ok: true, card, screenshot: "personal-pit-duration.png" }, null, 2));
} finally {
  await browser.close();
}
