/** Fixture-only visual acceptance: run with scripts/ensure-playwright-runtime.sh. */
import assert from "node:assert/strict";
import { chromium } from "playwright";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const OUT = path.resolve(process.cwd(), "docs/pitwall-look");
const BASE = "http://127.0.0.1:5199/docs/pitwall-look/preview";
const CHROME = process.env.PITWALL_CHROME ||
  path.join(process.env.HOME ?? "", ".cache/ms-playwright/chromium_headless_shell-1208/chrome-headless-shell-linux64/chrome-headless-shell");
await mkdir(OUT, { recursive: true });
const browser = await chromium.launch({ executablePath: CHROME, ignoreDefaultArgs: ["--hide-scrollbars"] });
const results = [];
try {
  for (const mode of ["endurance", "test"]) {
    const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
    const errors = [];
    page.on("pageerror", (error) => errors.push(String(error)));
    page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
    // This harness must not accidentally start using a production data path.
    await page.route("**/*", (route) => {
      if (new URL(route.request().url()).hostname !== "127.0.0.1") {
        errors.push(`External request: ${route.request().url()}`);
        return route.abort();
      }
      return route.continue();
    });
    await page.goto(`${BASE}/${mode}.html`, { waitUntil: "networkidle" });
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(800);
    const measure = () => page.evaluate(() => {
      const rect = (element) => {
        const r = element.getBoundingClientRect();
        return { x: r.x, y: r.y, width: r.width, height: r.height, bottom: r.bottom };
      };
      const panels = [...document.querySelectorAll('[data-pitwall-row="panels"] > div')].map(rect);
      const table = document.querySelector('.pitwall-timing-scroll');
      return {
        viewport: { width: innerWidth, height: innerHeight },
        document: { width: document.documentElement.scrollWidth, height: document.documentElement.scrollHeight },
        panels,
        timing: { ...rect(table), clientHeight: table.clientHeight, scrollHeight: table.scrollHeight, overflow: getComputedStyle(table).overflowY },
      };
    });
    const desktop = await measure();
    assert.equal(desktop.panels.length, 4);
    assert(desktop.panels.every((r) => r.y >= 0 && r.bottom <= 1080), `${mode}: all four panels must fit`);
    assert(desktop.document.width <= 1920, `${mode}: horizontal page overflow`);
    assert(desktop.timing.scrollHeight > desktop.timing.clientHeight);
    assert.equal(desktop.timing.overflow, "auto");
    await page.screenshot({ path: path.join(OUT, `pitwall-${mode}-1920x1080.png`) });
    await page.screenshot({ path: path.join(OUT, `pitwall-${mode}-full.png`), fullPage: true });

    const beforeScroll = await measure();
    // Real wheel and keyboard scrolling, while the page and panel row stay put.
    const table = page.getByRole("region", { name: "Live timing — scrollbaar klassement" });
    await table.hover();
    await page.mouse.wheel(0, 500);
    await page.waitForTimeout(150);
    assert(await table.evaluate((e) => e.scrollTop > 0), `${mode}: wheel must scroll timing`);
    await table.focus();
    await page.keyboard.press("Control+End");
    await page.waitForTimeout(150);
    assert(await table.evaluate((e) => e.scrollTop + e.clientHeight >= e.scrollHeight - 2), `${mode}: last timing row reachable`);
    assert.equal(await page.evaluate(() => scrollY), 0, `${mode}: timing must not scroll the document`);
    assert.equal((await measure()).panels[0].y, beforeScroll.panels[0].y);

    // A growing snapshot must never increase document or main-row height.
    const beforeGrowth = await measure();
    await table.evaluate((e) => {
      const body = e.querySelector("tbody");
      const row = body.querySelector("tr:last-child");
      for (let i = 0; i < 64; i++) body.append(row.cloneNode(true));
    });
    assert.equal((await measure()).document.height, beforeGrowth.document.height);
    await page.reload({ waitUntil: "networkidle" });
    if (mode === "test") {
      const raw = page.locator('details').filter({ hasText: 'telemetrie' });
      // The existing raw telemetry disclosure remains interactive below the fold.
      assert.equal(await raw.count(), 1);
      await raw.locator('summary').click();
      assert(await raw.evaluate((e) => e.open));
    }
    const responsive = [];
    for (const width of [1440, 1024, 390]) {
      await page.setViewportSize({ width, height: 1080 });
      await page.evaluate(() => scrollTo(0, 0));
      const m = await measure();
      assert(m.document.width <= width, `${mode}: overflow at ${width}px`);
      const columns = m.panels.filter((r) => r.y === m.panels[0].y).length;
      assert.equal(columns, width >= 1280 ? 4 : width >= 768 ? 2 : 1);
      if (width === 1024) {
        assert.equal(m.panels[0].y, m.panels[1].y);
        assert(m.panels[2].y > m.panels[0].y);
      }
      if (width === 390) assert(m.panels.every((r, i, a) => i === 0 || r.y >= a[i - 1].bottom));
      responsive.push({ width, panelColumns: columns, noHorizontalPageOverflow: true });
    }
    assert.deepEqual(errors, []);
    results.push({ mode, desktop, wheelAndKeyboardScroll: "PASS", growingSnapshot: "PASS", rawDisclosure: mode === "test" ? "PASS" : "not in endurance fixture", responsive, browserErrors: errors });
    console.log(`${mode}: PASS; panel bottom ${Math.max(...desktop.panels.map((r) => r.bottom))}px; document ${desktop.document.height}px`);
    await page.close();
  }
  await writeFile(path.join(OUT, "verification.json"), JSON.stringify(results, null, 2) + "\n");
} finally {
  await browser.close();
}
