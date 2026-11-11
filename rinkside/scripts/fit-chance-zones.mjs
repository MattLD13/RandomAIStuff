// Fit the scoring-chance danger zones to published chance reports (calibration/chance-reports.json).
//   high danger: within crease ft of the net at any angle, or within hiDist ft and hiAng degrees of straight on
//   mid danger:  within midDist ft and midAng degrees;   low: the rest of the zone
//   dump:        a shot on goal from outside the offensive zone or more than dump ft from the goal line
// Every combination on a grid is scored by the total count error over all reports; among the tied best, the one
// closest to the middle of the tied set is chosen. Leave-one-game-out shows how well a fit carries to a new game.
//   node scripts/fit-chance-zones.mjs           report only
//   node scripts/fit-chance-zones.mjs --write   also update ZONES in site/chances-core.mjs
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { reduce } from '../site/chances-core.mjs';
const here = new URL('..', import.meta.url).pathname;
const R = JSON.parse(readFileSync(here + 'calibration/chance-reports.json', 'utf8')).reports;
const cache = here + '.cache/calib'; mkdirSync(cache, { recursive: true });
const shots = {};
for (const id of [...new Set(R.map((r) => r.game))]) {
  const f = `${cache}/${id}.json`;
  let pbp;
  if (existsSync(f)) pbp = JSON.parse(readFileSync(f, 'utf8'));
  else { pbp = await (await fetch(`https://api-web.nhle.com/v1/gamecenter/${id}/play-by-play`)).json(); writeFileSync(f, JSON.stringify(pbp)); }
  const g = reduce(pbp), ab = { [pbp.homeTeam.id]: pbp.homeTeam.abbrev, [pbp.awayTeam.id]: pbp.awayTeam.abbrev };
  shots[id] = g.shots.filter((s) => !s.en).map((s) => ({ team: ab[s.team], zone: s.zone, fx: s.fx, goal: s.goal,
    dist: Math.hypot(s.fx, s.ay), ang: Math.atan2(s.ay, Math.max(s.fx, 0.5)) * 180 / Math.PI }));
}
const classify = (s, z) => (s.zone !== 'O' || s.fx > z.dump) ? 'dumps' : (s.dist <= z.crease || (s.dist <= z.hiDist && s.ang <= z.hiAng)) ? 'hi' : (s.dist <= z.midDist && s.ang <= z.midAng) ? 'mid' : 'low';
function err(z, reps) {
  let e = 0;
  for (const r of reps) {
    const c = { chances: 0, hi: 0, mid: 0, low: 0, dumps: 0, hiGoals: 0, midGoals: 0, lowGoals: 0 };
    for (const s of shots[r.game]) if (s.team === r.team) { const k = classify(s, z); c[k]++; if (k !== 'dumps') { c.chances++; c[k + 'Goals'] += s.goal; } }
    for (const k of Object.keys(c)) if (r[k] !== null && r[k] !== undefined) e += Math.abs(c[k] - r[k]);
  }
  return e;
}
const grid = [];
for (const crease of [0, 6, 8, 10, 12]) for (let dump = 50; dump <= 64; dump += 2) for (let hiDist = 12; hiDist <= 30; hiDist += 1) for (let hiAng = 25; hiAng <= 80; hiAng += 5)
  for (let midDist = hiDist + 2; midDist <= 46; midDist += 2) for (let midAng = hiAng; midAng <= 90; midAng += 5) grid.push({ crease, dump, hiDist, hiAng, midDist, midAng });
function fit(reps) {
  let best = Infinity, tied = [];
  for (const z of grid) { const e = err(z, reps); if (e < best) { best = e; tied = [z]; } else if (e === best) tied.push(z); }
  const keys = Object.keys(tied[0]), med = {};
  for (const k of keys) { const v = tied.map((z) => z[k]).sort((a, b) => a - b); med[k] = v[Math.floor(v.length / 2)]; }
  const span = Object.fromEntries(keys.map((k) => [k, Math.max(1, Math.max(...tied.map((z) => z[k])) - Math.min(...tied.map((z) => z[k])))]));
  const pick = tied.reduce((a, z) => { const d = keys.reduce((s, k) => s + ((z[k] - med[k]) / span[k]) ** 2, 0); return d < a[0] ? [d, z] : a; }, [Infinity, null])[1];
  return { z: pick, err: best, tied: tied.length };
}
const all = fit(R);
console.log(`${R.length} team-game reports from ${new Set(R.map((r) => r.game)).size} games`);
console.log('fit on all:', JSON.stringify(all.z), `total count error ${all.err} (${all.tied} tied settings)`);
const old = { dump: 58, box: true };
const oldErr = R.reduce((e, r) => e + err0(r), 0);
function err0(r) {   // the previous rule: a box (20 ft out, 19 ft wide; mid 30 x 30), dumps beyond 58 ft
  const c = { chances: 0, hi: 0, mid: 0, low: 0, dumps: 0, hiGoals: 0, midGoals: 0, lowGoals: 0 };
  for (const s of shots[r.game]) if (s.team === r.team) {
    const ay = s.dist * Math.sin(s.ang * Math.PI / 180);
    const k = (s.zone !== 'O' || s.fx > 58) ? 'dumps' : (s.fx >= -3 && s.fx <= 20 && ay <= 19) ? 'hi' : (s.fx <= 30 && ay <= 30) ? 'mid' : 'low';
    c[k]++; if (k !== 'dumps') { c.chances++; c[k + 'Goals'] += s.goal; }
  }
  let e = 0; for (const k of Object.keys(c)) if (r[k] !== null && r[k] !== undefined) e += Math.abs(c[k] - r[k]); return e;
}
console.log('previous box rule: total count error', oldErr);
const games = [...new Set(R.map((r) => r.game))];
if (games.length >= 2) {
  let lo = 0, loOld = 0;
  for (const g of games) { const f = fit(R.filter((r) => r.game !== g)); const held = R.filter((r) => r.game === g); lo += err(f.z, held); loOld += held.reduce((e, r) => e + err0(r), 0); }
  console.log(`leave-one-game-out count error: fitted zones ${lo}, previous box ${loOld}  (lower = carries better to a game the fit did not see)`);
}
if (process.argv.includes('--write')) {
  const f = here + 'site/chances-core.mjs', src = readFileSync(f, 'utf8');
  const line = `export const ZONES = ${JSON.stringify(all.z)};   // fitted on ${R.length} team-games (${games.length} games), count error ${all.err}`;
  writeFileSync(f, src.replace(/^export const ZONES = .*$/m, line));
  console.log('updated ZONES in site/chances-core.mjs');
}
