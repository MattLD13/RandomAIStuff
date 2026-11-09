// Drives render/render.html in headless Chromium to turn a scene spec into a PNG.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript' };

export async function startRenderer() {
  const server = http.createServer((req, res) => {
    const p = path.join(ROOT, decodeURIComponent(new URL(req.url, 'http://x').pathname));
    if (!p.startsWith(ROOT) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { 'content-type': TYPES[path.extname(p)] || 'application/octet-stream' });
    fs.createReadStream(p).pipe(res);
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const page = await browser.newPage({ deviceScaleFactor: 2, viewport: { width: 1200, height: 900 } });
  page.on('pageerror', (e) => console.error('render page error:', e.message));
  page.on('console', (m) => { if (m.type() === 'error') console.error('render console:', m.text()); });
  await page.goto(`http://127.0.0.1:${port}/render/render.html`);
  await page.waitForFunction(() => window.rendererReady === true);

  return {
    async render(spec, outFile) {
      let margin = spec.margin ?? 70;
      for (let i = 0; i < 6; i++) {
        const ok = await page.evaluate((s) => window.renderScene(s), { ...spec, margin });
        if (ok) break;
        margin += 30;
      }
      fs.mkdirSync(path.dirname(outFile), { recursive: true });
      await page.locator('#stage').screenshot({ path: outFile });
    },
    async close() { await browser.close(); server.close(); },
  };
}
