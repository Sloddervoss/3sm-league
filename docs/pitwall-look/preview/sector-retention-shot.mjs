/**
 * Echte-browserbewijs voor de sparse-sectorregressie.
 *
 * Speelt de vier frames van de veldmelding af in de echte premium- en klassieke
 * componenten (zelfde styles) en leest per auto de sectorcellen uit de DOM.
 *
 * Run: bash scripts/ensure-playwright-runtime.sh node docs/pitwall-look/preview/sector-retention-shot.mjs
 * Vereist: npx vite --config vite.pitwall-look.config.ts
 */
import assert from "node:assert/strict";
import { chromium } from "playwright";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const OUT = process.env.SECTOR_RETENTION_OUT || "/tmp/sector-retention";
const BASE = process.env.PITWALL_PREVIEW_BASE || "http://127.0.0.1:5199/docs/pitwall-look/preview";
const CHROME = process.env.PITWALL_CHROME ||
  path.join(process.env.HOME ?? "", ".cache/ms-playwright/chromium_headless_shell-1208/chrome-headless-shell-linux64/chrome-headless-shell");

await mkdir(OUT, { recursive: true });

const browser = await chromium.launch({ executablePath: CHROME });
const page = await browser.newPage({ viewport: { width: 1366, height: 1000 }, deviceScaleFactor: 1 });
const errors = [];
page.on("pageerror", (error) => errors.push(String(error)));
page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
await page.route("**/*", (route) => {
  if (new URL(route.request().url()).hostname !== "127.0.0.1") {
    errors.push(`External request: ${route.request().url()}`);
    return route.abort();
  }
  return route.continue();
});

const readPremium = () => page.evaluate(() => {
  const ids = ["player", "leroy", "bart", "albert", "f0820"];
  const read = (id) => {
    const row = document.querySelector(`[data-timing-row-id="${id}"]`);
    if (!row) return null;
    return [...row.querySelectorAll("td[data-sector-index]")].map((td) => ({
      value: td.querySelector("[data-sector-value]")?.textContent
        ?? (td.textContent ?? "").match(/\d+\.\d{3}/)?.[0]
        ?? null,
      lap: td.querySelector("[data-sector-lap]")?.getAttribute("data-sector-lap") ?? null,
      source: td.querySelector("[data-sector-source]")?.getAttribute("data-sector-source")
        ?? (td.querySelector("[data-sector-status]") ? "live" : null),
      stale: Boolean(td.querySelector("[data-retained-stale]")),
      title: td.getAttribute("title"),
    }));
  };
  const classic = (number) => {
    const rows = [...document.querySelectorAll("[data-classic-fixture] tbody tr")];
    const row = rows.find((tr) => tr.querySelector('[data-timing="car-number"]')?.textContent?.trim() === number);
    if (!row) return null;
    return [...row.querySelectorAll("td[data-sector-index]")].map((td) => ({
      value: td.querySelector("[data-sector-value]")?.textContent ?? null,
      lap: td.querySelector("[data-sector-lap]")?.getAttribute("data-sector-lap") ?? null,
      stale: Boolean(td.querySelector("[data-retained-stale]")),
    }));
  };
  return {
    poll: document.querySelector("[data-poll]")?.getAttribute("data-poll"),
    label: document.querySelector("[data-poll-caption]")?.textContent,
    rows: document.querySelectorAll("[data-timing-row-id]").length,
    sectorCount: document.querySelector(".ptp-timing-table")?.getAttribute("data-sector-count"),
    kpi: document.querySelector('[data-pitwall-kpi="true"]')?.getAttribute("data-sector-count"),
    premium: Object.fromEntries(ids.map((id) => [id, read(id)])),
    classic: { "134": classic("134"), "103": classic("103"), "77": classic("77") },
  };
});

const settle = async (index) => {
  await page.evaluate((next) => window.__pitwallPoll?.(next), index);
  await page.waitForFunction((next) => document.querySelector("[data-poll]")?.getAttribute("data-poll") === String(next), index);
  await page.waitForTimeout(120);
};

