// Player cards: league-wide percentiles and Rinkside's combined ratings.
//
// Sources: the NHL stats API (every skater's season reports) and Rinkside's own xG model
// (individual expected goals per shooter, goals saved above expected per goalie).
// Percentiles compare forwards with forwards and defensemen with defensemen (minimum games
// played), so a 90% EV Offense means better than 90% of qualified NHL players at that position.
import { xg as xgOf, danger, isDump } from './chances.mjs';

const STATS = 'https://api.nhle.com/stats/rest/en';
const REPORTS = ['summary', 'timeonice', 'percentages', 'penalties', 'realtime', 'powerplay', 'penaltykill', 'scoringRates', 'goalsForAgainst', 'faceoffpercentages', 'summaryshooting'];

// Every report for every skater in one season, merged by player id.
export async function loadSkaters(get, season) {
  const out = {};
  await Promise.all(REPORTS.map(async (r) => {
    const q = encodeURIComponent(`seasonId=${season} and gameTypeId=2`);
    const d = await get(`${STATS}/skater/${r}?limit=-1&cayenneExp=${q}`).catch(() => ({ data: [] }));
    for (const row of d.data || []) Object.assign((out[row.playerId] ??= {}), row);
  }));
  return out;
}
export async function loadGoalies(get, season) {
  const q = encodeURIComponent(`seasonId=${season} and gameTypeId=2`);
  const d = await get(`${STATS}/goalie/summary?limit=-1&cayenneExp=${q}`).catch(() => ({ data: [] }));
  return Object.fromEntries((d.data || []).map((g) => [g.playerId, g]));
}

// Individual xG for shooters and xG faced for goalies, from cached play-by-play.
export function shotTotals(games, w) {
  const shooters = {}, goalies = {};
  for (const g of games.values()) for (const s of g.shots) {
    if (s.en) continue;
    const v = xgOf(w, s), hd = danger(s) === 'hi' && !isDump(s);
    if (s.shooter) { const t = (shooters[s.shooter] ??= { shots: 0, goals: 0, ixg: 0, hd: 0 }); t.shots++; t.goals += s.goal; t.ixg += v; t.hd += hd ? 1 : 0; }
    if (s.goalie) { const t = (goalies[s.goalie] ??= { sa: 0, ga: 0, xga: 0, hdSa: 0, hdGa: 0 }); t.sa++; t.ga += s.goal; t.xga += v; if (hd) { t.hdSa++; t.hdGa += s.goal; } }
  }
  return { shooters, goalies };
}

const per60 = (v, minutes) => (minutes > 0 ? (v / minutes) * 60 : null);
const isD = (pos) => pos === 'D';

// The raw component values for one skater (null when there isn't enough of a sample).
function components(p, shot) {
  const toi = (p.timeOnIce || 0) / 60, ev = (p.evTimeOnIce || 0) / 60, pp = (p.ppTimeOnIce || 0) / 60, sh = (p.shTimeOnIce || 0) / 60;
  const t5 = ((p.timeOnIcePerGame5v5 || 0) * (p.gamesPlayed || 0)) / 60;
  const has = (x) => x != null && Number.isFinite(x);
  const c = {
    evOffA: p.pointsPer605v5, evOffB: per60(p.evenStrengthGoalsFor, ev),
    evDefA: has(per60(p.evenStrengthGoalsAgainst, ev)) ? -per60(p.evenStrengthGoalsAgainst, ev) : null,
    evDefB: t5 > 0 && has(p.satAgainst) ? -per60(p.satAgainst, t5) : null,
    possession: p.satRelative ?? null,
    pp: pp >= 15 ? p.ppPointsPer60 ?? null : null,
    pk: sh >= 15 && has(p.ppGoalsAgainstPer60) ? -p.ppGoalsAgainstPer60 : null,
    goals: per60(p.goals, toi),
    primary: p.primaryAssistsPer605v5 ?? null,
    penalties: p.netPenaltiesPer60 ?? null,
    physical: has(p.hitsPer60) ? p.hitsPer60 + (p.blockedShotsPer60 || 0) : null,
    faceoffs: (p.totalFaceoffs || 0) >= 50 ? p.faceoffWinPct : null,
    finishing: shot && shot.shots >= 10 ? per60(shot.goals - shot.ixg, toi) : null,
    quality: shot && shot.shots >= 10 ? shot.ixg / shot.shots : null,
  };
  return { c, toi, gp: p.gamesPlayed || 0 };
}

