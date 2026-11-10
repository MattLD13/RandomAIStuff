// Shooting / catching hand and birth date for every player on every team roster, per season.
import { readdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
const old = existsSync('players.json') ? JSON.parse(readFileSync('players.json', 'utf8')) : {};   // existing entries are kept as they were
const out = {}, pairs = new Set();
for (const s of readdirSync('raw')) {
  const files = readdirSync(`raw/${s}`);
  for (const f of files.filter((_, i) => i % 25 === 0)) { const g = JSON.parse(gunzipSync(readFileSync(`raw/${s}/${f}`))); pairs.add(`${g.homeAbbrev} ${g.season}`); pairs.add(`${g.awayAbbrev} ${g.season}`); }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const list = [...pairs];
async function w() { while (list.length) { const [t, s] = list.pop().split(' ');
  for (let a = 0; a < 6; a++) { const r = await fetch(`https://api-web.nhle.com/v1/roster/${t}/${s}`).catch(() => null);
    if (r?.ok) { const j = await r.json(); for (const p of [...(j.forwards || []), ...(j.defensemen || []), ...(j.goalies || [])]) out[p.id] = [p.shootsCatches, p.positionCode, p.birthDate, p.heightInInches]; break; }
    if (r?.status === 404) break; await sleep(1000 * 2 ** a); } } }
await Promise.all(Array.from({ length: 6 }, w));
Object.assign(out, old);   // only players not seen before are added
writeFileSync('players.json', JSON.stringify(out)); console.log(pairs.size, 'team-seasons,', Object.keys(out).length, 'players');
