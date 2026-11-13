// Empty Net: find real NHL endings where a team trailed by one goal late in the third period,
// then bake them, with each team's real shootout numbers, into one self-contained game page.
//
//   node scripts/build-drill.mjs                    fetch new games, write drill/endings.json and site/drill/index.html
//   node scripts/build-drill.mjs --offline          skip the NHL API and build the page from drill/endings.json
//   node scripts/build-drill.mjs --fragment <file>  also write the page without <!doctype>/<head> (for embedding)
//
// Play-by-play of a finished game never changes, so each game's result (a scenario or "none") is cached in
// .cache/drill/<id>.json and only new games are downloaded on later runs.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const OFFLINE = args.includes('--offline');
const fragmentAt = args.indexOf('--fragment');
const FRAGMENT = fragmentAt >= 0 ? args[fragmentAt + 1] : null;
const SEASONS = [20252026, 20262027];          // regular season: rivalry games from these
// Playoffs from 2010-11 (the first with goalie-in-net data in every play) through the latest season that has started them
const NOW = new Date();
const LAST_PLAYOFF_YEAR = NOW.getUTCMonth() >= 3 ? NOW.getUTCFullYear() : NOW.getUTCFullYear() - 1;
const PLAYOFF_SEASONS = Array.from({ length: LAST_PLAYOFF_YEAR - 2010 }, (_, i) => (2010 + i) * 10000 + 2011 + i);
// a playoff game that 404s is only "never played" once that postseason is over (July)
const settled = (id) => { const y = Math.floor(id / 1e6) + 1; return y < NOW.getUTCFullYear() || NOW.getUTCMonth() >= 7; };
const LAUNCH = '2026-11-12';                     // Empty Net #1
const SCHEDULE = join(ROOT, 'drill', 'schedule.json');
// Classic rivalries (unordered pairs) for regular-season games
const RIVALS = ['BOS-MTL', 'BOS-TOR', 'MTL-TOR', 'NYR-NYI', 'NYR-NJD', 'NYI-NJD', 'NYR-PHI', 'PHI-PIT', 'PIT-WSH', 'CHI-DET',
  'CHI-STL', 'CGY-EDM', 'CGY-VAN', 'EDM-VAN', 'COL-DET', 'ANA-LAK', 'LAK-SJS', 'ANA-SJS', 'FLA-TBL', 'DAL-STL', 'MIN-WPG',
  'BOS-PHI', 'NYR-WSH', 'CAR-WSH', 'BUF-TOR', 'OTT-TOR', 'MTL-OTT', 'COL-MIN', 'NSH-STL', 'SEA-VAN', 'CHI-MIN', 'DAL-CHI', 'BOS-NYR'];
const CACHE = join(ROOT, '.cache', 'drill-v2');   // v2: late-game lineups
const DATA = join(ROOT, 'drill', 'endings.json');

// Scenario window: a 5-on-5 faceoff, both goalies in, one team down exactly one, 2:00 to 4:30 left in the 3rd.
const WINDOW = { latest: 270, earliest: 120 };

const sec = (mmss) => { const [m, s] = mmss.split(':').map(Number); return m * 60 + s; };

async function get(url, tries = 4) {
  for (let i = 0; ; i++) {
    try {
      const r = await fetch(url, { headers: { 'user-agent': 'rinkside-drill' }, signal: AbortSignal.timeout(20000) });
      if (!r.ok) throw new Error(`${r.status} ${url}`);
      return await r.json();
    } catch (err) {
      if (i >= tries - 1) throw err;
      await new Promise((res) => setTimeout(res, 800 * 2 ** i));
    }
  }
}

// situationCode digits: away goalie in (1/0), away skaters, home skaters, home goalie in (1/0)
const sit = (code) => ({ awayG: code[0] === '1', away: +code[1], home: +code[2], homeG: code[3] === '1' });

const fin = (pbp) => ({ h: pbp.homeTeam.abbrev, a: pbp.awayTeam.abbrev, hs: pbp.homeTeam.score, as: pbp.awayTeam.score });

