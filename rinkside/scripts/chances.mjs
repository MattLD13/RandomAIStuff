// Scoring chances and expected goals (xG) from NHL play-by-play.
//
// - Every finished game's play-by-play is reduced to its shots and cached on disk (.cache/shots/),
//   so a build only downloads games it hasn't seen before.
// - An xG model (logistic regression) is fitted on every shot on goal in the league this season.
//   Inputs: distance, angle, shot type, rebound, rush, and power-play / shorthanded situation.
// - A scoring chance is a shot on goal (or goal) from the offensive zone, with the goalie in net.
//   Danger zones (feet from the goal line, feet either side of centre):
//     high: up to 20 ft out (or just behind the line), within 19 ft of centre
//     mid:  up to 30 ft out, within 30 ft of centre
//     low:  anywhere else in the offensive zone
//   Shots on goal from outside the zone, or more than 58 ft from the goal line, count as "dumps".
//   These boundaries were calibrated against a published scoring-chances report for NYR @ SEA
//   on 2026-11-07 (24 chances, 8 high-danger and 2 dumps for NYR, matched exactly).
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const SHOT_TYPES = ['wrist', 'snap', 'slap', 'backhand', 'tip-in', 'deflected', 'wrap-around'];
const secs = (t) => { const [m, s] = String(t || '0:0').split(':').map(Number); return m * 60 + s; };

// Reduce one game's play-by-play to the events we need.
function reduce(pbp) {
  const home = pbp.homeTeam.id, away = pbp.awayTeam.id;
  const out = { id: pbp.id, home, away, shots: [], blocked: { [home]: 0, [away]: 0 } };
  let prev = null;
  const plays = [...pbp.plays].sort((a, b) => a.sortOrder - b.sortOrder);
  for (const p of plays) {
    const pd = p.periodDescriptor || {};
    if (pd.periodType === 'SO') continue;
    const d = p.details || {}, type = p.typeDescKey;
    const t = (pd.number - 1) * 1200 + secs(p.timeInPeriod);
    if (type === 'blocked-shot') {
      // the API files a blocked shot under the blocking team; the shooter is the other team
      const shooter = d.eventOwnerTeamId === home ? away : home;
      out.blocked[shooter] = (out.blocked[shooter] || 0) + 1;
    }
    if (type === 'shot-on-goal' || type === 'goal') {
      const team = d.eventOwnerTeamId, isHome = team === home;
      const sc = String(p.situationCode || '1551').padStart(4, '0');
      const [awayG, awayS, homeS, homeG] = sc.split('').map(Number);
      const own = isHome ? homeS : awayS, opp = isHome ? awayS : homeS, oppGoalie = isHome ? awayG : homeG;
      const x = d.xCoord ?? 0, y = d.yCoord ?? 0;
      out.shots.push({
        team, goal: type === 'goal' ? 1 : 0, zone: d.zoneCode || '',
        fx: 89 - Math.abs(x), ay: Math.abs(y), type: d.shotType || 'other',
        en: oppGoalie === 0 || (type === 'goal' && !d.goalieInNetId) ? 1 : 0,
        pp: own > opp ? 1 : 0, sh: own < opp ? 1 : 0,
        rebound: prev && prev.shot && prev.team === team && t - prev.t <= 3 ? 1 : 0,
        rush: prev && t - prev.t <= 4 && (Math.abs(prev.x) < 25 || Math.sign(prev.x) !== Math.sign(x)) ? 1 : 0,
      });
    }
    if (d.xCoord != null) prev = { t, team: d.eventOwnerTeamId, x: d.xCoord, shot: ['shot-on-goal', 'missed-shot', 'blocked-shot'].includes(type) };
    if (type === 'goal') prev = null;   // no rebounds or rushes carry across a goal
  }
  return out;
}

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
        const g = reduce(await get(`https://api-web.nhle.com/v1/gamecenter/${id}/play-by-play`));
        await writeFile(file, JSON.stringify(g));
        games.set(id, g); fetched++;
      } catch (err) { console.warn(`play-by-play ${id}: ${err.message}`); }
    }
  }
  await Promise.all(Array.from({ length: concurrency }, worker));
  return { games, fetched };
}

// ---------- xG model ----------
const dist = (s) => Math.hypot(s.fx, s.ay);
const angle = (s) => (Math.atan2(s.ay, Math.max(s.fx, 0.5)) * 180) / Math.PI;
function features(s) {
  const dd = dist(s) / 10, ang = angle(s) / 45;
  return [1, dd, dd * dd, ang, s.rebound, s.rush, s.pp, s.sh, ...SHOT_TYPES.slice(1).map((k) => (s.type === k ? 1 : 0)),
    SHOT_TYPES.includes(s.type) ? 0 : 1];
}

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
export const xg = (w, s) => 1 / (1 + Math.exp(-features(s).reduce((a, v, j) => a + v * w[j], 0)));

export function danger(s) {
  if (s.fx >= -3 && s.fx <= 20 && s.ay <= 19) return 'hi';
  if (s.fx <= 30 && s.ay <= 30) return 'mid';
  return 'low';
}

// One team's side of a game's report.
function side(g, team, w) {
  const b = { hi: { n: 0, xg: 0, g: 0 }, mid: { n: 0, xg: 0, g: 0 }, low: { n: 0, xg: 0, g: 0 } };
  let goals = 0, en = 0, dumps = 0;
  for (const s of g.shots) {
    if (s.team !== team) continue;
    goals += s.goal;
    if (s.en) { en += s.goal; continue; }
    if (s.zone !== 'O' || s.fx > 58) { dumps++; continue; }   // long shots from the blue line or beyond
    const k = danger(s), v = xg(w, s);
    b[k].n++; b[k].xg += v; b[k].g += s.goal;
  }
  const r2 = (v) => Math.round(v * 100) / 100;
  for (const k of Object.keys(b)) b[k].xg = r2(b[k].xg);
  return { chances: b.hi.n + b.mid.n + b.low.n, hi: b.hi, mid: b.mid, low: b.low, xg: r2(b.hi.xg + b.mid.xg + b.low.xg), goals, en, dumps, blocked: g.blocked[team] || 0 };
}
export function report(g, teamId, w) {
  const opp = g.home === teamId ? g.away : g.home;
  return { us: side(g, teamId, w), them: side(g, opp, w) };
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
