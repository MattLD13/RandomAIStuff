// Builds the multi-sport boards (Courtside, Sideline, Dugout, Pitchside) from ESPN's public site API.
// Writes site/<league>/data/<ABBR>.json per team, site/<league>/data/league.json, and one folder per team
// (site/<league>/<nickname>/index.html) so each team has its own address. Rinkside (NHL) is built separately.
//   node scripts/build-sports.mjs            all leagues
//   node scripts/build-sports.mjs nba nfl    some leagues
import { mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SITE = path.join(ROOT, 'site');
const { leagues: LEAGUES } = JSON.parse(await readFile(path.join(ROOT, 'sports/leagues.json'), 'utf8'));
const SITEAPI = 'https://site.api.espn.com/apis/site/v2/sports';
const COREAPI = 'https://sports.core.api.espn.com/v2/sports';

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
        hist[t.id].push([d, Math.round((diff(rec[t.id]) - diff(rec[ref.id])) * half * 10) / 10]);
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
      return { id: t.id, abbr: t.abbreviation, name: t.displayName, short: t.shortDisplayName, nick: t.name, location: t.location,
        color: '#' + (t.color || '333333'), alt: '#' + (t.alternateColor || 'ffffff'),
        logo: logo(['full', 'dark']) || logo(['full', 'default']) || t.logos?.[0]?.href,   // the dark-background versions: the board is black
        conference: s.conference, confShort: s.confShort, division: s.division || s.conference, divShort: s.divShort || s.confShort };
    });
  const tById = Object.fromEntries(teams.map((t) => [t.id, t]));
  // a folder name per team: the nickname (knicks, giants, yankees); MLS clubs by their usual short name
  const used = new Set();
  for (const t of teams) {
    const cands = [cfg.sport === 'soccer' ? slugify(t.short) : slugify(t.nick), slugify(t.abbr), slugify(t.name)];
    t.slug = cands.find((c) => c && !used.has(c)); used.add(t.slug);
  }

  // per team: schedule (falls back to last season when the new one has not started), statistics, roster
  let season = null;
  const per = await pool(teams, 6, async (t) => {
    const st = cfg.sport === 'soccer' ? '' : '?seasontype=2';
    let sch = await get(`${SITEAPI}/${cfg.espn}/teams/${t.id}/schedule${st}`);
    let gs = (sch.events || []).map((e) => parseGame(e, t.id)).filter(Boolean);
    if (!gs.some((g) => g.state === 'final')) {
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
    return { post, games: gs, seasonYear: sch.requestedSeason?.year ?? sch.season?.year, seasonName: sch.requestedSeason?.displayName ?? sch.season?.displayName, stats, roster };
  });
  const games = Object.fromEntries(teams.map((t, i) => [t.id, per[i].games]));

  // ---------- team stat boxes, ranked across the league ----------
  const statOf = (i, [name, , src]) => {
    const t = teams[i], s = sById[t.id], g = per[i].games.filter((x) => x.state === 'final');
    const gp = g.length || 1;
    if (src === 'standings') return sv(s, name);
    if (src === 'derived') {
      const pf = g.reduce((a, x) => a + x.us, 0), pa = g.reduce((a, x) => a + x.them, 0);
      const pts = g.reduce((a, x) => a + (x.res === 'W' ? 3 : x.res === 'T' ? 1 : 0), 0);
      return { pointsAgainstPerGame: pa / gp, goalsPerGame: pf / gp, goalsAgainstPerGame: pa / gp, pointsPerMatch: pts / gp,
        cleanSheets: g.filter((x) => x.them === 0).length, homePointsPerMatch: (() => { const h = g.filter((x) => x.home); return h.length ? h.reduce((a, x) => a + (x.res === 'W' ? 3 : x.res === 'T' ? 1 : 0), 0) / h.length : null; })(),
        awayPointsPerMatch: (() => { const h = g.filter((x) => !x.home); return h.length ? h.reduce((a, x) => a + (x.res === 'W' ? 3 : x.res === 'T' ? 1 : 0), 0) / h.length : null; })(),
      }[name] ?? null;
    }
    const cat = per[i].stats?.results?.stats?.categories?.find((c) => c.name === src);
    return cat?.stats.find((x) => x.name === name)?.value ?? null;
  };
  const statTable = cfg.stats.map((def) => teams.map((_, i) => statOf(i, def)));
  const fmtStat = (v, [name]) => {
    if (v == null) return '–';
    if (/Pct$|^fieldGoalPct|^threePoint|^freeThrow/.test(name)) return v > 1 ? v.toFixed(1) : (v * 100).toFixed(1);
    if (/^(avg|OPS|fieldingPct)$/.test(name)) return v.toFixed(3).replace(/^0/, '');
    if (/^(ERA|WHIP|strikeoutsPerNineInnings)$/.test(name)) return v.toFixed(2);
    if (Number.isInteger(v) && !/^avg|PerGame|PerMatch/.test(name)) return (v > 0 && /ifferential|Differential/.test(name) ? '+' : '') + v;
    return (v > 0 && /ifferential|Differential/.test(name) ? '+' : '') + v.toFixed(1);
  };

  // ---------- leaders (named players) ----------
  const leaderData = await pool(teams, 6, async (t, i) => {
    const year = per[i].seasonYear;
    const people = new Map();
    const addPeople = (list) => { for (const a of list || []) {
      if (a.items) { addPeople(a.items); continue; }
      people.set(a.id, { name: a.displayName, short: a.shortName, jersey: a.jersey, pos: a.position?.abbreviation, face: a.headshot?.href });
    } };
    addPeople(per[i].roster?.athletes);
    let cats = [];
    if (cfg.sport === 'soccer') cats = null;  // filled from the league leaders below
    else {
      const d = await get(`${COREAPI}/${cfg.espn.replace('/', '/leagues/')}/seasons/${year}/types/2/teams/${t.id}/leaders`, { optional: true });
      cats = d?.categories || [];
    }
    return { people, cats };
  });
  if (cfg.sport === 'soccer') {
    const year = per[0].seasonYear;
    const d = await get(`${COREAPI}/${cfg.espn.replace('/', '/leagues/')}/seasons/${year}/types/1/leaders?limit=200`, { optional: true });
    for (const [i, t] of teams.entries()) {
      leaderData[i].cats = (d?.categories || []).map((c) => ({ name: c.name, leaders: c.leaders.filter((l) => teamIdFromRef(l.team?.$ref) === t.id) }));
    }
  }
  const missing = new Map();
  for (const ld of leaderData) for (const c of ld.cats) for (const l of c.leaders.slice(0, 1)) {
    const id = athleteId(l.athlete?.$ref);
    if (id && !ld.people.has(id)) missing.set(id, l.athlete.$ref);
  }
  const extra = new Map((await pool([...missing], 6, async ([id, ref]) => {
    const a = await get(ref.replace('http:', 'https:'), { optional: true });
    return [id, a && { name: a.displayName, short: a.shortName, jersey: a.jersey, pos: a.position?.abbreviation, face: a.headshot?.href }];
  })).filter(([, a]) => a));

  // ---------- playoff line through the season ----------
  const hist = lineHistory(cfg, teams, games);

  // ---------- write ----------
  const outDir = path.join(SITE, key);
  await rm(path.join(outDir, 'data'), { recursive: true, force: true });
  await mkdir(path.join(outDir, 'data'), { recursive: true });
  const standRows = (t) => {
    const s = sById[t.id];
    return { id: t.id, abbr: t.abbr, logo: t.logo, cols: cfg.standings.cols.map(([, k]) => sd(s, k)),
      seed: num(sd(s, 'playoffSeed')) ?? num(sd(s, 'rank')), clinch: sd(s, 'clincher') || null,
      w: sv(s, 'wins'), l: sv(s, 'losses'), t: sv(s, 'ties') ?? 0, pts: sv(s, 'points'), pct: sv(s, 'winPercent'), gp: sv(s, 'gamesPlayed') };
  };
  const leagueIndex = { key, brand: cfg.brand, league: cfg.league, sport: cfg.sport, defaultTeam: cfg.defaultTeam,
    updated: new Date().toISOString(), season: per[0].seasonName,
    teams: teams.map((t) => ({ abbr: t.abbr, name: t.name, slug: t.slug, logo: t.logo, color: t.color, conference: t.conference, confShort: t.confShort, division: t.division })) };
  await writeFile(path.join(outDir, 'data', 'league.json'), JSON.stringify(leagueIndex));

  for (const [i, t] of teams.entries()) {
    const s = sById[t.id];
    const confTeams = teams.filter((x) => x.conference === t.conference);
    const divisions = [t.division, ...new Set(confTeams.map((x) => x.division).filter((x) => x !== t.division))].map((dv) => ({
      name: dv, short: confTeams.find((x) => x.division === dv).divShort,
      rows: confTeams.filter((x) => x.division === dv).map(standRows)
        .sort((a, b) => (a.seed ?? 99) - (b.seed ?? 99)).sort((a, b) => cfg.draws ? (b.pts - a.pts) : ((b.pct ?? 0) - (a.pct ?? 0))),
    }));
    const pic = confTeams.map(standRows).sort((a, b) => (a.seed ?? 99) - (b.seed ?? 99));
    const ld = leaderData[i];
    const leaders = cfg.leaders.map(([cat, label, subCat]) => {
      const c = ld.cats.find((x) => x.name === cat); const l = c?.leaders?.[0];
      if (!l) return null;
      const id = athleteId(l.athlete?.$ref); const p = ld.people.get(id) || extra.get(id) || {};
      const sub = subCat ? ld.cats.find((x) => x.name === subCat)?.leaders?.find((x) => athleteId(x.athlete?.$ref) === id)?.displayValue : null;
      const value = cfg.sport === 'soccer' ? String(l.value) : l.displayValue;
      return { label, value, name: p.name || '?', short: p.short || p.name, jersey: p.jersey, pos: p.pos, face: p.face, sub };
    }).filter(Boolean);
    const stats = cfg.stats.map((def, k) => {
      const v = statTable[k][i]; if (v == null) return null;
      const lower = def[3];
      const others = statTable[k].filter((x) => x != null);
      const rank = 1 + others.filter((x) => lower ? x < v : x > v).length;
      return { key: def[0], label: def[1], value: fmtStat(v, def), rank, of: others.length };
    }).filter(Boolean);
    const data = {
      league: key, brand: cfg.brand, sport: cfg.sport, leagueName: cfg.league, season: per[i].seasonName, updated: leagueIndex.updated,
      team: { id: t.id, abbr: t.abbr, name: t.name, short: t.short, nick: t.nick, slug: t.slug, color: t.color, alt: t.alt, logo: t.logo,
        conference: t.conference, confShort: t.confShort, division: t.division, divShort: t.divShort },
      record: { w: sv(s, 'wins'), l: sv(s, 'losses'), t: sv(s, 'ties') ?? 0, pts: sv(s, 'points'), pct: sd(s, 'winPercent'),
        home: sd(s, 'home') || sd(s, 'Home') || splitRec(games[t.id].filter((g) => g.home)), road: sd(s, 'road') || sd(s, 'Road') || splitRec(games[t.id].filter((g) => !g.home)),
        last10: sd(s, 'lasttengames') || sd(s, 'Last Ten Games') || splitRec(games[t.id].filter((g) => g.state === 'final').slice(-10)),
        streak: sd(s, 'streak'), gb: sd(s, 'gamesBehind'), seed: num(sd(s, 'playoffSeed')) ?? num(sd(s, 'rank')), clinch: sd(s, 'clincher') || null,
        pf: sv(s, 'pointsFor'), pa: sv(s, 'pointsAgainst') },
      standCols: cfg.standings.cols.map(([h]) => h),
      divisions, picture: pic, line: hist[t.id],
      games: games[t.id].map((g) => ({ ...g, oppLogo: tById[g.oppId]?.logo || null })),
      post: per[i].post.map((g) => ({ ...g, oppLogo: tById[g.oppId]?.logo || null })),
      stats, leaders,
    };
    await writeFile(path.join(outDir, 'data', `${t.abbr}.json`), JSON.stringify(data));
  }

  // pages: site/<league>/index.html (default team) and site/<league>/<slug>/index.html
  const page = (depth, team) => PAGE.replaceAll('{{BASE}}', '../'.repeat(depth)).replaceAll('{{LEAGUE}}', key)
    .replaceAll('{{TEAM}}', team || '').replaceAll('{{BRAND}}', cfg.brand).replaceAll('{{ACCENT}}', cfg.accent);
  await writeFile(path.join(outDir, 'index.html'), page(1, ''));
  for (const t of teams) {
    await mkdir(path.join(outDir, t.slug), { recursive: true });
    await writeFile(path.join(outDir, t.slug, 'index.html'), page(2, t.abbr));
  }
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
  <link rel="icon" href="data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 32 32%22%3E%3Crect width=%2232%22 height=%2232%22 rx=%226%22 fill=%22%23000%22/%3E%3Crect x=%225%22 y=%2218%22 width=%225%22 height=%229%22 fill=%22{{ACCENT}}%22/%3E%3Crect x=%2213%22 y=%2210%22 width=%225%22 height=%2217%22 fill=%22{{ACCENT}}%22/%3E%3Crect x=%2221%22 y=%2214%22 width=%225%22 height=%2213%22 fill=%22%23d3233a%22/%3E%3C/svg%3E">
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
  <script src="sports/board.js"></script>
</body>
</html>
`;

const want = process.argv.slice(2).length ? process.argv.slice(2) : Object.keys(LEAGUES);
let failed = 0;
for (const k of want) {
  try { await buildLeague(k); } catch (e) { failed++; console.error(`${k}: ${e.stack || e}`); }
}
if (failed === want.length) process.exit(1);
