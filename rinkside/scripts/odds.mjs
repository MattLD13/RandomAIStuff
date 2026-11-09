// Team strength, game win probabilities and playoff odds.
//
// Strength blends three things for every team, each standardised across the league:
//   50% expected-goals share (Rinkside's xG model), 30% points %, 20% goal differential per game.
// Win probability for a game is a logistic curve of (home strength - away strength), fitted on
// this season's finished games (wins include OT/SO), so home ice is learned from the data.
// Early in a season a team's numbers are noisy, so predictions use strength shrunk toward
// average by games played: weight = GP / (GP + 25) (about 40% after 18 games, 77% by the end).
// Playoff odds play out the rest of the season 10,000 times with those probabilities; about 23%
// of games reach overtime, where the loser still takes a point. Playoff spots use the NHL format
// (top three in each division plus two wild cards per conference). Each simulated season then plays
// the bracket: in each division, the division winner meets a wild card (the better division winner
// gets the second wild card) and 2nd meets 3rd; then the division final, conference final and Cup
// Final. Series are best of seven with home ice (2-2-1-1-1) to the team with more points.

const z = (vals) => {
  const m = vals.reduce((a, b) => a + b, 0) / vals.length;
  const sd = Math.sqrt(vals.reduce((a, b) => a + (b - m) ** 2, 0) / vals.length) || 1;
  return (v) => (v - m) / sd;
};
const sigmoid = (x) => 1 / (1 + Math.exp(-x));

export const shrink = (s, standings, k = 25) =>
  Object.fromEntries(standings.map((t) => [t.teamAbbrev.default, s[t.teamAbbrev.default] * (t.gamesPlayed / (t.gamesPlayed + k))]));

export function strengths(standings, xgPctByAbbrev) {
  const rows = standings.map((t) => ({ a: t.teamAbbrev.default, xg: xgPctByAbbrev[t.teamAbbrev.default] ?? 50, pct: t.pointPctg, gd: t.gamesPlayed ? t.goalDifferential / t.gamesPlayed : 0 }));
  const zx = z(rows.map((r) => r.xg)), zp = z(rows.map((r) => r.pct)), zg = z(rows.map((r) => r.gd));
  return Object.fromEntries(rows.map((r) => [r.a, 0.5 * zx(r.xg) + 0.3 * zp(r.pct) + 0.2 * zg(r.gd)]));
}

// Fit P(home win) = sigmoid(a + b * (s_home - s_away)) by Newton's method.
export function fitWinModel(finals, s, predictWith = s) {
  let a = 0, b = 0.5;
  const rows = finals.filter((g) => s[g.homeTeam.abbrev] != null && s[g.awayTeam.abbrev] != null)
    .map((g) => [s[g.homeTeam.abbrev] - s[g.awayTeam.abbrev], g.homeTeam.score > g.awayTeam.score ? 1 : 0]);
  for (let it = 0; it < 30; it++) {
    let ga = 0, gb = 0, haa = 0, hab = 0, hbb = 0;
    for (const [x, y] of rows) { const p = sigmoid(a + b * x), w = p * (1 - p); ga += y - p; gb += (y - p) * x; haa += w; hab += w * x; hbb += w * x * x; }
    hbb += 1e-3; haa += 1e-3;
    const det = haa * hbb - hab * hab; if (!det) break;
    const da = (hbb * ga - hab * gb) / det, db = (haa * gb - hab * ga) / det;
    a += da; b += db;
    if (Math.abs(da) + Math.abs(db) < 1e-9) break;
  }
  return { a, b, n: rows.length, prob: (home, away) => sigmoid(a + b * ((predictWith[home] ?? 0) - (predictWith[away] ?? 0))) };
}

