// Season shot-speed numbers (NHL EDGE) for each shooter-season: avg and top speed, share of 80+ / 90+ mph attempts.
import { readFileSync, writeFileSync } from 'node:fs';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const pairs = readFileSync('edge_pairs.csv', 'utf8').trim().split('\n').slice(1).map((l) => l.split(',').map(Number));
const out = {}; let k = 0, n = 0;
async function w() { while (k < pairs.length) { const [s, id] = pairs[k++];
  for (let a = 0; a < 6; a++) {
    const r = await fetch(`https://api-web.nhle.com/v1/edge/skater-shot-speed-detail/${id}/${s}${s + 1}/2`).catch(() => null);
    if (r?.status === 404) break;
    if (r?.ok) { const j = await r.json(), d = j.shotSpeedDetails || {};
      out[`${s}:${id}`] = [d.avgShotSpeed?.imperial ?? null, d.topShotSpeed?.imperial ?? null,
        (d.shotAttemptsOver100?.value || 0) + (d.shotAttempts90To100?.value || 0), d.shotAttempts80To90?.value || 0]; break; }
    await sleep(1000 * 2 ** a); }
  if (++n % 500 === 0) console.log(n, '/', pairs.length); } }
await Promise.all(Array.from({ length: 4 }, w));
writeFileSync('edge.json', JSON.stringify(out)); console.log('done', Object.keys(out).length);
