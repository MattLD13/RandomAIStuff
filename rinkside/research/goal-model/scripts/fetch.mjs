// Download NHL play-by-play for whole seasons, keeping only what the shot model needs (gzip JSON per game).
import { writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
const [, , season, maxN = '1312', conc = '6'] = process.argv;   // season like 2021 (= 2021-22)
const dir = `raw/${season}`; mkdirSync(dir, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function get(url) {
  for (let a = 0; a < 8; a++) {
    try {
      const r = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
      if (r.status === 404) return null;
      if (r.ok) return await r.json();
      await sleep(1000 * 2 ** a);
    } catch { await sleep(1000 * 2 ** a); }
  }
  throw new Error('failed ' + url);
}
const keepD = ['xCoord', 'yCoord', 'zoneCode', 'shotType', 'reason', 'shootingPlayerId', 'scoringPlayerId', 'goalieInNetId', 'blockingPlayerId',
  'eventOwnerTeamId', 'assist1PlayerId', 'assist2PlayerId', 'hittingPlayerId', 'hitteePlayerId', 'playerId', 'losingPlayerId', 'winningPlayerId',
  'committedByPlayerId', 'drawnByPlayerId', 'typeCode', 'descKey', 'duration', 'awayScore', 'homeScore'];
let i = 1, done = 0, miss = 0; const t0 = Date.now();
async function worker() {
  while (i <= +maxN) {
    const n = i++, id = `${season}02${String(n).padStart(4, '0')}`, f = `${dir}/${id}.json.gz`;
    if (existsSync(f)) { done++; continue; }
    const p = await get(`https://api-web.nhle.com/v1/gamecenter/${id}/play-by-play`);
    if (!p || !['OFF', 'FINAL'].includes(p.gameState)) { miss++; continue; }
    const out = { id: p.id, season: p.season, date: p.gameDate, home: p.homeTeam.id, away: p.awayTeam.id, homeAbbrev: p.homeTeam.abbrev, awayAbbrev: p.awayTeam.abbrev,
      venue: p.venue?.default, roster: p.rosterSpots.map((r) => [r.playerId, r.teamId, r.positionCode, r.sweaterNumber]),
      plays: p.plays.map((e) => { const d = {}; for (const k of keepD) if (e.details?.[k] != null) d[k] = e.details[k];
        return [e.eventId, e.sortOrder, e.periodDescriptor?.number, e.periodDescriptor?.periodType, e.timeInPeriod, e.situationCode, e.homeTeamDefendingSide, e.typeDescKey, d]; }) };
    writeFileSync(f, gzipSync(JSON.stringify(out))); done++;
    if (done % 100 === 0) console.log(season, done, 'games', ((Date.now() - t0) / 1000).toFixed(0) + 's');
  }
}
await Promise.all(Array.from({ length: +conc }, worker));
console.log(season, 'finished', done, 'saved/kept,', miss, 'missing/unplayed', ((Date.now() - t0) / 1000).toFixed(0) + 's');
