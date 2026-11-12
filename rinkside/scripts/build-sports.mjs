// Builds the multi-sport boards (Courtside, Sideline, Dugout, Pitchside) from ESPN's public site API.
// Writes site/<league>/data/<ABBR>.json per team, site/<league>/data/league.json, and one folder per team
// (site/<league>/<nickname>/index.html) so each team has its own address. Rinkside (NHL) is built separately.
//   node scripts/build-sports.mjs            all leagues
//   node scripts/build-sports.mjs nba nfl    some leagues
import { mkdir, writeFile, readFile, rm, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SITE = path.join(ROOT, 'site');
const { leagues: LEAGUES, hockey: HOCKEY } = JSON.parse(await readFile(path.join(ROOT, 'sports/leagues.json'), 'utf8'));
const SITEAPI = 'https://site.api.espn.com/apis/site/v2/sports';
const COREAPI = 'https://sports.core.api.espn.com/v2/sports';

const CACHE = path.join(ROOT, '.cache', 'espn');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function get(url, { optional = false } = {}) {
  for (let i = 0; i < 4; i++) {
    try {
      const r = await fetch(url, { headers: { 'user-agent': 'rinkside-board/1.0' } });
      if (r.ok) return await r.json();
      if (r.status === 404 || r.status === 400) { if (optional) return null; throw new Error(`${r.status} ${url}`); }
    } catch (e) { if (i === 3 && !optional) throw e; }
    await sleep(500 * 2 ** i);
  }
  if (optional) return null;
  throw new Error(`failed ${url}`);
}
async function pool(items, n, fn) {
  const out = new Array(items.length); let next = 0;
  await Promise.all(Array.from({ length: n }, async () => { while (next < items.length) { const i = next++; out[i] = await fn(items[i], i); } }));
  return out;
}

const slugify = (s) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '');
const num = (v) => { const x = parseFloat(String(v).replace(/[^0-9.+-]/g, '')); return Number.isFinite(x) ? x : null; };
const athleteId = (ref) => (ref || '').match(/athletes\/(\d+)/)?.[1];
const teamIdFromRef = (ref) => (ref || '').match(/teams\/(\d+)/)?.[1];

// ---------- standings ----------
function parseStandings(root) {
  const rows = [];
  const walk = (node, conf, div) => {
    const isConf = !conf && node !== root;
    const c = isConf ? node : conf;
    const d = conf && node !== conf ? node : div;
    for (const e of node.standings?.entries || []) {
      const s = {};
      for (const st of e.stats) for (const k of [st.name, st.type, st.abbreviation]) if (k && !(k in s)) s[k] = st;
      rows.push({ id: e.team.id, abbr: e.team.abbreviation, stats: s,
        conference: c?.name, confShort: c?.abbreviation, division: d?.name, divShort: d?.abbreviation });
    }
    for (const ch of node.children || []) walk(ch, c, d);
  };
  walk(root);
  return rows;
}
const sv = (row, k) => row?.stats[k]?.value ?? num(row?.stats[k]?.displayValue);
const sd = (row, k) => row?.stats[k]?.displayValue ?? '';

// ---------- schedule ----------
function parseGame(e, teamId) {
  const c = e.competitions[0];
  const me = c.competitors.find((x) => x.team.id === teamId), op = c.competitors.find((x) => x.team.id !== teamId);
  if (!me || !op) return null;
  const score = (x) => num(typeof x.score === 'object' ? x.score?.displayValue : x.score);
  const st = c.status?.type || {};
  const done = st.completed === true || /FINAL|FULL_TIME/.test(st.name || '');
  const g = { id: e.id, date: e.date, home: me.homeAway === 'home', opp: op.team.abbreviation, oppId: op.team.id,
    week: e.week?.number ?? null, tv: (c.broadcasts || []).map((b) => b.media?.shortName).filter(Boolean)[0] || null,
    state: done ? 'final' : (st.state === 'in' ? 'live' : (/POSTPONED|CANCELED/.test(st.name || '') ? 'off' : 'pre')) };
  if (done) {
    g.us = score(me); g.them = score(op);
    g.res = g.us > g.them ? 'W' : g.us < g.them ? 'L' : 'T';
    const per = c.status?.period; const detail = st.shortDetail || '';
    if (/OT|SO|\/\d+/.test(detail) && !/^Final$/.test(detail)) g.extra = detail.replace(/^Final\/?/, '').trim() || null;
  }
  return g;
}

// ---------- the playoff line through the season ----------
// For every date with games: rank each conference by win % (points for MLS), work out who is in
// (division leaders first where the league seeds them), and record how far each team is from the line.
function lineHistory(cfg, teams, games) {
  const byDate = new Map();
  for (const t of teams) for (const g of games[t.id] || []) if (g.state === 'final') {
    const d = g.date.slice(0, 10);
    if (!byDate.has(d)) byDate.set(d, []);
    byDate.get(d).push([t.id, g.res]);
  }
  const rec = Object.fromEntries(teams.map((t) => [t.id, { w: 0, l: 0, t: 0 }]));
  const hist = Object.fromEntries(teams.map((t) => [t.id, []]));
  const P = cfg.picture, N = P.lineSeed;
  const score = (r) => cfg.draws ? 3 * r.w + r.t : (r.w + r.l + r.t ? (r.w + r.t / 2) / (r.w + r.l + r.t) : 0.5);
  const diff = (r) => cfg.draws ? 3 * r.w + r.t : (r.w - r.l);   // games-ahead uses (W-L)/2; points leagues use points
  const confs = [...new Set(teams.map((t) => t.conference))];
  for (const d of [...byDate.keys()].sort()) {
    for (const [id, res] of byDate.get(d)) { const r = rec[id]; r[res === 'W' ? 'w' : res === 'L' ? 'l' : 't']++; }
    for (const conf of confs) {
      const ct = teams.filter((t) => t.conference === conf);
      const ranked = [...ct].sort((a, b) => score(rec[b.id]) - score(rec[a.id]) || diff(rec[b.id]) - diff(rec[a.id]));
      let inSet = [];
      if (P.divWinners) {
        const divs = [...new Set(ct.map((t) => t.division))];
        const leaders = divs.map((dv) => ranked.find((t) => t.division === dv));
        inSet = [...leaders, ...ranked.filter((t) => !leaders.includes(t)).slice(0, N - leaders.length)];
      } else inSet = ranked.slice(0, N);
      const out = ranked.filter((t) => !inSet.includes(t));
      const firstOut = out[0], lastIn = [...inSet].sort((a, b) => score(rec[a.id]) - score(rec[b.id]) || diff(rec[a.id]) - diff(rec[b.id]))[0];
      const half = cfg.draws ? 1 : 0.5;
      for (const t of ct) {
        const ref = inSet.includes(t) ? firstOut : lastIn;
        if (!ref) continue;
        hist[t.id].push([d, Math.round((diff(rec[t.id]) - diff(rec[ref.id])) * half * 10) / 10, ranked.indexOf(t) + 1]);
      }
    }
  }
  return hist;
}

