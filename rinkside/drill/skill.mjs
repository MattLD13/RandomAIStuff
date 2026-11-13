// How much reading the play is worth: play real endings with a bench that grades every call
// (Monte Carlo, like the page does) and always takes the best one, next to the typical bench.
//   node drill/skill.mjs [games] [rollouts]
import { readdir, readFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import './engine.js';
const D = globalThis.Drill;
if (process.env.YQ) D.R.youQ = +process.env.YQ;
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const dir = join(ROOT, '.cache', 'drill-v2');
const files = (await readdir(dir)).sort();
const games = [];
for (const f of files) { const g = JSON.parse(await readFile(join(dir, f), 'utf8')); if (!g.none) games.push({ type: 2, ...g }); }
const M = +(process.argv[2] || 120), N = +(process.argv[3] || 200);
const pick = games.filter((_, i) => i % Math.floor(games.length / M) === 0).slice(0, M);
const run = (sc, smart, k) => {
  const r = D.mulberry(sc.id * 97 + k);
  const s = D.newGame({ ...sc, roster: sc.roster ?? { you: [], opp: [] } });
  let tied = false, calls = 0;
  while (!s.over && s.per !== 'SO' && s.otNum < 3 && calls < 120) {
    const c = smart ? D.grade(s, D.coach(s, r), N, calls + 1).best : D.coach(s, r);
    D.resolve(s, c, r); calls++;
    if (s.you >= s.opp) tied = true;
  }
  const won = s.over ? (s.won ? 1 : 0) : s.per === 'SO' ? s.soWin : 0.5;
  return { tied, won };
};
for (const smart of [false, true]) {
  let t = 0, w = 0, n = 0;
  for (const sc of pick) for (let k = 0; k < (smart ? 2 : 20); k++) { const o = run(sc, smart, k); t += o.tied; w += o.won; n++; }
  console.log(`${smart ? 'reads every play' : 'typical bench   '}: tied it ${(100 * t / n).toFixed(1)}%, won ${(100 * w / n).toFixed(1)}%  (${n} games)`);
}