function extract(pbp) {
  if (pbp.gameType !== 2 && pbp.gameType !== 3) return null;
  const home = pbp.homeTeam, away = pbp.awayTeam;
  const plays = pbp.plays;
  let score = { home: 0, away: 0 };
  let start = -1;
  for (let i = 0; i < plays.length; i++) {
    const p = plays[i];
    if (p.typeDescKey === 'goal' && p.periodDescriptor.periodType !== 'SO') {
      score = { home: p.details.homeScore, away: p.details.awayScore };
    }
    if (p.periodDescriptor.number !== 3 || p.typeDescKey !== 'faceoff') continue;
    const t = sec(p.timeRemaining);
    if (t > WINDOW.latest || t < WINDOW.earliest) continue;
    if (p.situationCode !== '1551' || Math.abs(score.home - score.away) !== 1) continue;
    start = i;
    break;
  }
  if (start < 0) return null;

  const fo = plays[start];
  const t0 = sec(fo.timeRemaining);
  const youHome = score.home < score.away;
  const you = youHome ? home : away, opp = youHome ? away : home;
  const youId = you.id;
  // faceoff zoneCode is from the winner's point of view
  let zone = fo.details.zoneCode;
  if (fo.details.eventOwnerTeamId !== youId && zone !== 'N') zone = zone === 'O' ? 'D' : 'O';

  const name = (id) => {
    const r = pbp.rosterSpots.find((x) => x.playerId === id);
    return r ? `${r.firstName.default} ${r.lastName.default}` : 'unknown';
  };

  // what the real coach did from here
  const real = { pulledAt: null, goals: [], final: null, ended: 'REG' };
  for (let i = start; i < plays.length; i++) {
    const p = plays[i], per = p.periodDescriptor.number;
    const t = sec(p.timeRemaining);
    if (per === 3 && p.situationCode && real.pulledAt === null) {
      const s = sit(p.situationCode);
      const out = youHome ? !s.homeG : !s.awayG;
      // a delayed penalty also pulls the goalie for a few seconds; only count a pull that lasts past a whistle
      if (out && p.typeDescKey !== 'delayed-penalty' && plays[i - 1]?.typeDescKey !== 'delayed-penalty') { real.pulledAt = t; }
    }
    if (p.typeDescKey === 'goal' && p.periodDescriptor.periodType !== 'SO') {
      const mine = p.details.eventOwnerTeamId === youId;
      const s = p.situationCode ? sit(p.situationCode) : null;
      const empty = s ? (mine ? (youHome ? !s.awayG : !s.homeG) : (youHome ? !s.homeG : !s.awayG)) : false;
      real.goals.push({ per, t, mine, by: name(p.details.scoringPlayerId), empty });
    }
  }
  const last = pbp.periodDescriptor?.periodType || pbp.gameOutcome?.lastPeriodType || 'REG';
  real.ended = last;
  real.otNum = Math.max(0, (pbp.periodDescriptor?.number ?? 3) - 3);
  const fYou = youHome ? pbp.homeTeam.score : pbp.awayTeam.score;
  const fOpp = youHome ? pbp.awayTeam.score : pbp.homeTeam.score;
  real.final = { you: fYou, opp: fOpp, won: fYou > fOpp };

  // shootout and OT need rosters: skaters who dressed, and the goalie in each net
  const skaters = (teamId) => pbp.rosterSpots.filter((r) => r.teamId === teamId && r.positionCode !== 'G')
    .map((r) => ({ id: r.playerId, n: `${r.firstName.default} ${r.lastName.default}`, pos: r.positionCode, num: r.sweaterNumber }));
  let youG = null, oppG = null;
  for (let i = start; i >= 0 && (!youG || !oppG); i--) {
    const d = plays[i].details;
    if (!d?.goalieInNetId) continue;
    if (d.eventOwnerTeamId === youId) oppG ??= d.goalieInNetId; else youG ??= d.goalieInNetId;
  }
  const goalie = (id) => { const r = pbp.rosterSpots.find((x) => x.playerId === id); return r ? { id, n: `${r.firstName.default} ${r.lastName.default}` } : null; };

  // who was on the ice late: third-period faceoffs pick the center; involvement in third-period plays picks the rest
  const lineup = (teamId) => {
    const roster = new Map(pbp.rosterSpots.filter((r) => r.teamId === teamId).map((r) => [r.playerId, r]));
    const fo = new Map(), inv = new Map();
    const bump = (m, id, w = 1) => { if (roster.has(id)) m.set(id, (m.get(id) || 0) + w); };
    for (const p of plays) {
      if (p.periodDescriptor.number !== 3) continue;
      const d = p.details || {};
      const late = sec(p.timeRemaining) < 600 ? 2 : 1;
      if (p.typeDescKey === 'faceoff') { bump(fo, d.winningPlayerId, late); bump(fo, d.losingPlayerId, late); }
      for (const k of ['shootingPlayerId', 'scoringPlayerId', 'assist1PlayerId', 'assist2PlayerId', 'blockingPlayerId', 'hittingPlayerId', 'hitteePlayerId', 'playerId', 'winningPlayerId', 'losingPlayerId']) bump(inv, d[k], late);
    }
    const tag = (id) => { const r = roster.get(id); return r ? { n: r.lastName.default, num: r.sweaterNumber } : null; };
    const rank = (pred) => [...roster.values()].filter(pred).map((r) => r.playerId).sort((a, b) => (inv.get(b) || 0) - (inv.get(a) || 0));
    const centers = [...fo.entries()].sort((a, b) => b[1] - a[1]).map(([id]) => id);
    const C = centers[0] ?? rank((r) => r.positionCode === 'C')[0];
    const fwd = rank((r) => r.positionCode !== 'D' && r.positionCode !== 'G' && r.playerId !== C);
    const dmen = rank((r) => r.positionCode === 'D');
    return { C: tag(C), W1: tag(fwd[0]), W2: tag(fwd[1]), X: tag(fwd[2]), D1: tag(dmen[0]), D2: tag(dmen[1]) };
  };

  return {
    id: pbp.id, date: pbp.gameDate, season: pbp.season, type: pbp.gameType, fin: fin(pbp),
    lineup: { you: lineup(youId), opp: lineup(opp.id) },
    you: { ab: you.abbrev, name: you.commonName.default, home: youHome },
    opp: { ab: opp.abbrev, name: opp.commonName.default },
    start: { t: t0, you: youHome ? score.home : score.away, opp: youHome ? score.away : score.home, zone },
    real,
    roster: { you: skaters(youId), opp: skaters(opp.id), youG: goalie(youG), oppG: goalie(oppG) },
  };
}

