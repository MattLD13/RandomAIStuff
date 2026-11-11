// Scoring-chance and expected-goals logic shared by the build (scripts/chances.mjs) and the
// browser (live games). Pure functions only: no Node or DOM APIs.
//
// A scoring chance is a shot on goal (or goal) from the offensive zone with the goalie in net.
// Danger zones are cones around the net: distance from the net (ft) and angle from straight on (degrees).
//   high: within ZONES.hiDist ft and ZONES.hiAng degrees, or in the post/goal-line crease: within ZONES.crease ft at
//         ZONES.creaseLo..creaseHi degrees from straight on (90 = along the goal line, above 90 = behind it);  mid: within ZONES.midDist ft and ZONES.midAng degrees;
//   low: anywhere else in the offensive zone.
// Shots on goal from outside the zone, or more than ZONES.dump ft from the goal line, count as "dumps".
// ZONES is fitted to published scoring-chance reports (calibration/chance-reports.json) by
// scripts/fit-chance-zones.mjs, which rewrites the line below; add reports as they come out and refit.
export const ZONES = {"crease":10,"creaseLo":80,"creaseHi":95,"dump":58,"hiDist":23,"hiAng":55,"midDist":27,"midAng":80};   // fitted on 3 team-games (2 games), count error 7

const SHOT_TYPES = ['wrist', 'snap', 'slap', 'backhand', 'tip-in', 'deflected', 'wrap-around'];
const secs = (t) => { const [m, s] = String(t || '0:0').split(':').map(Number); return m * 60 + s; };

// Reduce one game's play-by-play to the events we need.
export function reduce(pbp) {
  const home = pbp.homeTeam.id, away = pbp.awayTeam.id;
  const out = { id: pbp.id, home, away, shots: [], blocked: { [home]: 0, [away]: 0 } };
  // team game stats: shot attempts, hits, blocks, faceoffs, giveaways, takeaways, PIM, power plays
  const blank = () => ({ att: 0, hits: 0, blk: 0, fow: 0, fo: 0, give: 0, take: 0, pim: 0, ppo: 0, ppg: 0 });
  const st = { [home]: blank(), [away]: blank() }, other = (t) => (t === home ? away : home);
  let onPP = { [home]: false, [away]: false };
  const score = { [home]: 0, [away]: 0 };
  out.misses = [];
  let prev = null;
  const plays = [...pbp.plays].sort((a, b) => a.sortOrder - b.sortOrder);
  for (const p of plays) {
    const pd = p.periodDescriptor || {};
    if (pd.periodType === 'SO') continue;
    const d = p.details || {}, type = p.typeDescKey;
    const t = (pd.number - 1) * 1200 + secs(p.timeInPeriod);
    const owner = d.eventOwnerTeamId;
    if (p.situationCode) {   // count a power play each time a team goes a skater (or more) up with both goalies in
      const [ag, as, hs, hg] = String(p.situationCode).padStart(4, '0').split('').map(Number);
      for (const [tm, own, opp] of [[home, hs, as], [away, as, hs]]) {
        const pp = ag > 0 && hg > 0 && own > opp;
        if (pp && !onPP[tm]) st[tm].ppo++;
        onPP[tm] = pp;
      }
    }
    if (st[owner]) {
      if (type === 'hit') st[owner].hits++;
      else if (type === 'giveaway') st[owner].give++;
      else if (type === 'takeaway') st[owner].take++;
      else if (type === 'faceoff') { st[owner].fow++; st[owner].fo++; st[other(owner)].fo++; }
      else if (type === 'penalty') st[owner].pim += d.duration || 0;
      else if (type === 'blocked-shot') { st[owner].att++; if (d.reason !== 'teammate-blocked') st[other(owner)].blk++; }
      else if (type === 'missed-shot' || type === 'shot-on-goal' || type === 'goal') st[owner].att++;
    }
    if (type === 'blocked-shot') {
      // the API files a blocked shot under the shooting team (the blocker is on the other team,
      // unless it hit a teammate, which doesn't count as a block)
      const shooter = d.eventOwnerTeamId;
      if (d.reason !== 'teammate-blocked') out.blocked[shooter] = (out.blocked[shooter] || 0) + 1;
    }
    if (type === 'shot-on-goal' || type === 'goal' || type === 'missed-shot') {
      const team = d.eventOwnerTeamId, isHome = team === home;
      const sc = String(p.situationCode || '1551').padStart(4, '0');
      const [awayG, awayS, homeS, homeG] = sc.split('').map(Number);
      const own = isHome ? homeS : awayS, opp = isHome ? awayS : homeS, oppGoalie = isHome ? awayG : homeG;
      const x = d.xCoord ?? 0, y = d.yCoord ?? 0;
      const s = {
        team, goal: type === 'goal' ? 1 : 0, zone: d.zoneCode || '',
        shooter: d.shootingPlayerId || d.scoringPlayerId || 0, goalie: d.goalieInNetId || 0,
        fx: 89 - Math.abs(x), ay: Math.abs(y), type: d.shotType || 'other',
        en: oppGoalie === 0 || (type === 'goal' && !d.goalieInNetId) ? 1 : 0,
        pp: own > opp ? 1 : 0, sh: own < opp ? 1 : 0,
        xa: (isHome ? homeG : awayG) === 0 ? 1 : 0,   // own goalie pulled for an extra attacker
        sd: score[team] - score[other(team)],         // the shooting team's lead at the time (Box WAR score adjustment)
        rebound: prev && prev.shot && prev.team === team && t - prev.t <= 3 ? 1 : 0,
        rush: prev && t - prev.t <= 4 && (Math.abs(prev.x) < 25 || Math.sign(prev.x) !== Math.sign(x)) ? 1 : 0,
      };
      if (type === 'missed-shot') out.misses.push({ ...s, t });   // unblocked misses: Box WAR only
      else out.shots.push(s);
      if (type === 'goal' && team in score) score[team]++;
    }
    if (d.xCoord != null) prev = { t, team: d.eventOwnerTeamId, x: d.xCoord, shot: ['shot-on-goal', 'missed-shot', 'blocked-shot'].includes(type) };
    if (type === 'goal') prev = null;   // no rebounds or rushes carry across a goal
  }
  for (const s of out.shots) if (s.goal && s.pp && st[s.team]) st[s.team].ppg++;
  out.stats = st;
  return out;
}