// "W-L" (or "W-D-L" when draws exist) from a list of games
function splitRec(gs) {
  const f = gs.filter((g) => g.state === 'final'); const c = (r) => f.filter((g) => g.res === r).length;
  return c('T') ? `${c('W')}-${c('T')}-${c('L')}` : `${c('W')}-${c('L')}`;
}

// ---------- MLS match stats ----------
// ESPN has no MLS team statistics, but each day's scoreboard carries possession and shots per club.
// Finished days never change, so they are cached in .cache/espn (kept between workflow runs).
async function matchStats(cfg, games) {
  const days = new Set();
  for (const gs of Object.values(games)) for (const g of gs) if (g.state === 'final') {
    const d = new Date(g.date);
    for (const off of [0, -1]) days.add(new Date(d.getTime() + off * 864e5).toISOString().slice(0, 10).replace(/-/g, ''));
  }
  await mkdir(CACHE, { recursive: true });
  const seen = new Set(), out = {};
  await pool([...days].sort(), 6, async (day) => {
    const file = path.join(CACHE, `${cfg.espn.replace('/', '_')}_${day}.json`);
    let sb = null;
    try { sb = JSON.parse(await readFile(file, 'utf8')); } catch {}
    if (!sb) {
      sb = await get(`${SITEAPI}/${cfg.espn}/scoreboard?dates=${day}`, { optional: true });
      if (!sb) return;
      sb = { events: (sb.events || []).map((e) => ({ id: e.id, done: e.competitions[0].status?.type?.completed,
        teams: e.competitions[0].competitors.map((c) => ({ id: c.team.id, st: Object.fromEntries((c.statistics || []).map((x) => [x.name, parseFloat(x.displayValue)])) })) })) };
      if (sb.events.length && sb.events.every((e) => e.done)) await writeFile(file, JSON.stringify(sb));
    }
    for (const e of sb.events) {
      if (!e.done || seen.has(e.id) || e.teams.length !== 2) continue;
      seen.add(e.id);
      for (const [a, b] of [[0, 1], [1, 0]]) {
        const me = e.teams[a], op = e.teams[b];
        if (!(me.st.totalShots >= 0)) continue;
        const o = (out[me.id] ??= { n: 0, poss: 0, shots: 0, onT: 0, goals: 0, shotsA: 0 });
        o.n++; o.poss += me.st.possessionPct || 0; o.shots += me.st.totalShots; o.onT += me.st.shotsOnTarget || 0;
        o.goals += me.st.totalGoals || 0; o.shotsA += op.st.totalShots || 0;
      }
    }
  });
  return out;
}

// ---------- MLS playoffs ----------
// ESPN's MLS team schedules stop at the regular season; the playoffs are only on the daily scoreboards.
// Scan from the day after the last regular-season match to 45 days on (finished days are cached).
async function soccerPostseason(cfg, games) {
  const last = Object.values(games).flat().map((g) => g.date).sort().pop();
  if (!last) return {};
  const start = new Date(last), out = {};
  const days = Array.from({ length: 46 }, (_, k) => new Date(start.getTime() + (k + 1) * 864e5).toISOString().slice(0, 10).replace(/-/g, ''));
  await mkdir(CACHE, { recursive: true });
  const evs = (await pool(days, 6, async (day) => {
    const file = path.join(CACHE, `${cfg.espn.replace('/', '_')}_post_${day}.json`);
    try { return JSON.parse(await readFile(file, 'utf8')); } catch {}
    const sb = await get(`${SITEAPI}/${cfg.espn}/scoreboard?dates=${day}`, { optional: true });
    const list = (sb?.events || []).filter((e) => /playoff|cup|wild|final/i.test(e.season?.slug || ''));
    if (list.length && list.every((e) => e.competitions[0].status?.type?.completed) && day < new Date().toISOString().slice(0, 10).replace(/-/g, '')) await writeFile(file, JSON.stringify(list));
    return list;
  })).flat();
  const roundOf = (slug) => (slug || '').replace(/^(eastern|western)-conference-playoffs-+/, '').replace(/-+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()).replace(/^Mls/, 'MLS');
  const seen = new Set();
  for (const e of evs) {
    if (seen.has(e.id)) continue; seen.add(e.id);
    for (const c of e.competitions[0].competitors) {
      const g = parseGame(e, c.team.id); if (!g) continue;
      g.round = roundOf(e.season?.slug);
      (out[c.team.id] ??= []).push(g);
    }
  }
  for (const k in out) out[k].sort((a, b) => a.date.localeCompare(b.date));
  return out;
}

