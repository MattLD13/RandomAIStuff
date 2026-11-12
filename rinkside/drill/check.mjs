// Calibration check: simulate every real ending in the cache with the "typical coach" and compare
// the model's outcomes with what really happened from the same spots.
//   node drill/check.mjs
import { readdir, readFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import './engine.js';
const D = globalThis.Drill;
if (process.env.YQ) D.R.youQ = +process.env.YQ;
if (process.env.TIQ) D.R.tiedQ = +process.env.TIQ;
if (process.env.TQ) D.R.themQ = +process.env.TQ;
if (process.env.ENG) D.R.engClear = +process.env.ENG;
if (process.env.ENGT) D.R.engTurn = +process.env.ENGT;
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const dir = join(ROOT, '.cache', 'drill');
const games = [];
for (const f of await readdir(dir)) {
  const g = JSON.parse(await readFile(join(dir, f), 'utf8'));
  if (!g.none) games.push({ type: 2, ...g });
}
const real = { n: 0, tied: 0, won: 0, eng: 0, pulled: 0, pullT: 0, otWon: 0, ot: 0 };
for (const g of games) {
  real.n++;
  const reg = g.real.goals.filter((x) => x.per === 3);
  let you = g.start.you, opp = g.start.opp, tied = false;
  for (const x of reg) { if (x.mine) you++; else opp++; if (you === opp) tied = true; }
  if (tied || g.real.final.you >= g.real.final.opp) real.tied++;
  if (g.real.final.won) real.won++;
  if (g.real.goals.some((x) => !x.mine && x.empty)) real.eng++;
  if (g.real.pulledAt != null) { real.pulled++; real.pullT += g.real.pulledAt; }
}
const sim = { n: 0, tied: 0, won: 0, eng: 0, gf: 0, ga: 0 };
const K = +(process.env.K || 20);
for (const g of games) {
  const sc = { ...g, roster: g.roster ?? { you: [], opp: [] } };
  for (let k = 0; k < K; k++) {
    const r = D.mulberry(g.id * 31 + k);
    const s = D.newGame(sc);
    let tied = false, eng = false;
    let guard = 0;
    while (!s.over && s.per !== 'SO' && s.otNum < 3 && guard++ < 400) {
      const before = s.opp, wasPulled = s.pulled;
      D.resolve(s, D.coach(s, r), r);
      if (s.per === 'REG' && s.you === s.opp) tied = true;
      if (s.opp > before && wasPulled) eng = true;
      if (s.per !== 'REG') tied = true;
    }
    sim.n++; if (tied) sim.tied++; if (eng) sim.eng++;
    sim.won += s.per === 'SO' && !s.over ? s.soWin : s.otNum >= 3 && !s.over ? 0.5 : s.won ? 1 : 0;
  }
}
const pct = (a, n) => `${(100 * a / n).toFixed(1)}%`;
console.log(`real endings: ${real.n}`);
console.log(`                 real    model`);
console.log(`tied it up      ${pct(real.tied, real.n).padStart(6)}  ${pct(sim.tied, sim.n).padStart(6)}`);
console.log(`won the game    ${pct(real.won, real.n).padStart(6)}  ${pct(sim.won, sim.n).padStart(6)}`);
console.log(`gave up an ENG  ${pct(real.eng, real.n).padStart(6)}  ${pct(sim.eng, sim.n).padStart(6)}`);
console.log(`won once tied   ${pct(real.won, real.tied).padStart(6)}  ${pct(sim.won, sim.tied).padStart(6)}`);
console.log(`real coaches pulled in ${pct(real.pulled, real.n)} of games, average with ${D.fmt(real.pullT / real.pulled)} left`);
