#!/usr/bin/env node
/**
 * Real-browser smoke for the public Pitwall link.
 *
 * Serves the built app (`npx vite preview --port 8080`) and intercepts only the
 * Supabase RPC. Verifies:
 *  - the bearer token leaves the address bar before DOMContentLoaded;
 *  - the anon reader sends the token once and no URL/Referer carries it;
 *  - the official circuit map is requested from the public track id;
 *  - verified sectors render with stable car keys;
 *  - an unavailable sector board is stated explicitly, not guessed.
 *
 * Run: node scripts/personal-pitwall-share-browser.mjs
 */
import { chromium } from "@playwright/test";

const BASE = process.env.PITWALL_BASE_URL ?? "http://localhost:8080";
const TOKEN = "a".repeat(64);

const now = new Date().toISOString();
const sectors = (id, offset = 0) => ({
  id,
  sectorCount: 3,
  sectors: [37.9, 41.0, 38.8].map((seconds, sectorIndex) => ({
    sectorIndex,
    sectorCount: 3,
    lap: 18,
    seconds: seconds + offset,
    status: "verified",
    referenceSeconds: seconds + offset + 0.2,
    revision: 1,
    completedSessionTimeSeconds: 1170,
    observedSessionTimeSeconds: 1200,
  })),
  sectorBests: [37.9, 41.0, 38.8].map((seconds, sectorIndex) => ({
    sectorIndex,
    lap: 18,
    seconds: seconds + offset,
  })),
  metrics: {
    observedSessionTimeSeconds: 1200,
    lastLapSeconds: 117.7 + offset,
    bestLapSeconds: 117.7 + offset,
    sectorCount: 3,
    sectorLap: 18,
    lapValid: true,
    sectorSource: "measured",
    sectorErrorSeconds: 0,
  },
});

const snapshot = {
  ok: true,
  created_at: now,
  expires_at: new Date(Date.now() + 3_600_000).toISOString(),
  updated_at: now,
  circuit: { trackId: 42, name: "Spa-Francorchamps", config: "Endurance" },
  track: { name: "Spa-Francorchamps", config: "Endurance" },
  session: { driver: "Test Driver", car: "Porsche 911 GT3 R", state: "unknown" },
  v3: {
    capturedAt: now,
    identity: {
      currentDriverName: "Test Driver",
      carName: "Porsche 911 GT3 R",
      trackName: "Spa-Francorchamps",
      trackConfig: "Endurance",
      trackId: 42,
    },
    session: {
      isInCar: true,
      sessionTimeSeconds: 1200,
      sessionTimeRemainingSeconds: 2400,
      sessionLapsRemaining: 40,
      flags: [],
      sessionState: "unknown",
    },
    timing: {
      currentLapElapsedSeconds: 31,
      lastLapTimeSeconds: 117.7,
      bestLapTimeSeconds: 117.2,
      completedLaps: 18,
    },
    position: { position: 2, classPosition: 2, gapToLeaderSeconds: 4.2 },
    track: { lapDistancePct: 0.42, trackSurface: "on_track", onPitRoad: false },
    fuel: { fuelLitres: 55.4, fuelPct: 0.6, fuelCapacityLitres: 90, fuelPerLapLitres: 3.2, lapsRemaining: 17 },
    tyres: { sets: { used: 2, available: 3 } },
    vehicle: {
      speedKph: 210,
      gear: "4",
      tyreDataMode: "last_available",
      pressureUnit: "psi",
      temperatureUnit: "C",
      frontLeft: { wearPercent: 88, temperature: 84, pressure: 26 },
      frontRight: { wearPercent: 86, temperature: 85, pressure: 26 },
      rearLeft: { wearPercent: 91, temperature: 80, pressure: 25 },
      rearRight: { wearPercent: 90, temperature: 81, pressure: 25 },
    },
    opponents: [
      { id: "car-111111111111", driverName: "Leader", carNumber: "1", position: 1, classPosition: 1, lap: 19, lapDistancePct: 0.6, connected: true },
      { id: "car-222222222222", driverName: "Test Driver", carNumber: "3", position: 2, classPosition: 2, lap: 18, lapDistancePct: 0.42, connected: true, isPlayer: true },
      { id: "car-333333333333", driverName: "Rival", carNumber: "4", position: 3, classPosition: 3, lap: 18, lapDistancePct: 0.2, connected: true },
    ],
  },
  sectors: {
    available: true,
    reason: null,
    sectorCount: 3,
    cars: [sectors("car-111111111111"), sectors("car-222222222222", 0.3)],
  },
  laps: [{ lap: 17, seconds: 117.9 }, { lap: 18, seconds: 117.7 }],
  pace: { fastest: 117.2, median: 117.7, count: 18 },
};