// Simulate the rest of the season.
export function simulate(standings, remaining, model, { sims = 10000, otRate = 0.23, seed = 7 } = {}) {
  let r = seed >>> 0;
  const rand = () => ((r = (r * 1664525 + 1013904223) >>> 0) / 4294967296);   // deterministic, so odds don't jitter between builds
  const teams = standings.map((t) => t.teamAbbrev.default), idx = Object.fromEntries(teams.map((a, i) => [a, i]));
  const conf = standings.map((t) => t.conferenceAbbrev), div = standings.map((t) => t.divisionName);
  const base = standings.map((t) => t.points);
  const games = remaining.filter((g) => idx[g.homeTeam.abbrev] != null && idx[g.awayTeam.abbrev] != null)
    .map((g) => [idx[g.homeTeam.abbrev], idx[g.awayTeam.abbrev], model.prob(g.homeTeam.abbrev, g.awayTeam.abbrev)]);
  const made = new Array(teams.length).fill(0), divWin = new Array(teams.length).fill(0), ptsSum = new Array(teams.length).fill(0);
  const r2 = new Array(teams.length).fill(0), r3 = new Array(teams.length).fill(0), fin = new Array(teams.length).fill(0), cup = new Array(teams.length).fill(0);
  const pGame = (h, a) => model.prob(teams[h], teams[a]);
  // best of seven; `hi` has home ice in games 1, 2, 5 and 7
  const series = (hi, lo) => {
    let w1 = 0, w2 = 0;
    for (let g = 0; w1 < 4 && w2 < 4; g++) {
      const hiHome = g === 0 || g === 1 || g === 4 || g === 6;
      const p = hiHome ? pGame(hi, lo) : 1 - pGame(lo, hi);
      if (rand() < p) w1++; else w2++;
    }
    return w1 === 4 ? hi : lo;
  };
  const confs = [...new Set(conf)], divs = [...new Set(div)];
  for (let s = 0; s < sims; s++) {
    const pts = base.slice(), tie = teams.map(() => rand());
    for (const [h, a, p] of games) {
      const homeWins = rand() < p, ot = rand() < otRate;
      if (homeWins) { pts[h] += 2; if (ot) pts[a] += 1; } else { pts[a] += 2; if (ot) pts[h] += 1; }
    }
    const order = (list) => list.sort((x, y) => pts[y] - pts[x] || tie[y] - tie[x]);
    const better = (a, b) => (pts[a] > pts[b] || (pts[a] === pts[b] && tie[a] > tie[b]) ? [a, b] : [b, a]);
    const play = (a, b) => series(...better(a, b));
    const champs = [];
    for (const c of confs) {
      const top = [], byDiv = [];
      for (const d of divs) {
        const ds = order(teams.map((_, i) => i).filter((i) => conf[i] === c && div[i] === d));
        if (!ds.length) continue;
        divWin[ds[0]]++; top.push(...ds.slice(0, 3)); byDiv.push(ds.slice(0, 3));
      }
      const rest = order(teams.map((_, i) => i).filter((i) => conf[i] === c && !top.includes(i)));
      const wc = rest.slice(0, 2);
      for (const i of [...top, ...wc]) made[i]++;
      if (byDiv.length !== 2 || wc.length < 2) continue;
      // the better division winner meets the second wild card
      const [bestDiv] = better(byDiv[0][0], byDiv[1][0]);
      const sides = byDiv.map((d3) => {
        const wcOpp = d3[0] === bestDiv ? wc[1] : wc[0];
        const a = play(d3[0], wcOpp), b = play(d3[1], d3[2]);
        r2[a]++; r2[b]++;
        const w = play(a, b); r3[w]++;
        return w;
      });
      const cc = play(sides[0], sides[1]); fin[cc]++; champs.push(cc);
    }
    if (champs.length === 2) cup[play(champs[0], champs[1])]++;
    for (let i = 0; i < teams.length; i++) ptsSum[i] += pts[i];
  }
  return Object.fromEntries(teams.map((a, i) => [a, {
    playoff: +((100 * made[i]) / sims).toFixed(1), division: +((100 * divWin[i]) / sims).toFixed(1), projPts: Math.round(ptsSum[i] / sims),
    round2: +((100 * r2[i]) / sims).toFixed(1), round3: +((100 * r3[i]) / sims).toFixed(1), final: +((100 * fin[i]) / sims).toFixed(1), cup: +((100 * cup[i]) / sims).toFixed(1),
  }]));
}