const evidence = [];
try {
  await page.goto(`${BASE}/sector-retention.html?poll=0&pitwallTrace=1`, { waitUntil: "domcontentloaded" });
  await page.evaluate(() => document.fonts.ready);
  await page.waitForSelector("[data-timing-row-id='leroy']");

  await settle(0);
  const p0 = await readPremium();
  assert.equal(p0.poll, "0");
  assert.equal(p0.rows, 16);
  assert.deepEqual(p0.premium.player.map((c) => c.value), ["40.100", "40.200", "40.300"]);
  assert.equal(p0.premium.leroy[0].value, null);
  assert.equal(p0.sectorCount, "3");
  evidence.push({ step: p0.label, poll: p0.poll, data: p0 });
  await page.screenshot({ path: path.join(OUT, "poll-1-seq718.png"), fullPage: true });

  await settle(1);
  const p1 = await readPremium();
  assert.equal(p1.poll, "1");
  assert.deepEqual(p1.premium.leroy.map((c) => c.value), ["35.503", "52.350", "33.853"]);
  assert.equal(p1.premium.leroy[0].lap, "4");
  assert.equal(p1.premium.bart[0].value, "38.100");
  assert.equal(p1.premium.albert[0].value, "39.100");
  assert.equal(p1.premium.f0820[0].value, "36.500");
  assert.equal(p1.premium.f0820[0].lap, "3");
  // De rij loopt al een ronde voor: de bewezen reeks is gedimd, niet weg.
  assert.equal(p1.premium.f0820[0].stale, true);
  evidence.push({ step: p1.label, poll: p1.poll, data: p1 });
  await page.screenshot({ path: path.join(OUT, "poll-2-seq720.png"), fullPage: true });

  await settle(2);
  const p2 = await readPremium();
  assert.equal(p2.poll, "2");
  // f0820's metingslot is weer mid-lap; de bewezen R3 blijft zichtbaar.
  assert.deepEqual(p2.premium.f0820.map((c) => c.value), ["36.500", "37.500", "38.500"]);
  assert.equal(p2.premium.f0820[0].lap, "3");
  assert.equal(p2.premium.f0820[0].source, "verified-lap");
  assert.deepEqual(p2.premium.leroy.map((c) => c.value), ["35.503", "52.350", "33.853"]);
  assert.deepEqual(p2.classic["77"].map((c) => c.value), ["36.500", "37.500", "38.500"]);
  evidence.push({ step: p2.label, poll: p2.poll, data: p2 });
  await page.screenshot({ path: path.join(OUT, "poll-3-seq722.png"), fullPage: true });

  await settle(3);
  const p3 = await readPremium();
  assert.equal(p3.poll, "3");
  assert.equal(p3.rows, 13);
  assert.deepEqual(p3.premium.f0820.map((c) => c.value), ["36.500", "37.500", "38.500"]);
  assert.deepEqual(p3.premium.leroy.map((c) => c.value), ["35.503", "52.350", "33.853"]);
  assert.equal(p3.premium.bart[0].value, "38.100");
  assert.equal(p3.premium.albert[0].value, "39.100");
  assert.equal(p3.sectorCount, "3");
  evidence.push({ step: p3.label, poll: p3.poll, data: p3 });
  await page.screenshot({ path: path.join(OUT, "poll-4-13cars.png"), fullPage: true });

  // Structural sequence: a transient frame without track identity and with a
  // sparse PACE block must not erase the proven rows.
  await settle(4);
  const p4 = await readPremium();
  assert.equal(p4.poll, "4");
  assert.deepEqual(p4.premium.leroy.map((c) => c.value), ["35.503", "52.350", "33.853"]);
  assert.deepEqual(p4.premium.f0820.map((c) => c.value), ["36.500", "37.500", "38.500"]);
  const trace = await page.evaluate(() => window.__pitwallSectorTrace?.dump() ?? []);
  assert.equal(trace.some((event) => event.code === "retained_reset" && event.detail?.reason === "identity"), false);
  evidence.push({ step: p4.label, poll: p4.poll, data: p4, traceCodes: trace.map((event) => event.code) });
  await page.screenshot({ path: path.join(OUT, "poll-5-transient-identity.png"), fullPage: true });

  await settle(5);
  const p5 = await readPremium();
  assert.equal(p5.poll, "5");
  assert.deepEqual(p5.premium.leroy.map((c) => c.value), ["35.503", "52.350", "33.853"]);
  assert.deepEqual(p5.premium.f0820.map((c) => c.value), ["36.500", "37.500", "38.500"]);
  evidence.push({ step: p5.label, poll: p5.poll, data: p5 });
  await page.screenshot({ path: path.join(OUT, "poll-6-restored.png"), fullPage: true });

  // Only S1 of R4 is present. The complete R3 must remain visible as a whole.
  await settle(6);
  const p6 = await readPremium();
  assert.equal(p6.poll, "6");
  assert.deepEqual(p6.premium.f0820.map((c) => c.value), ["36.500", "37.500", "38.500"]);
  assert.deepEqual(p6.premium.f0820.map((c) => c.lap), ["3", "3", "3"]);
  assert.deepEqual(p6.premium.f0820.map((c) => c.source), ["verified-lap", "verified-lap", "verified-lap"]);
  const partialTrace = await page.evaluate(() => window.__pitwallSectorTrace?.dump() ?? []);
  assert.equal(partialTrace.some((event) => event.code === "live_partial_ignored" && event.detail?.slots === 1), true);
  evidence.push({ step: p6.label, poll: p6.poll, data: p6, traceCodes: partialTrace.map((event) => event.code) });
  await page.screenshot({ path: path.join(OUT, "poll-7-partial-live.png"), fullPage: true });

  // All three sectors of R4 arrived: the row may switch as a whole.
  await settle(7);
  const p7 = await readPremium();
  assert.equal(p7.poll, "7");
  assert.deepEqual(p7.premium.f0820.map((c) => c.value), ["36.200", "37.200", "38.200"]);
  assert.deepEqual(p7.premium.f0820.map((c) => c.lap), ["4", "4", "4"]);
  assert.deepEqual(p7.premium.f0820.map((c) => c.source), ["live", "live", "live"]);
  evidence.push({ step: p7.label, poll: p7.poll, data: p7 });
  await page.screenshot({ path: path.join(OUT, "poll-8-complete-live.png"), fullPage: true });

  assert.deepEqual(errors, []);
  await writeFile(path.join(OUT, "evidence.json"), JSON.stringify({ ok: true, evidence, errors }, null, 2));
  console.log(JSON.stringify({
    ok: true,
    screenshots: [
      "poll-1-seq718.png", "poll-2-seq720.png", "poll-3-seq722.png", "poll-4-13cars.png",
      "poll-5-transient-identity.png", "poll-6-restored.png", "poll-7-partial-live.png", "poll-8-complete-live.png",
    ],
    polls: evidence.map((entry) => ({
      poll: entry.poll,
      leroy: entry.data.premium.leroy.map((c) => c.value),
      f0820: entry.data.premium.f0820.map((c) => c.value),
      rows: entry.data.rows,
    })),
  }, null, 2));
} finally {
  await browser.close();
}
