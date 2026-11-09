// Box WAR, one game at a time: shared by the build (scripts/war.mjs) and the browser (live games).
// Pure functions only: no Node or DOM APIs. See scripts/war.mjs for how the pieces are valued.
import { reduce, xg } from './chances-core.mjs';

const secs = (t) => { const [m, s] = String(t || '0:0').split(':').map(Number); return m * 60 + s; };
export const ST = ['ev', 'pp', 'sh'];
export const VALUE = { shooter: 0.35, a1: 0.15, a2: 0.05, minor: 0.17, faceoff: 0.008, takeaway: 0.015, giveaway: -0.01, block: 0.012 };

// ---------- shift charts ----------
export function apiShifts(rows) {
  return rows.filter((r) => r.typeCode === 517 && r.startTime && r.endTime)
    .map((r) => ({ id: r.playerId, p: r.period, s: secs(r.startTime), e: secs(r.endTime) }));
}
// NHL HTML time-on-ice report (TH = home, TV = visitor): one table of shifts per player
export function parseToiReport(html, teamId, roster) {
  const byNumber = Object.fromEntries(roster.filter((r) => r.teamId === teamId).map((r) => [r.sweaterNumber, r.playerId]));
  const out = [];
  for (const part of html.split('class="playerHeading').slice(1)) {
    const head = part.slice(part.indexOf('>') + 1, part.indexOf('</td>')).trim();
    const id = byNumber[parseInt(head, 10)];
    if (!id) continue;
    for (const m of part.matchAll(/<tr class="\s*(?:oddColor|evenColor)">([\s\S]*?)<\/tr>/g)) {
      const cells = [...m[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((c) => c[1].replace(/&nbsp;/g, ' ').trim());
      if (cells.length < 5 || !cells[2].includes('/') || !cells[3].includes('/')) continue;   // skip the per-period summary rows
      const p = cells[1] === 'OT' ? 4 : parseInt(cells[1], 10);
      if (!p) continue;
      out.push({ id, p, s: secs(cells[2].split('/')[0].trim()), e: secs(cells[3].split('/')[0].trim()) });
    }
  }
  return out;
}

// ---------- one game: who was on the ice for what ----------
export function digest(pbp, shifts) {
  const home = pbp.homeTeam.id, away = pbp.awayTeam.id;
  const players = {};
  for (const r of pbp.rosterSpots || []) {
    players[r.playerId] = { t: r.teamId, pos: r.positionCode, n: `${r.firstName.default[0]}. ${r.lastName.default}` };
  }
  // on-ice players for every second of the game
  const T = Math.max(3600, ...shifts.map((x) => (x.p - 1) * 1200 + x.e));
  const on = Array.from({ length: T }, () => []);
  for (const x of shifts) {
    if (!players[x.id] || x.e <= x.s) continue;
    const a = (x.p - 1) * 1200 + x.s, b = Math.min(T, (x.p - 1) * 1200 + x.e);
    for (let t = a; t < b; t++) if (!on[t].includes(x.id)) on[t].push(x.id);
  }
  const strength = (t) => {
    const c = { [home]: { s: 0, g: 0 }, [away]: { s: 0, g: 0 } };
    for (const id of on[t]) { const p = players[id]; if (c[p.t]) c[p.t][p.pos === 'G' ? 'g' : 's']++; }
    const st = (me, op) => (!c[me].g || !c[op].g ? 'x' : c[me].s > c[op].s ? 'pp' : c[me].s < c[op].s ? 'sh' : 'ev');
    return { [home]: st(home, away), [away]: st(away, home) };
  };
  const toi = {};
  for (let t = 0; t < T; t++) {
    if (!on[t].length) continue;
    const s = strength(t);
    for (const id of on[t]) {
      const p = players[id];
      toi[id] ??= { ev: 0, pp: 0, sh: 0, x: 0 };
      toi[id][p.pos === 'G' ? 'x' : s[p.t]]++;
    }
  }
  const box = {};
  const bump = (id, k, v = 1) => { if (!id || !players[id]) return; box[id] ??= {}; box[id][k] = (box[id][k] || 0) + v; };
  // shots on goal in the same order as reduce() lists them
  const red = reduce(pbp), plays = [...pbp.plays].sort((a, b) => a.sortOrder - b.sortOrder);
  const shots = [];
  let k = 0;
  for (const p of plays) {
    const pd = p.periodDescriptor || {};
    if (pd.periodType === 'SO') continue;
    const d = p.details || {}, type = p.typeDescKey, t = (pd.number - 1) * 1200 + secs(p.timeInPeriod);
    if (type === 'shot-on-goal' || type === 'goal') {
      const s = red.shots[k++], at = on[Math.min(T - 1, Math.max(0, t - 1))] || [];
      const skaters = (team) => at.filter((id) => players[id]?.t === team && players[id].pos !== 'G');
      shots.push({ ...s, a1: d.assist1PlayerId || 0, a2: d.assist2PlayerId || 0, of: skaters(s.team), df: skaters(s.team === home ? away : home) });
    } else if (type === 'penalty') {
      const minors = d.typeCode === 'MIN' || d.typeCode === 'BEN' ? (d.duration || 2) / 2 : d.typeCode === 'MAJ' || d.typeCode === 'MAT' ? 2.5 : 0;
      if (minors) { bump(d.committedByPlayerId, 'pt', minors); bump(d.drawnByPlayerId, 'pd', minors); }
    } else if (type === 'faceoff') { bump(d.winningPlayerId, 'fw'); bump(d.losingPlayerId, 'fl'); }
    else if (type === 'takeaway') bump(d.playerId, 'tk');
    else if (type === 'giveaway') bump(d.playerId, 'gv');
    else if (type === 'blocked-shot' && d.reason !== 'teammate-blocked') bump(d.blockingPlayerId, 'bk');
    else if (type === 'hit') bump(d.hittingPlayerId, 'ht');
  }
  return { id: pbp.id, home, away, players, toi, box, shots };
}

// ---------- raw (not yet replacement-adjusted) value of one game ----------
export function rawGame(g, w) {
  const P = {};
  const get = (id) => {
    if (!P[id]) {
      const p = g.players[id] || {};
      P[id] = { id: +id, t: p.t, pos: p.pos, n: p.n, toi: g.toi[id] || { ev: 0, pp: 0, sh: 0, x: 0 },
        gc: { ev: 0, pp: 0, sh: 0 }, oio: { ev: 0, pp: 0, sh: 0 }, oid: { ev: 0, pp: 0, sh: 0 }, pen: 0, oth: 0, shots: 0, gsax: 0,
        // the player's own game line: goals, assists, shots, individual xG, on-ice goals and xG for / against
        x: { g: 0, a: 0, sog: 0, ixg: 0, gf: 0, ga: 0, xgf: 0, xga: 0, gaG: 0, xgaG: 0 } };
    }
    return P[id];
  };
  const has = (id) => id && g.players[id];
  for (const id of Object.keys(g.toi)) get(id);
  for (const s of g.shots) {
    if (has(s.shooter)) { const p = get(s.shooter).x; p.sog++; p.g += s.goal; }
    if (s.goal) {
      for (const a of [s.a1, s.a2]) if (has(a)) get(a).x.a++;
      for (const id of s.of) get(id).x.gf++;
      for (const id of s.df) get(id).x.ga++;
    }
    if (s.en) continue;
    const x = xg(w, s), v = 0.5 * x + 0.5 * s.goal;
    if (has(s.shooter)) get(s.shooter).x.ixg += x;
    for (const id of s.of) get(id).x.xgf += x;
    for (const id of s.df) get(id).x.xga += x;
    if (has(s.goalie)) { const k = get(s.goalie).x; k.gaG += s.goal; k.xgaG += x; }
    const st = s.pp ? 'pp' : s.sh ? 'sh' : 'ev', dst = s.pp ? 'sh' : s.sh ? 'pp' : 'ev';
    let pool = v;
    const give = (id, share) => { if (id && g.players[id]) { get(id).gc[st] += share * v; pool -= share * v; } };
    give(s.shooter, VALUE.shooter);
    if (s.goal) { give(s.a1, VALUE.a1); give(s.a2, VALUE.a2); }
    if (s.of.length) for (const id of s.of) get(id).oio[st] += pool / s.of.length;
    if (s.df.length) for (const id of s.df) get(id).oid[dst] -= x / s.df.length;
    if (s.goalie && g.players[s.goalie]) { const gk = get(s.goalie); gk.shots++; gk.gsax += x - s.goal; }
  }
  for (const [id, b] of Object.entries(g.box)) {
    const p = get(id);
    p.pen += VALUE.minor * ((b.pd || 0) - (b.pt || 0));
    p.oth += VALUE.faceoff * ((b.fw || 0) - (b.fl || 0)) + VALUE.takeaway * (b.tk || 0) + VALUE.giveaway * (b.gv || 0) + VALUE.block * (b.bk || 0);
  }
  return Object.values(P);
}

export const r2 = (v) => Math.round(v * 100) / 100;
export const pctOf = (sorted, v) => {   // share of values below v (ties count half)
  let lo = 0, hi = sorted.length;
  while (lo < hi) { const m = (lo + hi) >> 1; if (sorted[m] < v) lo = m + 1; else hi = m; }
  let eq = lo; while (eq < sorted.length && sorted[eq] === v) eq++;
  return Math.round((100 * (lo + (eq - lo) / 2)) / Math.max(sorted.length, 1));
};


// ---------- replacement-adjusted pieces (R comes from the season: scripts/war.mjs) ----------
export const allToi = (t) => t.ev + t.pp + t.sh + t.x;
export function parts(p, R) {
  const r = R[p.pos === 'D' ? 'D' : 'F'];
  const ev = (c) => p[c].ev - r[c].ev * p.toi.ev + p[c].sh - r[c].sh * p.toi.sh;
  const gc = ev('gc'), oio = ev('oio'), oid = ev('oid');
  const pp = ['gc', 'oio', 'oid'].reduce((a, c) => a + p[c].pp - r[c].pp * p.toi.pp, 0);
  const pen = p.pen - r.pen * allToi(p.toi), oth = p.oth - r.oth * allToi(p.toi);
  return { gc, oio, oid, pp, pen, oth, gar: gc + oio + oid + pp + pen + oth };
}
export const goalieGar = (p, R) => p.gsax - R.G * p.shots;
// every skater's and goalie's line for one game; without shift data (anyTime) skaters with
// no ice time are kept so the individual pieces still show
export function gameRows(g, raw, R, { anyTime = false } = {}) {
  const rows = [], goalies = [];
  for (const p of raw) {
    if (p.pos === 'G') { if (p.shots) goalies.push({ id: p.id, t: p.t, n: p.n, toi: allToi(p.toi), shots: p.shots, gsax: p.gsax, gar: goalieGar(p, R), ga: p.x.gaG, xga: p.x.xgaG }); continue; }
    if (!allToi(p.toi) && !anyTime) continue;
    if (!p.t || p.pos == null) continue;
    const b = g.box[p.id] || {};
    rows.push({ id: p.id, t: p.t, n: p.n, pos: p.pos, toi: allToi(p.toi), ...parts(p, R),
      line: { ...p.x, ht: b.ht || 0, bk: b.bk || 0, fw: b.fw || 0, fl: b.fl || 0, tk: b.tk || 0, gv: b.gv || 0, pt: b.pt || 0, pd: b.pd || 0, ev: p.toi.ev, pp: p.toi.pp, sh: p.toi.sh } });
  }
  return { rows, goalies };
}
// a percentile from a 101-point quantile table
export function pctFromQ(q, v) {
  if (!q || !q.length) return null;
  let lo = 0, hi = q.length;
  while (lo < hi) { const m = (lo + hi) >> 1; if (q[m] < v) lo = m + 1; else hi = m; }
  return Math.min(100, Math.round((100 * lo) / (q.length - 1)));
}
// one team's side of a game in the compact form the site uses (see scripts/build-data.mjs)
export function compactGame(v, teamId) {
  const R2 = r2, mine = v.rows.filter((r) => r.t === teamId).sort((a, b) => b.gar - a.gar), theirs = v.rows.filter((r) => r.t !== teamId);
  const gl = v.goalies.filter((r) => r.t === teamId), gt = v.goalies.filter((r) => r.t !== teamId);
  const sum = (a) => a.reduce((x, r) => x + r.gar, 0);
  return {
    us: R2(sum(mine) + sum(gl)), them: R2(sum(theirs) + sum(gt)),
    // the 13th entry is the player's own game line:
    // [G, A, SOG, ixG, hits, blocks, FO won, FO lost, takeaways, giveaways, minors taken, minors drawn, EV / PP / SH seconds, on-ice GF, GA, xGF, xGA]
    rows: mine.map((r) => [r.id, r.n, r.pos, r.toi, R2(r.gc), R2(r.oio), R2(r.oid), R2(r.pp), R2(r.pen), R2(r.oth), R2(r.gar), r.pct,
      ((l) => [l.g, l.a, l.sog, R2(l.ixg), l.ht, l.bk, l.fw, l.fl, l.tk, l.gv, l.pt, l.pd, l.ev, l.pp, l.sh, l.gf, l.ga, R2(l.xgf), R2(l.xga)])(r.line)]),
    g: gl.map((r) => [r.id, r.n, r.shots, R2(r.gsax), R2(r.gar), r.pct, r.ga, R2(r.xga)]),
  };
}
