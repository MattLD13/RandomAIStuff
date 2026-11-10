// Box WAR: goals and wins above replacement for every skater and goalie, game by game.
//
// Inputs per game: the play-by-play (shots, goals, assists, penalties, faceoffs, takeaways,
// giveaways, blocks) and the shift chart (who was on the ice each second). Shifts come from the
// stats API or the NHL's HTML time-on-ice reports, whichever has more ice time for the game.
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
import { digest, apiShifts, parseToiReport, rawGame, r2, pctOf, ST, parts as partsR, goalieGar, gameRows } from '../site/war-core.mjs';
export { parseToiReport, digest, compactGame, pctFromQ } from '../site/war-core.mjs';

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
        // Use whichever source has more ice time. Right after a game the stats API's chart is often
        // only part-posted (NYR@EDM 2026-11-09: 678 of 779 shifts, ~15% of ice time missing), while the
        // HTML time-on-ice reports are complete within a minute of the clock.
        const api = apiShifts(sc.data || []);
        const s = String(id), base = `https://www.nhl.com/scores/htmlreports/${s.slice(0, 4)}${+s.slice(0, 4) + 1}`;
        let html = [];
        try {
          const [th, tv] = await Promise.all([getText(`${base}/TH${s.slice(4)}.HTM`), getText(`${base}/TV${s.slice(4)}.HTM`)]);
          html = [...parseToiReport(th, pbp.homeTeam.id, pbp.rosterSpots), ...parseToiReport(tv, pbp.awayTeam.id, pbp.rosterSpots)];
        } catch {}
        const iceMin = (l) => l.reduce((a, x) => a + (x.e - x.s), 0) / 60;
        const shifts = iceMin(html) > iceMin(api) ? html : api;
        if (shifts.length < 200) { missing++; continue; }   // try again on the next build
        if (shifts === html) fromReport++;
        const g = digest(pbp, shifts);
        // a full game is ~700 player-minutes (12 on the ice for 60); cache only once it adds up to one,
        // so a game whose shifts are still being posted is fetched again on the next build
        if (iceMin(shifts) >= 640) await writeFile(file, JSON.stringify(g));
        out.set(id, g); fetched++;
      } catch (err) { console.warn(`war ${id}: ${err.message}`); }
    }
  }
  await Promise.all(Array.from({ length: concurrency }, worker));
  return { digests: out, fetched, fromReport, missing };
}

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

  // replacement-adjusted pieces for one game (or a season total): site/war-core.mjs
  const parts = (p) => partsR(p, R), gGar = (p) => goalieGar(p, R);

  const out = { gpw, games: new Map(), season: {}, R };
  const sk = [], gk = [];
  for (const g of games) {
    const { rows, goalies: gl } = gameRows(g, raw.get(g.id), R);
    for (const r of rows) if (r.toi >= 300) sk.push(r.gar);
    for (const r of gl) gk.push(r.gar);
    out.games.set(g.id, { home: g.home, away: g.away, rows, goalies: gl });
  }
  sk.sort((a, b) => a - b); gk.sort((a, b) => a - b);
  // 101-point quantile tables, so the browser can place a live game's GAR on the same scale
  const quant = (a) => (a.length ? Array.from({ length: 101 }, (_, k) => r2(a[Math.min(a.length - 1, Math.round((k / 100) * (a.length - 1)))]) * 1) : []);
  out.q = { sk: quant(sk), gk: quant(gk) };
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
