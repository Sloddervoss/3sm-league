import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = new URL('../', import.meta.url).pathname;
const dist = join(root, 'dist');
const config = JSON.parse(readFileSync(join(root, 'community-support.config.json'), 'utf8'));
const shared = config.dataSource === 'supabase';
if (config.public && !shared) throw new Error('Community Support public release requires dataSource=supabase');
const isPublic = config.public && shared;

const supportHtml = readFileSync(join(dist, 'support/index.html'), 'utf8');
const managementHtml = readFileSync(join(dist, 'support-beheer/index.html'), 'utf8');
const sitemap = readFileSync(join(dist, 'sitemap.xml'), 'utf8');
const manifest = JSON.parse(readFileSync(join(dist, '.route-html-manifest.json'), 'utf8'));
const noindex = '<meta name="robots" content="noindex, nofollow"';
const supportInSitemap = sitemap.includes('https://3stripemotorsport.cc/support/');
const supportPrivate = manifest.privateRoutes.includes('/support');
const supportPublic = manifest.publicRoutes.includes('/support');

const assertions = [
  [managementHtml.includes(noindex), '/support-beheer must always be noindex'],
  [manifest.privateRoutes.includes('/support-beheer'), '/support-beheer must always be private in manifest'],
  [isPublic ? !supportHtml.includes(noindex) : supportHtml.includes(noindex), '/support robots state does not match config'],
  [supportInSitemap === isPublic, '/support sitemap state does not match config'],
  [supportPrivate === !isPublic, '/support private manifest state does not match config'],
  [supportPublic === isPublic, '/support public manifest state does not match config'],
];
for (const [condition, message] of assertions) if (!condition) throw new Error(message);
console.log(`Community Support release boundary validated (${isPublic ? 'public/shared' : 'private/local-session'}).`);