// ---------- one league ----------
async function buildLeague(key) {
  const cfg = LEAGUES[key];
  const t0 = Date.now();
  const [teamsRaw, standRaw] = await Promise.all([
    get(`${SITEAPI}/${cfg.espn}/teams`),
    get(`https://site.api.espn.com/apis/v2/sports/${cfg.espn}/standings?level=3`),
  ]);
  const stand = parseStandings(standRaw);
  const sById = Object.fromEntries(stand.map((r) => [r.id, r]));
  const teams = teamsRaw.sports[0].leagues[0].teams.map(({ team: t }) => t)
    .filter((t) => sById[t.id])
    .map((t) => {
      const s = sById[t.id];
      const logo = (rel) => t.logos?.find((l) => rel.every((r) => l.rel.includes(r)))?.href;
      // remix background: the team's secondary (alternate) logo, made for black, through ESPN's resizer (13 KB, not 230)
      const sec = logo(['full', 'secondary_logo_on_black_color']);
      const altLogo = sec ? `https://a.espncdn.com/combiner/i?img=${new URL(sec).pathname}&w=240&h=240` : null;
      return { id: t.id, abbr: t.abbreviation, altLogo, name: t.displayName, short: t.shortDisplayName, nick: t.name, location: t.location,
        color: '#' + (t.color || '333333'), alt: '#' + (t.alternateColor || 'ffffff'),
        logo: logo(['full', 'dark']) || logo(['full', 'default']) || t.logos?.[0]?.href,   // the dark-background versions: the board is black
        conference: s.conference, confShort: s.confShort, division: s.division || s.conference, divShort: s.divShort || s.confShort };
    });
  const tById = Object.fromEntries(teams.map((t) => [t.id, t]));
  // your own alternate logos win: site/alt/<league>/<ABBR>.png (or .svg, .webp, .gif, .jpg)
  try {
    for (const f of await readdir(path.join(SITE, 'alt', key))) {
      const t = teams.find((x) => x.abbr === f.replace(/\.(png|svg|webp|gif|jpe?g)$/i, '').toUpperCase());
      if (t) t.altLogo = `alt/${key}/${f}`;
    }
  } catch {}
  // a folder name per team: the team name (knicks, giants, yankees, sounders); sports/leagues.json "slugs" can set one.
  // Other spellings (abbreviation, city, full name) become alias folders that open the same board.
  const RESERVED = new Set(['league', 'data', 'guide', 'sports', 'brand', 'alt', 'fonts']);
  const used = new Set(RESERVED);
  for (const t of teams) {
    const cands = [cfg.slugs?.[t.abbr], slugify(t.nick), slugify(t.abbr), slugify(t.name)].filter(Boolean);
    t.slug = cands.find((c) => !used.has(c)); used.add(t.slug);
  }
  for (const t of teams) {
    // a city alias only when one team has that city (not New York, Los Angeles or Chicago in leagues with two)
    const cityOf = (x) => ({ la: 'losangeles', ny: 'newyork' })[slugify(x.location || '')] || slugify(x.location || '');
    const city = cityOf(t), cityTeams = teams.filter((x) => cityOf(x) === city).length;
    t.aliases = [...new Set([slugify(t.abbr), slugify(t.short), slugify(t.nick), slugify(t.name), cityTeams === 1 && city !== slugify(t.name) ? city : ''])]
      .filter((a) => a && a.length > 1 && !used.has(a));
    t.aliases.forEach((a) => used.add(a));
  }

  // per team: schedule (falls back to last season when the new one has not started), statistics, roster
  let season = null;
  const per = await pool(teams, 6, async (t) => {
    const st = cfg.sport === 'soccer' ? '' : '?seasontype=2';
    let sch = await get(`${SITEAPI}/${cfg.espn}/teams/${t.id}/schedule${st}`);
    let gs = (sch.events || []).map((e) => parseGame(e, t.id)).filter(Boolean);
    let nextSeason = null;
    if (!gs.some((g) => g.state === 'final')) {
      // the new season hasn't started (MLB now): show last season, and keep the new one's first games for "Next 5"
      nextSeason = { name: sch.requestedSeason?.displayName ?? sch.season?.displayName, games: gs.filter((g) => g.state === 'pre').sort((a, b) => a.date.localeCompare(b.date)).slice(0, 10) };
      const y = sch.requestedSeason?.year ?? sch.season?.year;
      const prev = await get(`${SITEAPI}/${cfg.espn}/teams/${t.id}/schedule?season=${y - 1}${st ? '&seasontype=2' : ''}`, { optional: true });
      if (prev?.events?.length) { sch = prev; gs = prev.events.map((e) => parseGame(e, t.id)).filter(Boolean); }
    }
    gs.sort((a, b) => a.date.localeCompare(b.date));
    season ??= sch.requestedSeason?.year ?? sch.season?.year;
    const [stats, roster] = await Promise.all([
      cfg.sport === 'soccer' ? null : get(`${SITEAPI}/${cfg.espn}/teams/${t.id}/statistics?season=${sch.requestedSeason?.year ?? sch.season?.year}&seasontype=2`, { optional: true }),
      get(`${SITEAPI}/${cfg.espn}/teams/${t.id}/roster`, { optional: true }),
    ]);
    // once the regular season is done (MLB now), the postseason too
    let post = [];
    if (st && gs.length && !gs.some((g) => g.state === 'pre' || g.state === 'live')) {
      const y = sch.requestedSeason?.year ?? sch.season?.year;
      const ps = await get(`${SITEAPI}/${cfg.espn}/teams/${t.id}/schedule?season=${y}&seasontype=3`, { optional: true });
      post = (ps?.events || []).map((e) => { const g = parseGame(e, t.id); if (g) g.round = e.competitions[0].notes?.[0]?.headline || null; return g; })
        .filter(Boolean).sort((a, b) => a.date.localeCompare(b.date));
    }
    return { post, nextSeason, games: gs, seasonYear: sch.requestedSeason?.year ?? sch.season?.year, seasonName: sch.requestedSeason?.displayName ?? sch.season?.displayName, stats, roster };
  });
  const games = Object.fromEntries(teams.map((t, i) => [t.id, per[i].games]));
  if (cfg.sport === 'soccer') {
    const post = await soccerPostseason(cfg, games);
    teams.forEach((t, i) => { per[i].post = (post[t.id] || []); });
  }

  // ---------- MLS match stats (possession, shots) from the daily scoreboards ----------
  const match = cfg.stats.some((d) => d[2] === 'match') ? await matchStats(cfg, games) : {};

  // ---------- team stat boxes, ranked across the league ----------
  // Each box is something the standings do not already show. A stat is a number, or [number to rank by, text to show].
  const pts3 = (x) => (x.res === 'W' ? 3 : x.res === 'T' ? 1 : 0);
  const statOf = (i, [name, , src]) => {
    const t = teams[i], s = sById[t.id], g = per[i].games.filter((x) => x.state === 'final');
    const gp = g.length || 1;
    const cs = (cat, n) => per[i].stats?.results?.stats?.categories?.find((c) => c.name === cat)?.stats.find((x) => x.name === n)?.value ?? null;
    if (src === 'calc') {
      if (/^(pace|offRating|defRating)$/.test(name)) {
        // possessions per game, the usual estimate: FGA - offensive rebounds + turnovers + 0.44 x FTA
        const poss = cs('offensive', 'avgFieldGoalsAttempted') - cs('offensive', 'avgOffensiveRebounds') + cs('offensive', 'avgTurnovers') + 0.44 * cs('offensive', 'avgFreeThrowsAttempted');
        if (!(poss > 0)) return null;
        if (name === 'pace') return poss;
        if (name === 'offRating') return 100 * cs('offensive', 'avgPoints') / poss;
        return 100 * (g.reduce((a, x) => a + x.them, 0) / gp) / poss;
      }
      if (name === 'yardsPerPlay') { const y = cs('rushing', 'totalYards'), n = cs('rushing', 'totalOffensivePlays'); return n ? y / n : null; }
      if (name === 'possessionTime') { const sec = cs('miscellaneous', 'possessionTimeSeconds'), n = cs('passing', 'teamGamesPlayed'); if (!n) return null;
        const per = sec / n; return [per, `${Math.floor(per / 60)}:${String(Math.round(per % 60)).padStart(2, '0')}`]; }
      if (name === 'oneRunGames') { const o = g.filter((x) => Math.abs(x.us - x.them) === 1), w = o.filter((x) => x.res === 'W').length;
        return o.length ? [w / o.length, `${w}-${o.length - w}`] : null; }
      if (name === 'cleanSheets') return g.filter((x) => x.them === 0).length;
      if (name === 'failedToScore') return g.filter((x) => x.us === 0).length;
      if (name === 'goalsPerGame') return g.reduce((a, x) => a + x.us, 0) / gp;
      if (name === 'goalsAgainstPerGame') return g.reduce((a, x) => a + x.them, 0) / gp;
      if (name === 'pointsPerMatch') return g.reduce((a, x) => a + pts3(x), 0) / gp;
      if (name === 'homePointsPerMatch' || name === 'awayPointsPerMatch') {
        const h = g.filter((x) => x.home === (name === 'homePointsPerMatch')); return h.length ? h.reduce((a, x) => a + pts3(x), 0) / h.length : null; }
      return null;
    }
    if (src === 'match') {
      const m = match[t.id]; if (!m?.n) return null;
      return { possessionPct: m.poss / m.n, shotsPerMatch: m.shots / m.n, onTargetPerMatch: m.onT / m.n, shotsAllowedPerMatch: m.shotsA / m.n,
        conversionPct: m.shots ? 100 * m.goals / m.shots : null }[name] ?? null;
    }
    if (src === 'standings') return sv(s, name);
    return cs(src, name);
  };
  const statTable = cfg.stats.map((def) => teams.map((_, i) => statOf(i, def)));
  const fmtStat = (v, [name]) => {
    if (Array.isArray(v)) return v[1];
    if (/^(avg|OPS|onBasePct|slugAvg|opponentAvg)$/.test(name)) return v.toFixed(3).replace(/^0/, '');
    if (/Pct$|^threePoint|^freeThrow/.test(name)) return v > 1 ? v.toFixed(1) : (v * 100).toFixed(1);
    if (/^(ERA|WHIP|strikeoutsPerNineInnings|assistTurnoverRatio)$/.test(name)) return v.toFixed(2);
    if (Number.isInteger(v) && !/^avg|PerGame|PerMatch|PerPlay|^pace|Rating$/.test(name)) return (v > 0 && /ifferential/.test(name) ? '+' : '') + v;
    return (v > 0 && /ifferential/.test(name) ? '+' : '') + v.toFixed(1);
  };
  const rankVal = (v) => (Array.isArray(v) ? v[0] : v);

  // ---------- leaders (named players) ----------
  // a category key can name ESPN's team and league spellings at once: "3PointMadePerGame|3PointsMadePerGame"
  const catFind = (cats, key) => { const ks = key.split('|'); return cats?.find((c) => ks.includes(c.name)); };
  const year0 = per[0].seasonYear, coreLeague = `${COREAPI}/${cfg.espn.replace('/', '/leagues/')}/seasons/${year0}/types/${cfg.sport === 'soccer' ? 1 : 2}`;
  const leagueLead = await get(`${coreLeague}/leaders?limit=${cfg.sport === 'soccer' ? 200 : 5}`, { optional: true });
  const leaderData = await pool(teams, 6, async (t, i) => {
    const people = new Map();
    const addPeople = (list) => { for (const a of list || []) {
      if (a.items) { addPeople(a.items); continue; }
      people.set(a.id, { name: a.displayName, short: a.shortName, jersey: a.jersey, pos: a.position?.abbreviation, face: a.headshot?.href });
    } };
    addPeople(per[i].roster?.athletes);
    let cats;
    if (cfg.sport === 'soccer') cats = (leagueLead?.categories || []).map((c) => ({ name: c.name, leaders: c.leaders.filter((l) => teamIdFromRef(l.team?.$ref) === t.id) }));
    else cats = (await get(`${COREAPI}/${cfg.espn.replace('/', '/leagues/')}/seasons/${per[i].seasonYear}/types/2/teams/${t.id}/leaders`, { optional: true }))?.categories || [];
    return { people, cats };
  });
  // league leaders: the top 5 in the first categories of the list
  const leagueCats = cfg.leaders.slice(0, 6).map(([k, label, sub]) => {
    const c = catFind(leagueLead?.categories, k);
    return { key: k.split('|')[0], label, sub, rows: (c?.leaders || []).slice(0, 5) };
  });
  const missing = new Map();
  const want = (l, ld) => { const id = athleteId(l.athlete?.$ref); if (id && !ld?.people.has(id)) missing.set(id, l.athlete.$ref); };
  for (const ld of leaderData) for (const [k] of cfg.leaders) { const l = catFind(ld.cats, k)?.leaders?.[0]; if (l) want(l, ld); }
  for (const c of leagueCats) for (const l of c.rows) want(l, null);
  const extra = new Map((await pool([...missing], 6, async ([id, ref]) => {
    const a = await get(ref.replace('http:', 'https:'), { optional: true });
    return [id, a && { name: a.displayName, short: a.shortName, jersey: a.jersey, pos: a.position?.abbreviation, face: a.headshot?.href, teamId: teamIdFromRef(a.team?.$ref) }];
  })).filter(([, a]) => a));

  // ---------- playoff line through the season ----------
  const hist = lineHistory(cfg, teams, games);

  // ---------- standings for the whole league ----------
  const outDir = path.join(SITE, key);
  await rm(outDir, { recursive: true, force: true });   // team folders too, so renamed teams don't leave old ones
  await mkdir(path.join(outDir, 'data'), { recursive: true });
  const standRows = (t) => {
    const s = sById[t.id];
    return { id: t.id, abbr: t.abbr, logo: t.logo, cols: cfg.standings.cols.map(([, k]) => sd(s, k)),
      seed: num(sd(s, 'playoffSeed')) ?? num(sd(s, 'rank')), clinch: sd(s, 'clincher') || null,
      w: sv(s, 'wins'), l: sv(s, 'losses'), t: sv(s, 'ties') ?? 0, pts: sv(s, 'points'), pct: sv(s, 'winPercent'), gp: sv(s, 'gamesPlayed') };
  };
  const m = (r) => cfg.draws ? r.pts : (r.w - r.l);
  const conferences = [...new Set(teams.map((t) => t.conference))].map((conf) => {
    const ct = teams.filter((x) => x.conference === conf);
    const pic = ct.map(standRows).sort((a, b) => (a.seed ?? 99) - (b.seed ?? 99));
    // each seed's distance from the line: inside, ahead of the first team out; outside, behind the last team in
    const N = cfg.picture.lineSeed, firstOut = pic[N], lastIn = pic[N - 1];
    for (const [k, r] of pic.entries()) {
      const ref = k < N ? firstOut : lastIn;
      r.edge = ref ? (cfg.draws ? 1 : 0.5) * (m(r) - m(ref)) : null;
      // a division leader stays in by keeping the division or by the wild-card margin, whichever is bigger
      if (cfg.picture.divWinners && k < N) {
        const mates = pic.filter((x) => tById[x.id].division === tById[r.id].division);
        const [top, next] = [...mates].sort((x, y) => (y.pct ?? 0) - (x.pct ?? 0) || m(y) - m(x));
        if (top === r && next) r.edge = Math.max(r.edge ?? -Infinity, 0.5 * (m(r) - m(next)));
      }
    }
    const byId = Object.fromEntries(pic.map((r) => [r.id, r]));
    const divisions = [...new Set(ct.map((x) => x.division))].map((dv) => ({ name: dv,
      rows: ct.filter((x) => x.division === dv).map((x) => byId[x.id]).sort((a, b) => cfg.draws ? (b.pts - a.pts) : ((b.pct ?? 0) - (a.pct ?? 0)) || (a.seed ?? 99) - (b.seed ?? 99)) }));
    return { name: conf, short: ct[0].confShort, divisions, picture: pic };
  });
  // power ranking, as on Rinkside: strength = half win % (points per match in MLS), half margin per game, each
  // standardized across the league, on a 50-is-average scale (one standard deviation = 10)
  const lum = (hex) => { const c = (hex || '#000').replace('#', '').padEnd(6, '0').match(/../g).map((x) => parseInt(x, 16) / 255)
    .map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)); return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]; };
  // a bar color that shows on black: the team color, else its alternate, else gray
  const nearWhite = (hex) => (hex || '').replace('#', '').match(/../g)?.every((x) => parseInt(x, 16) > 215);
  const lighten = (hex, k) => '#' + hex.replace('#', '').match(/../g).map((x) => Math.round(parseInt(x, 16) + (255 - parseInt(x, 16)) * k).toString(16).padStart(2, '0')).join('');
  // a bar color that shows on black: the team color (lightened if it is very dark); white teams use their alternate
  const barColor = (t) => {
    const c = nearWhite(t.color) && !nearWhite(t.alt) ? t.alt : t.color;
    if (nearWhite(c)) return '#8a8a8a';
    let out = c; for (let k = 0; lum(out) < 0.06 && k < 6; k++) out = lighten(c, 0.12 * (k + 1));
    return out;
  };
  const rowsP = teams.map((t) => {
    const f = games[t.id].filter((g) => g.state === 'final'), n = f.length || 1;
    const s = sById[t.id];
    const winPct = cfg.draws ? f.reduce((a, g) => a + pts3(g), 0) / n / 3 : f.reduce((a, g) => a + (g.res === 'W' ? 1 : g.res === 'T' ? 0.5 : 0), 0) / n;
    return { abbr: t.abbr, logo: t.logo, color: barColor(t), conf: t.confShort, winPct,
      margin: Math.round(10 * f.reduce((a, g) => a + g.us - g.them, 0) / n) / 10,
      rec: cfg.draws ? `${sv(s, 'wins')}-${sv(s, 'ties')}-${sv(s, 'losses')}` : splitRec(f),
      form: f.slice(-10).map((g) => g.res).join('') };
  });
  const zf = (vals) => { const mu = vals.reduce((a, b) => a + b, 0) / vals.length; const sd = Math.sqrt(vals.reduce((a, b) => a + (b - mu) ** 2, 0) / vals.length) || 1; return (v) => (v - mu) / sd; };
  const zW = zf(rowsP.map((r) => r.winPct)), zM = zf(rowsP.map((r) => r.margin));
  const power = rowsP.map((r) => ({ ...r, strength: Math.round(10 * (50 + 10 * (0.5 * zW(r.winPct) + 0.5 * zM(r.margin)))) / 10 }))
    .sort((a, b) => b.strength - a.strength);

  // "good" teams for the header's record against them
  const ppm = (id) => { const s = sById[id]; const gp = sv(s, 'gamesPlayed') || (sv(s, 'wins') + sv(s, 'losses') + (sv(s, 'ties') || 0)); return gp ? sv(s, 'points') / gp : 0; };
  const medPpm = cfg.draws ? teams.map((x) => ppm(x.id)).sort((a, b) => a - b)[Math.floor(teams.length / 2)] : 0;
  const good = new Set(teams.filter((x) => cfg.draws ? ppm(x.id) >= medPpm : (sv(sById[x.id], 'winPercent') ?? 0) >= 0.5).map((x) => x.id));
  const cfgOut = { brand: cfg.brand, league: cfg.league, espn: cfg.espn, sport: cfg.sport, draws: !!cfg.draws, ...cfg.words, ...cfg.chart,
    lineSeed: cfg.picture.lineSeed, lineName: cfg.picture.lineName, cuts: cfg.picture.cuts, note: cfg.picture.note,
    goodLabel: cfg.draws ? 'top-half clubs' : '.500+ teams',
    standCols: cfg.standings.cols.map(([h]) => h),
    stats: cfg.stats.map(([k, label]) => [k, label]), boxes: cfg.boxes,
    leaders: cfg.leaders.map(([k, label]) => [k.split('|')[0], label]), leaderRows: cfg.leaderRows,
    domain: cfg.domain || null,
    leagues: [{ key: 'nhl', brand: 'Rinkside', league: 'NHL', domain: HOCKEY?.domain || null }, ...Object.entries(LEAGUES).map(([k, l]) => ({ key: k, brand: l.brand, league: l.league, domain: l.domain || null }))] };
  // the number itself: ESPN's league leaders sometimes give a whole stat line ("135-581, 45 HR, ...") as the display value
  const shortVal = (l, k = '') => {
    const d = String(l.displayValue ?? ''); if (cfg.sport !== 'soccer' && d && d.length <= 7) return d;
    const v = l.value; if (v == null) return d;
    return Number.isInteger(v) ? v.toLocaleString('en-US') : v < 1 || /^(avg|OPS|onBasePct|slugAvg)$/.test(k) ? v.toFixed(3).replace(/^0/, '') : v.toFixed(2);
  };
  const person = (l, ld) => { const id = athleteId(l.athlete?.$ref); return ld?.people.get(id) || extra.get(id) || {}; };
  const leagueIndex = { key, brand: cfg.brand, league: cfg.league, sport: cfg.sport, defaultTeam: cfg.defaultTeam,
    updated: new Date().toISOString(), season: per[0].seasonName, cfg: cfgOut,
    teams: teams.map((t) => ({ abbr: t.abbr, id: t.id, name: t.name, short: t.short, slug: t.slug, aliases: t.aliases, logo: t.logo, color: t.color,
      conference: t.conference, confShort: t.confShort, division: t.division })),
    conferences, power,
    leaders: leagueCats.map((c) => ({ key: c.key, label: c.label, rows: c.rows.map((l) => {
      const p = person(l, null), tid = teamIdFromRef(l.team?.$ref) || p.teamId;
      return { name: p.name || '?', short: p.short || p.name || '?', pos: p.pos, face: p.face, team: tById[tid]?.abbr || '', teamLogo: tById[tid]?.logo || null,
        value: shortVal(l, c.key) };
    }) })) };
  await writeFile(path.join(outDir, 'data', 'league.json'), JSON.stringify(leagueIndex));

  for (const [i, t] of teams.entries()) {
    const s = sById[t.id];
    const ld = leaderData[i];
    // every leader category (the board shows three; Customize picks which)
    const leaders = cfg.leaders.map(([cat, label, subCat]) => {
      const l = catFind(ld.cats, cat)?.leaders?.[0];
      if (!l) return null;
      const p = person(l, ld), id = athleteId(l.athlete?.$ref);
      const sub = subCat ? catFind(ld.cats, subCat)?.leaders?.find((x) => athleteId(x.athlete?.$ref) === id)?.displayValue : null;
      const value = shortVal(l, cat);
      return { key: cat.split('|')[0], label, value, name: p.name || '?', short: p.short || p.name, jersey: p.jersey, pos: p.pos, face: p.face, sub };
    }).filter(Boolean);
    // every stat in the list, ranked (the board shows eight; Customize picks which)
    const stats = cfg.stats.map((def, k) => {
      const raw = statTable[k][i]; if (raw == null) return null;
      const v = rankVal(raw), lower = def[3];
      const others = statTable[k].filter((x) => x != null).map(rankVal);
      const rank = 1 + others.filter((x) => lower ? x < v : x > v).length;
      return { key: def[0], label: def[1], value: fmtStat(raw, def), rank, of: others.length };
    }).filter(Boolean);
    const data = {
      league: key, brand: cfg.brand, sport: cfg.sport, leagueName: cfg.league, season: per[i].seasonName, updated: leagueIndex.updated,
      team: { id: t.id, abbr: t.abbr, name: t.name, short: t.short, nick: t.nick, slug: t.slug, color: t.color, alt: t.alt, logo: t.logo, altLogo: t.altLogo || t.logo,
        conference: t.conference, confShort: t.confShort, division: t.division, divShort: t.divShort },
      record: { w: sv(s, 'wins'), l: sv(s, 'losses'), t: sv(s, 'ties') ?? 0, pts: sv(s, 'points'), pct: sd(s, 'winPercent'),
        home: sd(s, 'home') || sd(s, 'Home') || splitRec(games[t.id].filter((g) => g.home)), road: sd(s, 'road') || sd(s, 'Road') || splitRec(games[t.id].filter((g) => !g.home)),
        last10: sd(s, 'lasttengames') || sd(s, 'Last Ten Games') || splitRec(games[t.id].filter((g) => g.state === 'final').slice(-10)),
        streak: sd(s, 'streak'), gb: sd(s, 'gamesBehind'), seed: num(sd(s, 'playoffSeed')) ?? num(sd(s, 'rank')), clinch: sd(s, 'clincher') || null,
        pf: sv(s, 'pointsFor'), pa: sv(s, 'pointsAgainst'),
        vsGood: splitRec(games[t.id].filter((g) => good.has(g.oppId))) },
      cfg: cfgOut,
      line: hist[t.id],
      games: games[t.id].map((g) => ({ ...g, oppLogo: tById[g.oppId]?.logo || null })),
      post: per[i].post.map((g) => ({ ...g, oppLogo: tById[g.oppId]?.logo || null })),
      nextSeason: per[i].nextSeason && { name: per[i].nextSeason.name, games: per[i].nextSeason.games.map((g) => ({ ...g, oppLogo: tById[g.oppId]?.logo || null })) },
      stats, leaders,
    };
    await writeFile(path.join(outDir, 'data', `${t.abbr}.json`), JSON.stringify(data));
  }

  // pages: site/<league>/index.html (default team) and site/<league>/<slug>/index.html
  const page = (depth, team, script = 'board') => PAGE.replaceAll('{{BASE}}', '../'.repeat(depth)).replaceAll('{{LEAGUE}}', key)
    .replaceAll('{{TEAM}}', team || '').replaceAll('{{BRAND}}', cfg.brand).replaceAll('{{SCRIPT}}', script).replaceAll('{{ICON}}', cfg.brand.toLowerCase());
  await writeFile(path.join(outDir, 'index.html'), page(1, ''));
  await mkdir(path.join(outDir, 'league'), { recursive: true });   // the whole league: /nba/league/
  await writeFile(path.join(outDir, 'league', 'index.html'), page(2, '', 'league').replace('data-team=""', 'data-team="" data-page="league"'));
  for (const t of teams) for (const name of [t.slug, ...t.aliases]) {
    await mkdir(path.join(outDir, name), { recursive: true });
    await writeFile(path.join(outDir, name, 'index.html'), page(2, t.abbr));
  }
  built.push({ key, cfg, teams });
  console.log(`${cfg.brand} (${cfg.league}): ${teams.length} teams, season ${per[0].seasonName}, ${((Date.now() - t0) / 1000).toFixed(0)} s`);
}

