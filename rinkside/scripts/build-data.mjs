#!/usr/bin/env node
// Builds site/data/<TEAM>.json for every NHL team (plus site/data/teams.json) from the public NHL APIs.
// Run: node scripts/build-data.mjs   (TEAMS=NYR,BOS limits the build; DEFAULT_TEAM overrides config.json)
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as chances from './chances.mjs';
import * as players from './players.mjs';
import * as odds from './odds.mjs';
import * as war from './war.mjs';

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

async function getText(url, tries = 3) {
  for (let i = 1; ; i++) {
    try {
      const res = await fetch(url, { headers: { 'user-agent': 'rinkside' } });
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
      return await res.text();
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
// ---------- scoring chances + expected goals (league-wide play-by-play) ----------
const { games: pbpGames, fetched: pbpFetched } = await chances.loadGames(finals.map((g) => g.id), get, join(ROOT, '.cache', 'shots-v3')   /* v3: team game stats (hits, faceoffs, power plays ...) */);
const allShots = [...pbpGames.values()].flatMap((g) => g.shots.filter((s) => !s.en));
const xgModel = chances.fitModel(allShots);
const xgTotals = chances.seasonTotals(pbpGames, xgModel);
{
  const xgSum = allShots.reduce((a, s) => a + chances.xg(xgModel, s), 0), gSum = allShots.reduce((a, s) => a + s.goal, 0);
  console.log(`xG model: ${pbpGames.size} games (${pbpFetched} new), ${allShots.length} shots on goal, xG ${xgSum.toFixed(1)} vs goals ${gSum}`);
}

// ---------- player ratings (league-wide percentiles) ----------
const [skNow, skLast, goNow] = await Promise.all([players.loadSkaters(get, season), players.loadSkaters(get, season - 10001), players.loadGoalies(get, season)]);
const { shooters, goalies: facedByGoalie } = players.shotTotals(pbpGames, xgModel);
const ratedNow = players.rateSkaters(skNow, shooters), ratedLast = players.rateSkaters(skLast), ratedGoalies = players.rateGoalies(goNow, facedByGoalie);
console.log(`player ratings: ${Object.keys(ratedNow).length} skaters, ${Object.keys(ratedGoalies).length} goalies (last season ${Object.keys(ratedLast).length})`);

// ---------- Box WAR (play-by-play + shift charts, see scripts/war.mjs) ----------
const warDigests = await war.loadDigests(finals.map((g) => g.id), get, getText, join(ROOT, '.cache', 'war-v2'));
const WAR = war.computeWar(warDigests.digests, xgModel);
const abbrevOfId = {};
for (const g of finals) { abbrevOfId[g.homeTeam.id] = g.homeTeam.abbrev; abbrevOfId[g.awayTeam.id] = g.awayTeam.abbrev; }
const teamGar = {};
for (const v of WAR.games.values()) for (const r of [...v.rows, ...v.goalies]) teamGar[abbrevOfId[r.t]] = (teamGar[abbrevOfId[r.t]] || 0) + r.gar;
console.log(`box WAR: ${warDigests.digests.size} games (${warDigests.fetched} new, ${warDigests.fromReport} from HTML reports, ${warDigests.missing} without shifts yet), ${WAR.gpw} goals per win`);

// ---------- team strength, win probabilities, playoff odds ----------
const xgPctByAbbrev = Object.fromEntries(abbrevs.map((a) => {
  const t = xgTotals[myIdFor(a)];
  return [a, t && t.xgf + t.xga ? (100 * t.xgf) / (t.xgf + t.xga) : 50];
}));
const strength = odds.strengths(standings, xgPctByAbbrev);
const winModel = odds.fitWinModel(finals, strength, odds.shrink(strength, standings));
const remainingGames = [...new Map(abbrevs.flatMap((a) => schedules[a]).filter((g) => g.gameType === 2 && !isFinal(g)).map((g) => [g.id, g])).values()];
const playoffOdds = odds.simulate(standings, remainingGames, winModel);
console.log(`odds: win model on ${winModel.n} games (home team wins ${(100 / (1 + Math.exp(-winModel.a))).toFixed(1)}% between equal teams, slope ${winModel.b.toFixed(2)}), ${remainingGames.length} games simulated 10,000 times`);
const winPct = (me, opp, home) => Math.round(100 * (home ? winModel.prob(me, opp) : 1 - winModel.prob(opp, me)));

const tableCache = new Map();
const tableAtCached = (d) => {
  if (!tableCache.has(d)) tableCache.set(d, tableAt(d));
  return tableCache.get(d);
};
const rankSort = (x, y) =>
  y.pts - x.pts || x.gp - y.gp || y.rw - x.rw || y.row - x.row || y.w - x.w || x.a.localeCompare(y.a);

// Background logo: a file dropped in site/alt/<TEAM>.(png|svg|webp|gif|jpg) wins; otherwise config.json
// "altLogo" (a bare name is an NHL logo file, a path or URL is used as given); otherwise the dark logo.
const altFiles = await readdir(join(ROOT, 'site', 'alt')).catch(() => []);
function altLogoFor(team, palette, row) {
  const own = altFiles.find((f) => new RegExp(`^${team}\\.(png|svg|webp|gif|jpe?g)$`, 'i').test(f));
  if (own) return `alt/${own}`;
  const v = palette.altLogo;
  if (!v) return row.teamLogoDark;
  return /[/:]/.test(v) ? v : `https://assets.nhle.com/logos/nhl/svg/${v}`;
}

// NHL team ids (EDGE endpoints are keyed by id, not abbreviation)
function myIdFor(abbrev) {
  for (const g of schedules[abbrev] || []) {
    if (g.homeTeam.abbrev === abbrev) return g.homeTeam.id;
    if (g.awayTeam.abbrev === abbrev) return g.awayTeam.id;
  }
  return 0;
}

// ---------- per-team board ----------
async function buildTeam(TEAM) {
  const meRow = teamInfo[TEAM].row;
  const clubStats = await get(`${WEB}/club-stats/${TEAM}/${season}/2`);
  // NHL EDGE tracking data (skating, shot speed, zone time). Optional: the board works without it.
  const edgeGet = (path) => get(`${WEB}/edge/${path}/${myIdFor(TEAM)}/now`, 2).catch(() => null);
  const [edgeTeam, edgeZone, edgeSpeed, edgeShot] = await Promise.all([
    edgeGet('team-detail'), edgeGet('team-zone-time-details'), edgeGet('team-skating-speed-detail'), edgeGet('team-shot-speed-detail'),
  ]);
  const mySchedule = schedules[TEAM];
  const myRegular = mySchedule.filter((g) => g.gameType === 2);
  const myId = (myRegular[0]?.homeTeam.abbrev === TEAM ? myRegular[0].homeTeam : myRegular[0]?.awayTeam)?.id;

  const logoOf = (a, fallback) => teamInfo[a]?.logo || fallback;

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
    info: {
      gf: meRow.goalFor, ga: meRow.goalAgainst, diff: meRow.goalDifferential,
      ptsPct: meRow.pointPctg.toFixed(3).replace(/^0/, ''),
      pace: Math.round(meRow.pointPctg * 2 * myRegular.length),
      rw: meRow.regulationWins, row: meRow.regulationPlusOtWins,
      leagueRank: meRow.leagueSequence, confRank: meRow.conferenceSequence,
      splits: [
        ['Home', rec(meRow.homeWins, meRow.homeLosses, meRow.homeOtLosses), meRow.homeGoalsFor, meRow.homeGoalsAgainst],
        ['Road', rec(meRow.roadWins, meRow.roadLosses, meRow.roadOtLosses), meRow.roadGoalsFor, meRow.roadGoalsAgainst],
        ['Last 10', rec(meRow.l10Wins, meRow.l10Losses, meRow.l10OtLosses), meRow.l10GoalsFor, meRow.l10GoalsAgainst],
      ],
      sos: {
        rank: mySos, of: abbrevs.length, left: myLeft,
        oppPct: (sos.find((x) => x.a === TEAM).v || 0).toFixed(3).replace(/^0/, ''),
        homeLeft: myRegular.filter((g) => !isFinal(g) && g.homeTeam.abbrev === TEAM).length,
        roadLeft: myRegular.filter((g) => !isFinal(g) && g.awayTeam.abbrev === TEAM).length,
      },
    },
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
  // Everything a game popup shows.
  const nameOf = (side) => `${side.placeName?.default ?? ''} ${side.commonName?.default ?? ''}`.trim() || side.abbrev;
  const person = (x) => (x ? `${x.firstInitial?.default ?? ''} ${x.lastName?.default ?? ''}`.trim() : null);
  const gameInfo = (g) => {
    const p = perspective(g, TEAM);
    const d = new Date(g.startTimeUTC);
    const live = g.gameState === 'LIVE' || g.gameState === 'CRIT';
    const last = g.gameOutcome?.lastPeriodType;
    return {
      date: fmt(d, { weekday: 'short', month: 'short', day: 'numeric' }),
      time: g.gameScheduleState === 'TBD' ? 'TBD' : fmt(d, { hour: 'numeric', minute: '2-digit', hour12: true }).replace(' ', '').toLowerCase() + ' ET',
      opp: nameOf(p.them),
      oppAbbrev: p.opp,
      oppLogo: logoOf(p.opp, p.them.darkLogo || p.them.logo),
      home: p.home,
      venue: g.venue?.default || '',
      status: isFinal(g) ? (last && last !== 'REG' ? `Final/${last}` : 'Final') : live ? 'Live' : g.gameScheduleState === 'PPD' ? 'Postponed' : 'Upcoming',
      us: p.us.score ?? null,
      them: p.them.score ?? null,
      result: p.result,
      tv: [...new Set((g.tvBroadcasts || []).map((b) => b.network))].join(', '),
      winPct: !isFinal(g) && g.gameType === 2 ? winPct(TEAM, p.opp, p.home) : null,
      gwg: person(g.winningGoalScorer),
      winGoalie: person(g.winningGoalie),
      link: g.gameCenterLink ? `https://www.nhl.com${g.gameCenterLink}` : null,
    };
  };

  const games = myRegular.map((g) => {
    const p = perspective(g, TEAM);
    const d = new Date(g.startTimeUTC);
    const pg = pbpGames.get(g.id);
    return {
      id: g.id,
      chances: pg && isFinal(g) ? chances.report(pg, myId, xgModel) : null,
      date: g.gameDate,
      month: fmt(d, { month: 'short' }),
      home: p.home,
      opp: p.opp,
      result: p.result,
      margin: p.result ? p.us.score - p.them.score : null,
      info: gameInfo(g),
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
          games: games.map((g, gi) => ({ g, gi })).filter(({ g }) => g.opp === t.teamAbbrev.default)
          .map(({ g, gi }) => ({ home: g.home, result: g.result, gi })),
        }));
      const all = teams.flatMap((t) => t.games);
      const c = (r) => all.filter((g) => g.result === r).length;
      return { name: d, record: rec(c('W'), c('L'), c('O')), teams };
    });

  // ---------- playoff pictures ----------
  const pictureRow = (t, label) => ({
    label,
    abbrev: t.teamAbbrev.default,
    logo: teamInfo[t.teamAbbrev.default].logo,
    gp: t.gamesPlayed,
    pts: t.points,
    me: t.teamAbbrev.default === TEAM,
  });
  function pictureFor(confAbbrev, divisionName) {
    const conf = standings.filter((t) => t.conferenceAbbrev === confAbbrev);
    const div = conf.filter((t) => t.divisionName === divisionName).sort((x, y) => x.divisionSequence - y.divisionSequence);
    const letter = div[0]?.divisionAbbrev || '';
    const divRows = div.slice(0, 3).map((t, i) => pictureRow(t, `${letter}${i + 1}`));
    const wcRows = [1, 2].map((n) => conf.find((t) => t.wildcardSequence === n)).filter(Boolean).map((t, i) => pictureRow(t, `WC${i + 1}`));
    let outRows = [3, 4, 5].map((n) => conf.find((t) => t.wildcardSequence === n)).filter(Boolean).map((t) => pictureRow(t, ''));
    const mine = conf.find((t) => t.teamAbbrev.default === TEAM);
    if (mine && ![...divRows, ...wcRows, ...outRows].some((r) => r.me)) outRows = [...outRows.slice(0, 2), pictureRow(mine, '')];
    return { conference: conf[0]?.conferenceName || confAbbrev, divisionName, divRows, wcRows, outRows };
  }
  const otherConf = standings.find((t) => t.conferenceAbbrev !== meRow.conferenceAbbrev);
  const otherLeader = standings.filter((t) => t.conferenceAbbrev !== meRow.conferenceAbbrev).sort((x, y) => x.conferenceSequence - y.conferenceSequence)[0];
  const pictures = {
    own: pictureFor(meRow.conferenceAbbrev, meRow.divisionName),
    other: otherConf ? pictureFor(otherConf.conferenceAbbrev, otherLeader.divisionName) : null,
  };

  // special teams, scoring rates and xG share for any team (summary is keyed by team id)
  function advFor(abbrev) {
    const id = myIdFor(abbrev), sm = summary.find((x) => x.teamId === id), xt = xgTotals[id];
    return sm ? {
      pp: +(sm.powerPlayPct * 100).toFixed(1), pk: +(sm.penaltyKillPct * 100).toFixed(1),
      gfpg: +sm.goalsForPerGame.toFixed(2), gapg: +sm.goalsAgainstPerGame.toFixed(2),
      sfpg: +sm.shotsForPerGame.toFixed(1), sapg: +sm.shotsAgainstPerGame.toFixed(1),
      xgPct: xt ? +((100 * xt.xgf) / (xt.xgf + xt.xga)).toFixed(1) : null,
    } : {};
  }

  // ---------- every team's standings line (tables and team popups) ----------
  const teamsOut = Object.fromEntries(standings.map((t) => [t.teamAbbrev.default, {
    name: t.teamName.default, logo: teamInfo[t.teamAbbrev.default].logo,
    conf: t.conferenceName, div: t.divisionName, divSeq: t.divisionSequence, confSeq: t.conferenceSequence,
    leagueSeq: t.leagueSequence, wcSeq: t.wildcardSequence,
    gp: t.gamesPlayed, pts: t.points, pct: t.pointPctg,
    record: rec(t.wins, t.losses, t.otLosses), rw: t.regulationWins,
    gf: t.goalFor, ga: t.goalAgainst, diff: t.goalDifferential,
    home: rec(t.homeWins, t.homeLosses, t.homeOtLosses), road: rec(t.roadWins, t.roadLosses, t.roadOtLosses),
    l10: rec(t.l10Wins, t.l10Losses, t.l10OtLosses), streak: t.streakCode ? `${t.streakCode}${t.streakCount}` : '–',
    ...advFor(t.teamAbbrev.default),
    odds: playoffOdds[t.teamAbbrev.default], strength: +strength[t.teamAbbrev.default].toFixed(2),
    color: config.teams?.[t.teamAbbrev.default]?.primary || '#555555',
  }]));

  // ---------- conference rank after each of our games ----------
  const confTeams = standings.filter((t) => t.conferenceAbbrev === meRow.conferenceAbbrev).map((t) => t.teamAbbrev.default);
  const rankHistory = [];
  for (const g of games) if (g.result) {
    const tb = tableAtCached(g.date);
    rankHistory.push(confTeams.map((a) => tb[a]).sort(rankSort).findIndex((r) => r.a === TEAM) + 1);
  }

  // ---------- division points race: points after each of our games ----------
  const raceTeams = standings.filter((t) => t.divisionName === meRow.divisionName).map((t) => t.teamAbbrev.default);
  const race = { teams: raceTeams, pts: Object.fromEntries(raceTeams.map((a) => [a, [0]])) };
  for (const g of games) if (g.result) {
    const tb = tableAtCached(g.date);
    for (const a of raceTeams) race.pts[a].push(tb[a].pts);
  }

  // ---------- special teams ----------
  const rankOf = (key) => {
    const sorted = [...summary].sort((x, y) => (y[key] ?? 0) - (x[key] ?? 0));
    const i = sorted.findIndex((t) => t.teamId === myId);
    const avg = sorted.reduce((a, t) => a + (t[key] ?? 0), 0) / (sorted.length || 1);
    const best = sorted[0];
    return {
      rank: i + 1, of: sorted.length, pct: ((sorted[i]?.[key] ?? 0) * 100).toFixed(1),
      avg: (avg * 100).toFixed(1), best: best ? `${best.teamFullName} ${((best[key] ?? 0) * 100).toFixed(1)}%` : '',
    };
  };
  const specialTeams = summary.length && myId
    ? { pp: rankOf('powerPlayPct'), pk: rankOf('penaltyKillPct') }
    : null;

  const statDefs = [
    ['pp', 'Power play', (t) => t.powerPlayPct * 100, 1, '%', true],
    ['pk', 'Penalty kill', (t) => t.penaltyKillPct * 100, 1, '%', true],
    ['gfpg', 'Goals for / game', (t) => t.goalsForPerGame, 2, '', true],
    ['gapg', 'Goals against / game', (t) => t.goalsAgainstPerGame, 2, '', false],
    ['sfpg', 'Shots for / game', (t) => t.shotsForPerGame, 1, '', true],
    ['sapg', 'Shots against / game', (t) => t.shotsAgainstPerGame, 1, '', false],
    ['fo', 'Faceoffs won', (t) => t.faceoffWinPct * 100, 1, '%', true],
    ['shpct', 'Shooting', (t) => (t.shotsForPerGame ? (t.goalsForPerGame / t.shotsForPerGame) * 100 : 0), 1, '%', true],
    ['svpct', 'Team save %', (t) => (t.shotsAgainstPerGame ? (1 - t.goalsAgainstPerGame / t.shotsAgainstPerGame) * 100 : 0), 1, '%', true],
    ['ptspct', 'Points %', (t) => t.pointPct * 100, 1, '%', true],
    ['gdpg', 'Goal diff / game', (t) => t.goalsForPerGame - t.goalsAgainstPerGame, 2, '', true],
  ];
  const stats = {};
  if (summary.length && myId) for (const [key, label, fn, dp, unit, high] of statDefs) {
    const vals = summary.map((t) => ({ id: t.teamId, name: t.teamFullName, v: fn(t) || 0 }));
    vals.sort((x, y) => (high ? y.v - x.v : x.v - y.v));
    const i = vals.findIndex((x) => x.id === myId);
    const avg = vals.reduce((a, x) => a + x.v, 0) / vals.length;
    const f = (v) => (key === 'gdpg' && v > 0 ? '+' : '') + v.toFixed(dp);
    stats[key] = { label, value: f(vals[i].v), unit, rank: i + 1, of: vals.length, avg: f(avg), best: `${vals[0].name} ${f(vals[0].v)}${unit}` };
  }
  // Expected-goals stats from the play-by-play model, ranked across the league
  const xgRank = (key, label, fn, dp, unit, signed) => {
    const vals = Object.entries(xgTotals).map(([id, t]) => ({ id: +id, v: fn(t) })).filter((x) => Number.isFinite(x.v)).sort((a, b) => b.v - a.v);
    const i = vals.findIndex((x) => x.id === myId);
    if (i < 0) return;
    const f = (v) => (signed && v > 0 ? '+' : '') + v.toFixed(dp);
    const avg = vals.reduce((a, x) => a + x.v, 0) / vals.length;
    stats[key] = { label, value: f(vals[i].v), unit, rank: i + 1, of: vals.length, avg: f(avg), xg: true };
  };
  xgRank('xgPct', 'Expected goals share', (t) => (100 * t.xgf) / (t.xgf + t.xga), 1, '%');
  xgRank('finishing', 'Finishing (goals minus xG)', (t) => t.gf - t.xgf, 1, '', true);
  xgRank('hdcPct', 'High-danger chance share', (t) => (100 * t.hcf) / (t.hcf + t.hca), 1, '%');

  // Simulation and strength stats, ranked across the league
  {
    const rankBy = (f) => abbrevs.map((a) => [a, f(a)]).sort((x, y) => y[1] - x[1]).findIndex(([a]) => a === TEAM) + 1;
    const o = playoffOdds[TEAM];
    stats.playoffOdds = { label: 'Playoff odds', value: o.playoff.toFixed(o.playoff >= 99.5 || o.playoff < 0.5 ? 0 : 1), unit: '%', rank: rankBy((a) => playoffOdds[a].playoff), of: 32, sim: true, avg: '50' };
    stats.projPts = { label: 'Projected points', value: String(o.projPts), unit: '', rank: rankBy((a) => playoffOdds[a].projPts), of: 32, sim: true, avg: '' };
    stats.cupOdds = { label: 'Stanley Cup odds', value: o.cup.toFixed(1), unit: '%', rank: rankBy((a) => playoffOdds[a].cup), of: 32, sim: true, avg: '3.1' };
    stats.divOdds = { label: 'Division title odds', value: o.division.toFixed(1), unit: '%', rank: rankBy((a) => playoffOdds[a].division), of: 32, sim: true, avg: '' };
    if (teamGar[TEAM] != null) stats.teamWar = { label: 'Team WAR (skaters + goalies)', value: (teamGar[TEAM] / WAR.gpw).toFixed(1), unit: '', rank: rankBy((a) => teamGar[a] ?? -1e9), of: 32, war: true, avg: '' };
    stats.strength = { label: 'Team strength rating', value: (strength[TEAM] > 0 ? '+' : '') + strength[TEAM].toFixed(2), unit: '', rank: rankBy((a) => strength[a]), of: 32, sim: true, avg: '0.00' };
  }

  // NHL EDGE: values arrive with their league rank and average
  const edge = (key, label, node, value, unit, dp, by) => {
    if (!node || node.rank == null || value == null) return;
    const avg = node.leagueAvg ? (node.leagueAvg.imperial ?? node.leagueAvg.value) : null;
    stats[key] = { label, value: Number(value).toFixed(dp), unit, rank: node.rank, of: 32, edge: true,
      avg: avg != null ? Number(avg).toFixed(dp) : '', by: by || '' };
  };
  const who = (o) => (o?.overlay?.player ? `${o.overlay.player.firstName.default} ${o.overlay.player.lastName.default}, ${o.overlay.gameDate}` : '');
  if (edgeTeam) {
    const sp = edgeTeam.skatingSpeed || {}, sh = edgeTeam.shotSpeed || {}, ds = edgeTeam.distanceSkated?.total;
    const loc = (c) => (edgeTeam.sogSummary || []).find((x) => x.locationCode === c);
    edge('topSpeed', 'Top skating speed', sp.speedMax, sp.speedMax?.imperial, ' mph', 1, who(sp.speedMax));
    edge('bursts20', 'Bursts over 20 mph', sp.burstsOver20, sp.burstsOver20?.value, '', 0);
    edge('bursts22', 'Bursts over 22 mph', sp.burstsOver22, sp.burstsOver22?.value, '', 0);
    edge('topShot', 'Hardest shot', sh.topShotSpeed, sh.topShotSpeed?.imperial, ' mph', 1, who(sh.topShotSpeed));
    edge('shots90', 'Shots over 90 mph', sh.shotAttemptsOver90, sh.shotAttemptsOver90?.value, '', 0);
    edge('distance', 'Distance skated', ds, ds?.imperial, ' mi', 0);
    const hi = loc('high');
    if (hi) {
      stats.hdShots = { label: 'High-danger shots', value: String(hi.shots), unit: '', rank: hi.shotsRank, of: 32, edge: true, avg: hi.shotsLeagueAvg.toFixed(0) };
      stats.hdPct = { label: 'High-danger shooting', value: (hi.shootingPctg * 100).toFixed(1), unit: '%', rank: hi.shootingPctgRank, of: 32, edge: true, avg: (hi.shootingPctgLeagueAvg * 100).toFixed(1) };
    }
  }
  const zAll = edgeZone?.zoneTimeDetails?.find((z) => z.strengthCode === 'all');
  if (zAll) {
    stats.ozTime = { label: 'Offensive-zone time', value: (zAll.offensiveZonePctg * 100).toFixed(1), unit: '%', rank: zAll.offensiveZoneRank, of: 32, edge: true, avg: (zAll.offensiveZoneLeagueAvg * 100).toFixed(1) };
    stats.dzTime = { label: 'Defensive-zone time', value: (zAll.defensiveZonePctg * 100).toFixed(1), unit: '%', rank: zAll.defensiveZoneRank, of: 32, edge: true, avg: (zAll.defensiveZoneLeagueAvg * 100).toFixed(1) };
  }
  const sd = edgeZone?.shotDifferential;
  if (sd) stats.satDiff = { label: 'Shot-attempt diff / game', value: (sd.shotAttemptDifferential > 0 ? '+' : '') + sd.shotAttemptDifferential.toFixed(1), unit: '', rank: sd.shotAttemptDifferentialRank, of: 32, edge: true, avg: '' };

  // ---------- leaders ----------
  const skaters = clubStats.skaters || [];
  const goalies = clubStats.goalies || [];
  const leaders = [];
  const toi = (sec) => `${Math.floor(sec / 60)}:${String(Math.round(sec % 60)).padStart(2, '0')}`;
  const skaterLine = (x) => [
    ['GP', x.gamesPlayed], ['G', x.goals], ['A', x.assists], ['P', x.points],
    ['+/-', x.plusMinus > 0 ? `+${x.plusMinus}` : x.plusMinus], ['Shots', x.shots],
    ['PPG', x.powerPlayGoals], ['TOI', toi(x.avgTimeOnIcePerGame || 0)],
  ];
  const pts = [...skaters].sort((x, y) => y.points - x.points || y.goals - x.goals)[0];
  if (pts)
    leaders.push({
      label: 'Points', name: initialName(pts), headshot: pts.headshot, value: String(pts.points),
      sub: `${plural(pts.goals, 'goal')}, ${plural(pts.assists, 'assist')}`,
      full: `${pts.firstName.default} ${pts.lastName.default}`, stats: skaterLine(pts),
    });
  const sog = [...skaters].sort((x, y) => y.shots - x.shots || y.goals - x.goals)[0];
  if (sog)
    leaders.push({
      label: 'Shots on goal', name: initialName(sog), headshot: sog.headshot, value: String(sog.shots),
      sub: `${plural(sog.goals, 'goal')}, ${((sog.shootingPctg || 0) * 100).toFixed(1)}% shooting`,
      full: `${sog.firstName.default} ${sog.lastName.default}`, stats: skaterLine(sog),
    });
  const minGp = Math.max(1, Math.round(meRow.gamesPlayed / 6));
  const fullName = (x) => `${x.firstName.default} ${x.lastName.default}`;
  const skaterCats = [
    ['points', 'Points', (x) => x.points, (x) => String(x.points), (x) => `${plural(x.goals, 'goal')}, ${plural(x.assists, 'assist')}`],
    ['goals', 'Goals', (x) => x.goals, (x) => String(x.goals), (x) => `${plural(x.shots, 'shot')}, ${((x.shootingPctg || 0) * 100).toFixed(1)}%`],
    ['assists', 'Assists', (x) => x.assists, (x) => String(x.assists), (x) => `${plural(x.points, 'point')} in ${x.gamesPlayed} GP`],
    ['shots', 'Shots on goal', (x) => x.shots, (x) => String(x.shots), (x) => `${plural(x.goals, 'goal')}, ${((x.shootingPctg || 0) * 100).toFixed(1)}% shooting`],
    ['plusminus', 'Plus / minus', (x) => x.plusMinus, (x) => (x.plusMinus > 0 ? `+${x.plusMinus}` : String(x.plusMinus)), (x) => `${x.gamesPlayed} games`],
    ['ppg', 'Power-play goals', (x) => x.powerPlayGoals, (x) => String(x.powerPlayGoals), (x) => `${plural(x.goals, 'goal')} total`],
    ['gwg', 'Game-winning goals', (x) => x.gameWinningGoals, (x) => String(x.gameWinningGoals), (x) => `${plural(x.goals, 'goal')} total`],
    ['toi', 'Ice time / game', (x) => x.avgTimeOnIcePerGame, (x) => toi(x.avgTimeOnIcePerGame || 0), (x) => `${x.gamesPlayed} games`],
    ['pim', 'Penalty minutes', (x) => x.penaltyMinutes, (x) => String(x.penaltyMinutes), (x) => `${x.gamesPlayed} games`],
  ];
  const leaderBoard = {};
  for (const [key, label, sortV, valueF, subF] of skaterCats) {
    const x = [...skaters].sort((a, b) => sortV(b) - sortV(a) || b.points - a.points)[0];
    if (x) leaderBoard[key] = { id: x.playerId, label, name: initialName(x), full: fullName(x), headshot: x.headshot, value: valueF(x), sub: subF(x), stats: skaterLine(x) };
  }
  const gl = (x) => [
    ['GP', x.gamesPlayed], ['Record', rec(x.wins, x.losses, x.overtimeLosses)],
    ['SV%', x.savePercentage.toFixed(3).replace(/^0/, '')], ['GAA', x.goalsAgainstAverage.toFixed(2)],
    ['Saves', `${x.saves}/${x.shotsAgainst}`], ['Shutouts', x.shutouts],
  ];
  const qualified = [...goalies].filter((g) => g.gamesPlayed >= minGp);
  const goalieCats = [
    ['svpct', 'Save percentage', qualified, (x) => x.savePercentage, (x) => x.savePercentage.toFixed(3).replace(/^0/, ''), (x) => `${plural(x.gamesPlayed, 'game')}, ${x.goalsAgainstAverage.toFixed(2)} GAA`],
    ['gaa', 'Goals against avg', qualified, (x) => -x.goalsAgainstAverage, (x) => x.goalsAgainstAverage.toFixed(2), (x) => `${plural(x.gamesPlayed, 'game')}, ${x.savePercentage.toFixed(3).replace(/^0/, '')} SV%`],
    ['wins', 'Goalie wins', goalies, (x) => x.wins, (x) => String(x.wins), (x) => `${rec(x.wins, x.losses, x.overtimeLosses)} in ${x.gamesPlayed} GP`],
    ['shutouts', 'Shutouts', goalies, (x) => x.shutouts, (x) => String(x.shutouts), (x) => `${plural(x.gamesPlayed, 'game')}, ${x.savePercentage.toFixed(3).replace(/^0/, '')} SV%`],
  ];
  // full lists for the Top scorers and Goalies panels
  const scorers = [...skaters].sort((a, b) => b.points - a.points || b.goals - a.goals).slice(0, 8).map((x) => ({
    id: x.playerId, name: initialName(x), full: fullName(x), headshot: x.headshot, pos: x.positionCode,
    gp: x.gamesPlayed, g: x.goals, a: x.assists, p: x.points, stats: skaterLine(x),
  }));
  const goalieList = [...goalies].filter((x) => x.gamesPlayed > 0).sort((a, b) => b.gamesPlayed - a.gamesPlayed).slice(0, 4).map((x) => ({
    id: x.playerId, name: initialName(x), full: fullName(x), headshot: x.headshot, gp: x.gamesPlayed, record: rec(x.wins, x.losses, x.overtimeLosses),
    sv: x.savePercentage.toFixed(3).replace(/^0/, ''), gaa: x.goalsAgainstAverage.toFixed(2), so: x.shutouts, stats: gl(x),
  }));

  // ---------- player cards ----------
  const roster = await get(`${WEB}/roster/${TEAM}/current`).catch(() => ({}));
  const bio = Object.fromEntries([...(roster.forwards || []), ...(roster.defensemen || []), ...(roster.goalies || [])].map((r) => [r.id, r]));
  const ageOf = (id) => {
    const b = bio[id]?.birthDate; if (!b) return null;
    const d = new Date(b), t = new Date(); let a = t.getUTCFullYear() - d.getUTCFullYear();
    if (t < new Date(Date.UTC(t.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()))) a--;
    return a;
  };
  // usage tier by average ice time among the team's regulars
  const usage = {};
  for (const [grp, size, word] of [[(x) => x.positionCode !== 'D', 3, 'line'], [(x) => x.positionCode === 'D', 2, 'pair']]) {
    [...skaters].filter((x) => grp(x) && x.gamesPlayed >= 3).sort((a, b) => b.avgTimeOnIcePerGame - a.avgTimeOnIcePerGame)
      .forEach((x, i) => { usage[x.playerId] = `${['1st', '2nd', '3rd', '4th'][Math.min(Math.floor(i / size), 3)]} ${word}`; });
  }
  const TILE = [['evOff', 'EV offence'], ['evDef', 'EV defence'], ['possession', 'Possession'], ['pp', 'Power play'], ['pk', 'Penalty kill'],
    ['finishing', 'Finishing'], ['goals', 'Goals'], ['primary', '1st assists'], ['penalties', 'Penalties'], ['physical', 'Physical']];
  const cards = {};
  for (const x of skaters) {
    const r = ratedNow[x.playerId], last = ratedLast[x.playerId];
    cards[x.playerId] = {
      id: x.playerId, kind: 'S', name: initialName(x), full: fullName(x), headshot: x.headshot, pos: x.positionCode,
      number: bio[x.playerId]?.sweaterNumber ?? null, age: ageOf(x.playerId), usage: usage[x.playerId] || '',
      gp: x.gamesPlayed, toi: toi(x.avgTimeOnIcePerGame || 0), qualified: !!r, group: r?.group || (x.positionCode === 'D' ? 'D' : 'F'),
      overall: r?.overall ?? null,
      tiles: TILE.map(([k, label]) => [label, r ? r[k] : null]).concat(x.positionCode === 'C' ? [['Faceoffs', r ? r.faceoffs : null]] : []),
      extra: r ? { ixg: shooters[x.playerId] ? +shooters[x.playerId].ixg.toFixed(1) : null, quality: r.quality,
        finishing: shooters[x.playerId] ? +(shooters[x.playerId].goals - shooters[x.playerId].ixg).toFixed(1) : null } : null,
      trend: [last ? { season: `${String(season - 10001).slice(2, 4)}-${String(season - 10001).slice(6)}`, overall: last.overall, evOff: last.evOff, evDef: last.evDef } : null,
        r ? { season: `${String(season).slice(2, 4)}-${String(season).slice(6)}`, overall: r.overall, evOff: r.evOff, evDef: r.evDef } : null].filter(Boolean),
      stats: skaterLine(x),
    };
  }
  for (const x of goalies) {
    const r = ratedGoalies[x.playerId];
    cards[x.playerId] = {
      id: x.playerId, kind: 'G', name: initialName(x), full: fullName(x), headshot: x.headshot, pos: 'G',
      number: bio[x.playerId]?.sweaterNumber ?? null, age: ageOf(x.playerId), usage: x.gamesStarted >= meRow.gamesPlayed / 2 ? 'Starter' : 'Backup',
      gp: x.gamesPlayed, qualified: !!r, group: 'G', overall: r?.overall ?? null,
      tiles: [['Goals saved above exp.', r?.gsax60 ?? null], ['Save %', r?.sv ?? null], ['High-danger save %', r?.hdSv ?? null], ['Workload', r?.load ?? null]],
      extra: r ? r.raw : null, trend: [], stats: gl(x),
    };
  }
  // ---------- Box WAR: every game's table for this team, season totals on the cards ----------
  const R2 = war.round2;
  const warOut = { gpw: WAR.gpw, games: {}, season: {} };
  const warIds = new Set();
  for (const g of games) {
    const v = g.id && WAR.games.get(g.id);
    if (!v) continue;
    const mine = v.rows.filter((r) => r.t === myId).sort((a, b) => b.gar - a.gar), theirs = v.rows.filter((r) => r.t !== myId);
    const gl = v.goalies.filter((r) => r.t === myId), gt = v.goalies.filter((r) => r.t !== myId);
    const sum = (a) => a.reduce((x, r) => x + r.gar, 0);
    warOut.games[g.id] = {
      us: R2(sum(mine) + sum(gl)), them: R2(sum(theirs) + sum(gt)),
      // the 13th entry is the player's own game line:
      // [G, A, SOG, ixG, hits, blocks, FO won, FO lost, takeaways, giveaways, minors taken, minors drawn, EV / PP / SH seconds, on-ice GF, GA, xGF, xGA]
      rows: mine.map((r) => [r.id, r.n, r.pos, r.toi, R2(r.gc), R2(r.oio), R2(r.oid), R2(r.pp), R2(r.pen), R2(r.oth), R2(r.gar), r.pct,
        ((l) => [l.g, l.a, l.sog, R2(l.ixg), l.ht, l.bk, l.fw, l.fl, l.tk, l.gv, l.pt, l.pd, l.ev, l.pp, l.sh, l.gf, l.ga, R2(l.xgf), R2(l.xga)])(r.line)]),
      g: gl.map((r) => [r.id, r.n, r.shots, R2(r.gsax), R2(r.gar), r.pct, r.ga, R2(r.xga)]),
    };
    for (const r of [...mine, ...gl]) warIds.add(r.id);
  }
  for (const id of warIds) {
    const r = WAR.season[id];
    if (!r) continue;
    warOut.season[id] = r.pos === 'G'
      ? { n: r.n, pos: 'G', gp: r.gp, shots: r.shots, gsax: R2(r.gsax), gar: R2(r.gar), war: R2(r.war), pct: r.pct }
      : { n: r.n, pos: r.pos, gp: r.gp, toi: r.toi, gc: R2(r.gc), oio: R2(r.oio), oid: R2(r.oid), pp: R2(r.pp), pen: R2(r.pen), oth: R2(r.oth), gar: R2(r.gar), war: R2(r.war), pct: r.pct };
    if (cards[id]) cards[id].war = warOut.season[id];
  }
  {
    const best = Object.entries(warOut.season).filter(([id]) => cards[id]).sort((a, b) => b[1].war - a[1].war)[0];
    if (best) {
      const [id, r] = best, c = cards[id];
      leaderBoard.war = { id: +id, label: 'Wins above repl.', name: c.name, full: c.full, headshot: c.headshot, value: r.war.toFixed(1),
        sub: `${r.gar.toFixed(1)} goals above repl.`, stats: c.stats };
    }
  }

  const ratings = Object.values(cards).filter((c) => c.qualified && c.overall != null).sort((a, b) => b.overall - a.overall)
    .map((c) => ({ id: c.id, name: c.name, pos: c.pos, number: c.number, usage: c.usage, overall: c.overall, headshot: c.headshot }));

  // NHL EDGE player leaders: fastest skater and hardest shot on the team
  const byId = (id) => skaters.find((x) => x.playerId === id);
  const fast = edgeSpeed?.topSkatingSpeeds?.[0], hard = edgeShot?.hardestShots?.[0];
  if (fast && byId(fast.player.id)) {
    const x = byId(fast.player.id);
    leaderBoard.fastest = { id: x.playerId, label: 'Fastest skater (EDGE)', name: initialName(x), full: fullName(x), headshot: x.headshot, value: fast.skatingSpeed.imperial.toFixed(1),
      sub: `mph, ${fast.gameDate}`, stats: skaterLine(x) };
  }
  if (hard && byId(hard.player.id)) {
    const x = byId(hard.player.id);
    leaderBoard.hardest = { id: x.playerId, label: 'Hardest shot (EDGE)', name: initialName(x), full: fullName(x), headshot: x.headshot, value: hard.shotSpeed.imperial.toFixed(1),
      sub: `mph, ${hard.gameDate}`, stats: skaterLine(x) };
  }
  for (const [key, label, pool, sortV, valueF, subF] of goalieCats) {
    const x = [...pool].sort((a, b) => sortV(b) - sortV(a) || b.gamesPlayed - a.gamesPlayed)[0];
    if (x) leaderBoard[key] = { id: x.playerId, label, name: initialName(x), full: fullName(x), headshot: x.headshot, value: valueF(x), sub: subF(x), stats: gl(x) };
  }
  const sv = [...goalies].filter((g) => g.gamesPlayed >= minGp)
    .sort((x, y) => y.savePercentage - x.savePercentage)[0];
  if (sv)
    leaders.push({
      label: 'Save percentage', name: initialName(sv), headshot: sv.headshot,
      value: sv.savePercentage.toFixed(3).replace(/^0/, ''),
      sub: `${plural(sv.gamesPlayed, 'game')}, ${sv.goalsAgainstAverage.toFixed(2)} GAA`,
      full: `${sv.firstName.default} ${sv.lastName.default}`,
      stats: [
        ['GP', sv.gamesPlayed], ['Record', rec(sv.wins, sv.losses, sv.overtimeLosses)],
        ['SV%', sv.savePercentage.toFixed(3).replace(/^0/, '')], ['GAA', sv.goalsAgainstAverage.toFixed(2)],
        ['Saves', `${sv.saves}/${sv.shotsAgainst}`], ['Shutouts', sv.shutouts],
      ],
    });

  // ---------- next 5 / last 5 ----------
  const nextGames = mySchedule
    .filter((g) => (g.gameType === 2 || g.gameType === 3) && !isFinal(g))
    .slice(0, 5)
    .map((g) => {
      const p = perspective(g, TEAM);
      const d = new Date(g.startTimeUTC);
      const tbd = g.gameScheduleState === 'TBD';
      const live = g.gameState === 'LIVE' || g.gameState === 'CRIT';
      return {
        id: g.id,
        startUTC: g.startTimeUTC,
        winPct: g.gameType === 2 ? winPct(TEAM, p.opp, p.home) : null,
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
        info: gameInfo(g),
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
        dow: fmt(new Date(g.startTimeUTC), { weekday: 'short' }).toUpperCase(),
        day: fmt(new Date(g.startTimeUTC), { day: 'numeric' }),
        info: gameInfo(g),
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
    altLogo: altLogoFor(TEAM, palette, meRow),
    },
    header,
    teams: teamsOut,
    season: { games, played, total: games.length },
    playoffLine,
    divisions,
    pictures,
    race,
    rankHistory,
    confSize: confTeams.length,
    scorers,
    goalies: goalieList,
    cards,
    ratings,
    war: warOut,
    xgModel,   // weights for site/chances-core.mjs, so live games get the same xG
    stats,
    leaderBoard,
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
  layout: config.layout || null,   // optional default board layout (see README)
  liveProxy: (process.env.LIVE_PROXY ?? config.liveProxy ?? '').replace(/\/$/, ''),   // Cloudflare Worker relay for live games
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

// ---------- league page (hockey.mattdicks.org/nhl/): scoreboard, standings, odds, leaders ----------
{
  const sample = JSON.parse(await readFile(join(outDir, `${built[0]}.json`), 'utf8'));
  const slugOf = Object.fromEntries(teamsIndex.teams.map((t) => [t.abbrev, t.slug]));
  const teams = Object.fromEntries(Object.entries(sample.teams).map(([a, t]) => [a, { ...t, slug: slugOf[a] || a.toLowerCase() }]));
  const ymd = (d) => new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(new Date(d));
  const dayMs = 86400000, today = ymd(now);
  const dayKeys = [-1, 0, 1, 2, 3].map((k) => ymd(now.getTime() + k * dayMs));
  const games = [...new Map(abbrevs.flatMap((a) => schedules[a]).filter((g) => g.gameType === 2).map((g) => [g.id, g])).values()]
    .filter((g) => dayKeys.includes(ymd(g.startTimeUTC))).sort((x, y) => x.startTimeUTC.localeCompare(y.startTimeUTC));
  const days = dayKeys.map((key, k) => ({
    key, label: ['Yesterday', 'Today', 'Tomorrow'][k] || fmt(new Date(`${key}T12:00:00Z`), { weekday: 'short', month: 'short', day: 'numeric' }),
    games: games.filter((g) => ymd(g.startTimeUTC) === key).map((g) => {
      const fin = isFinal(g), h = g.homeTeam.abbrev, a = g.awayTeam.abbrev;
      return { id: g.id, start: g.startTimeUTC, state: g.gameState, home: h, away: a,
        hs: g.homeTeam.score ?? null, as: g.awayTeam.score ?? null, last: g.gameOutcome?.lastPeriodType || '',
        time: fmt(new Date(g.startTimeUTC), { hour: 'numeric', minute: '2-digit' }),
        winHome: !fin && teams[h] && teams[a] ? winPct(h, a, true) : null };
    }),
  }));
  // leaders across the league
  const shortName = (full) => { const p = String(full || '').split(' '); return p.length > 1 ? `${p[0][0]}. ${p.slice(1).join(' ')}` : full; };
  const teamOf = (x) => String(x.teamAbbrevs || '').split(',').pop().trim();
  const mug = (id, t) => `https://assets.nhle.com/mugs/nhl/${season}/${t}/${id}.png`;
  const sk = Object.values(skNow).filter((x) => x.gamesPlayed > 0), gk = Object.values(goNow).filter((x) => x.gamesPlayed > 0);
  const maxGp = Math.max(1, ...sk.map((x) => x.gamesPlayed));
  const top = (arr, f, row, n = 10) => [...arr].sort((a, b) => f(b) - f(a)).slice(0, n).map(row);
  const skRow = (v, sub) => (x) => ({ id: x.playerId, n: shortName(x.skaterFullName), t: teamOf(x), pos: x.positionCode, v: v(x), sub: sub(x), img: mug(x.playerId, teamOf(x)) });
  const leaders = {
    points: { label: 'Points', rows: top(sk, (x) => x.points + x.goals / 1000, skRow((x) => x.points, (x) => `${x.goals} G · ${x.assists} A`)) },
    goals: { label: 'Goals', rows: top(sk, (x) => x.goals + x.points / 1000, skRow((x) => x.goals, (x) => `${x.shots} shots`)) },
    assists: { label: 'Assists', rows: top(sk, (x) => x.assists + x.points / 1000, skRow((x) => x.assists, (x) => `${x.points} points`)) },
    war: { label: 'Wins above replacement', rows: Object.values(WAR.season).filter((r) => r.pos !== 'G' && r.qualified).sort((a, b) => b.war - a.war).slice(0, 10)
      .map((r) => ({ id: r.id, n: r.n, t: abbrevOfId[r.t], pos: r.pos, v: r.war.toFixed(1), sub: `${r.gar.toFixed(1)} GAR · ${r.gp} GP`, img: mug(r.id, abbrevOfId[r.t]) })) },
    overall: { label: 'Rinkside overall', rows: Object.entries(ratedNow).filter(([id]) => skNow[id]).sort((a, b) => b[1].overall - a[1].overall).slice(0, 10)
      .map(([id, r]) => { const x = skNow[id]; return { id: +id, n: shortName(x.skaterFullName), t: teamOf(x), pos: x.positionCode, v: r.overall, sub: `${x.points} pts in ${x.gamesPlayed}`, img: mug(id, teamOf(x)) }; }) },
    save: { label: 'Save %', rows: top(gk.filter((x) => x.gamesPlayed >= Math.max(3, maxGp / 4)), (x) => x.savePct, (x) => ({ id: x.playerId, n: shortName(x.goalieFullName), t: teamOf(x), pos: 'G',
      v: x.savePct.toFixed(3).replace(/^0/, ''), sub: `${x.wins}-${x.losses}-${x.otLosses} · ${x.goalsAgainstAverage.toFixed(2)} GAA`, img: mug(x.playerId, teamOf(x)) })) },
    gwar: { label: 'Goalie WAR', rows: Object.values(WAR.season).filter((r) => r.pos === 'G' && r.qualified).sort((a, b) => b.war - a.war).slice(0, 10)
      .map((r) => ({ id: r.id, n: r.n, t: abbrevOfId[r.t], pos: 'G', v: r.war.toFixed(1), sub: `${r.gsax >= 0 ? '+' : ''}${r.gsax.toFixed(1)} saved vs xG`, img: mug(r.id, abbrevOfId[r.t]) })) },
  };
  const league = { generatedAt: now.toISOString(), season, date: fmt(now, { weekday: 'long', month: 'long', day: 'numeric' }), today, gpw: WAR.gpw, teams, days, leaders };
  await writeFile(join(outDir, 'league.json'), JSON.stringify(league));
  console.log(`league: ${games.length} games around today, ${Object.keys(leaders).length} leader boards`);
}

// One folder per team name so hockey.mattdicks.org/rangers/ (and /nyr/, /leafs/ ...) work on plain
// static hosting. Each is the main page with <base href="../"> so it shares app.js, style.css and data/.
const page = (await readFile(join(ROOT, 'site', 'index.html'), 'utf8')).replace('<head>', '<head>\n  <base href="../">');
for (const name of ['nhl', 'league']) {   // the league page
  await mkdir(join(ROOT, 'site', name), { recursive: true });
  await writeFile(join(ROOT, 'site', name, 'index.html'), page);
}
for (const t of teamsIndex.teams) {
  for (const name of new Set([t.slug, t.abbrev.toLowerCase(), ...t.aliases])) {
    await mkdir(join(ROOT, 'site', name), { recursive: true });
    await writeFile(join(ROOT, 'site', name, 'index.html'), page);
  }
}
console.log(`Wrote ${built.length} boards to site/data/`);
