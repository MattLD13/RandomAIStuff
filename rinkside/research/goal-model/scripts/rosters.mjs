// Shooting / catching hand and birth date for every player on every team roster, per season.
import { readdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
const old = existsSync('players.json') ? JSON.parse(readFileSync('players.json', 'utf8')) : {};   // existing entries are kept as they were
const out = {}, pairs = new Set();
for (const s of readdirSync('raw')) {
  const files = readdirSync(`raw/${s}`);
  for (const f of files) { const g = JSON.parse(gunzipSync(readFileSync(`raw/${s}/${f}`))); pairs.add(`${g.homeAbbrev} ${g.season}`); pairs.add(`${g.awayAbbrev} ${g.season}`); }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const list = [...pairs];
async function w() { while (list.length) { const [t, s] = list.pop().split(' ');
  for (let a = 0; a < 6; a++) { const r = await fetch(`https://api-web.nhle.com/v1/roster/${t}/${s}`).catch(() => null);
    if (r?.ok) { const j = await r.json(); for (const p of [...(j.forwards || []), ...(j.defensemen || []), ...(j.goalies || [])]) out[p.id] = [p.shootsCatches, p.positionCode, p.birthDate, p.heightInInches]; break; }
    if (r?.status === 404) break; await sleep(1000 * 2 ** a); } } }
await Promise.all(Array.from({ length: 6 }, w));
Object.assign(out, old);   // only players not seen before are added
// anyone in the play-by-play still missing (traded / called up after the roster snapshot): player page
const need = new Set();
for (const s of readdirSync('raw')) for (const f of readdirSync(`raw/${s}`)) {
  const g = JSON.parse(gunzipSync(readFileSync(`raw/${s}/${f}`)));
  for (const [pid] of g.roster) if (!(pid in out)) need.add(pid);
}
const ids = [...need];
async function w2() { while (ids.length) { const id = ids.pop();
  for (let a = 0; a < 6; a++) { const r = await fetch(`https://api-web.nhle.com/v1/player/${id}/landing`).catch(() => null);
    if (r?.ok) { const p = await r.json(); out[id] = [p.shootsCatches, p.position, p.birthDate, p.heightInInches]; break; }
    if (r?.status === 404) break; await sleep(1000 * 2 ** a); } } }
await Promise.all(Array.from({ length: 4 }, w2));
console.log('looked up', need.size, 'players missing from team rosters');
writeFileSync('players.json', JSON.stringify(out)); console.log(pairs.size, 'team-seasons,', Object.keys(out).length, 'players');
