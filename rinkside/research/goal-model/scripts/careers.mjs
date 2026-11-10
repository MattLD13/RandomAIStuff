// Career team history per player (NHL regular seasons): {playerId: [[season, teamAbbrev], ...]}
import { readFileSync, writeFileSync } from 'node:fs';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ids = readFileSync('shooters.txt', 'utf8').trim().split('\n'); const out = {}; let k = 0;
async function w() { while (k < ids.length) { const id = ids[k++];
  for (let a = 0; a < 6; a++) { const r = await fetch(`https://api-web.nhle.com/v1/player/${id}/landing`).catch(() => null);
    if (r?.status === 404) break;
    if (r?.ok) { const j = await r.json();
      out[id] = (j.seasonTotals || []).filter((s) => s.leagueAbbrev === 'NHL' && s.gameTypeId === 2).map((s) => [s.season, s.teamCommonName?.default || '', s.teamName?.default || '']); break; }
    await sleep(1000 * 2 ** a); } } }
await Promise.all(Array.from({ length: 4 }, w));
writeFileSync('careers.json', JSON.stringify(out)); console.log('done', Object.keys(out).length);