// percentile of each value within its group (ties share the midpoint)
function percentiles(values) {
  const v = values.filter((x) => x != null).sort((a, b) => a - b), n = v.length;
  return (x) => {
    if (x == null || !n) return null;
    let lo = 0, hi = n;
    while (lo < hi) { const m = (lo + hi) >> 1; if (v[m] < x) lo = m + 1; else hi = m; }
    let eq = lo; while (eq < n && v[eq] === x) eq++;
    return Math.round(((lo + (eq - lo) / 2) / n) * 100);
  };
}

const WEIGHTS = { evOff: 0.28, evDef: 0.17, pp: 0.1, pk: 0.05, finishing: 0.1, goals: 0.1, primary: 0.1, penalties: 0.05, possession: 0.05 };

// Percentile cards for every qualified skater in a season.
export function rateSkaters(skaters, shots = {}) {
  const maxGp = Math.max(1, ...Object.values(skaters).map((p) => p.gamesPlayed || 0));
  const minGp = Math.max(3, Math.floor(maxGp * 0.25));
  const rows = Object.values(skaters).filter((p) => (p.gamesPlayed || 0) >= minGp && (p.timeOnIce || 0) >= 3600).map((p) => ({ p, ...components(p, shots[p.playerId]) }));
  const out = {};
  for (const group of ['F', 'D']) {
    const g = rows.filter((r) => (group === 'D') === isD(r.p.positionCode));
    const keys = Object.keys(g[0]?.c || {});
    const pct = Object.fromEntries(keys.map((k) => [k, percentiles(g.map((r) => r.c[k]))]));
    const scored = g.map((r) => {
      const q = Object.fromEntries(keys.map((k) => [k, pct[k](r.c[k])]));
      const avg = (a, b) => (a == null ? b : b == null ? a : Math.round((a + b) / 2));
      const comp = { evOff: avg(q.evOffA, q.evOffB), evDef: avg(q.evDefA, q.evDefB), possession: q.possession, pp: q.pp, pk: q.pk,
        finishing: q.finishing, goals: q.goals, primary: q.primary, penalties: q.penalties, physical: q.physical, faceoffs: q.faceoffs, quality: q.quality };
      let num = 0, den = 0;
      for (const [k, wgt] of Object.entries(WEIGHTS)) if (comp[k] != null) { num += comp[k] * wgt; den += wgt; }
      return { r, comp, score: den ? num / den : null };
    });
    const overallPct = percentiles(scored.map((x) => x.score));
    for (const x of scored) out[x.r.p.playerId] = { group, overall: overallPct(x.score), ...x.comp, gp: x.r.gp, toi: x.r.toi, raw: x.r.c };
  }
  return out;
}

// Goalie cards: goals saved above expected, save %, high-danger save %, workload.
export function rateGoalies(goalies, faced, teamGames = 82) {
  const rows = Object.values(goalies).filter((g) => (g.gamesPlayed || 0) >= 3).map((g) => {
    const f = faced[g.playerId] || { sa: 0, ga: 0, xga: 0, hdSa: 0, hdGa: 0 }, min = (g.timeOnIce || 0) / 60;
    return { g, f, gsax: f.xga - f.ga, gsax60: per60(f.xga - f.ga, min), sv: g.savePct, hdSv: f.hdSa ? 1 - f.hdGa / f.hdSa : null, load: (g.gamesStarted || 0) / teamGames };
  });
  const pct = { gsax60: percentiles(rows.map((r) => r.gsax60)), sv: percentiles(rows.map((r) => r.sv)), hdSv: percentiles(rows.map((r) => r.hdSv)), load: percentiles(rows.map((r) => r.load)) };
  const scores = rows.map((r) => 0.5 * (pct.gsax60(r.gsax60) ?? 50) + 0.25 * (pct.sv(r.sv) ?? 50) + 0.25 * (pct.hdSv(r.hdSv) ?? 50));
  const overall = percentiles(scores);
  return Object.fromEntries(rows.map((r, i) => [r.g.playerId, {
    group: 'G', overall: overall(scores[i]), gsax: +r.gsax.toFixed(1), gsax60: pct.gsax60(r.gsax60), sv: pct.sv(r.sv), hdSv: pct.hdSv(r.hdSv), load: pct.load(r.load),
    raw: { gsax: +r.gsax.toFixed(1), xga: +r.f.xga.toFixed(1), ga: r.f.ga, hdSv: r.hdSv != null ? +r.hdSv.toFixed(3) : null, sv: r.sv },
  }]));
}
