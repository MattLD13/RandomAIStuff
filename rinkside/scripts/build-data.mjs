#!/usr/bin/env node
// Builds site/data/<TEAM>.json for every NHL team (plus site/data/teams.json) from the public NHL APIs.
// Run: node scripts/build-data.mjs   (TEAMS=NYR,BOS limits the build; DEFAULT_TEAM overrides config.json)
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const config = JSON.parse(await readFile(join(ROOT, 'config.json'), 'utf8'));
const DEFAULT_TEAM = (process.env.DEFAULT_TEAM || config.defaultTeam).toUpperCase();
const TZ = 'America/New_York';
const WEB = 'https://api-web.nhle.com/v1';
const STATS = 'https://api.nhle.com/stats/rest/en';

async function get(url, tries = 4) {
  for (let i = 1; ; i++) {
    try {
      const res = await fetch(url, { headers: { 'user-agent': 'rinkside' } });
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
      return await res.json();
    } catch (err) {
      if (i >= tries) throw new Error(`GET ${url} failed: ${err.message}`);
      await new Promise((r) => setTimeout(r, 1000 * 2 ** i));
    }
  }
}

// ---------- helpers ----------
const isFinal = (g) => g.gameState === 'FINAL' || g.gameState === 'OFF';
const ordinal = (n) => {
  const s = ['th', 'st', 'nd', 'rd'], v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
};
const plural = (n, word) => `${n} ${word}${Math.abs(n) === 1 ? '' : 's'}`;
const fmt = (date, opts) => new Intl.DateTimeFormat('en-US', { timeZone: TZ, ...opts }).format(date);
const initialName = (p) => `${p.firstName.default[0]}. ${p.lastName.default}`;

function perspective(g, abbrev) {
  const home = g.homeTeam.abbrev === abbrev;
  const us = home ? g.homeTeam : g.awayTeam;
  const them = home ? g.awayTeam : g.homeTeam;
  let result = null;
  if (isFinal(g)) {
    const last = g.gameOutcome?.lastPeriodType || g.periodDescriptor?.periodType || 'REG';
    if (us.score > them.score) result = 'W';
    else result = last === 'OT' || last === 'SO' ? 'O' : 'L';
  }
  return { home, us, them, opp: them.abbrev, result, last: g.gameOutcome?.lastPeriodType };
}

// ---------- shared fetch (once for the whole league) ----------
const standingsRes = await get(`${WEB}/standings/now`);
const standings = standingsRes.standings;
const season = standings[0].seasonId;

const teamInfo = Object.fromEntries(
  standings.map((t) => [
    t.teamAbbrev.default,
    {
      abbrev: t.teamAbbrev.default,
      logo: t.teamLogoDark || t.teamLogo,
      conf: t.conferenceAbbrev,
      div: t.divisionName,
      row: t,
    },
  ]),
);

const abbrevs = Object.keys(teamInfo);
const schedules = Object.fromEntries(
  await Promise.all(
    abbrevs.map(async (a) => [a, (await get(`${WEB}/club-schedule-season/${a}/${season}`)).games]),
  ),
);
const summary = (
  await get(`${STATS}/team/summary?cayenneExp=${encodeURIComponent(`seasonId=${season} and gameTypeId=2`)}`)
).data;

const now = new Date();
const rec = (w, l, o) => `${w}-${l}-${o}`;

// Strength of remaining schedule: average current points % of remaining opponents, ranked 1 = toughest.
const ptsPct = (a) => teamInfo[a]?.row.pointPctg ?? 0.5;
const sos = abbrevs
  .map((a) => {
    const left = schedules[a].filter((g) => g.gameType === 2 && !isFinal(g));
    const opp = left.map((g) => perspective(g, a).opp).filter((o) => teamInfo[o]);
    return { a, n: opp.length, v: opp.length ? opp.reduce((s, o) => s + ptsPct(o), 0) / opp.length : 0 };
  })
  .sort((x, y) => y.v - x.v);

const allFinal = new Map();
for (const a of abbrevs)
  for (const g of schedules[a]) if (g.gameType === 2 && isFinal(g)) allFinal.set(g.id, g);
const finals = [...allFinal.values()].sort((x, y) => x.startTimeUTC.localeCompare(y.startTimeUTC));