const PAGE = `<!doctype html>
<html lang="en">
<head>
  <base href="{{BASE}}">
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
  <meta name="theme-color" content="#000000">
  <meta name="apple-mobile-web-app-capable" content="yes">
  <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
  <title>{{BRAND}}</title>
  <link rel="icon" href="brand/{{ICON}}.svg" type="image/svg+xml">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@500;600;700&family=Barlow+Semi+Condensed:wght@400;500;600;700&display=swap" rel="stylesheet">
  <link rel="preload" href="fonts/RinksideMono.woff2" as="font" type="font/woff2" crossorigin>
  <link rel="stylesheet" href="style.css">
  <link rel="stylesheet" href="sports/board.css">
</head>
<body data-league="{{LEAGUE}}" data-team="{{TEAM}}">
  <div id="stage">
    <div id="remix" aria-hidden="true"></div>
    <main id="board" aria-live="polite"></main>
  </div>
  <svg width="0" height="0" style="position:absolute" aria-hidden="true">
    <symbol id="i-home" viewBox="0 0 24 24"><path d="M3.5 21.5V9.8L12 3l8.5 6.8v11.7h-6.1v-7h-4.8v7z"/></symbol>
    <symbol id="i-away" viewBox="0 0 24 24"><path transform="rotate(90 12 12)" d="M21 16v-2l-8-5V3.5c0-.83-.67-1.5-1.5-1.5S10 2.67 10 3.5V9l-8 5v2l8-2.5V19l-2 1.5V22l3.5-1 3.5 1v-1.5L13 19v-5.5l8 2.5z"/></symbol>
  </svg>
  <script src="sports/common.js"></script>
  <script src="sports/{{SCRIPT}}.js"></script>
</body>
</html>
`;

