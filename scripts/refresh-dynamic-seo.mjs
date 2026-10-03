import { assertSameSiteBuild } from "./seo-release-guard.mjs";
import { fileURLToPath } from "node:url";
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const repoRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));
const distDir = join(repoRoot, 'dist');
const webroot = process.env.WEBROOT || '/var/www/3sm';
const manifestPath = join(distDir, '.route-html-manifest.json');
const generatorPath = join(repoRoot, 'scripts/generate-route-html.mjs');

const routeIndexPath = (routePath, baseDir) => join(baseDir, routePath.replace(/^\//, ''), 'index.html');
const routeDirectoryPath = (routePath, baseDir) => dirname(routeIndexPath(routePath, baseDir));

const readManifest = () => {
  if (!existsSync(manifestPath)) return null;
  return JSON.parse(readFileSync(manifestPath, 'utf8'));
};

const assertReadableFile = (path, label) => {
  if (!existsSync(path)) throw new Error(`${label} ontbreekt: ${path}`);
};

const filesEqual = (left, right) =>
  existsSync(left) && existsSync(right) && readFileSync(left).equals(readFileSync(right));

let updatedFiles = 0;
const copyFileIfChanged = (from, to) => {
  if (filesEqual(from, to)) return false;
  mkdirSync(dirname(to), { recursive: true });
  copyFileSync(from, to);
  updatedFiles += 1;
  return true;
};

assertReadableFile(join(distDir, 'index.html'), 'Build artifact dist/index.html');
assertReadableFile(generatorPath, 'Route HTML generator');

const assertActiveBuild = () => {
  assertReadableFile(join(webroot, 'index.html'), 'Live index.html');
  assertSameSiteBuild(readFileSync(join(distDir, 'index.html'), 'utf8'), readFileSync(join(webroot, 'index.html'), 'utf8'));
};
assertActiveBuild();
const previousManifest = readManifest();

const result = spawnSync(process.execPath, [generatorPath], {
  cwd: repoRoot,
  stdio: 'inherit',
  env: process.env,
});
if (result.status !== 0) {
  throw new Error(`generate-route-html.mjs faalde met exit code ${result.status}`);
}

assertActiveBuild();
const nextManifest = readManifest();
if (!nextManifest) throw new Error('Route manifest is niet gegenereerd');

const nextKnownRoutes = new Set([
  ...(nextManifest.publicRoutes || []),
  ...(nextManifest.privateRoutes || []),
]);

for (const stalePath of previousManifest?.dynamicRoutes || []) {
  if (nextKnownRoutes.has(stalePath)) continue;
  if (!stalePath.startsWith('/news/') && !stalePath.startsWith('/results/')) continue;
  rmSync(routeDirectoryPath(stalePath, webroot), { recursive: true, force: true });
}

const changedRoutes = [];
const copyHtmlRoute = (routePath) => {
  const from = routePath === '/' ? join(distDir, 'index.html') : routeIndexPath(routePath, distDir);
  const to = routePath === '/' ? join(webroot, 'index.html') : routeIndexPath(routePath, webroot);
  assertReadableFile(from, `Generated HTML voor ${routePath}`);
  if (copyFileIfChanged(from, to)) changedRoutes.push(routePath);
};

for (const routePath of nextManifest.publicRoutes || []) copyHtmlRoute(routePath);
for (const routePath of nextManifest.privateRoutes || []) copyHtmlRoute(routePath);

copyFileIfChanged(join(distDir, 'sitemap.xml'), join(webroot, 'sitemap.xml'));
copyFileIfChanged(join(distDir, 'llms.txt'), join(webroot, 'llms.txt'));
copyFileIfChanged(join(distDir, 'feed.xml'), join(webroot, 'feed.xml'));
copyFileIfChanged(join(distDir, '404.html'), join(webroot, '404.html'));
copyFileIfChanged(join(distDir, 'app-shell-fallback.html'), join(webroot, 'app-shell-fallback.html'));
copyFileIfChanged(manifestPath, join(webroot, '.route-html-manifest.json'));

// Nieuwe en gewijzigde nieuws- en uitslagpagina's meteen aanmelden bij Bing via
// IndexNow: dat is precies waarom die sleutel in de webroot staat. Alleen echte
// wijzigingen worden verstuurd, dus een rustige refresh meldt niets aan.
// Uitzetten kan met SKIP_INDEXNOW=1.
const indexableRoutes = changedRoutes.filter(
  (routePath) => routePath.startsWith('/news/') || routePath.startsWith('/results/'),
);
if (process.env.SKIP_INDEXNOW !== '1' && indexableRoutes.length > 0) {
  const urls = indexableRoutes.map((routePath) =>
    `https://3stripemotorsport.cc${routePath.endsWith('/') ? routePath : `${routePath}/`}`);
  const submit = spawnSync(process.execPath, [join(repoRoot, 'scripts/submit-indexnow.mjs'), ...urls], {
    cwd: repoRoot,
    stdio: 'inherit',
  });
  if (submit.status !== 0) {
    // Geen harde fout: de site staat live en de volgende refresh probeert het opnieuw.
    console.warn(`⚠ IndexNow-melding mislukt voor ${urls.length} gewijzigde pagina('s); de site is wel bijgewerkt.`);
  }
}

console.log(`Refreshed dynamic SEO HTML into ${webroot}: ${updatedFiles} gewijzigde bestanden; ${(nextManifest.publicRoutes || []).length} public routes, ${(nextManifest.dynamicRoutes || []).length} dynamic routes.`);