function tableAt(dateStr) {
  const t = Object.fromEntries(abbrevs.map((a) => [a, { a, pts: 0, gp: 0, w: 0, rw: 0, row: 0 }]));
  for (const g of finals) {
    if (g.gameDate > dateStr) break;
    for (const side of [g.homeTeam.abbrev, g.awayTeam.abbrev]) {
      const r = t[side];
      if (!r) continue;
      const p = perspective(g, side);
      r.gp++;
      if (p.result === 'W') {
        r.pts += 2; r.w++;
        if (p.last === 'REG') r.rw++;
        if (p.last !== 'SO') r.row++;
      } else if (p.result === 'O') r.pts += 1;
    }
  }
  return t;
}
const tableCache = new Map();
const tableAtCached = (d) => {
  if (!tableCache.has(d)) tableCache.set(d, tableAt(d));
  return tableCache.get(d);
};
const rankSort = (x, y) =>
  y.pts - x.pts || x.gp - y.gp || y.rw - x.rw || y.row - x.row || y.w - x.w || x.a.localeCompare(y.a);

// ---------- per-team board ----------
async function buildTeam(TEAM) {
  const meRow = teamInfo[TEAM].row;
  const clubStats = await get(`${WEB}/club-stats/${TEAM}/${season}/2`);
  const mySchedule = schedules[TEAM];
  const myRegular = mySchedule.filter((g) => g.gameType === 2);
  const myId = (myRegular[0]?.homeTeam.abbrev === TEAM ? myRegular[0].homeTeam : myRegular[0]?.awayTeam)?.id;

  // ---------- header ----------
  const streak = (() => {
    const n = meRow.streakCount, c = meRow.streakCode;
    if (!n) return '';
    if (c === 'W') return n > 1 ? `won ${n} straight` : 'won last game';
    if (c === 'L') return n > 1 ? `lost ${n} straight` : 'lost last game';
    return n > 1 ? `${n} straight OT losses` : 'lost last game in OT';
  })();

  const mySos = sos.findIndex((s) => s.a === TEAM) + 1;
  const myLeft = sos.find((s) => s.a === TEAM).n;

  const header = {
    record: rec(meRow.wins, meRow.losses, meRow.otLosses),
    points: meRow.points,
    summary: [`${ordinal(meRow.divisionSequence)} in the ${meRow.divisionName}`, streak].filter(Boolean).join(', '),
    date: fmt(now, { weekday: 'long', month: 'long', day: 'numeric' }),
    splits: `Home ${rec(meRow.homeWins, meRow.homeLosses, meRow.homeOtLosses)} · Road ${rec(
      meRow.roadWins,
      meRow.roadLosses,
      meRow.roadOtLosses,
    )} · Last 10 ${rec(meRow.l10Wins, meRow.l10Losses, meRow.l10OtLosses)}`,
    schedule: myLeft ? `Schedule left: ${ordinal(mySos)}-toughest of ${abbrevs.length}` : 'Regular season complete',
  };

  // ---------- season game by game ----------
  const games = myRegular.map((g) => {
    const p = perspective(g, TEAM);
    const d = new Date(g.startTimeUTC);
    return {
      date: g.gameDate,
      month: fmt(d, { month: 'short' }),
      home: p.home,
      opp: p.opp,
      result: p.result,
      margin: p.result ? p.us.score - p.them.score : null,
    };
  });
  const played = games.filter((g) => g.result).length;

  // ---------- playoff line history (rebuild standings after each of our games) ----------
  function playoffMargin(table) {
    const conf = abbrevs.filter((a) => teamInfo[a].conf === meRow.conferenceAbbrev).map((a) => table[a]);
    const divs = [...new Set(conf.map((r) => teamInfo[r.a].div))];
    const divTop = divs.flatMap((d) => conf.filter((r) => teamInfo[r.a].div === d).sort(rankSort).slice(0, 3));
    const rest = conf.filter((r) => !divTop.includes(r)).sort(rankSort);
    const wc = rest.slice(0, 2), out = rest[2];
    const me = table[TEAM];
    const inPlayoffs = divTop.includes(me) || wc.includes(me);
    return inPlayoffs ? me.pts - (out?.pts ?? me.pts) : me.pts - wc[wc.length - 1].pts;
  }

  const lineHistory = [0];
  for (const g of games) if (g.result) lineHistory.push(playoffMargin(tableAtCached(g.date)));
  // Use the official standings for today's value (handles official tiebreakers).
  const confRows = standings.filter((t) => t.conferenceAbbrev === meRow.conferenceAbbrev);
  const officialMargin = (() => {
    const wcRow = (n) => confRows.find((t) => t.wildcardSequence === n);
    const inPO = meRow.divisionSequence <= 3 || (meRow.wildcardSequence >= 1 && meRow.wildcardSequence <= 2);
    if (inPO) return meRow.points - (wcRow(3)?.points ?? meRow.points);
    return meRow.points - (wcRow(2)?.points ?? meRow.points);
  })();
  if (played) lineHistory[lineHistory.length - 1] = officialMargin;
  const margin = played ? officialMargin : 0;
  const inPO = meRow.divisionSequence <= 3 || (meRow.wildcardSequence >= 1 && meRow.wildcardSequence <= 2);
  const playoffLine = {
    history: lineHistory,
    margin,
    label: margin > 0 ? `+${margin}` : margin < 0 ? `−${-margin}` : '0',
    text:
      margin > 0
        ? `${plural(margin, 'point')} clear of the first team out`
        : margin < 0
          ? `${plural(-margin, 'point')} behind the last playoff spot`
          : inPO
            ? 'Level on points with the first team out'
            : 'Level on points with the last playoff spot',
  };

  // ---------- division grids ----------
  const divisionOrder = ['Atlantic', 'Pacific', 'Metropolitan', 'Central'];
  const divisions = divisionOrder
    .filter((d) => standings.some((t) => t.divisionName === d))
    .map((d) => {
      const teams = standings
        .filter((t) => t.divisionName === d && t.teamAbbrev.default !== TEAM)
        .sort((x, y) => x.divisionSequence - y.divisionSequence)
        .map((t) => ({
          abbrev: t.teamAbbrev.default,
          logo: teamInfo[t.teamAbbrev.default].logo,
          games: games.filter((g) => g.opp === t.teamAbbrev.default).map((g) => ({ home: g.home, result: g.result })),
        }));
      const all = teams.flatMap((t) => t.games);
      const c = (r) => all.filter((g) => g.result === r).length;
      return { name: d, record: rec(c('W'), c('L'), c('O')), teams };
    });

  // ---------- playoff picture ----------
  const divLetter = meRow.divisionAbbrev;
  const pictureRow = (t, label) => ({
    label,
    abbrev: t.teamAbbrev.default,
    logo: teamInfo[t.teamAbbrev.default].logo,
    gp: t.gamesPlayed,
    pts: t.points,
    me: t.teamAbbrev.default === TEAM,
  });
  const divRows = standings
    .filter((t) => t.divisionName === meRow.divisionName)
    .sort((x, y) => x.divisionSequence - y.divisionSequence)
    .slice(0, 3)
    .map((t, i) => pictureRow(t, `${divLetter}${i + 1}`));
  const wcRows = [1, 2].map((n) => confRows.find((t) => t.wildcardSequence === n)).filter(Boolean)
    .map((t, i) => pictureRow(t, `WC${i + 1}`));
  let outRows = [3, 4, 5].map((n) => confRows.find((t) => t.wildcardSequence === n)).filter(Boolean)
    .map((t) => pictureRow(t, ''));
  if (![...divRows, ...wcRows, ...outRows].some((r) => r.me)) outRows = [...outRows.slice(0, 2), pictureRow(meRow, '')];

  // ---------- special teams ----------
  const rankOf = (key) => {
    const sorted = [...summary].sort((x, y) => (y[key] ?? 0) - (x[key] ?? 0));
    const i = sorted.findIndex((t) => t.teamId === myId);
    return { rank: i + 1, of: sorted.length, pct: ((sorted[i]?.[key] ?? 0) * 100).toFixed(1) };
  };
  const specialTeams = summary.length && myId
    ? { pp: rankOf('powerPlayPct'), pk: rankOf('penaltyKillPct') }
    : null;

  // ---------- leaders ----------
  const skaters = clubStats.skaters || [];
  const goalies = clubStats.goalies || [];
  const leaders = [];
  const pts = [...skaters].sort((x, y) => y.points - x.points || y.goals - x.goals)[0];
  if (pts)
    leaders.push({
      label: 'Points', name: initialName(pts), headshot: pts.headshot, value: String(pts.points),
      sub: `${plural(pts.goals, 'goal')}, ${plural(pts.assists, 'assist')}`,
    });
  const sog = [...skaters].sort((x, y) => y.shots - x.shots || y.goals - x.goals)[0];
  if (sog)
    leaders.push({
      label: 'Shots on goal', name: initialName(sog), headshot: sog.headshot, value: String(sog.shots),
      sub: `${plural(sog.goals, 'goal')}, ${((sog.shootingPctg || 0) * 100).toFixed(1)}% shooting`,
    });
  const minGp = Math.max(1, Math.round(meRow.gamesPlayed / 6));
  const sv = [...goalies].filter((g) => g.gamesPlayed >= minGp)
    .sort((x, y) => y.savePercentage - x.savePercentage)[0];
  if (sv)
    leaders.push({
      label: 'Save percentage', name: initialName(sv), headshot: sv.headshot,
      value: sv.savePercentage.toFixed(3).replace(/^0/, ''),
      sub: `${plural(sv.gamesPlayed, 'game')}, ${sv.goalsAgainstAverage.toFixed(2)} GAA`,
    });

  // ---------- next 5 / last 5 ----------
  const logoOf = (a, fallback) => teamInfo[a]?.logo || fallback;
  const nextGames = mySchedule
    .filter((g) => (g.gameType === 2 || g.gameType === 3) && !isFinal(g))
    .slice(0, 5)
    .map((g) => {
      const p = perspective(g, TEAM);
      const d = new Date(g.startTimeUTC);
      const tbd = g.gameScheduleState === 'TBD';
      const live = g.gameState === 'LIVE' || g.gameState === 'CRIT';
      return {
        dow: fmt(d, { weekday: 'short' }).toUpperCase(),
        day: fmt(d, { day: 'numeric' }),
        home: p.home,
        opp: p.opp,
        logo: logoOf(p.opp, p.them.darkLogo || p.them.logo),
        time: live
          ? `${p.us.score ?? 0}-${p.them.score ?? 0} LIVE`
          : tbd
            ? 'TBD'
            : fmt(d, { hour: 'numeric', minute: '2-digit', hour12: true }).replace(' ', '').toLowerCase(),
      };
    });
  const lastGames = mySchedule
    .filter((g) => (g.gameType === 2 || g.gameType === 3) && isFinal(g))
    .slice(-5)
    .reverse()
    .map((g) => {
      const p = perspective(g, TEAM);
      const hi = Math.max(p.us.score, p.them.score), lo = Math.min(p.us.score, p.them.score);
      return {
        opp: p.opp,
        logo: logoOf(p.opp, p.them.darkLogo || p.them.logo),
        result: p.result === 'W' ? 'W' : p.result === 'O' ? (p.last === 'SO' ? 'SO' : 'OT') : 'L',
        score: `${hi}-${lo}`,
      };
    });

  const palette = config.teams?.[TEAM] || {};
  return {
    generatedAt: now.toISOString(),
    team: {
      abbrev: TEAM,
      name: meRow.teamName.default,
      logo: palette.bandLogo === 'dark' ? meRow.teamLogoDark : meRow.teamLogo,
      primaryColor: palette.primary || '#333333',
      accentColor: palette.accent || '#888888',
    // alternate / throwback logo tiled behind the board (config.json "altLogo")
    // a bare file name is an NHL logo file; a path (alt/NYR.png) or URL is used as given
    altLogo: !palette.altLogo
      ? meRow.teamLogoDark
      : /[/:]/.test(palette.altLogo) ? palette.altLogo : `https://assets.nhle.com/logos/nhl/svg/${palette.altLogo}`,
    },
    header,
    season: { games, played, total: games.length },
    playoffLine,
    divisions,
    picture: { divisionName: meRow.divisionName, divRows, wcRows, outRows },
    specialTeams,
    leaders,
    nextGames,
    lastGames,
  };
}