const want = process.argv.slice(2).length ? process.argv.slice(2) : Object.keys(LEAGUES);
const built = [];
let failed = 0;
for (const k of want) {
  try { await buildLeague(k); } catch (e) { failed++; console.error(`${k}: ${e.stack || e}`); }
}
if (want.length === Object.keys(LEAGUES).length) await writeGuide();

// ---------- the guide: every league's address and every team's (site/guide/) ----------
// Each league is reachable two ways: its own subdomain (soccer.mattdicks.org/sounders) once the Cloudflare Worker in
// deploy/subdomains-worker.js is set up, and always under the hockey site (hockey.mattdicks.org/mls/sounders/).
async function writeGuide() {
  const esc = (x) => String(x ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
  let hockey = [];
  try { hockey = JSON.parse(await readFile(path.join(SITE, 'data', 'teams.json'), 'utf8')).teams.map((t) => ({ name: t.name, slug: t.slug, logo: t.logo, conference: t.conference + ' Conference' })); } catch {}
  const sections = [{ key: 'nhl', brand: 'Rinkside', league: 'NHL', domain: HOCKEY.domain, path: '', teams: hockey, leaguePath: 'nhl/' },
    ...built.map(({ key, cfg, teams }) => ({ key, brand: cfg.brand, league: cfg.league, domain: cfg.domain, path: `${key}/`, leaguePath: `${key}/league/`,
      teams: teams.map((t) => ({ name: t.name, slug: t.slug, logo: t.logo, conference: t.conference })) }))];
  const sec = (s) => {
    const confs = [...new Set(s.teams.map((t) => t.conference))].sort();
    const sub = s.key !== 'nhl';
    return `<section id="${s.key}"><div class="gh"><img src="brand/${s.brand.toLowerCase()}.svg" width="44" height="44" alt=""><div><h2>${esc(s.brand)} <span>${esc(s.league)}</span></h2>
      <div class="dom"><a href="https://${esc(s.domain)}/">${esc(s.domain)}</a> · whole league: <a href="${sub ? `https://${esc(s.domain)}/` : `https://${esc(s.domain)}/nhl/`}">${esc(s.domain)}${sub ? '' : '/nhl'}</a>${sub ? ` · also <a href="${esc(s.leaguePath)}">hockey.mattdicks.org/${esc(s.leaguePath)}</a>` : ''}</div></div></div>
      ${confs.map((c) => `<h3>${esc(c)}</h3><div class="gl">${s.teams.filter((t) => t.conference === c).sort((a, b) => a.name.localeCompare(b.name)).map((t) =>
        `<a href="${esc(s.path + t.slug)}/" data-sub="https://${esc(s.domain)}/${esc(t.slug)}"><img src="${esc(t.logo)}" alt="" loading="lazy"><span><b>${esc(t.name)}</b><small>${esc(s.domain)}/${esc(t.slug)}</small></span></a>`).join('')}</div>`).join('')}</section>`;
  };
  const html = `<!doctype html>
<html lang="en"><head><base href="../"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Guide · every league and team</title><link rel="icon" href="brand/rinkside.svg" type="image/svg+xml">
<link href="https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@600;700&family=Barlow+Semi+Condensed:wght@400;500;600&display=swap" rel="stylesheet">
<style>
:root { color-scheme: dark; --gold: #d4b26a; --muted: #9a9a9a; --card: #161616; }
body { margin: 0; background: #000; color: #f4f4f4; font-family: 'Barlow Semi Condensed', sans-serif; }
main { max-width: 1060px; margin: 0 auto; padding: 24px 20px 40px; }
h1 { font: 700 40px 'Barlow Condensed', sans-serif; margin: 0; }
.lead { color: #cfcfcf; margin: 6px 0 14px; font-size: 16px; line-height: 1.45; }
nav { display: flex; gap: 8px; flex-wrap: wrap; padding-bottom: 14px; border-bottom: 2px solid var(--gold); }
nav a { display: flex; align-items: center; gap: 8px; padding: 7px 12px 7px 8px; background: var(--card); border-radius: 5px; color: #f4f4f4; text-decoration: none; font: 700 16px 'Barlow Condensed', sans-serif; }
nav img { width: 26px; height: 26px; }
section { margin-top: 30px; }
.gh { display: flex; gap: 12px; align-items: center; }
.gh h2 { margin: 0; font: 700 28px 'Barlow Condensed', sans-serif; } .gh h2 span { color: var(--muted); font-size: 20px; margin-left: 4px; }
.dom { color: var(--muted); font-size: 14px; } .dom a { color: var(--gold); text-decoration: none; }
h3 { margin: 18px 0 8px; font: 600 12px 'Barlow Semi Condensed', sans-serif; letter-spacing: .12em; text-transform: uppercase; color: var(--muted); border-bottom: 1px solid #262626; padding-bottom: 5px; }
.gl { display: grid; grid-template-columns: repeat(auto-fill, minmax(230px, 1fr)); gap: 6px; }
.gl a { display: flex; align-items: center; gap: 10px; padding: 7px 9px; background: var(--card); border-radius: 4px; color: #f4f4f4; text-decoration: none; border: 1px solid transparent; }
.gl a:hover { border-color: #555; }
.gl img { width: 30px; height: 30px; object-fit: contain; flex: none; }
.gl b { display: block; font: 700 16px 'Barlow Condensed', sans-serif; } .gl small { color: var(--muted); font-size: 12.5px; }
</style></head><body><main>
<h1>Every league, every team</h1>
<p class="lead">Each league has its own address, and each team's board is the league's address plus the team's name, like <b>soccer.mattdicks.org/sounders</b> or <b>basketball.mattdicks.org/knicks</b>. A league's address on its own opens the whole league. Every board also works under hockey.mattdicks.org (for example <b>hockey.mattdicks.org/mls/sounders</b>), and abbreviations and city names work too (<b>/sea</b>, <b>/seattle</b>).</p>
<nav>${sections.map((s) => `<a href="guide/#${s.key}"><img src="brand/${s.brand.toLowerCase()}.svg" alt="">${esc(s.brand)} · ${esc(s.league)}</a>`).join('')}</nav>
${sections.map(sec).join('')}
</main>
<script>
// on a league's own subdomain, link straight to the short addresses
if (/^(basketball|football|baseball|soccer)\./.test(location.hostname)) document.querySelectorAll('a[data-sub]').forEach((a) => (a.href = a.dataset.sub));
</script></body></html>`;
  await mkdir(path.join(SITE, 'guide'), { recursive: true });
  await writeFile(path.join(SITE, 'guide', 'index.html'), html);
  console.log('Guide: site/guide/index.html');
}
if (failed === want.length) process.exit(1);