async function finishedGames(teams) {
  const ids = new Set();
  for (const season of SEASONS) {
    for (const ab of teams) {
      try {
        const s = await get(`https://api-web.nhle.com/v1/club-schedule-season/${ab}/${season}`);
        for (const g of s.games) if (g.gameType === 2 && (g.gameState === 'OFF' || g.gameState === 'FINAL')) ids.add(g.id);
      } catch (err) { console.warn(`schedule ${ab} ${season}: ${err.message}`); }
    }
  }
  return [...ids].sort();
}

// Playoff game ids are season + 03 + round + series + game: enumerate them and let missing ones 404.
function playoffIds() {
  const ids = [];
  const series = { 1: 8, 2: 4, 3: 2, 4: 1 };
  for (const season of PLAYOFF_SEASONS) {
    const y = Math.floor(season / 10000);
    for (const [round, n] of Object.entries(series)) for (let k = 1; k <= n; k++) for (let g = 1; g <= 7; g++) ids.push(Number(`${y}030${round}${k}${g}`));
  }
  return ids;
}

async function scenarios(ids) {
  await mkdir(CACHE, { recursive: true });
  const out = [];
  let i = 0, fetched = 0;
  async function worker() {
    while (i < ids.length) {
      const id = ids[i++];
      const file = join(CACHE, `${id}.json`);
      let sc;
      try { sc = JSON.parse(await readFile(file, 'utf8')); } catch {
        try {
          const pbp = await get(`https://api-web.nhle.com/v1/gamecenter/${id}/play-by-play`, String(id)[5] === '3' ? 1 : 4);
          sc = pbp.gameState === 'OFF' || pbp.gameState === 'FINAL' ? extract(pbp) ?? { none: true, fin: fin(pbp) } : { none: true, live: true };
          if (!sc.live) await writeFile(file, JSON.stringify(sc));
          fetched++;
        } catch (err) {
          if (/^404/.test(err.message)) { if (settled(id)) await writeFile(file, JSON.stringify({ none: true, missing: true })); continue; }
          console.warn(`play-by-play ${id}: ${err.message}`); continue;
        }
      }
      out.push({ id, ...sc });
    }
  }
  await Promise.all(Array.from({ length: 8 }, worker));
  const found = out.filter((x) => !x.none);
  console.log(`play-by-play: ${ids.length} ids, ${fetched} downloaded, ${found.length} late one-goal games`);
  return { all: new Map(out.filter((x) => x.fin).map((x) => [x.id, x.fin])), found: found.sort((a, b) => a.id - b.id) };
}

