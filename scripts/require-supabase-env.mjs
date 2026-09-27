/**
 * Preflight voor `npm run build`.
 *
 * Vite bakt `VITE_*`-variabelen tijdens de build in de client-bundle. Zonder
 * Supabase-env bouwt Vite gewoon door, maar gooit de app bij het opstarten
 * "Missing Supabase environment variables" — de pagina laadt dan wel (HTTP 200,
 * met de geprerenderde crawler-tekst) maar React mount nooit: een wit scherm.
 * Dat is op 27-09-2026 precies zo live gegaan vanuit een verse release-worktree
 * zonder .env.
 *
 * Daarom hier falen vóórdat er iets gebouwd of gepubliceerd wordt. Bewust
 * bouwen zonder Supabase kan met ALLOW_MISSING_SUPABASE_ENV=1.
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));

const parseEnvFile = (path) => {
  if (!existsSync(path)) return {};
  const out = {};
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!match) continue;
    out[match[1]] = match[2].replace(/^["']|["']$/g, '');
  }
  return out;
};

const env = {
  ...parseEnvFile(join(root, '.env')),
  ...parseEnvFile(join(root, '.env.local')),
  ...parseEnvFile(join(root, '.env.production')),
  ...parseEnvFile(join(root, '.env.production.local')),
  ...process.env,
};

const missing = ['VITE_SUPABASE_URL', 'VITE_SUPABASE_ANON_KEY'].filter((key) => !env[key]);

if (missing.length === 0) {
  console.log(`Supabase-env aanwezig (${Object.keys(env).filter((k) => k.startsWith('VITE_SUPABASE')).length} VITE_SUPABASE-sleutels).`);
  process.exit(0);
}

if (process.env.ALLOW_MISSING_SUPABASE_ENV === '1') {
  console.warn(`Supabase-env ontbreekt (${missing.join(', ')}); doorgebouwd omdat ALLOW_MISSING_SUPABASE_ENV=1. De app zal dit in de browser melden.`);
  process.exit(0);
}

console.error(
  `✗ Build afgebroken: ${missing.join(' en ')} ontbreekt.\n`
  + '  Vite zou een client-bundle bouwen waarin de app bij het opstarten crasht\n'
  + '  ("Missing Supabase environment variables") — de site laadt dan wel maar\n'
  + '  blijft leeg. Een verse release-worktree heeft geen .env (gitignored);\n'
  + '  deploy.sh neemt die over uit de vorige actieve release.\n'
  + '  Bewust zonder Supabase bouwen: ALLOW_MISSING_SUPABASE_ENV=1.',
);
process.exit(1);