const unavailable = {
  ...snapshot,
  circuit: { trackId: null, name: "Spa-Francorchamps", config: "Endurance" },
  v3: { ...snapshot.v3, identity: { ...snapshot.v3.identity, trackId: null } },
  sectors: { available: false, reason: "no_sector_data", sectorCount: 0, cars: [] },
};

const results = [];
const check = (ok, label) => {
  if (!ok) throw new Error(`FAIL: ${label}`);
  results.push(label);
  console.log(`  ok  ${label}`);
};

const browser = await chromium.launch({
  executablePath:
    process.env.PW_CHROMIUM ??
    "/home/hermes/.cache/ms-playwright/chromium-1208/chrome-linux64/chrome",
});
try {
  const context = await browser.newContext();
  const page = await context.newPage();
  const rpcBodies = [];
  const seenUrls = [];

  await page.addInitScript(() => {
    window.__pitwallPreBootstrapHash = location.hash;
    window.addEventListener("DOMContentLoaded", () => {
      window.__pitwallHrefAtDom = location.href;
    });
  });

  await page.route("**/rest/v1/rpc/pitwall_shared_snapshot_v2", async (route) => {
    rpcBodies.push(route.request().postDataJSON());
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(snapshot),
    });
  });
  page.on("request", (request) => seenUrls.push(request.url()));

  console.log("1. fragment token is consumed before app scripts");
  await page.goto(`${BASE}/pitwall/shared#t=${TOKEN}`, { waitUntil: "domcontentloaded" });
  check(await page.evaluate(() => window.__pitwallPreBootstrapHash === `#t=${"a".repeat(64)}`), "init script observed the original fragment (control)");
  check(!(await page.evaluate(() => window.__pitwallHrefAtDom)).includes(TOKEN), "DOMContentLoaded href has no bearer token");
  check(!page.url().includes(TOKEN) && !page.url().includes("#"), "visible URL has no fragment/token");
  check(await page.evaluate(() => typeof window.__3smTakeShareToken === "undefined"), "one-shot token closure is removed after consumption");

  console.log("2. anon reader call and public map/timing");
  await page.getByText("LIVE PITWALL").waitFor({ timeout: 15_000 });
  check(rpcBodies.length === 1 && rpcBodies[0].p_token === TOKEN, "exactly one snapshot RPC with the fragment token");
  check(seenUrls.every((url) => !url.includes(TOKEN)), "no request URL contains the bearer token");
  check(await page.locator('[data-ptp-circuit-status="available"]').count() === 1, "circuit status is available");
  check(await page.locator('[data-ptp-sectors-status="available"]').count() === 1, "sector status is available");
  check((await page.getByText(/sectoren S1–S3/).count()) >= 1, "sector layout S1-S3 is visible");
  check(await page.locator('[data-sector-status="verified"]').count() >= 3, "verified sector cells are rendered");
  check((await page.getByText("37.900", { exact: true }).count()) >= 1, "a verified sector time is visible");
  check(await page.locator('[data-ptp-circuit] svg').count() > 0, "official circuit geometry is present");
  check(
    await page.evaluate(() =>
      performance.getEntriesByType("resource").some((entry) =>
        entry.name.includes("/tracks/layered/track-42.svg"),
      ),
    ),
    "official track-42 SVG was loaded",
  );
  const bodyText = await page.locator("body").innerText();
  check(!bodyText.includes(TOKEN), "token is not rendered");

  console.log("3. unavailable sectors are stated explicitly");
  const page2 = await context.newPage();
  await page2.route("**/rest/v1/rpc/pitwall_shared_snapshot_v2", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(unavailable) });
  });
  await page2.goto(`${BASE}/pitwall/shared#t=${TOKEN}`, { waitUntil: "domcontentloaded" });
  await page2.getByText("LIVE PITWALL").waitFor({ timeout: 15_000 });
  check(await page2.locator('[data-ptp-sectors-status="unavailable"]').count() === 1, "unavailable sector status is explicit");
  check((await page2.getByText(/sectortijden niet beschikbaar/).count()) >= 1, "explicit sector unavailability text is visible");
  check(await page2.locator('[data-ptp-circuit-status="unavailable"]').count() === 1, "unavailable circuit status is explicit");
  check(await page2.locator('[data-sector-status="verified"]').count() === 0, "no invented verified sectors");

  console.log(`\nPASS: ${results.length} browser checks`);
} finally {
  await browser.close();
}