// Career regular-season shootout numbers, all players, in one call each.
async function shootoutStats() {
  const q = 'cayenneExp=gameTypeId=2%20and%20seasonId%3C=20262027%20and%20seasonId%3E=20052006&isAggregate=true&limit=-1';
  const [sk, gl] = await Promise.all([
    get(`https://api.nhle.com/stats/rest/en/skater/shootout?${q}`),
    get(`https://api.nhle.com/stats/rest/en/goalie/shootout?${q}`),
  ]);
  const skaters = new Map(sk.data.map((r) => [r.playerId, { g: r.careerShootoutGoals ?? r.shootoutGoals, s: r.careerShootoutShots ?? r.shootoutShots, h: r.shootsCatches }]));
  const goalies = new Map(gl.data.map((r) => [r.playerId, { sv: r.careerShootoutSaves ?? r.shootoutSaves, s: r.careerShootoutShotsAgainst ?? r.shootoutShotsAgainst, h: r.shootsCatches }]));
  return { skaters, goalies };
}

// Keep the page small: each side's 7 best-known shootout shooters, plus both goalies' career lines.
function trim(sc, so) {
  const shrink = (g, s) => (g + 0.32 * 10) / (s + 10);
  const side = (list) => list.map((p) => {
    const st = so.skaters.get(p.id) ?? { g: 0, s: 0 };
    return { n: p.n, pos: p.pos, num: p.num, g: st.g, s: st.s, h: st.h ?? null };
  }).sort((a, b) => shrink(b.g, b.s) - shrink(a.g, a.s) || b.s - a.s).slice(0, 7);
  const gl = (g) => g && { n: g.n, ...(so.goalies.get(g.id) ?? { sv: 0, s: 0 }) };
  return { ...sc, roster: { you: side(sc.roster.you), opp: side(sc.roster.opp).slice(0, 5), youG: gl(sc.roster.youG), oppG: gl(sc.roster.oppG) } };
}

// Series state before each playoff game, from the finals of the earlier games in the same series.
function playoffContext(sc, finals) {
  const id = String(sc.id);
  const round = +id[7], game = +id[9];
  const wins = { [sc.you.ab]: 0, [sc.opp.ab]: 0 };
  for (let g = 1; g < game; g++) {
    const f = finals.get(Number(id.slice(0, 9) + g));
    if (!f) continue;
    const w = f.hs > f.as ? f.h : f.a;
    if (w in wins) wins[w]++;
  }
  const y = wins[sc.you.ab], o = wins[sc.opp.ab];
  return { round, game, you: y, opp: o, elim: y === 3 || o === 3 };
}

