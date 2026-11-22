#!/usr/bin/env node
/**
 * Meet de leesbaarheid van de premium Pitwall in een echte browser.
 *
 * Werkt tegen de login-vrije fixture (`docs/pitwall-look/preview/premium-readability.html`)
 * of, met `--base`, tegen een andere served build. Meet uitsluitend:
 *  - effectieve tekstgroottes;
 *  - contrast van gerenderde tekst tegen de samengestelde achtergrond;
 *  - afkapping/overflow per paneel en per pagina;
 *  - het aantal panelen en de zichtbaarheid van kernwaarden.
 *
 * Geen writes, geen Supabase, geen productiesessie.
 *
 * Gebruik:
 *   bash scripts/ensure-playwright-runtime.sh node scripts/pitwall-readability-browser.mjs \
 *     --base http://127.0.0.1:5210/docs/pitwall-look/preview --out docs/pitwall-look/evidence/<map>
 */
import { chromium } from "playwright";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const args = new Map();
for (let i = 2; i < process.argv.length; i += 2) {
  if (process.argv[i]?.startsWith("--")) args.set(process.argv[i].slice(2), process.argv[i + 1]);
}
const BASE = args.get("base") || "http://127.0.0.1:5210/docs/pitwall-look/preview";
const OUT = path.resolve(args.get("out") || "docs/pitwall-look/evidence/pitwall-readable");
const LABEL = args.get("label") || "run";
const ONLY = args.get("only") || "";
const CHROME = process.env.PITWALL_CHROME ||
  path.join(process.env.HOME ?? "", ".cache/ms-playwright/chromium_headless_shell-1248/chrome-headless-shell-linux64/chrome-headless-shell");

const VIEWPORTS = [
  { id: "2560x1440", width: 2560, height: 1440 },
  { id: "1920x1080", width: 1920, height: 1080 },
  { id: "1280x720", width: 1280, height: 720 },
];
const VARIANTS = ["test", "personal", "shared"];
// De gedeelde meekijkstand is read-only en heeft geen owner-only
// pitbevestiging; vier kaarten is daar het bestaande, bedoelde contract.
const expectedPanels = (variant) => (variant === "shared" ? 4 : 5);
const VIEWPORT_FILTER = args.get("viewport") || "";

const target = (variant, focus, state, viewport) =>
  `${BASE}/premium-readability.html?variant=${variant}&state=${state}&focus=${focus ? 1 : 0}`;