// The NHL's own team stats for the game (the gamecenter "right-rail" feed) replace the
// play-by-play counts where they exist: power plays especially follow scorekeeping rules.
export function officialStats(st, home, away, tgs) {
  if (!st || !Array.isArray(tgs)) return st;
  const pair = (v) => String(v).split('/').map(Number);
  for (const x of tgs) for (const [tm, v] of [[away, x.awayValue], [home, x.homeValue]]) {
    const o = st[tm];
    if (!o || v == null) continue;
    if (x.category === 'hits') o.hits = +v;
    else if (x.category === 'blockedShots') o.blk = +v;
    else if (x.category === 'giveaways') o.give = +v;
    else if (x.category === 'takeaways') o.take = +v;
    else if (x.category === 'pim') o.pim = +v;
    else if (x.category === 'faceoffWins') [o.fow, o.fo] = pair(v);
    else if (x.category === 'powerPlay') [o.ppg, o.ppo] = pair(v);
  }
  return st;
}

const dist = (s) => Math.hypot(s.fx, s.ay);
const angle = (s) => (Math.atan2(s.ay, Math.max(s.fx, 0.5)) * 180) / Math.PI;
export function features(s) {
  const dd = dist(s) / 10, ang = angle(s) / 45;
  return [1, dd, dd * dd, ang, s.rebound, s.rush, s.pp, s.sh, ...SHOT_TYPES.slice(1).map((k) => (s.type === k ? 1 : 0)),
    SHOT_TYPES.includes(s.type) ? 0 : 1];
}

export const xg = (w, s) => 1 / (1 + Math.exp(-features(s).reduce((a, v, j) => a + v * w[j], 0)));

export function danger(s) {
  const d = Math.hypot(s.fx, s.ay);
  // angle from straight on; from behind the goal line it is 90° or more, so those shots are never "straight on"
  const ang = s.fx > 0 ? (Math.atan2(s.ay, s.fx) * 180) / Math.PI : 90 + (Math.atan2(-s.fx, s.ay + 1e-9) * 180) / Math.PI;
  if ((d <= ZONES.hiDist && ang <= ZONES.hiAng) || (d <= (ZONES.crease || 0) && ang >= (ZONES.creaseLo ?? 80) && ang <= (ZONES.creaseHi ?? 95))) return 'hi';
  if (d <= ZONES.midDist && ang <= ZONES.midAng) return 'mid';
  return 'low';
}
export const isDump = (s) => s.zone !== 'O' || s.fx > ZONES.dump;

// One team's side of a game's report.
export function side(g, team, w) {
  const b = { hi: { n: 0, xg: 0, g: 0 }, mid: { n: 0, xg: 0, g: 0 }, low: { n: 0, xg: 0, g: 0 } };
  let goals = 0, en = 0, dumps = 0, dumpGoals = 0, sog = 0;
  for (const s of g.shots) {
    if (s.team !== team) continue;
    goals += s.goal; sog++;
    if (s.en) { en += s.goal; continue; }
    if (isDump(s)) { dumps++; dumpGoals += s.goal; continue; }   // long shots from the blue line or beyond
    const k = danger(s), v = xg(w, s);
    b[k].n++; b[k].xg += v; b[k].g += s.goal;
  }
  const r2 = (v) => Math.round(v * 100) / 100;
  for (const k of Object.keys(b)) b[k].xg = r2(b[k].xg);
  return { chances: b.hi.n + b.mid.n + b.low.n, hi: b.hi, mid: b.mid, low: b.low, xg: r2(b.hi.xg + b.mid.xg + b.low.xg), goals, sog, en, dumps, dumpGoals,
    // shots of ours that were blocked = the other team's official blocks (the play-by-play count otherwise)
    blocked: g.stats?.[g.home === team ? g.away : g.home]?.blk ?? g.blocked[team] ?? 0 };
}
export function report(g, teamId, w) {
  const opp = g.home === teamId ? g.away : g.home;
  return { us: side(g, teamId, w), them: side(g, opp, w), stats: g.stats ? { us: g.stats[teamId], them: g.stats[opp] } : null };
}

