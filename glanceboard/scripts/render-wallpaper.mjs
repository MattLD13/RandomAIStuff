#!/usr/bin/env node
// Renders site/wallpaper.png (iPhone lock-screen size) from the built site using Playwright.
// Usage: node scripts/render-wallpaper.mjs [width height scale]   default 393 852 3 -> 1179x2556
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { dirname, extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const SITE = join(dirname(fileURLToPath(import.meta.url)), '..', 'site');
const [w = 393, h = 852, scale = 3] = process.argv.slice(2).map(Number);
const out = process.env.OUT || join(SITE, 'wallpaper.png');
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png' };

const server = createServer(async (req, res) => {
  try {
    const path = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname)).replace(/^([/\\])+/, '');
    const file = join(SITE, path || 'index.html');
    if (!file.startsWith(SITE)) throw new Error('bad path');
    res.writeHead(200, { 'content-type': types[extname(file)] || 'application/octet-stream' });
    res.end(await readFile(file));
  } catch {
    res.writeHead(404).end();
  }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const url = `http://127.0.0.1:${server.address().port}/index.html?${process.env.FULL ? '' : 'wallpaper'}`;

const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: scale });
  await page.goto(url, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => document.body.dataset.ready === '1', null, { timeout: 30000 });
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(500);
  await page.screenshot({ path: out, fullPage: !!process.env.FULL });
  console.log(`Wrote ${out}`);
} finally {
  await browser.close();
  server.close();
}
