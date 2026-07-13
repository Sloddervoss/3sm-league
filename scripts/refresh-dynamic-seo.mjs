import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const repoRoot = resolve(new URL('..', import.meta.url).pathname);
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

const previousManifest = readManifest();

const result = spawnSync(process.execPath, [generatorPath], {
  cwd: repoRoot,
  stdio: 'inherit',
  env: process.env,
});
if (result.status !== 0) {
  throw new Error(`generate-route-html.mjs faalde met exit code ${result.status}`);
}

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

const copyHtmlRoute = (routePath) => {
  const from = routePath === '/' ? join(distDir, 'index.html') : routeIndexPath(routePath, distDir);
  const to = routePath === '/' ? join(webroot, 'index.html') : routeIndexPath(routePath, webroot);
  assertReadableFile(from, `Generated HTML voor ${routePath}`);
  copyFileIfChanged(from, to);
};

for (const routePath of nextManifest.publicRoutes || []) copyHtmlRoute(routePath);
for (const routePath of nextManifest.privateRoutes || []) copyHtmlRoute(routePath);

copyFileIfChanged(join(distDir, 'sitemap.xml'), join(webroot, 'sitemap.xml'));
copyFileIfChanged(manifestPath, join(webroot, '.route-html-manifest.json'));

console.log(`Refreshed dynamic SEO HTML into ${webroot}: ${updatedFiles} gewijzigde bestanden; ${(nextManifest.publicRoutes || []).length} public routes, ${(nextManifest.dynamicRoutes || []).length} dynamic routes.`);