/** In-page meting. Alles wat hier gebeurt is read-only DOM/computed-style. */
const measure = () => {
  const px = (value) => Number.parseFloat(value) || 0;
  const parseColor = (value) => {
    const text = String(value).trim();
    const rgbMatch = text.match(/rgba?\(([^)]+)\)/);
    if (rgbMatch) {
      const parts = rgbMatch[1].split(/[, /]+/).map(Number).filter((n) => Number.isFinite(n));
      if (parts.length < 3) return null;
      return { r: parts[0], g: parts[1], b: parts[2], a: parts.length > 3 ? parts[3] : 1 };
    }
    const hex = text.match(/^#([0-9a-f]{6})$/i);
    if (hex) {
      const n = Number.parseInt(hex[1], 16);
      return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255, a: 1 };
    }
    // Tailwind v4 levert oklch()/oklab(); Chromium serialiseert die zo en
    // canvas zet ze niet om. Reken ze zelf om naar sRGB.
    const ok = text.match(/okl(ch|ab)\(([^)]+)\)/);
    if (ok) {
      const parts = ok[2].split(/[, /]+/).map(Number).filter((n) => Number.isFinite(n));
      if (parts.length < 3) return null;
      const alpha = parts.length > 3 ? parts[3] : 1;
      const L = parts[0];
      const a = ok[1] === "ch" ? parts[1] * Math.cos((parts[2] * Math.PI) / 180) : parts[1];
      const b = ok[1] === "ch" ? parts[1] * Math.sin((parts[2] * Math.PI) / 180) : parts[2];
      const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
      const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
      const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
      const lin = [
        4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
        -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
        -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
      ].map((v) => Math.max(0, Math.min(1, v)));
      const gamma = (v) => (v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055);
      return { r: gamma(lin[0]) * 255, g: gamma(lin[1]) * 255, b: gamma(lin[2]) * 255, a: alpha };
    }
    return null;
  };
  const composite = (top, bottom) => ({
    r: top.r * top.a + bottom.r * (1 - top.a),
    g: top.g * top.a + bottom.g * (1 - top.a),
    b: top.b * top.a + bottom.b * (1 - top.a),
    a: 1,
  });
  const effectiveBackground = (el) => {
    const chain = [];
    let opacity = 1;
    for (let node = el; node && node.nodeType === 1; node = node.parentElement) {
      const style = getComputedStyle(node);
      opacity *= px(style.opacity) || 1;
      const bg = parseColor(style.backgroundColor);
      if (bg && bg.a > 0) chain.push(bg);
    }
    let result = { r: 7, g: 9, b: 12, a: 1 };
    for (const layer of chain.reverse()) result = composite(layer, result);
    if (opacity < 1) result = composite({ r: 7, g: 9, b: 12, a: 1 - opacity }, result);
    return result;
  };
  const luminance = ({ r, g, b }) => {
    const channel = (v) => {
      const c = v / 255;
      return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    };
    return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
  };
  const contrast = (fg, bg) => {
    const a = luminance(fg);
    const b = luminance(bg);
    return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
  };
  const selector = (el) => {
    if (!el) return null;
    const parts = [];
    for (let node = el; node && node.nodeType === 1 && parts.length < 5; node = node.parentElement) {
      let part = node.tagName.toLowerCase();
      if (node.id) { part += `#${node.id}`; parts.unshift(part); break; }
      const cls = [...node.classList].filter((c) => !c.startsWith("css-") && c.length < 42).slice(0, 2);
      if (cls.length) part += `.${cls.join(".")}`;
      parts.unshift(part);
    }
    return parts.join(" > ");
  };
  const hasOwnText = (el) => [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim().length > 0);

  const texts = [];
  for (const el of document.querySelectorAll("body *")) {
    if (!hasOwnText(el)) continue;
    if (el.classList.contains("sr-only") || el.closest(".sr-only")) continue;
    const style = getComputedStyle(el);
    if (style.visibility === "hidden" || style.display === "none" || px(style.opacity) === 0) continue;
    if (style.clip !== "auto" || style.clipPath !== "none") continue;
    const box = el.getBoundingClientRect();
    if (box.width <= 2 || box.height <= 2) continue;
    if (box.bottom < 0 || box.top > innerHeight * 20) continue;
    const fg = parseColor(style.color) ?? { r: 0, g: 0, b: 0, a: 1 };
    if (fg.a === 0) continue;
    const bg = effectiveBackground(el);
    texts.push({
      text: el.textContent.trim().replace(/\s+/g, " ").slice(0, 48),
      selector: selector(el),
      fontPx: Number.parseFloat(style.fontSize),
      weight: style.fontWeight,
      color: style.color,
      background: `rgb(${Math.round(bg.r)}, ${Math.round(bg.g)}, ${Math.round(bg.b)})`,
      contrast: Number(contrast(fg.a < 1 ? { ...fg, a: 1 } : fg, bg).toFixed(2)),
      role: el.getAttribute("role") || null,
      pit: el.closest("[data-pitwall-col], [data-ptp-panel]")?.getAttribute("data-pitwall-col") ||
        el.closest("[data-ptp-panel]")?.getAttribute("data-ptp-panel") || "masthead/kpi",
    });
  }

  const clip = [];
  for (const el of document.querySelectorAll("body *")) {
    const style = getComputedStyle(el);
    if (style.display === "none" || style.visibility === "hidden") continue;
    if (el.classList.contains("sr-only") || el.closest(".sr-only")) continue;
    const box = el.getBoundingClientRect();
    if (box.width <= 2 || box.height <= 2) continue;
    const overflowX = style.overflowX;
    const overflowY = style.overflowY;
    const clipsX = (overflowX === "hidden" || overflowX === "clip") && el.scrollWidth > el.clientWidth + 1;
    const clipsY = (overflowY === "hidden" || overflowY === "clip") && el.scrollHeight > el.clientHeight + 1;
    // Een scrollcontainer is geen afkapping: de inhoud blijft bereikbaar.
    const scrollsX = overflowX === "auto" || overflowX === "scroll";
    const scrollsY = overflowY === "auto" || overflowY === "scroll";
    // Een ouder met overflow:hidden kan bovenmatige scrollHeight krijgen van een
    // kind dat zélf scrolt (tabel in de timingtoren). Dat is bereikbaar, geen
    // afkapping; tel alleen overloop zonder eigen scrollbare afhandeling.
    const descendantScrolls = [...el.querySelectorAll("*")].some((child) => {
      const s = getComputedStyle(child);
      return ((s.overflowY === "auto" || s.overflowY === "scroll") && child.scrollHeight > child.clientHeight + 1) ||
        ((s.overflowX === "auto" || s.overflowX === "scroll") && child.scrollWidth > child.clientWidth + 1);
    });
    if (((clipsX && !scrollsX) || (clipsY && !scrollsY)) && !descendantScrolls) {
      clip.push({
        selector: selector(el),
        text: el.textContent.trim().replace(/\s+/g, " ").slice(0, 60),
        axis: clipsX ? "x" : "y",
        client: clipsX ? { w: el.clientWidth } : { h: el.clientHeight },
        scroll: clipsX ? { w: el.scrollWidth } : { h: el.scrollHeight },
        overflow: `${overflowX}/${overflowY}`,
      });
    }
  }

  const panelEls = [...document.querySelectorAll('[data-pitwall-row="panels"] > div')];
  const panels = panelEls.map((el) => {
    const box = el.getBoundingClientRect();
    const section = el.querySelector("section") ?? el;
    const sectionBox = section.getBoundingClientRect();
    const children = [...section.querySelectorAll("p, dd, dt, li, button, [role=meter], h3")];
    const outside = children.filter((child) => {
      const r = child.getBoundingClientRect();
      return r.bottom > sectionBox.bottom + 1 || r.right > sectionBox.right + 1;
    }).map((child) => ({ selector: selector(child), text: child.textContent.trim().slice(0, 40) }));
    return {
      slot: el.getAttribute("data-ptp-panel"),
      x: Math.round(box.x), y: Math.round(box.y), w: Math.round(box.width), h: Math.round(box.height),
      visible: box.width > 0 && box.height > 0 && box.bottom > 0 && box.top < innerHeight,
      scrollH: section.scrollHeight, clientH: section.clientHeight,
      outside,
    };
  });
  const textPanel = (() => {
    const el = document.querySelector(".ptp-timing-scroll") || document.querySelector('[data-pitwall-col="timing"]');
    if (!el) return null;
    const box = el.getBoundingClientRect();
    return {
      client: { w: el.clientWidth, h: el.clientHeight },
      scroll: { w: el.scrollWidth, h: el.scrollHeight },
      box: { x: Math.round(box.x), y: Math.round(box.y), w: Math.round(box.width), h: Math.round(box.height) },
      overflowY: getComputedStyle(el).overflowY,
      overflowX: getComputedStyle(el).overflowX,
    };
  })();

  const small = texts.filter((t) => t.fontPx < 11);
  const lowContrast = texts.filter((t) => t.contrast < 4.5);
  const keyValues = {
    s1: [...document.querySelectorAll("th, .ptp-col-sector")].some((el) => el.textContent.trim() === "S1"),
    pit: texts.some((t) => t.text === "PIT" || t.text.includes("PIT")),
    offline: texts.some((t) => /OFFLINE/i.test(t.text)),
    lastLap: texts.some((t) => /1:4\d\.\d{3}/.test(t.text)),
    gap: texts.some((t) => t.text.startsWith("+") && t.text.includes(".")),
  };

  return {
    viewport: { width: innerWidth, height: innerHeight },
    document: {
      width: document.documentElement.scrollWidth,
      height: document.documentElement.scrollHeight,
      horizontalOverflow: document.documentElement.scrollWidth > innerWidth + 1,
    },
    panels,
    panelCount: panels.length,
    panelsInViewport: panels.filter((p) => p.visible).length,
    timing: textPanel,
    textCount: texts.length,
    smallCount: small.length,
    smallest: [...texts].sort((a, b) => a.fontPx - b.fontPx).slice(0, 14),
    lowContrast: lowContrast.sort((a, b) => a.contrast - b.contrast).slice(0, 14),
    lowContrastCount: lowContrast.length,
    clip: clip.slice(0, 20),
    clipCount: clip.length,
    keyValues,
  };
};