// ---------- write ----------
const only = process.env.TEAMS ? process.env.TEAMS.toUpperCase().split(',') : abbrevs;
const outDir = join(ROOT, 'site', 'data');
await mkdir(outDir, { recursive: true });
const built = [];
for (const team of only) {
  if (!teamInfo[team]) throw new Error(`Unknown team ${team}`);
  const data = await buildTeam(team);
  await writeFile(join(outDir, `${team}.json`), JSON.stringify(data));
  built.push(team);
  console.log(`${team}: ${data.header.record}, ${data.season.played}/${data.season.total} played, playoff line ${data.playoffLine.label}`);
}
const teamsIndex = {
  generatedAt: now.toISOString(),
  default: teamInfo[DEFAULT_TEAM] ? DEFAULT_TEAM : built[0],
  teams: standings
    .map((t) => ({
      abbrev: t.teamAbbrev.default,
      slug: config.teams?.[t.teamAbbrev.default]?.slug || t.teamAbbrev.default.toLowerCase(),
      aliases: config.teams?.[t.teamAbbrev.default]?.aliases || [],
      name: t.teamName.default,
      logo: t.teamLogoDark || t.teamLogo,
      conference: t.conferenceName,
      division: t.divisionName,
    }))
    .filter((t) => built.includes(t.abbrev))
    .sort((a, b) => a.name.localeCompare(b.name)),
};
await writeFile(join(outDir, 'teams.json'), JSON.stringify(teamsIndex, null, 1));

// One folder per team name so hockey.mattdicks.org/rangers/ (and /nyr/, /leafs/ ...) work on plain
// static hosting. Each is the main page with <base href="../"> so it shares app.js, style.css and data/.
const page = (await readFile(join(ROOT, 'site', 'index.html'), 'utf8')).replace('<head>', '<head>\n  <base href="../">');
for (const t of teamsIndex.teams) {
  for (const name of new Set([t.slug, t.abbrev.toLowerCase(), ...t.aliases])) {
    await mkdir(join(ROOT, 'site', name), { recursive: true });
    await writeFile(join(ROOT, 'site', name, 'index.html'), page);
  }
}
console.log(`Wrote ${built.length} boards to site/data/`);
