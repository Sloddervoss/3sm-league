import { chromium } from 'playwright';

const baseURL = process.env.BASE_URL || 'http://127.0.0.1:4173';
const executablePath = '/home/hermes/.cache/ms-playwright/chromium-1234/chrome-linux64/chrome';
const browser = await chromium.launch({ executablePath, headless: true, args: ['--no-sandbox'] });

async function inspect(path, width, label, mode = 'enabled') {
  const context = await browser.newContext({ viewport: { width, height: width < 600 ? 900 : 1000 } });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(`page:${error.message}`));
  page.on('console', (message) => { if (message.type() === 'error') errors.push(`console:${message.text()}`); });
  if (mode === 'disabled') {
    await page.route('**/tracks/layered/runtime.json*', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: '{"enabled":false}' }));
  }
  if (mode === 'asset-error') {
    await page.route('**/tracks/layered/track-*.svg', (route) => route.fulfill({ status: 404, body: 'missing' }));
  }
  const response = await page.goto(`${baseURL}${path}`, { waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForTimeout(1200);
  const images = await page.locator('img').evaluateAll((nodes) => nodes.map((node) => ({ src: node.currentSrc || node.src, complete: node.complete, width: node.naturalWidth, height: node.naturalHeight })).filter((image) => image.src.includes('/tracks/layered/') || image.src.includes('wikimedia')));
  await page.screenshot({ path: `/tmp/${label}.png`, fullPage: true });
  await context.close();
  return { label, status: response?.status(), images, errors };
}

const results = [];
results.push(await inspect('/', 1440, 'layered-home-desktop'));
results.push(await inspect('/calendar/', 1440, 'layered-calendar-desktop'));
results.push(await inspect('/calendar/', 390, 'layered-calendar-mobile'));
results.push(await inspect('/', 1440, 'fallback-home-disabled', 'disabled'));
results.push(await inspect('/', 1440, 'fallback-home-asset-error', 'asset-error'));
console.log(JSON.stringify(results, null, 2));
const unexpectedErrors = results.some((result) => result.status !== 200 || (result.label !== 'fallback-home-asset-error' && result.errors.length));
const brokenAssetFallback = results.find((result) => result.label === 'fallback-home-asset-error');
const fallbackSucceeded = brokenAssetFallback?.images.some((image) => image.src.includes('wikimedia') && image.complete && image.width > 0);
if (unexpectedErrors || !fallbackSucceeded) process.exitCode = 1;
await browser.close();
