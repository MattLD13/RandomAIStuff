// Shift charts for every downloaded game: [playerId, teamId, period, startSec, endSec]
import { readdirSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const secs = (t) => { const [m, s] = String(t || '0:0').split(':').map(Number); return m * 60 + s; };
const ids = [];
for (const s of readdirSync('raw')) for (const f of readdirSync(`raw/${s}`)) ids.push([s, f.split('.')[0]]);
let k = 0, done = 0, empty = 0; const t0 = Date.now();
async function w() {
  while (k < ids.length) {
    const [s, id] = ids[k++]; mkdirSync(`shifts/${s}`, { recursive: true }); const f = `shifts/${s}/${id}.json.gz`;
    if (existsSync(f)) { done++; continue; }
    let j = null;
    for (let a = 0; a < 12 && !j; a++) {
      const r = await fetch(`https://api.nhle.com/stats/rest/en/shiftcharts?cayenneExp=gameId=${id}`).catch(() => null);
      if (r?.ok) j = await r.json(); else await sleep(Math.min(8000, 800 * 2 ** a));
    }
    const rows = (j?.data || []).filter((x) => x.typeCode === 517 && x.period <= 4).map((x) => [x.playerId, x.teamId, x.period, secs(x.startTime), secs(x.endTime)]);
    if (!rows.length) empty++;
    writeFileSync(f, gzipSync(JSON.stringify(rows))); done++;
    if (done % 250 === 0) console.log(done, '/', ids.length, 'empty', empty, ((Date.now() - t0) / 1000).toFixed(0) + 's');
  }
}
await Promise.all(Array.from({ length: 4 }, w));
console.log('finished', done, 'empty', empty, ((Date.now() - t0) / 1000).toFixed(0) + 's');
