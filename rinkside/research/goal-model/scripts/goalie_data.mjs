// More goalie data: (1) season save stats by strength, 2010-11 on (NHL stats API); (2) EDGE goalie numbers per season, 2021-22 on.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
const prev = existsSync('goalie_data.json') ? JSON.parse(readFileSync('goalie_data.json', 'utf8')) : { seasons: {}, edge: {} };
const LAST = +(process.env.LAST_SEASON || 2025);   // the newest completed season
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function get(u) { for (let a = 0; a < 8; a++) { const r = await fetch(u).catch(() => null); if (r?.status === 404) return null; if (r?.ok) return r.json(); await sleep(Math.min(8000, 800 * 2 ** a)); } return null; }
const seasons = prev.seasons;
for (let y = 2010; y <= LAST; y++) {
  if (seasons[y]?.length) continue;   // completed seasons never change
  const j = await get(`https://api.nhle.com/stats/rest/en/goalie/savesByStrength?limit=-1&cayenneExp=seasonId=${y}${y + 1}%20and%20gameTypeId=2`);
  seasons[y] = (j?.data || []).map((g) => [g.playerId, g.gamesPlayed, g.gamesStarted, g.shotsAgainst, g.goalsAgainst, g.evShotsAgainst, g.evGoalsAgainst, g.ppShotsAgainst, g.ppGoalsAgainst]);
  console.log(y, seasons[y].length);
}
const pairs = readFileSync('gedge_pairs.csv', 'utf8').trim().split('\n').slice(1).map((l) => l.split(',').map(Number));
const edge = prev.edge; let k = 0;
const todo = pairs.filter(([s, id]) => !(`${s}:${id}` in edge)); pairs.length = 0; pairs.push(...todo);
async function w() { while (k < pairs.length) { const [s, id] = pairs[k++];
  const [a, b] = await Promise.all([get(`https://api-web.nhle.com/v1/edge/goalie-5v5-detail/${id}/${s}${s + 1}/2`), get(`https://api-web.nhle.com/v1/edge/goalie-shot-location-detail/${id}/${s}${s + 1}/2`)]);
  const d = a?.savePctg5v5Details, tot = Object.fromEntries((b?.shotLocationTotals || []).map((x) => [x.locationCode, x]));
  edge[`${s}:${id}`] = { sv5: d?.savePctg?.value ?? null, sv5close: d?.savePctgClose?.value ?? null, shots5: d?.shots?.value ?? null,
    hd: tot.high ? [tot.high.shotsAgainst, tot.high.goalsAgainst] : null, md: tot.mid ? [tot.mid.shotsAgainst, tot.mid.goalsAgainst] : null, ld: tot.long ? [tot.long.shotsAgainst, tot.long.goalsAgainst] : null }; } }
await Promise.all(Array.from({ length: 3 }, w));
writeFileSync('goalie_data.json', JSON.stringify({ seasons, edge }));
console.log('edge', Object.keys(edge).length, JSON.stringify(Object.values(edge)[0]));
