// Box WAR: goals and wins above replacement for every skater and goalie, game by game.
//
// Inputs per game: the play-by-play (shots, goals, assists, penalties, faceoffs, takeaways,
// giveaways, blocks) and the shift chart (who was on the ice each second). Shift charts come
// from the stats API; when it has none for a game, the NHL's HTML time-on-ice reports are parsed.
//
// Every shot on goal is worth v = ½·xG + ½·goal (process and result, half each).
//   Goal creation   the shooter's 35% of v; on a goal, 15% to the first assist, 5% to the second
//   On-ice offence  the rest of v, split evenly between the attacking skaters on the ice
//   On-ice defence  minus the shot's xG, split evenly between the defending skaters on the ice
//                   (goals against beyond xG are the goalie's, not the skaters')
//   Power play      the three above while on the power play
//   Penalties       0.17 goals per minor drawn, minus 0.17 per minor taken (majors 2.5 minors)
//   Other           faceoffs (±0.008 a draw), takeaways (+0.015), giveaways (−0.01), blocks (+0.012)
// Each piece is measured against a replacement-level player: the per-60 rate, at the same
// strength, of the skaters outside each team's top 13 forwards and top 7 defencemen by ice time.
// Goalies: goals saved above expected, minus the replacement goalies' rate per shot (goalies
// outside each team's top two by shots faced, shrunk toward −0.006 a shot). Wins = goals ÷ (2 × league goals per team-game).
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { reduce, xg } from '../site/chances-core.mjs';

const secs = (t) => { const [m, s] = String(t || '0:0').split(':').map(Number); return m * 60 + s; };
const ST = ['ev', 'pp', 'sh'];
const VALUE = { shooter: 0.35, a1: 0.15, a2: 0.05, minor: 0.17, faceoff: 0.008, takeaway: 0.015, giveaway: -0.01, block: 0.012 };

// ---------- shift charts ----------
function apiShifts(rows) {
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
    else if (type === 'blocked-shot') bump(d.blockingPlayerId, 'bk');
  }
  return { id: pbp.id, home, away, players, toi, box, shots };
}

// Fetch (or read from cache) every game's digest.
export async function loadDigests(gameIds, get, getText, cacheDir, { concurrency = 6 } = {}) {
  await mkdir(cacheDir, { recursive: true });
  const out = new Map();
  let fetched = 0, fromReport = 0, missing = 0, i = 0;
  async function worker() {
    while (i < gameIds.length) {
      const id = gameIds[i++], file = join(cacheDir, `${id}.json`);
      try { out.set(id, JSON.parse(await readFile(file, 'utf8'))); continue; } catch {}
      try {
        const [pbp, sc] = await Promise.all([get(`https://api-web.nhle.com/v1/gamecenter/${id}/play-by-play`),
          get(`https://api.nhle.com/stats/rest/en/shiftcharts?cayenneExp=gameId=${id}`).catch(() => ({ data: [] }))]);
        let shifts = apiShifts(sc.data || []);
        if (shifts.length < 200) {   // the API sometimes has nothing for a run of games: use the HTML reports
          const s = String(id), base = `https://www.nhl.com/scores/htmlreports/${s.slice(0, 4)}${+s.slice(0, 4) + 1}`;
          try {
            const [th, tv] = await Promise.all([getText(`${base}/TH${s.slice(4)}.HTM`), getText(`${base}/TV${s.slice(4)}.HTM`)]);
            shifts = [...parseToiReport(th, pbp.homeTeam.id, pbp.rosterSpots), ...parseToiReport(tv, pbp.awayTeam.id, pbp.rosterSpots)];
            if (shifts.length >= 200) fromReport++;
          } catch {}
        }
        if (shifts.length < 200) { missing++; continue; }   // try again on the next build
        const g = digest(pbp, shifts);
        await writeFile(file, JSON.stringify(g));
        out.set(id, g); fetched++;
      } catch (err) { console.warn(`war ${id}: ${err.message}`); }
    }
  }
  await Promise.all(Array.from({ length: concurrency }, worker));
  return { digests: out, fetched, fromReport, missing };
}