const ROUNDS = { 1: 'First Round', 2: 'Second Round', 3: 'Conference Final', 4: 'Stanley Cup Final' };
function label(sc) {
  if (sc.type === 3) {
    const c = sc.series;
    const st = c.you === c.opp ? `series tied ${c.you}-${c.opp}` : c.you > c.opp ? `${sc.you.ab} lead ${c.you}-${c.opp}` : `${sc.opp.ab} lead ${c.opp}-${c.you}`;
    return `${ROUNDS[c.round]}, Game ${c.game} · ${c.game === 1 ? 'series opener' : st}`;
  }
  return 'Rivalry night';
}
// A: Stanley Cup Final. B: other playoff games. C: regular-season rivalry games.
function tier(sc) {
  if (sc.type === 3) return sc.series.round === 4 ? 'A' : 'B';
  return RIVALS.includes([sc.you.ab, sc.opp.ab].sort().join('-')) ? 'C' : null;
}

// One fixed game per day from LAUNCH. Past days never change; new days are appended from the pool.
async function schedule(pool) {
  let sched = [];
  try { sched = JSON.parse(await readFile(SCHEDULE, 'utf8')); } catch {}
  const want = Math.round((Date.now() - Date.parse(LAUNCH)) / 864e5) + 400;
  if (sched.length >= want) return sched;
  const pattern = ['A', 'B', 'C', 'B', 'A', 'B', 'B'];
  const byTier = { A: [], B: [], C: [] };
  for (const sc of pool) byTier[sc.tier].push(sc.id);
  const rand = (seed) => () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
  const shuffled = {};
  for (const [t, ids] of Object.entries(byTier)) {
    const r = rand(t.charCodeAt(0) * 7777);
    shuffled[t] = ids.slice().sort((a, b) => a - b);
    for (let i = shuffled[t].length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [shuffled[t][i], shuffled[t][j]] = [shuffled[t][j], shuffled[t][i]]; }
  }
  const used = new Set(sched);
  while (sched.length < want) {
    let t = pattern[sched.length % pattern.length];
    if (!shuffled[t].length) t = 'B';
    let next = shuffled[t].find((id) => !used.has(id));
    if (next === undefined) { used.clear(); next = shuffled[t][0]; }
    sched.push(next); used.add(next);
  }
  await writeFile(SCHEDULE, JSON.stringify(sched));
  return sched;
}