await mkdir(OUT, { recursive: true });
const browser = await chromium.launch({ executablePath: CHROME });
const report = { label: LABEL, base: BASE, chrome: CHROME, generatedAt: new Date().toISOString(), runs: [] };
try {
  for (const viewport of VIEWPORTS) {
    if (VIEWPORT_FILTER && viewport.id !== VIEWPORT_FILTER) continue;
    for (const variant of VARIANTS) {
      if (ONLY && !`${variant}`.includes(ONLY)) continue;
      for (const focus of [false, true]) {
        for (const state of ["live", "offline"]) {
          const page = await browser.newPage({
            viewport: { width: viewport.width, height: viewport.height },
            deviceScaleFactor: 1,
            reducedMotion: "reduce",
          });
          const errors = [];
          page.on("pageerror", (error) => errors.push(String(error)));
          page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
          await page.route("**/*", (route) => {
            const url = new URL(route.request().url());
            if (url.port === "54321") {
              return route.fulfill({ status: 200, contentType: "application/json", body: "[]" });
            }
            if (url.hostname !== "127.0.0.1" && url.hostname !== "localhost") return route.abort();
            return route.continue();
          });
          const url = target(variant, focus, state, viewport);
          await page.goto(url, { waitUntil: "networkidle" });
          await page.evaluate(() => document.fonts.ready);
          await page.waitForTimeout(350);
          const metrics = await page.evaluate(measure);
          const id = `${variant}-${focus ? "focus" : "normal"}-${state}-${viewport.id}`;
          const screenshot = path.join(OUT, `${id}.png`);
          await page.screenshot({ path: screenshot, fullPage: !focus });
          // Bewijs dat wat buiten beeld valt ook echt bereikbaar is: scrol naar
          // het einde en meet de laatste kaart opnieuw.
          const scrollCheck = await page.evaluate(async (isFocus) => {
            const scroller = isFocus ? document.querySelector(".ptp-focus-shell") : document.scrollingElement;
            if (!scroller) return null;
            const before = scroller.scrollTop;
            scroller.scrollTop = scroller.scrollHeight;
            await new Promise((resolve) => setTimeout(resolve, 120));
            const panels = [...document.querySelectorAll('[data-pitwall-row="panels"] > div')];
            const last = panels[panels.length - 1]?.getBoundingClientRect() ?? null;
            const inside = (rect) => rect && rect.top >= -1 && rect.bottom <= innerHeight + 1 && rect.left >= -1 && rect.right <= innerWidth + 1;
            const result = {
              client: scroller.clientHeight,
              scrollHeight: scroller.scrollHeight,
              maxScroll: Math.max(0, scroller.scrollHeight - scroller.clientHeight),
              reachedBottom: Math.abs(scroller.scrollTop - Math.max(0, scroller.scrollHeight - scroller.clientHeight)) <= 2,
              lastPanelBottom: last ? Math.round(last.bottom) : null,
              lastPanelVisible: inside(last),
              panelsVisibleAtEnd: panels.filter((panel) => inside(panel.getBoundingClientRect())).length,
              viewport: { width: innerWidth, height: innerHeight },
            };
            scroller.scrollTop = before;
            return result;
          }, focus);
          if (focus) {
            await page.evaluate(() => {
              const scroller = document.querySelector(".ptp-focus-shell");
              if (scroller) scroller.scrollTop = scroller.scrollHeight;
            });
            await page.waitForTimeout(120);
            await page.screenshot({ path: path.join(OUT, `${id}-scrollend.png`) });
            await page.evaluate(() => {
              const scroller = document.querySelector(".ptp-focus-shell");
              if (scroller) scroller.scrollTop = 0;
            });
          }
          report.runs.push({ id, variant, focus, state, viewport: viewport.id, errors, screenshot, metrics, scrollCheck });
          await page.close();
        }
      }
    }
  }
} finally {
  await browser.close();
}
report.summary = {
  runs: report.runs.length,
  withPageErrors: report.runs.filter((r) => r.errors.length).length,
  horizontalOverflow: report.runs.filter((r) => r.metrics.document.horizontalOverflow).map((r) => r.id),
  missingFivePanels: report.runs
    .filter((r) => r.metrics.panelCount !== expectedPanels(r.variant))
    .map((r) => ({ id: r.id, count: r.metrics.panelCount, expected: expectedPanels(r.variant) })),
  clips: report.runs.reduce((sum, r) => sum + r.metrics.clipCount, 0),
  textBelow11: report.runs.reduce((sum, r) => sum + r.metrics.smallCount, 0),
  contrastBelow45: report.runs.reduce((sum, r) => sum + r.metrics.lowContrastCount, 0),
  scrollNotReachable: report.runs
    .filter((r) => r.focus && (!r.scrollCheck?.reachedBottom || !r.scrollCheck?.lastPanelVisible))
    .map((r) => ({ id: r.id, scroll: r.scrollCheck })),
};
await writeFile(path.join(OUT, "report.json"), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report.summary, null, 2));
for (const run of report.runs) {
  console.log(
    `${run.id.padEnd(38)} panels=${run.metrics.panelCount} small=${String(run.metrics.smallCount).padStart(3)} ` +
    `lowContrast=${String(run.metrics.lowContrastCount).padStart(3)} clips=${String(run.metrics.clipCount).padStart(2)} ` +
    `docW=${run.metrics.document.width} errors=${run.errors.length}`,
  );
}
