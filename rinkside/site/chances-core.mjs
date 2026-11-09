// Scoring-chance and expected-goals logic shared by the build (scripts/chances.mjs) and the
// browser (live games). Pure functions only: no Node or DOM APIs.
//
// A scoring chance is a shot on goal (or goal) from the offensive zone with the goalie in net.
// Danger zones (feet from the goal line, feet either side of centre):
//   high: up to 20 ft out (or just behind the line), within 19 ft of centre
//   mid:  up to 30 ft out, within 30 ft of centre
//   low:  anywhere else in the offensive zone
// Shots on goal from outside the zone, or more than 58 ft from the goal line, count as "dumps".
// These boundaries were calibrated against a published scoring-chances report for NYR @ SEA on
// 2026-11-07 (24 chances, 8 high-danger and 2 dumps for NYR, matched exactly).

const SHOT_TYPES = ['wrist', 'snap', 'slap', 'backhand', 'tip-in', 'deflected', 'wrap-around'];
const secs = (t) => { const [m, s] = String(t || '0:0').split(':').map(Number); return m * 60 + s; };

// Reduce one game's play-by-play to the events we need.
export function reduce(pbp) {
  const home = pbp.homeTeam.id, away = pbp.awayTeam.id;
  const out = { id: pbp.id, home, away, shots: [], blocked: { [home]: 0, [away]: 0 } };
  let prev = null;
  const plays = [...pbp.plays].sort((a, b) => a.sortOrder - b.sortOrder);
  for (const p of plays) {
    const pd = p.periodDescriptor || {};
    if (pd.periodType === 'SO') continue;
    const d = p.details || {}, type = p.typeDescKey;
    const t = (pd.number - 1) * 1200 + secs(p.timeInPeriod);
    if (type === 'blocked-shot') {
      // the API files a blocked shot under the blocking team; the shooter is the other team
      const shooter = d.eventOwnerTeamId === home ? away : home;
      out.blocked[shooter] = (out.blocked[shooter] || 0) + 1;
    }
    if (type === 'shot-on-goal' || type === 'goal') {
      const team = d.eventOwnerTeamId, isHome = team === home;
      const sc = String(p.situationCode || '1551').padStart(4, '0');
      const [awayG, awayS, homeS, homeG] = sc.split('').map(Number);
      const own = isHome ? homeS : awayS, opp = isHome ? awayS : homeS, oppGoalie = isHome ? awayG : homeG;
      const x = d.xCoord ?? 0, y = d.yCoord ?? 0;
      out.shots.push({
        team, goal: type === 'goal' ? 1 : 0, zone: d.zoneCode || '',
        shooter: d.shootingPlayerId || d.scoringPlayerId || 0, goalie: d.goalieInNetId || 0,
        fx: 89 - Math.abs(x), ay: Math.abs(y), type: d.shotType || 'other',
        en: oppGoalie === 0 || (type === 'goal' && !d.goalieInNetId) ? 1 : 0,
        pp: own > opp ? 1 : 0, sh: own < opp ? 1 : 0,
        rebound: prev && prev.shot && prev.team === team && t - prev.t <= 3 ? 1 : 0,
        rush: prev && t - prev.t <= 4 && (Math.abs(prev.x) < 25 || Math.sign(prev.x) !== Math.sign(x)) ? 1 : 0,
      });
    }
    if (d.xCoord != null) prev = { t, team: d.eventOwnerTeamId, x: d.xCoord, shot: ['shot-on-goal', 'missed-shot', 'blocked-shot'].includes(type) };
    if (type === 'goal') prev = null;   // no rebounds or rushes carry across a goal
  }
  return out;
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
  if (s.fx >= -3 && s.fx <= 20 && s.ay <= 19) return 'hi';
  if (s.fx <= 30 && s.ay <= 30) return 'mid';
  return 'low';
}

// One team's side of a game's report.
export function side(g, team, w) {
  const b = { hi: { n: 0, xg: 0, g: 0 }, mid: { n: 0, xg: 0, g: 0 }, low: { n: 0, xg: 0, g: 0 } };
  let goals = 0, en = 0, dumps = 0, dumpGoals = 0, sog = 0;
  for (const s of g.shots) {
    if (s.team !== team) continue;
    goals += s.goal; sog++;
    if (s.en) { en += s.goal; continue; }
    if (s.zone !== 'O' || s.fx > 58) { dumps++; dumpGoals += s.goal; continue; }   // long shots from the blue line or beyond
    const k = danger(s), v = xg(w, s);
    b[k].n++; b[k].xg += v; b[k].g += s.goal;
  }
  const r2 = (v) => Math.round(v * 100) / 100;
  for (const k of Object.keys(b)) b[k].xg = r2(b[k].xg);
  return { chances: b.hi.n + b.mid.n + b.low.n, hi: b.hi, mid: b.mid, low: b.low, xg: r2(b.hi.xg + b.mid.xg + b.low.xg), goals, sog, en, dumps, dumpGoals, blocked: g.blocked[team] || 0 };
}
export function report(g, teamId, w) {
  const opp = g.home === teamId ? g.away : g.home;
  return { us: side(g, teamId, w), them: side(g, opp, w) };
}

