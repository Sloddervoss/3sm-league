/** Fixture-only visual acceptance: run with scripts/ensure-playwright-runtime.sh. */
import assert from "node:assert/strict";
import { chromium } from "playwright";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const OUT = path.resolve(process.cwd(), "docs/pitwall-look");
const BASE = process.env.PITWALL_PREVIEW_BASE || "http://127.0.0.1:5199/docs/pitwall-look/preview";
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
        more: rect(document.querySelector('[data-pitwall-more] > summary')),
        extraVisible: [...document.querySelector('[data-pitwall-extra]').children].some((e) => e.checkVisibility()),
        timing: { ...rect(table), clientHeight: table.clientHeight, scrollHeight: table.scrollHeight, overflow: getComputedStyle(table).overflowY },
      };
    });
    const desktop = await measure();
    // The instrument skin is verified in the browser, not inferred from class names.
    const skin = await page.evaluate(() => {
      const style = selector => getComputedStyle(document.querySelector(selector));
      const panel = style('[data-pitwall-slot="pace"]');
      const title = style('[data-pitwall-slot="pace"] h3');
      const row = document.querySelector('.pitwall-timing-scroll tbody tr[data-pitwall-own-row]');
      const contentFits = [...document.querySelectorAll('[data-pitwall-row="panels"] section')].every(panel => {
        const bounds = panel.getBoundingClientRect();
        return [...panel.querySelectorAll('p, dl, ol, [role="meter"]')].every(child => {
          const r = child.getBoundingClientRect();
          return r.bottom <= bounds.bottom + 1 && r.right <= bounds.right + 1;
        });
      });
      return {
        radius: panel.borderRadius, border: panel.borderTopWidth,
        background: panel.backgroundColor, borderColor: panel.borderTopColor,
        titleFont: title.fontFamily, titleTracking: title.letterSpacing,
        timingRowHeight: row.getBoundingClientRect().height, contentFits,
      };
    });
    assert.equal(skin.radius, '5px');
    assert.equal(skin.border, '1px');
    assert.equal(skin.background, 'rgb(6, 14, 20)');
    assert.equal(skin.borderColor, 'rgb(23, 42, 54)');
    assert(skin.titleFont.includes('Rajdhani'));
    assert(skin.timingRowHeight <= 27, `${mode}: compact timing rows`);
    assert(skin.contentFits, `${mode}: panel contents must not be clipped`);

    assert.equal(await page.getByText('▲ +0.649 s', { exact: true }).count(), 1);
    assert.equal(await page.getByText('Verstreken sessie', { exact: true }).count(), 1);
    assert.equal(await page.getByLabel('Sectorlegenda eigen tijden; geen kaartgrenzen').count(), 0);
    await page.locator('[data-pitwall-track-artwork="layered"]').waitFor();
    const trackMap = page.locator('[data-pitwall-slot="trackmap"] svg[role="img"]');
    assert.equal(await trackMap.locator('text').count(), 0);
    assert.equal(await trackMap.locator('circle').count(), 13);
    assert(await trackMap.locator('mask polyline').getAttribute('points'));
    assert.equal(await trackMap.locator('image[filter*="finish"]').count(), 1);
    assert.equal(await page.getByRole('meter').count(), 4);
    const ownDescriptionFits = await page.locator('[data-pitwall-slot="own-car"] > p:last-of-type').evaluate(e => e.scrollWidth <= e.clientWidth);
    assert(ownDescriptionFits, `${mode}: own-car description must not be truncated`);
    const interactionChecks = [];
    if (mode === 'endurance') {
      const plan = page.getByRole('list', { name: 'Volledige stintplanning' });
      assert.equal(await plan.getByRole('listitem').count(), 3);
      assert(await plan.evaluate(e => [...e.children].every(c => c.getBoundingClientRect().bottom <= e.getBoundingClientRect().bottom + 1)), 'all fixture stint rows must fit, no half row');
      for (const name of ['Stints', 'Pitstops', 'Gebeurtenissen']) {
        await page.getByRole('button', { name, exact: true }).click();
        const region = page.getByRole('region', { name: 'Eigen opgeslagen planning en gebeurtenissen' });
        assert(await region.getByRole('listitem').count() > 0, `${name}: real fixture content required`);
        assert.equal((await measure()).document.height, 1080, `${name}: no page growth`);
        interactionChecks.push(`${name}: nonempty own-team content, bounded layout`);
      }
      await page.getByRole('button', { name: 'Live timing', exact: true }).click();
    } else {
      assert.equal(await page.getByRole('button', { name: 'Stints', exact: true }).count(), 0);
      assert.equal(await page.getByRole('button', { name: 'Pitstops', exact: true }).count(), 0);
    }
    await page.getByRole('button', { name: 'Klasse', exact: true }).click();
    await page.getByRole('button', { name: 'LMP2', exact: true }).click();
    assert.equal(await page.locator('.pitwall-timing-scroll tbody tr[data-pitwall-own-row]').count(), 0);
    await page.getByRole('button', { name: 'Live timing', exact: true }).click();
    interactionChecks.push('Klasse: LMP2 filter, restored full snapshot');
    for (const name of ['Snelheid', 'Delta']) {
      await page.getByRole('button', { name, exact: true }).click();
      assert.equal(await page.getByText(name === 'Snelheid' ? '187 km/h' : '+0.649 s', { exact: true }).count(), 1);
      assert.equal((await measure()).document.height, 1080);
      interactionChecks.push(`${name}: explicit source/reference, bounded layout`);
    }
    await page.getByRole('button', { name: 'Rondetijd', exact: true }).click();

    assert.equal(desktop.panels.length, 4);
    assert.equal(await page.getByText("Compound-ID 4", { exact: true }).count(), 1);
    assert.equal(await page.getByText("2 gebruikt", { exact: true }).count(), 1);
    assert.equal(await page.getByText("3 beschikbaar", { exact: true }).count(), 1);
    assert.equal(await page.getByText("Baan 31.5 °C", { exact: true }).count(), 1);
    assert.equal(await page.getByText("Lucht 21.3 °C", { exact: true }).count(), 1);
    const environmentClear = () => page.evaluate(() => {
      const readings = [...document.querySelectorAll("[data-pitwall-environment] > span")];
      const markers = [...document.querySelectorAll("[aria-label=\"Live rondeposities\"] > span")];
      return readings.every(reading => markers.every(marker => {
        const a = reading.getBoundingClientRect(), b = marker.getBoundingClientRect();
        return a.right <= b.left || b.right <= a.left || a.bottom <= b.top || b.bottom <= a.top;
      }));
    });
    assert(await environmentClear(), `${mode}: environment must not overlap car markers`);
    assert(desktop.panels[0].width > desktop.panels[1].width * 1.4, `${mode}: pace follows the wider circuit column`);
    assert.equal(await page.locator("[data-pitwall-pace-graph] circle").count() > 0, true);
    assert.equal(await page.locator("[data-pitwall-kpi-group]").count(), 3);
    assert(desktop.panels.every((r) => r.y >= 0 && r.bottom <= 1080), `${mode}: all four panels must fit`);
    assert(desktop.document.width <= 1920, `${mode}: horizontal page overflow`);
    assert(desktop.timing.scrollHeight > desktop.timing.clientHeight);
    assert.equal(desktop.timing.overflow, "auto");
    await page.screenshot({ path: path.join(OUT, `pitwall-${mode}-1920x1080.png`) });
    assert(desktop.more.y >= Math.max(...desktop.panels.map((r) => r.bottom)));
    assert(desktop.more.bottom <= 1080, `${mode}: Meer analyse must fit entirely`);
    assert.equal(desktop.extraVisible, false, `${mode}: no extra block may peek out`);
    assert.equal(desktop.document.height, 1080, `${mode}: collapsed page must fit without scrolling`);
    const more = page.locator('[data-pitwall-more]');
    assert.equal(await more.evaluate((e) => e.open), false);
    await more.locator(':scope > summary').click();
    assert.equal(await more.evaluate((e) => e.open), true);
    assert.equal((await measure()).extraVisible, true);
    await page.screenshot({ path: path.join(OUT, `pitwall-${mode}-full.png`), fullPage: true });
    await more.locator(':scope > summary').click();
    await page.evaluate(() => scrollTo(0, 0));
    await more.locator(':scope > summary').focus();
    await page.keyboard.press('Enter');
    assert.equal(await more.evaluate((e) => e.open), true);
    await page.keyboard.press('Enter');
    assert.equal(await more.evaluate((e) => e.open), false);

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
    await page.locator('[data-pitwall-more] > summary').click();
    if (mode === "test") {
      const raw = page.locator('[data-pitwall-extra] details').filter({ hasText: 'telemetrie' });
      // The existing raw telemetry disclosure remains interactive below the fold.
      assert.equal(await raw.count(), 1);
      await raw.locator('summary').click();
      assert(await raw.evaluate((e) => e.open));
    }
    await page.locator('[data-pitwall-more] > summary').click();
    const responsive = [];
    for (const width of [1440, 1024, 390]) {
      await page.setViewportSize({ width, height: 1080 });
      await page.evaluate(() => scrollTo(0, 0));
      const m = await measure();
      assert(await environmentClear(), `${mode}: environment overlap at ${width}px`);
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
    results.push({ mode, desktop, skin, interactionChecks, stintRowsFullyVisible: mode === "endurance" ? "PASS: three full rows" : "not applicable", ownDescriptionFits, moreAnalysis: "PASS: closed by default, click and keyboard, contents preserved", wheelAndKeyboardScroll: "PASS", growingSnapshot: "PASS", rawDisclosure: mode === "test" ? "PASS" : "not in endurance fixture", responsive, browserErrors: errors });
    console.log(`${mode}: PASS; panel bottom ${Math.max(...desktop.panels.map((r) => r.bottom))}px; document ${desktop.document.height}px`);
    await page.close();
  }
  await writeFile(path.join(OUT, "verification.json"), JSON.stringify(results, null, 2) + "\n");
} finally {
  await browser.close();
}
