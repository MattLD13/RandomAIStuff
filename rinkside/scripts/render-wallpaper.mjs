#!/usr/bin/env node
// Renders lock-screen PNGs from the built site using Playwright:
//   site/<slug>/wallpaper.png for every team in site/data/teams.json (e.g. /rangers/wallpaper.png),
//   and site/wallpaper.png for the default team.
// Usage: node scripts/render-wallpaper.mjs [width height scale]   default 393 852 3 -> 1179x2556
// Env: TEAMS=NYR,BOS to limit; OUT=path to write a single file for the first team; FULL=1 for a full-page shot.
import { createServer } from 'node:http';
import { copyFile, mkdir, readFile } from 'node:fs/promises';
import { dirname, extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const SITE = join(dirname(fileURLToPath(import.meta.url)), '..', 'site');
const [w = 393, h = 852, scale = 3] = process.argv.slice(2).map(Number);
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png' };

const server = createServer(async (req, res) => {
  try {
    const path = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname)).replace(/^([/\\])+/, '');
    const file = join(SITE, !path || path.endsWith('/') ? `${path}index.html` : path);
    if (!file.startsWith(SITE)) throw new Error('bad path');
    res.writeHead(200, { 'content-type': types[extname(file)] || 'application/octet-stream' });
    res.end(await readFile(file));
  } catch {
    res.writeHead(404).end();
  }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const origin = `http://127.0.0.1:${server.address().port}/`;
const query = process.env.FULL ? '' : '?wallpaper';
const index = JSON.parse(await readFile(join(SITE, 'data', 'teams.json'), 'utf8'));
const slugOf = Object.fromEntries(index.teams.map((t) => [t.abbrev, t.slug]));
const teams = process.env.TEAMS ? process.env.TEAMS.toUpperCase().split(',') : index.teams.map((t) => t.abbrev);

const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: scale });
  for (const team of process.env.OUT ? teams.slice(0, 1) : teams) {
    const out = process.env.OUT || join(SITE, slugOf[team], 'wallpaper.png');
    await mkdir(dirname(out), { recursive: true });
    await page.goto(`${origin}${slugOf[team]}/${query}`, { waitUntil: 'networkidle' });
    await page.waitForFunction(() => document.body.dataset.ready === '1', null, { timeout: 30000 });
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(300);
    await page.screenshot({ path: out, fullPage: !!process.env.FULL });
    console.log(`Wrote ${out}`);
  }
  if (!process.env.OUT && teams.includes(index.default))
    await copyFile(join(SITE, slugOf[index.default], 'wallpaper.png'), join(SITE, 'wallpaper.png'));
} finally {
  await browser.close();
  server.close();
}