// ---------- raw (not yet replacement-adjusted) value of one game ----------
function rawGame(g, w) {
  const P = {};
  const get = (id) => {
    if (!P[id]) {
      const p = g.players[id] || {};
      P[id] = { id: +id, t: p.t, pos: p.pos, n: p.n, toi: g.toi[id] || { ev: 0, pp: 0, sh: 0, x: 0 },
        gc: { ev: 0, pp: 0, sh: 0 }, oio: { ev: 0, pp: 0, sh: 0 }, oid: { ev: 0, pp: 0, sh: 0 }, pen: 0, oth: 0, shots: 0, gsax: 0 };
    }
    return P[id];
  };
  for (const id of Object.keys(g.toi)) get(id);
  for (const s of g.shots) {
    if (s.en) continue;
    const x = xg(w, s), v = 0.5 * x + 0.5 * s.goal;
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

const r2 = (v) => Math.round(v * 100) / 100;
const pctOf = (sorted, v) => {   // share of values below v (ties count half)
  let lo = 0, hi = sorted.length;
  while (lo < hi) { const m = (lo + hi) >> 1; if (sorted[m] < v) lo = m + 1; else hi = m; }
  let eq = lo; while (eq < sorted.length && sorted[eq] === v) eq++;
  return Math.round((100 * (lo + (eq - lo) / 2)) / Math.max(sorted.length, 1));
};

export function computeWar(digests, w) {
  const games = [...digests.values()].sort((a, b) => a.id - b.id);
  const raw = new Map(games.map((g) => [g.id, rawGame(g, w)]));
  // season totals per player (raw), and the team each skater played for most recently
  const season = {};
  let goals = 0;
  for (const g of games) {
    goals += g.shots.reduce((a, s) => a + s.goal, 0);
    for (const p of raw.get(g.id)) {
      const s = season[p.id] ??= { id: p.id, pos: p.pos, n: p.n, t: p.t, gp: 0, toi: { ev: 0, pp: 0, sh: 0, x: 0 },
        gc: { ev: 0, pp: 0, sh: 0 }, oio: { ev: 0, pp: 0, sh: 0 }, oid: { ev: 0, pp: 0, sh: 0 }, pen: 0, oth: 0, shots: 0, gsax: 0 };
      s.t = p.t; s.gp++;
      for (const k of ['ev', 'pp', 'sh', 'x']) s.toi[k] += p.toi[k];
      for (const c of ['gc', 'oio', 'oid']) for (const k of ST) s[c][k] += p[c][k];
      s.pen += p.pen; s.oth += p.oth; s.shots += p.shots; s.gsax += p.gsax;
    }
  }
  const gpw = r2((2 * goals) / Math.max(1, 2 * games.length));
  const all = (t) => t.ev + t.pp + t.sh + t.x;

  // replacement pool: outside each team's top 13 forwards / top 7 defencemen / top 2 goalies
  const byTeam = {};
  for (const s of Object.values(season)) (byTeam[s.t] ??= []).push(s);
  const pool = { F: [], D: [], G: [] };
  for (const list of Object.values(byTeam)) {
    const grp = (pos) => list.filter((s) => (pos === 'G' ? s.pos === 'G' : pos === 'D' ? s.pos === 'D' : s.pos !== 'G' && s.pos !== 'D'));
    pool.F.push(...grp('F').sort((a, b) => all(b.toi) - all(a.toi)).slice(13));
    pool.D.push(...grp('D').sort((a, b) => all(b.toi) - all(a.toi)).slice(7));
    pool.G.push(...grp('G').sort((a, b) => b.shots - a.shots).slice(2));
  }
  const R = {};
  for (const grp of ['F', 'D']) {
    const L = pool[grp], sum = (f) => L.reduce((a, s) => a + f(s), 0);
    const toi = Object.fromEntries(['ev', 'pp', 'sh'].map((k) => [k, sum((s) => s.toi[k]) || 1]));
    R[grp] = {};
    for (const c of ['gc', 'oio', 'oid']) R[grp][c] = Object.fromEntries(ST.map((k) => [k, sum((s) => s[c][k]) / toi[k]]));
    const tot = sum((s) => all(s.toi)) || 1;
    R[grp].pen = sum((s) => s.pen) / tot; R[grp].oth = sum((s) => s.oth) / tot;
    R[grp].n = L.length;
  }
  const gShots = pool.G.reduce((a, s) => a + s.shots, 0);
  // few shots reach third-string goalies, so shrink their rate toward a typical -0.006 goals a shot
  R.G = Math.max(-0.012, Math.min(0, (pool.G.reduce((a, s) => a + s.gsax, 0) - 0.006 * 3000) / (gShots + 3000)));

  // replacement-adjusted pieces for one game (or a season total)
  const parts = (p) => {
    const r = R[p.pos === 'D' ? 'D' : 'F'];
    const ev = (c) => p[c].ev - r[c].ev * p.toi.ev + p[c].sh - r[c].sh * p.toi.sh;
    const gc = ev('gc'), oio = ev('oio'), oid = ev('oid');
    const pp = ['gc', 'oio', 'oid'].reduce((a, c) => a + p[c].pp - r[c].pp * p.toi.pp, 0);
    const pen = p.pen - r.pen * all(p.toi), oth = p.oth - r.oth * all(p.toi);
    return { gc, oio, oid, pp, pen, oth, gar: gc + oio + oid + pp + pen + oth };
  };
  const gGar = (p) => p.gsax - R.G * p.shots;

  const out = { gpw, games: new Map(), season: {}, R };
  const sk = [], gk = [];
  for (const g of games) {
    const rows = [], gl = [];
    for (const p of raw.get(g.id)) {
      if (p.pos === 'G') { if (p.shots) gl.push({ id: p.id, t: p.t, n: p.n, toi: all(p.toi), shots: p.shots, gsax: p.gsax, gar: gGar(p) }); continue; }
      if (!all(p.toi)) continue;
      rows.push({ id: p.id, t: p.t, n: p.n, pos: p.pos, toi: all(p.toi), ...parts(p) });
    }
    for (const r of rows) if (r.toi >= 300) sk.push(r.gar);
    for (const r of gl) gk.push(r.gar);
    out.games.set(g.id, { home: g.home, away: g.away, rows, goalies: gl });
  }
  sk.sort((a, b) => a - b); gk.sort((a, b) => a - b);
  for (const v of out.games.values()) {
    for (const r of v.rows) r.pct = pctOf(sk, r.gar);
    for (const r of v.goalies) r.pct = pctOf(gk, r.gar);
  }
  // season: skaters with 25%+ of the most games played, goalies with 3+ games, for percentiles
  const maxGp = Math.max(1, ...Object.values(season).map((s) => s.gp));
  const sSk = [], sGk = [];
  for (const s of Object.values(season)) {
    const toi = all(s.toi);
    const row = s.pos === 'G'
      ? { id: s.id, t: s.t, n: s.n, pos: 'G', gp: s.gp, toi, shots: s.shots, gsax: s.gsax, gar: gGar(s) }
      : { id: s.id, t: s.t, n: s.n, pos: s.pos, gp: s.gp, toi, ...parts(s) };
    if (s.pos === 'G' && !s.shots) continue;
    row.war = row.gar / gpw;
    row.qualified = s.pos === 'G' ? s.gp >= 3 : s.gp >= Math.max(3, 0.25 * maxGp);
    if (row.qualified) (s.pos === 'G' ? sGk : sSk).push(row.gar);
    out.season[s.id] = row;
  }
  sSk.sort((a, b) => a - b); sGk.sort((a, b) => a - b);
  for (const r of Object.values(out.season)) r.pct = r.qualified ? pctOf(r.pos === 'G' ? sGk : sSk, r.gar) : null;
  return out;
}

export const round2 = r2;