// ---------- real lines, from the NHL shift charts ----------
// Forward lines: the three centers who took the most draws, each with the two forwards who shared the most ice
// with him. D pairs: the four D with the most ice, paired by shared ice. Also: who was on the ice (and for how
// long) at the scenario's starting faceoff, each center's faceoff record that night, and the other team's
// go-to line late in the third.
const LINES = join(ROOT, '.cache', 'drill-lines');
async function linesFor(sc) {
  const file = join(LINES, `${sc.id}.json`);
  try { return JSON.parse(await readFile(file, 'utf8')); } catch {}
  const [pbp, sh] = await Promise.all([get(`https://api-web.nhle.com/v1/gamecenter/${sc.id}/play-by-play`), get(`https://api.nhle.com/stats/rest/en/shiftcharts?cayenneExp=gameId=${sc.id}`)]);
  const at = (per, mmss) => (per - 1) * 1200 + sec(mmss);
  const shifts = (sh.data || []).filter((x) => x.typeCode === 517 && x.startTime && x.endTime).map((x) => ({ pid: x.playerId, team: x.teamId, s: at(x.period, x.startTime), e: at(x.period, x.endTime) })).filter((x) => x.e > x.s);
  const byP = new Map();
  for (const x of shifts) { if (!byP.has(x.pid)) byP.set(x.pid, []); byP.get(x.pid).push(x); }
  const toi = (pid, from = 0, to = 1e9) => (byP.get(pid) || []).reduce((a, x) => a + Math.max(0, Math.min(x.e, to) - Math.max(x.s, from)), 0);
  const overlap = (a, b) => { let o = 0; for (const x of byP.get(a) || []) for (const y of byP.get(b) || []) o += Math.max(0, Math.min(x.e, y.e) - Math.max(x.s, y.s)); return o; };
  const fo = new Map();
  for (const p of pbp.plays) if (p.typeDescKey === 'faceoff') {
    const d = p.details || {};
    for (const [id, w] of [[d.winningPlayerId, 1], [d.losingPlayerId, 0]]) { if (!id) continue; const r = fo.get(id) || [0, 0]; r[0] += w; r[1] += 1; fo.set(id, r); }
  }
  const T0 = 2 * 1200 + (1200 - sc.start.t);
  const side = (teamId) => {
    const roster = pbp.rosterSpots.filter((r) => r.teamId === teamId && byP.has(r.playerId));
    const tag = (r) => ({ n: r.lastName.default, num: r.sweaterNumber, pos: r.positionCode });
    const fwd = roster.filter((r) => ['C', 'L', 'R'].includes(r.positionCode));
    const dmen = roster.filter((r) => r.positionCode === 'D').sort((a, b) => toi(b.playerId) - toi(a.playerId)).slice(0, 4);
    // cluster forwards into trios by shared ice: the two who played most together, then whoever played most with both
    const pool = fwd.filter((r) => toi(r.playerId) > 120).sort((a, b) => toi(b.playerId) - toi(a.playerId)).slice(0, 12);
    const ov = new Map();
    const o2 = (a, b) => { const k = a < b ? `${a}-${b}` : `${b}-${a}`; if (!ov.has(k)) ov.set(k, overlap(a, b)); return ov.get(k); };
    let lines = [];
    const left = new Set(pool.map((r) => r.playerId));
    const byId = new Map(pool.map((r) => [r.playerId, r]));
    for (let k = 0; k < 3 && left.size >= 3; k++) {
      let best = null, bo = -1;
      const ids = [...left];
      for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) { const o = o2(ids[i], ids[j]); if (o > bo) { bo = o; best = [ids[i], ids[j]]; } }
      const third = ids.filter((id) => !best.includes(id)).sort((a, b) => (o2(b, best[0]) + o2(b, best[1])) - (o2(a, best[0]) + o2(a, best[1])))[0];
      const trio = [...best, third].map((id) => byId.get(id));
      trio.forEach((r) => left.delete(r.playerId));
      // the center: whoever took the most draws
      trio.sort((a, b) => (fo.get(b.playerId) || [0, 0])[1] - (fo.get(a.playerId) || [0, 0])[1]);
      lines.push(trio);
    }
    lines = lines.sort((a, b) => b.reduce((x, r) => x + toi(r.playerId), 0) - a.reduce((x, r) => x + toi(r.playerId), 0));
    const d1 = dmen[0], d1p = dmen.slice(1).sort((a, b) => overlap(d1.playerId, b.playerId) - overlap(d1.playerId, a.playerId))[0];
    const pairs = [[d1, d1p], dmen.filter((d) => d !== d1 && d !== d1p)].map((p) => p.filter(Boolean));
    // on the ice at the starting faceoff
    const on = new Set(shifts.filter((x) => x.team === teamId && x.s <= T0 && x.e > T0).map((x) => x.pid));
    const score = lines.map((l) => l.filter((r) => on.has(r.playerId)).length);
    const cur = score.indexOf(Math.max(...score));
    const curStarts = lines[cur].filter((r) => on.has(r.playerId)).map((r) => (byP.get(r.playerId) || []).find((x) => x.s <= T0 && x.e > T0).s);
    const shiftSec = curStarts.length ? Math.round(T0 - Math.min(...curStarts)) : 0;
    const late = lines.map((l) => l.reduce((x, r) => x + toi(r.playerId, 2 * 1200 + 600, 3 * 1200), 0));
    return {
      lines: lines.map((l) => l.map(tag)),
      fo: lines.map((l) => fo.get(l[0].playerId) || [0, 0]),
      pairs: pairs.map((p) => p.map(tag)),
      onIce: Math.max(0, cur), shiftSec: Math.min(shiftSec, 90),
      late: late.indexOf(Math.max(...late)),
    };
  };
  const youId = sc.you.home ? pbp.homeTeam.id : pbp.awayTeam.id, oppId = sc.you.home ? pbp.awayTeam.id : pbp.homeTeam.id;
  const out = { you: side(youId), opp: side(oppId) };
  if (out.you.lines.length < 3 || out.opp.lines.length < 3 || out.you.pairs[0].length < 2 || out.opp.pairs[0].length < 2) return null;
  await mkdir(LINES, { recursive: true });
  await writeFile(file, JSON.stringify(out));
  return out;
}

