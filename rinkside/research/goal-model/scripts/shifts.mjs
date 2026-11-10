// Shift charts for every downloaded game: [playerId, teamId, period, startSec, endSec]
import { readdirSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { gzipSync, gunzipSync } from 'node:zlib';
import { readFileSync } from 'node:fs';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const secs = (t) => { const [m, s] = String(t || '0:0').split(':').map(Number); return m * 60 + s; };

// Fallback when the stats API has no chart: the NHL's HTML time-on-ice reports (same parser as rinkside/site/war-core.mjs)
function parseToiReport(html, teamId, roster) {
  const byNumber = Object.fromEntries(roster.filter((r) => r[1] === teamId).map((r) => [r[3], r[0]]));
  const out = [];
  for (const part of html.split('class="playerHeading').slice(1)) {
    const head = part.slice(part.indexOf('>') + 1, part.indexOf('</td>')).trim();
    const id = byNumber[parseInt(head, 10)];
    if (!id) continue;
    for (const m of part.matchAll(/<tr class="\s*(?:oddColor|evenColor)">([\s\S]*?)<\/tr>/g)) {
      const cells = [...m[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((c) => c[1].replace(/&nbsp;/g, ' ').trim());
      if (cells.length < 5 || !cells[2].includes('/') || !cells[3].includes('/')) continue;
      const p = cells[1] === 'OT' ? 4 : parseInt(cells[1], 10);
      if (!p) continue;
      out.push([id, teamId, p, secs(cells[2].split('/')[0].trim()), secs(cells[3].split('/')[0].trim())]);
    }
  }
  return out;
}
async function fromReports(s, id) {
  const g = JSON.parse(gunzipSync(readFileSync(`raw/${s}/${id}.json.gz`)));
  const base = `https://www.nhl.com/scores/htmlreports/${id.slice(0, 4)}${+id.slice(0, 4) + 1}`;
  const text = async (u) => { for (let a = 0; a < 4; a++) { const r = await fetch(u).catch(() => null); if (r?.ok) return r.text(); if (r?.status === 404) return ''; await sleep(800 * 2 ** a); } return ''; };
  const [th, tv] = await Promise.all([text(`${base}/TH${id.slice(4)}.HTM`), text(`${base}/TV${id.slice(4)}.HTM`)]);
  return [...parseToiReport(th, g.home, g.roster), ...parseToiReport(tv, g.away, g.roster)];
}
const ids = [];
for (const s of readdirSync('raw')) for (const f of readdirSync(`raw/${s}`)) ids.push([s, f.split('.')[0]]);
let k = 0, done = 0, empty = 0, fromHtml = 0; const t0 = Date.now();
async function w() {
  while (k < ids.length) {
    const [s, id] = ids[k++]; mkdirSync(`shifts/${s}`, { recursive: true }); const f = `shifts/${s}/${id}.json.gz`;
    if (existsSync(f) && JSON.parse(gunzipSync(readFileSync(f))).length >= 200) { done++; continue; }   // empty / partial files are fetched again
    let j = null;
    for (let a = 0; a < 12 && !j; a++) {
      const r = await fetch(`https://api.nhle.com/stats/rest/en/shiftcharts?cayenneExp=gameId=${id}`).catch(() => null);
      if (r?.ok) j = await r.json(); else await sleep(Math.min(8000, 800 * 2 ** a));
    }
    const rows = (j?.data || []).filter((x) => x.typeCode === 517 && x.period <= 4).map((x) => [x.playerId, x.teamId, x.period, secs(x.startTime), secs(x.endTime)]);
    let use = rows;
    if (rows.length < 200) { const h = await fromReports(s, id).catch(() => []); if (h.length >= 200) { use = h; fromHtml++; } }
    if (use.length < 200) { empty++; done++; continue; }   // empty / partial: not cached, retried next run
    writeFileSync(f, gzipSync(JSON.stringify(use))); done++;
    if (done % 250 === 0) console.log(done, '/', ids.length, 'empty', empty, ((Date.now() - t0) / 1000).toFixed(0) + 's');
  }
}
await Promise.all(Array.from({ length: 4 }, w));
console.log('finished', done, 'from HTML reports', fromHtml, 'still missing', empty, ((Date.now() - t0) / 1000).toFixed(0) + 's');
