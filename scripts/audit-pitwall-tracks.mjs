import { chromium } from '@playwright/test';
import { mkdir } from 'node:fs/promises';

// Run against a local Vite server. Exercises native SVG geometry, not jsdom mocks.
const browser = await chromium.launch({ ...(process.platform === 'win32' ? { channel: 'chrome' } : {}), headless: true });
try {
  const visual = process.argv.includes('--visual');
  const page = await browser.newPage({ viewport: { width: 1600, height: 1200 } });
  page.on('console', message => { if (message.text().startsWith('AUDIT:')) console.log(message.text()); });
  await page.route('**/pitwall-audit.html', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Pitwall geometry audit</title>' }));
  await page.goto(new URL('/pitwall-audit.html', process.argv[2] ?? 'http://127.0.0.1:4192/').href);
  const report = await page.evaluate(async visual => {
    const { loadTrackProjection } = await import('/src/lib/pitwallTrackGeometry.ts');
    const manifest = await fetch('/tracks/layered/manifest.json').then(r => r.json());
    const rows = [];
    const entries = visual ? manifest.tracks.filter(e => [127, 145, 168, 181, 186, 392, 414, 493, 501, 503, 580, 581].includes(e.trackId)) : manifest.tracks;
    document.body.style.cssText = 'background:#080b10;color:white;display:grid;grid-template-columns:repeat(3,1fr);font:14px sans-serif;gap:12px';
    for (const entry of entries) {
      if (rows.length % 50 === 0) console.log(`AUDIT: ${rows.length}/${manifest.count}`);
      try {
        const geometry = await loadTrackProjection(entry.name, entry.configName, new AbortController().signal);
        if (entry.trackId === 127 && (!geometry?.points.length || geometry.points[8].y <= geometry.points[0].y)) throw new Error('Road Atlanta direction regression');
        if (entry.trackId === 580 && (!geometry?.points.length || Math.hypot(geometry.points[0].x - 1424, geometry.points[0].y - 640) > 50)) throw new Error('Adelaide symbol/use start-line regression');
        if (visual && geometry) {
          const card = document.createElement('article');
          const title = document.createElement('p'); title.textContent = `${entry.trackId} · ${entry.name} · SIMULATIE`;
          card.append(title);
          const ns = 'http://www.w3.org/2000/svg';
          const svg = document.createElementNS(ns, 'svg'); svg.setAttribute('viewBox', '0 0 1920 1080');
          const image = document.createElementNS(ns, 'image'); image.setAttribute('href', geometry.mapPath); image.setAttribute('width', '1920'); image.setAttribute('height', '1080'); svg.append(image);
          for (let i = 0; i < 16 && geometry.points.length; i++) {
            const p = geometry.points[Math.floor(i * geometry.points.length / 16)];
            const circle = document.createElementNS(ns, 'circle'); circle.setAttribute('cx', String(p.x)); circle.setAttribute('cy', String(p.y)); circle.setAttribute('r', '28'); circle.setAttribute('fill', i === 0 ? '#ff0' : '#0df'); svg.append(circle);
            const text = document.createElementNS(ns, 'text'); text.setAttribute('x', String(p.x)); text.setAttribute('y', String(p.y + 7)); text.setAttribute('text-anchor', 'middle'); text.setAttribute('font-size', '22'); text.textContent = String(i); svg.append(text);
          }
          card.append(svg);
          const note = document.createElement('p'); note.textContent = geometry.unavailableReason ?? '0 = start/finish; 1–15 = toenemende rondeafstand'; card.append(note); document.body.append(card);
        }
        rows.push({ id: entry.trackId, name: entry.name, available: !!geometry,
          direction: geometry?.hasOfficialDirection,
          projected: !!geometry?.points.length,
          reason: geometry?.unavailableReason,
          valid: geometry?.points.every(p => Number.isFinite(p.x) && Number.isFinite(p.y) && p.x >= 0 && p.x <= 1920 && p.y >= 0 && p.y <= 1080),
          start: geometry?.points[0],
          bounds: geometry ? { minX: Math.min(...geometry.points.map(p => p.x)), minY: Math.min(...geometry.points.map(p => p.y)), maxX: Math.max(...geometry.points.map(p => p.x)), maxY: Math.max(...geometry.points.map(p => p.y)) } : null,
        });
      } catch (error) { rows.push({ id: entry.trackId, name: entry.name, error: String(error) }); }
    }
    return { total: rows.length, projected: rows.filter(r => r.projected).length, unavailable: rows.filter(r => !r.available), invalid: rows.filter(r => r.available && !r.valid), uncalibrated: rows.filter(r => r.available && !r.projected) };
  }, visual);
  if (visual) { await mkdir('builds/pitwall-allmaps', { recursive: true }); await page.screenshot({ path: 'builds/pitwall-allmaps/catalog.png', fullPage: true }); }
  console.log(JSON.stringify(report, null, 2));
  if (report.unavailable.length || report.invalid.length) process.exitCode = 1;
  if (!visual) {
    const expected = [143,145,146,168,173,175,176,189,202,207,209,211,214,215,216,239,242,244,319,398,399,581];
    if (report.total !== 424 || report.projected !== 402 || JSON.stringify(report.uncalibrated.map(r => r.id)) !== JSON.stringify(expected)) {
      console.error('Catalog coverage changed; review the exact supported/uncalibrated set.');
      process.exitCode = 1;
    }
  }
} finally { await browser.close(); }
