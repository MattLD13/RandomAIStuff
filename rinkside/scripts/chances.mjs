// Build-time side of scoring chances / expected goals: download and cache league play-by-play,
// fit the xG model, and total up every team's season. The per-shot logic lives in
// site/chances-core.mjs so the browser can run exactly the same model on live games.
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { reduce, features, xg, side, officialStats } from '../site/chances-core.mjs';

export { xg, danger, isDump, report } from '../site/chances-core.mjs';

// Fetch (or read from cache) every listed game.
export async function loadGames(gameIds, get, cacheDir, { concurrency = 8 } = {}) {
  await mkdir(cacheDir, { recursive: true });
  const games = new Map();
  let fetched = 0, i = 0;
  async function worker() {
    while (i < gameIds.length) {
      const id = gameIds[i++];
      const file = join(cacheDir, `${id}.json`);
      try { games.set(id, JSON.parse(await readFile(file, 'utf8'))); continue; } catch {}
      try {
        const [pbp, rail] = await Promise.all([get(`https://api-web.nhle.com/v1/gamecenter/${id}/play-by-play`),
          get(`https://api-web.nhle.com/v1/gamecenter/${id}/right-rail`).catch(() => null)]);
        const g = reduce(pbp);
        delete g.misses;   // missed shots are for Box WAR (scripts/war.mjs) only
        officialStats(g.stats, g.home, g.away, rail?.teamGameStats);
        await writeFile(file, JSON.stringify(g));
        games.set(id, g); fetched++;
      } catch (err) { console.warn(`play-by-play ${id}: ${err.message}`); }
    }
  }
  await Promise.all(Array.from({ length: concurrency }, worker));
  return { games, fetched };
}

// ---------- xG model ----------
// Logistic regression by Newton's method (with a little ridge for stability).
export function fitModel(shots, { iterations = 25, ridge = 1 } = {}) {
  const X = shots.map(features), y = shots.map((s) => s.goal), k = X[0].length;
  let w = new Array(k).fill(0);
  w[0] = Math.log((y.reduce((a, b) => a + b, 0) + 1) / (y.length - y.reduce((a, b) => a + b, 0) + 1));
  for (let it = 0; it < iterations; it++) {
    const g = new Array(k).fill(0), Hm = Array.from({ length: k }, () => new Array(k).fill(0));
    for (let n = 0; n < X.length; n++) {
      const z = X[n].reduce((a, v, j) => a + v * w[j], 0), p = 1 / (1 + Math.exp(-z)), r = p * (1 - p);
      for (let a = 0; a < k; a++) {
        g[a] += (y[n] - p) * X[n][a];
        for (let b = a; b < k; b++) Hm[a][b] += r * X[n][a] * X[n][b];
      }
    }
    for (let a = 0; a < k; a++) { for (let b = 0; b < a; b++) Hm[a][b] = Hm[b][a]; if (a) { Hm[a][a] += ridge; g[a] -= ridge * w[a]; } }
    const step = solve(Hm, g);
    w = w.map((v, j) => v + step[j]);
    if (Math.max(...step.map(Math.abs)) < 1e-7) break;
  }
  return w;
}
function solve(A, b) {   // Gaussian elimination with partial pivoting
  const n = b.length, M = A.map((r, i) => [...r, b[i]]);
  for (let c = 0; c < n; c++) {
    let p = c; for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    [M[c], M[p]] = [M[p], M[c]];
    const d = M[c][c] || 1e-12;
    for (let r = c + 1; r < n; r++) { const f = M[r][c] / d; for (let j = c; j <= n; j++) M[r][j] -= f * M[c][j]; }
  }
  const x = new Array(n).fill(0);
  for (let r = n - 1; r >= 0; r--) { let s = M[r][n]; for (let j = r + 1; j < n; j++) s -= M[r][j] * x[j]; x[r] = s / (M[r][r] || 1e-12); }
  return x;
}
// Season totals for every team (for league ranks).
export function seasonTotals(games, w) {
  const t = {};
  const add = (id, k, v) => { t[id] ??= { xgf: 0, xga: 0, gf: 0, hcf: 0, hca: 0 }; t[id][k] += v; };
  for (const g of games.values()) for (const [a, b] of [[g.home, g.away], [g.away, g.home]]) {
    const s = side(g, a, w);
    add(a, 'xgf', s.xg); add(b, 'xga', s.xg); add(a, 'gf', s.hi.g + s.mid.g + s.low.g); add(a, 'hcf', s.hi.n); add(b, 'hca', s.hi.n);
  }
  return t;
}