async function main() {
  const config = JSON.parse(await readFile(join(ROOT, 'config.json'), 'utf8'));
  let endings;
  if (OFFLINE) {
    endings = JSON.parse(await readFile(DATA, 'utf8'));
  } else {
    const ids = [...await finishedGames(Object.keys(config.teams)), ...playoffIds()];
    const { all, found } = await scenarios(ids);
    const so = await shootoutStats();
    const pool = [];
    for (const sc of found) {
      sc.type ??= 2;
      if (sc.real.final.won) continue;            // the daily game is always one the real coach lost
      if (sc.type === 3) sc.series = playoffContext(sc, all);
      sc.tier = tier(sc);
      if (!sc.tier) continue;
      sc.label = label(sc);
      try { sc.lines = await linesFor(sc); } catch (err) { console.warn(`lines ${sc.id}: ${err.message}`); sc.lines = null; }
      pool.push(trim(sc, so));
    }
    const sched = await schedule(pool);
    endings = { built: new Date().toISOString(), launch: LAUNCH, schedule: sched, games: pool };
    console.log(`pool: ${pool.length} (A ${pool.filter((x) => x.tier === 'A').length}, B ${pool.filter((x) => x.tier === 'B').length}, C ${pool.filter((x) => x.tier === 'C').length})`);
    await mkdir(dirname(DATA), { recursive: true });
    await writeFile(DATA, JSON.stringify(endings));
  }
  const colors = Object.fromEntries(Object.entries(config.teams).map(([ab, t]) => [ab, [t.primary, t.accent]]));
  const read = (f) => readFile(join(ROOT, 'drill', f), 'utf8');
  const [page, css, engine, ui, font] = await Promise.all([read('page.html'), read('style.css'), read('engine.js'), read('ui.js'),
    readFile(join(ROOT, 'site', 'fonts', 'RinksideMono.woff2'))]);
  const data = JSON.stringify({ built: endings.built, launch: endings.launch, schedule: endings.schedule, colors, games: endings.games }).replace(/</g, '\\u003c');
  const body = page
    .replace('/*CSS*/', () => css.replace('/*FONT*/', `data:font/woff2;base64,${font.toString('base64')}`))
    .replace('/*DATA*/', () => `window.DRILL_DATA = ${data};`)
    .replace('/*ENGINE*/', () => engine)
    .replace('/*UI*/', () => ui);
  const full = `<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">\n${body.replace('<!--BODY-->', '</head>\n<body>')}\n</body>\n</html>\n`;
  await mkdir(join(ROOT, 'site', 'drill'), { recursive: true });
  await writeFile(join(ROOT, 'site', 'drill', 'index.html'), full);
  if (FRAGMENT) await writeFile(FRAGMENT, body.replace('<!--BODY-->', ''));
  const n = endings.games.length;
  console.log(`Empty Net: ${n} real endings -> site/drill/index.html (${Math.round(full.length / 1024)} KB)`);
}

export { extract };
if (process.argv[1] === fileURLToPath(import.meta.url)) main().catch((err) => { console.error(err); process.exit(1); });
