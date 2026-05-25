#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';

const HOST = '3stripemotorsport.cc';
const KEY = '4486228027c74f048fa3815cbfe262ec';
const KEY_LOCATION = `https://${HOST}/${KEY}.txt`;
const ENDPOINT = 'https://api.indexnow.org/indexnow';
const SITEMAP_PATH = path.resolve('dist/sitemap.xml');

function unique(values) {
  return [...new Set(values)];
}

async function readUrlsFromSitemap() {
  const xml = await fs.readFile(SITEMAP_PATH, 'utf8');
  const urls = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((match) => match[1].trim());
  if (urls.length === 0) {
    throw new Error(`No <loc> URLs found in ${SITEMAP_PATH}`);
  }
  return unique(urls);
}

async function submit(urls) {
  const response = await fetch(ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify({
      host: HOST,
      key: KEY,
      keyLocation: KEY_LOCATION,
      urlList: urls,
    }),
  });

  const body = await response.text();
  if (!response.ok) {
    throw new Error(`IndexNow submit failed: HTTP ${response.status} ${response.statusText}${body ? `\n${body}` : ''}`);
  }

  console.log(`IndexNow accepted ${urls.length} URL(s): HTTP ${response.status}`);
  for (const url of urls) console.log(`- ${url}`);
}

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const cliUrls = args.filter((arg) => arg !== '--dry-run' && arg !== '--');
const urls = cliUrls.length > 0 ? unique(cliUrls) : await readUrlsFromSitemap();

if (dryRun) {
  console.log(`IndexNow dry run for ${urls.length} URL(s)`);
  console.log(`keyLocation: ${KEY_LOCATION}`);
  for (const url of urls) console.log(`- ${url}`);
} else {
  await submit(urls);
}
