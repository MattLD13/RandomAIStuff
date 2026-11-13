// Empty Net: the game model. Plain script (no imports/exports) so it can be inlined into the page
// and also loaded by node for calibration (drill/check.mjs). Sets globalThis.Drill.
//
// You coach the bench, not the puck. At every whistle, and whenever a shift runs long, you decide:
//   - which line goes out (your real lines from that game, each with legs that drain on the ice and
//     come back on the bench),
//   - the offensive-zone setup (umbrella, overload, crash the net),
//   - what your D do at the blue line (pinch to keep pucks in, or keep one man high),
//   - the goalie (pull him, and whether the extra man is a forward or a defenseman) and the timeout.
// Then a whole shift plays out in steps of a few seconds: zone time, cycles, shots, saves, rebounds,
// clears, pinches, icings, line changes. The other team shows a structure (collapsing box, pressuring
// your points, sagging off) and deploys its own lines; an icing traps their tired line on the ice.
// Every decision is graded by Monte Carlo: the same spot is replayed with the other choices you could
// have made and finished by a typical NHL bench.
(function () {
  // ---------- rates ----------
  // Tuned by drill/check.mjs so the typical bench reproduces ~950 real late one-goal endings.
  const R = {
    adv: { '-2': 0.18, '-1': 0.42, '0': 1, '1': 1.75, '2': 2.4, '3': 2.8 }, // shot quality by skater advantage
    youQ: 0.4, tiedQ: 1, themQ: 1, themTied: 1.75, them3: 1, otOpen: 1,  // overall scales (tuned by drill/check.mjs)
    eng: 0.12,             // a clear from their end goes into your empty net
    engMul: 3.4,           // scales every empty-net try (tuned: 38% of real down-one endings gave one up)
    icing: 0.35,           // an empty-net try from their end that misses is icing
    shift: 42,             // when a shift has run long enough to ask about a change (s)
    drain: 1 / 70, rest: 1 / 95,
    penOpp: 0.045, penYou: 0.03,
    pullAt: { '-1': 100, '-2': 200 },
  };
  const LQ = [{ off: 1.35, def: 0.96 }, { off: 1.0, def: 1.0 }, { off: 0.72, def: 1.16 }];   // line 1 scores, line 3 checks

  const mulberry = (a) => () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const hash = (str) => { let h = 2166136261; for (const c of String(str)) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); } return h >>> 0; };
  const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
  const fmt = (t) => `${Math.floor(t / 60)}:${String(Math.round(t) % 60).padStart(2, '0')}`;

  // ---------- the choices ----------
  const SETUPS = [
    ['umb', 'Umbrella', '1-3-1. Point shots through screens, a man always high.'],
    ['over', 'Overload', 'Flood the strong side, work it low to high.'],
    ['crash', 'Crash the net', 'Two at the crease. Rebounds and chaos, thin behind.'],
  ];
  const SETUPS3 = [
    ['umb', 'Hold & cycle', 'Keep the puck, wait for a lane.'],
    ['over', 'Attack with speed', 'Go before they set up.'],
    ['crash', 'Crash the net', 'Two to the crease. Odd-man rushes both ways.'],
  ];
  const DMODES = [['safe', 'Keep one high', 'A D stays back. Safer, fewer pucks kept in.'], ['pinch', 'Pinch', 'Both D jump to keep pucks in. Burned if they get by.']];
  // what the other team is showing in their end
  const LOOKS = [
    ['box', 'Collapsing in front', 'Five inside the dots. They will give you the point.'],
    ['pressure', 'Jumping your points', 'Their wingers are pressuring your D at the line.'],
    ['sag', 'Sagging off', 'Soft on the puck, and {oG} is leaking rebounds.'],
  ];

  // ---------- state ----------
  function newGame(sc) {
    const so = shootout(sc);
    const L = sc.lines;
    const on = L ? L.you.onIce : 0, oon = L ? L.opp.onIce : 0;
    const shiftSec = L ? L.you.shiftSec : 20, oShift = L ? L.opp.shiftSec : 20;
    const lines = [0, 1, 2].map((i) => ({ e: i === on ? clamp(1 - shiftSec * R.drain, 0.2, 1) : 0.9 }));
    const olines = [0, 1, 2].map((i) => ({ e: i === oon ? clamp(1 - oShift * R.drain, 0.2, 1) : 0.9 }));
    const fo = L ? L.you.fo.map(([w, t]) => (w + 5) / (t + 10)) : [0.5, 0.5, 0.5];
    const ofo = L ? L.opp.fo.map(([w, t]) => (w + 5) / (t + 10)) : [0.5, 0.5, 0.5];
    const s = {
      id: sc.id, playoff: sc.type === 3, otNum: 0, per: 'REG', t: sc.start.t, you: sc.start.you, opp: sc.start.opp,
      pulled: false, xa: 'F', oppPulled: false, to: true, pp: 0,
      lines, olines, on, oon, onSec: shiftSec, oonSec: oShift, fo, ofo, late: L ? L.opp.late : 2,
      dec: 'FO', askAt: 42, fz: sc.start.zone, z: sc.start.zone, poss: 'you', setup: 'umb', d: 'safe', oppStuck: false,
      look: 'box', over: false, won: null, how: null, soWin: so.win, pulls: [], ticks: 0,
    };
    s.look = pickLook(s, mulberry(hash(`look${sc.id}`)));
    return s;
  }
  const clone = (s) => ({ ...s, pulls: s.pulls.slice(), lines: s.lines.map((l) => ({ ...l })), olines: s.olines.map((l) => ({ ...l })) });
  const diff = (s) => s.you - s.opp;
  const three = (s) => s.per === 'OT' && !s.playoff;

  function pickLook(s, r) {
    const w = { box: s.pulled ? 2.2 : 1.2, pressure: 1, sag: s.olines[s.oon].e < 0.5 ? 1.8 : 0.8 };
    let x = r() * (w.box + w.pressure + w.sag);
    for (const k of ['box', 'pressure', 'sag']) { if (x < w[k]) return k; x -= w[k]; }
    return 'box';
  }
  const lookInfo = (s) => LOOKS.find((l) => l[0] === s.look);

  function skaters(s) {
    const base = three(s) ? 3 : 5;
    let you = base, opp = base;
    if (s.pp > 0) opp -= 1; else if (s.pp < 0) you -= 1;
    if (three(s) && s.pp !== 0) { if (s.pp > 0) you += 1; else opp += 1; opp = Math.min(opp, 4); you = Math.min(you, 4); }
    if (s.pulled) you += 1;
    if (s.oppPulled) opp += 1;
    return { you, opp };
  }
  const adv = (n) => R.adv[String(clamp(n, -2, 3))];

  // what can be decided right now
  function options(s) {
    const reg = s.per === 'REG';
    const stop = s.dec === 'FO';
    const goalie = !reg ? ['in'] : !s.pulled ? (stop || s.z !== 'D' ? ['in', 'pullF', 'pullD'] : ['in']) : stop ? ['stay', 'back'] : ['stay'];
    return { lines: [0, 1, 2], setups: (three(s) ? SETUPS3 : SETUPS).map((x) => x[0]), d: ['safe', 'pinch'], goalie, timeout: reg && s.to && stop ? [false, true] : [false] };
  }
  const key = (c) => `${c.line}|${c.setup}|${c.d}|${c.goalie}|${c.timeout ? 1 : 0}`;

  // ---------- one decision: a shift (or the rest of one) plays out ----------
  // say(kind, text, data) narrates for the page. Names are tokens filled from the line on the ice:
  // {C} {LW} {RW} {D1} {D2} {X} {G} are yours; {oC} {oLW} {oRW} {oD1} {oD2} {oG} are theirs.
  const FROM = { point: 'from the point', wall: 'from the half-wall', slot: 'from the slot', low: 'from below the dots', crease: 'at the crease', rebound: 'on the rebound', rush: 'off the rush', bumper: 'from the bumper spot' };
  const RES = { save: 'saved by {oG}.', block: 'blocked.', wide: 'wide.' };
  const SET = {
    umb: { shotP: 0.5, xg: 0.045, reb: 0.22, keep: 0.55, turn: 0.1, high: 0.55, from: ['point', 'point', 'bumper', 'wall'] },
    over: { shotP: 0.38, xg: 0.075, reb: 0.15, keep: 0.5, turn: 0.16, high: 0.8, from: ['low', 'slot', 'wall'] },
    crash: { shotP: 0.45, xg: 0.06, reb: 0.42, keep: 0.42, turn: 0.16, high: 1.25, from: ['crease', 'slot', 'point'] },
  };
  const SHOOTER = { point: ['D1', 'D2', 'X'], bumper: ['C'], wall: ['LW', 'RW'], low: ['LW', 'C'], slot: ['C', 'RW'], crease: ['RW', 'LW'], rebound: ['C', 'RW'], rush: ['LW', 'RW', 'C'] };

  function resolve(s, c, rng, say = () => {}) {
    const r = rng;
    const tag = () => ({ line: s.on, oline: s.oon, z: s.z, poss: s.poss, setup: s.setup, look: s.look, pulled: s.pulled, xa: s.xa });
    const sayT = (k, text, data = {}) => say(k, text, { ...data, ...tag() });
    s.setup = c.setup || s.setup; s.d = c.d || s.d;
    // timeout first: everyone gets a breather, the chosen line most of all
    if (c.timeout && s.to) { s.to = false; s.lines.forEach((l) => { l.e = Math.min(1, l.e + 0.2); }); s.lines[c.line].e = 1; sayT('timeout', 'Timeout. Your bench gets a breather.'); }
    // the goalie
    if ((c.goalie === 'pullF' || c.goalie === 'pullD') && !s.pulled) { s.pulled = true; s.xa = c.goalie === 'pullF' ? 'F' : 'D'; s.pulls.push(s.t); sayT('pull', `{G} to the bench with ${fmt(s.t)} left. ${s.xa === 'F' ? 'An extra forward, {X},' : 'An extra defenseman'} jumps on.`); }
    else if (c.goalie === 'back' && s.pulled) { s.pulled = false; sayT('return', '{G} back in the net.'); }
    // the line
    let changeRisk = 0;
    // keeping a tired line out: you will not be asked again for another 20 seconds
    s.askAt = c.line === s.on && s.dec === 'FLY' ? s.onSec + 20 : R.shift;
    if (c.line !== s.on) {
      if (s.dec === 'FLY') changeRisk = s.z === 'D' ? 0.3 : s.z === 'O' && s.poss === 'you' ? 0.5 : 0;
      s.on = c.line; s.onSec = 0;
      say('change', `Line ${c.line + 1} over the boards: {C}, {LW}, {RW}.`, tag());
    }
    s.oppPulled = s.per === 'REG' && diff(s) > 0 && s.t <= 150;
    // their deployment at a whistle (not after an icing: their line is stuck out there)
    if (s.dec === 'FO') {
      if (!s.oppStuck && (s.olines[s.oon].e < 0.7 || s.oonSec > 35)) {
        const fresh = [0, 1, 2].filter((i) => s.olines[i].e > 0.55);
        const want = s.on === 0 && s.per === 'REG' && diff(s) < 0 ? s.late : fresh.sort((a, b) => s.olines[b].e - s.olines[a].e)[0];
        const pick = want != null && s.olines[want].e > 0.45 ? want : [0, 1, 2].sort((a, b) => s.olines[b].e - s.olines[a].e)[0];
        if (pick !== s.oon) { s.oon = pick; s.oonSec = 0; say('ochange', 'They change: {oC}, {oLW}, {oRW} out.', tag()); }
      } else if (s.oppStuck) say('stuck', `They iced it. {oC}'s line can't change: ${Math.round(s.oonSec)} seconds and counting.`, tag());
      s.oppStuck = false;
    }
    if (changeRisk && r() < changeRisk) {
      if (s.z === 'O') { s.poss = 'them'; sayT('chip', 'Chipped it deep to change. They have it.'); }
      else { s.poss = 'them'; sayT('badchange', 'Caught changing in your own end.'); }
    }

    // the draw
    if (s.dec === 'FO') {
      const winP = clamp(0.5 + (s.fo[s.on] - s.ofo[s.oon]) * 0.6 + (s.lines[s.on].e - s.olines[s.oon].e) * 0.05, 0.3, 0.7);
      const won = r() < winP;
      s.z = s.fz; s.poss = won ? 'you' : 'them';
      sayT('fo', won ? '{C} wins the draw.' : '{oC} wins the draw.', { won, zone: s.fz });
    }
    s.dec = 'PLAY';

    // ---------- the shift ----------
    const is3 = three(s);
    const st = SET[s.setup];
    let ticks = 0;
    const goal = (mine, empty = false) => {
      if (mine) s.you += 1; else s.opp += 1;
      if ((mine && s.pp > 0) || (!mine && s.pp < 0)) s.pp = 0;
      if (s.pulled) s.pulled = false;
      s.dec = 'FO'; s.fz = 'N'; s.oppStuck = false;
      if (s.per === 'OT') s.over = true;
      void empty;
    };
    const stop = (zone) => { s.dec = 'FO'; s.fz = zone; };
    while (ticks++ < 24) {
      const dt = 4 + Math.round(r() * 3);
      s.t = Math.max(0, s.t - dt);
      s.onSec += dt; s.oonSec += dt;
      s.lines.forEach((l, i) => { l.e = clamp(l.e + (i === s.on ? -dt * R.drain * (s.z === 'D' ? 1.25 : 1) : dt * R.rest), 0, 1); });
      s.olines.forEach((l, i) => { l.e = clamp(l.e + (i === s.oon ? -dt * R.drain * (s.z === 'O' && s.poss === 'you' ? 1.3 : 1) : dt * R.rest), 0, 1); });
      if (s.pp) { const left = Math.abs(s.pp) - dt; s.pp = left > 0 ? Math.sign(s.pp) * left : 0; }
      const sk = skaters(s);
      const eY = s.lines[s.on].e, eO = s.olines[s.oon].e;
      const lq = LQ[s.on], oq = LQ[s.oon];
      const youMul = s.per === 'REG' && diff(s) < 0 ? R.youQ : R.tiedQ;
      const themMul = s.per === 'REG' && diff(s) < 0 ? R.themQ : is3 ? R.them3 : R.themTied;
      const gassed = eO < 0.35 || s.oonSec > 50;
      const Y = adv(sk.you - sk.opp) * (is3 ? R.otOpen : 1) * lq.off * (0.65 + 0.35 * eY) * youMul * (gassed ? 1.45 : 1) * (s.xa === 'F' && s.pulled ? 1.08 : 1);
      const T = adv(sk.opp - sk.you) * (is3 ? R.otOpen : 1) * oq.off * (0.72 + 0.28 * eO) * (1.25 - 0.25 * eY) / lq.def * themMul;
      const L = s.look;
      const highMan = st.high * (s.d === 'pinch' ? 1.8 : 1) * (s.xa === 'D' && s.pulled ? 0.75 : 1);
      const engTry = (base, who = '{oD1}') => {
        const p = clamp(base * highMan * R.engMul, 0.02, 0.85);
        if (r() < p) { sayT('eng', `${who} from distance. Into the empty net.`, { res: 'goal' }); goal(false, true); return 'goal'; }
        return 'miss';
      };
      const shotFor = (q, from) => {
        const who = `{${SHOOTER[from][Math.floor(r() * SHOOTER[from].length)]}}`;
        const pg = clamp(q * Y, 0, 0.7);
        if (r() < pg) { sayT('shot', `${who} ${FROM[from]}. GOAL!`, { from, res: 'goal' }); goal(true); return 'goal'; }
        const block = from === 'point' ? (L === 'box' ? 0.18 : L === 'pressure' ? 0.45 : 0.3) : 0.12;
        const x = r();
        const res = x < block ? 'block' : x < block + (1 - block) * 0.72 ? 'save' : 'wide';
        sayT('shot', `${who} ${FROM[from]}: ${RES[res]}`, { from, res });
        return res;
      };
      const against = (q, from, who = '{oRW}') => {
        if (s.pulled) return engTry(0.55, who) === 'goal';
        if (r() < clamp(q * T, 0, 0.7)) { sayT('against', `${who} ${FROM[from]}. Goal.`, { from, res: 'goal' }); goal(false); return true; }
        sayT('stop', `${who} ${FROM[from]}: {G} makes the save.`, { from });
        if (r() < 0.4) stop('D');
        return false;
      };

      if (s.z === 'O' && s.poss === 'you') {
        const xgMul = { umb: { box: 2.0, pressure: 0.6, sag: 0.9 }, over: { box: 0.55, pressure: 2.2, sag: 0.8 }, crash: { box: 0.7, pressure: 0.75, sag: 2.1 } }[s.setup][L];
        const right = xgMul > 1.5;   // the setup that beats what they are showing also gets more pucks to the net
        const shotP = st.shotP * (s.setup === 'umb' && L === 'pressure' ? 0.6 : 1) * (right ? 1.25 : 1);
        const turn = st.turn * (s.setup === 'umb' && L === 'pressure' ? 2 : 1) * (right ? 0.7 : xgMul < 0.8 ? 1.3 : 1);
        if (r() < shotP) {
          const from = st.from[Math.floor(r() * st.from.length)];
          const res = shotFor(st.xg * xgMul, from);
          if (res === 'goal') break;
          if (res === 'save') {
            if (r() < 0.3) { stop('O'); sayT('freeze', '{oG} freezes it. Faceoff in their end.'); break; }
            if (r() < st.reb * (s.setup === 'crash' && L === 'sag' ? 1.6 : 1)) { if (shotFor(0.1 * (L === 'sag' ? 1.3 : 1), 'rebound') === 'goal') break; }
          }
          if (r() < st.keep + (s.d === 'pinch' ? 0.1 : 0)) { if (r() < 0.5) sayT('keep', '{D1} keeps it alive at the line.'); }
          else { s.poss = 'them'; }
        } else if (r() < turn) { s.poss = 'them'; sayT('turn', L === 'pressure' ? '{oLW} jumps the point and takes it.' : '{oC} picks it off on the cycle.'); }
        else sayT('cycle', s.setup === 'umb' ? '{D1} to {C} in the bumper, back up top.' : s.setup === 'over' ? '{LW} and {C} work it low on the strong side.' : '{RW} and {LW} fight for it in front.');
      } else if (s.z === 'O') {
        // they have it in their end and try to get it out
        const keepIn = 0.3 + (s.d === 'pinch' ? 0.18 : 0) + (s.setup === 'crash' ? 0.03 : 0) - (gassed ? -0.08 : 0);
        if (r() < keepIn) { s.poss = 'you'; sayT('keep', s.d === 'pinch' ? '{D2} pinches and keeps it in.' : '{D1} holds the line.'); }
        else if (s.pulled) {
          if (engTry(R.eng, '{oD1}') === 'goal') break;
          if (r() < R.icing) { stop('O'); s.oppStuck = true; sayT('icing', '{oD1} fires at the empty net and misses. Icing: their line has to stay out.'); break; }
          s.z = 'N'; s.poss = r() < 0.55 ? 'you' : 'them'; sayT('clear', s.poss === 'you' ? 'Cleared. {D1} goes back for it.' : 'Cleared. They have it at center.');
        } else if (s.d === 'pinch' && r() < 0.45) {
          sayT('rush', 'The pinch misses. Odd-man rush the other way.');
          if (against(0.15, 'rush')) break;
          if (s.dec === 'FO') break;
          s.z = 'D'; s.poss = r() < 0.5 ? 'you' : 'them';
        } else if (r() < 0.12) { stop('O'); s.oppStuck = true; sayT('icing', 'They ice it. Their line has to stay out.'); break; }
        else { s.z = 'N'; s.poss = r() < 0.45 ? 'you' : 'them'; sayT('clear', '{oD1} clears it.'); }
      } else if (s.z === 'N' && s.poss === 'you') {
        const entry = clamp(0.55 * (0.8 + 0.2 * lq.off) * (0.8 + 0.2 * eY) + (L === 'box' ? 0.05 : L === 'pressure' ? -0.06 : 0) + (s.pulled ? 0.06 : 0) + (gassed ? 0.08 : 0), 0.2, 0.9);
        if (r() < entry) { s.z = 'O'; s.poss = 'you'; sayT('entry', '{C} gets it in. Set up.', { ok: true }); }
        else {
          s.poss = 'them'; sayT('entry', '{oD1} stands up {C} at the line.', { ok: false });
          if (s.pulled) { if (engTry(0.18, '{oC}') === 'goal') break; s.poss = 'you'; }
        }
      } else if (s.z === 'N') {
        if (s.pulled) { if (engTry(0.2, '{oC}') === 'goal') break; s.poss = 'you'; sayT('take', '{D2} retrieves it.'); continue; }
        const x = r();
        const take = 0.2 + (s.d === 'pinch' ? 0.1 : 0);
        if (x < take) { s.poss = 'you'; sayT('take', '{LW} forces the turnover in the neutral zone.'); }
        else if (x < take + 0.4) { s.z = 'D'; s.poss = r() < 0.6 ? 'you' : 'them'; sayT('dumpin', s.poss === 'you' ? '{oC} dumps it in. {D1} retrieves.' : '{oC} dumps it in and they win the race.'); }
        else if (s.d === 'pinch' && r() < 0.25) { s.z = 'D'; s.poss = 'them'; sayT('rush', 'They get behind your pinching D.'); if (against(0.1, 'rush')) break; if (s.dec === 'FO') break; }
        else { s.z = 'D'; s.poss = 'them'; sayT('zone', 'They carry it in.'); }
      } else if (s.poss === 'them') {
        // your end
        if (s.pulled) { if (engTry(0.6, '{oRW}') === 'goal') break; s.poss = 'you'; continue; }
        if (r() < 0.35) { if (against(0.06, r() < 0.5 ? 'point' : 'slot', r() < 0.5 ? '{oD1}' : '{oRW}')) break; if (s.dec === 'FO') break; }
        if (r() < 0.32 + 0.2 * lq.def * eY - 0.1) { s.poss = 'you'; sayT('take', '{D2} wins the puck battle.'); }
      } else {
        // breaking out
        if (r() < 0.72 + 0.1 * eY) { s.z = 'N'; sayT('breakout', '{D1} up to {LW}. Out of the zone.'); }
        else { s.poss = 'them'; sayT('turn', 'The outlet is picked off.'); }
      }
      // penalties
      if (s.pp === 0 && r() < (s.z === 'O' ? R.penOpp : s.z === 'D' ? R.penYou : 0.01) * dt / 60) {
        if (s.z !== 'D') { s.pp = 120; stop('O'); sayT('pp', 'Penalty on {oD2}. Power play.'); }
        else { s.pp = -120; stop('D'); sayT('pk', 'Penalty on {D2}. Penalty kill.'); }
        break;
      }
      if (s.t <= 0) break;
      // their change on the fly (not while you have them pinned in their end)
      if (s.oonSec > 45 && !(s.z === 'O' && s.poss === 'you')) {
        const pick = [0, 1, 2].sort((a, b) => s.olines[b].e - s.olines[a].e)[0];
        if (pick !== s.oon) { s.oon = pick; s.oonSec = 0; say('ochange', 'They change on the fly: {oC}, {oLW}, {oRW} out.', tag()); }
      }
      // your line has been out long enough: your call
      if (s.onSec >= s.askAt && s.z !== 'D') { s.dec = 'FLY'; break; }
      if (s.onSec >= s.askAt + 25) { s.dec = 'FLY'; break; }
    }
    if (s.dec === 'PLAY') s.dec = 'FLY';
    s.ticks = ticks;
    finishClock(s, say);
    if (!s.over) s.look = pickLook(s, r);
    return s;
  }

  function finishClock(s, say) {
    if (s.over) { s.won = s.you > s.opp; s.how = s.how || 'OT'; return; }
    if (s.t > 0) return;
    if (s.per === 'REG') {
      if (s.you !== s.opp) { s.over = true; s.won = s.you > s.opp; s.how = 'REG'; say('end', 'Final horn.'); return; }
      s.per = 'OT'; s.otNum = 1; s.t = s.playoff ? 1200 : 300; s.dec = 'FO'; s.fz = 'N'; s.pulled = false; s.oppPulled = false;
      s.lines.forEach((l) => { l.e = 1; }); s.olines.forEach((l) => { l.e = 1; }); s.onSec = 0; s.oonSec = 0;
      if (s.pp) s.pp = Math.sign(s.pp) * Math.min(Math.abs(s.pp), 120);
      say('ot', s.playoff ? 'Tied at the end of regulation. Sudden-death overtime: 20 minutes, full strength, next goal wins.' : 'Tied at the end of regulation. 3-on-3 overtime.');
    } else if (s.per === 'OT' && s.playoff) {
      s.otNum += 1; s.t = 1200; s.dec = 'FO'; s.fz = 'N'; s.lines.forEach((l) => { l.e = 1; }); s.olines.forEach((l) => { l.e = 1; });
      say('ot', `Still tied. ${s.otNum === 2 ? 'Double' : s.otNum === 3 ? 'Triple' : `${s.otNum}x`} overtime.`);
    } else if (s.per === 'OT') {
      s.per = 'SO';
      say('so', 'Still tied after overtime. Shootout.');
    }
  }

  // ---------- the typical NHL bench, who finishes every simulated game ----------
  function coachBase(s) {
    const o = options(s);
    const d = diff(s);
    // lines: the top line when it has legs, otherwise the freshest of the top two, the third line only when both are gassed
    const e = s.lines.map((l) => l.e);
    let line = s.on;
    const tired = e[s.on] < 0.5 || s.onSec >= R.shift;
    if (s.dec === 'FO' || tired) {
      if (s.dec === 'FLY' && s.z === 'D') line = s.on;
      else if (e[0] > 0.7) line = 0;
      else if (Math.max(e[0], e[1]) > 0.45) line = e[0] >= e[1] ? 0 : 1;
      else line = [0, 1, 2].sort((a, b) => e[b] - e[a])[0];
    }
    let goalie = o.goalie[0];
    if (o.goalie.includes('pullF') && s.per === 'REG' && d < 0 && s.t <= (R.pullAt[String(Math.max(d, -2))] ?? 300)) goalie = 'pullF';
    if (o.goalie.includes('back') && d >= 0) goalie = 'back';
    const pulling = goalie === 'pullF' || goalie === 'pullD' || (s.pulled && goalie !== 'back');
    const timeout = o.timeout.length > 1 && d < 0 && ((pulling && s.t < 120 && s.fz === 'O') || (s.t < 60 && s.fz === 'O'));
    return { line, goalie, timeout };
  }
  const MIX = { setup: { umb: 0.45, over: 0.35, crash: 0.2 }, d: { safe: 0.6, pinch: 0.4 } };
  function coach(s, r) {
    const b = coachBase(s);
    let x = r(), setup = 'umb';
    for (const [k, w] of Object.entries(MIX.setup)) { if (x < w) { setup = k; break; } x -= w; }
    const d = r() < MIX.d.pinch * (diff(s) < 0 ? 1 : 0.5) ? 'pinch' : 'safe';
    return { ...b, setup, d };
  }
  // play the game out; returns the win value (shootouts count at their real win chance)
  function finish(s, r) {
    let guard = 0;
    while (!s.over && s.per !== 'SO' && s.otNum < 3 && guard++ < 300) resolve(s, coach(s, r), r);
    if (!s.over && s.otNum >= 3) return 0.5;
    if (s.per === 'SO' && !s.over) return s.soWin;
    return s.won ? 1 : 0;
  }

  // ---------- grading ----------
  // win chance of a set of choices from this spot, the same luck for every choice
  function evaluate(s, list, n = 1200, seed = 1) {
    const wins = new Float64Array(list.length);
    for (let k = 0; k < n; k++) {
      for (let i = 0; i < list.length; i++) {
        const r = mulberry(seed * 7919 + k * 104729 + 13);
        const g = clone(s);
        resolve(g, list[i], r);
        wins[i] += finish(g, r);
      }
    }
    return list.map((c, i) => ({ ...c, wp: wins[i] / n }));
  }
  // grade a choice: one dimension at a time (what else could you have done with the rest the same),
  // the best of each combined, and what a typical bench would have done here
  function grade(s, mine, n = 1200, seed = 1) {
    const o = options(s);
    const dims = { line: o.lines, setup: o.setups, d: o.d, goalie: o.goalie, timeout: o.timeout };
    const list = [mine];
    const seen = new Set([key(mine)]);
    const add = (c) => { const k = key(c); if (!seen.has(k)) { seen.add(k); list.push(c); } };
    for (const [dim, vals] of Object.entries(dims)) for (const v of vals) add({ ...mine, [dim]: v });
    // a typical bench: its line, goalie and timeout, and its usual mix of setups and D
    const b = coachBase(s);
    const typ = [];
    for (const [setup, ws] of Object.entries(MIX.setup)) for (const d of ['safe', 'pinch']) {
      const pinchW = MIX.d.pinch * (diff(s) < 0 ? 1 : 0.5);
      const c = { ...b, setup, d };
      typ.push([c, ws * (d === 'pinch' ? pinchW : 1 - pinchW)]);
      add(c);
    }
    let res = evaluate(s, list, n, seed);
    const wp = (c) => res.find((x) => key(x) === key(c)).wp;
    const myWp = wp(mine);
    const perDim = {};
    const best = { ...mine };
    for (const [dim, vals] of Object.entries(dims)) {
      if (vals.length < 2) continue;
      let bv = mine[dim], bw = myWp;
      for (const v of vals) { const w = wp({ ...mine, [dim]: v }); if (w > bw) { bw = w; bv = v; } }
      perDim[dim] = { best: bv, gain: bw - myWp };
      best[dim] = bv;
    }
    // the best of each, together
    if (!seen.has(key(best))) { res = res.concat(evaluate(s, [best], n, seed)); seen.add(key(best)); }
    const top = res.reduce((a, x) => (x.wp > a.wp ? x : a), res[0]);
    const typWp = typ.reduce((a, [c, w]) => a + w * wp(c), 0);
    const typV = typ.reduce((a, [c, w]) => a + w * (wp(c) - typWp) ** 2, 0);
    return { mine: myWp, best: top, bestWp: top.wp, perDim, typ: typWp, typV };
  }
  // the verdict on one decision, in words
  function verdict(loss, best) {
    if (best < 0.01) return { k: 'none', text: 'Out of reach. Not graded.' };
    const l = loss * clamp(0.15 / best, 1, 3);   // edges count for more when there is less to play with
    if (l <= 0.003) return { k: 'best', text: 'The best call.' };
    if (l <= 0.012) return { k: 'good', text: 'As good as any (inside the margin).' };
    if (l <= 0.03) return { k: 'ok', text: 'Decent.' };
    return { k: 'bad', text: 'Costly.' };
  }
  function phi(z) { const t = 1 / (1 + 0.2316419 * Math.abs(z)); const d = 0.3989423 * Math.exp(-z * z / 2); const p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274)))); return z > 0 ? 1 - p : p; }

  // ---------- shootout ----------
  const MOVES = [
    ['glove', 'Glove side, high'], ['blocker', 'Blocker side, low'], ['five', 'Five-hole'], ['deke', 'Deke to the backhand'],
  ];
  const LEAGUE = 0.32;
  const shrinkShooter = (g, s) => (g + LEAGUE * 10) / (s + 10);
  const shrinkGoalie = (sv, s) => (sv + (1 - LEAGUE) * 10) / (s + 10);
  const log5 = (a, b) => { const x = (a * b) / LEAGUE, y = ((1 - a) * (1 - b)) / (1 - LEAGUE); return x / (x + y); };

  function shootout(sc) {
    const r = mulberry(hash(`so${sc.id}`));
    const gYou = sc.roster.youG ?? { sv: 0, s: 0 }, gOpp = sc.roster.oppG ?? { sv: 0, s: 0 };
    const svOpp = shrinkGoalie(gOpp.sv || 0, gOpp.s || 0), svYou = shrinkGoalie(gYou.sv || 0, gYou.s || 0);
    // their goalie's tendencies (hidden), centered on zero
    let gm = MOVES.map(() => (r() - 0.5) * 0.12);
    const mean = gm.reduce((a, b) => a + b, 0) / gm.length;
    gm = gm.map((x) => x - mean);
    const shooters = sc.roster.you.map((p) => {
      const sig = Math.floor(r() * MOVES.length);
      const base = log5(shrinkShooter(p.g || 0, p.s || 0), 1 - svOpp);
      const by = MOVES.map((_, m) => clamp(base + gm[m] + (m === sig ? 0.04 : -0.015), 0.04, 0.8));
      return { ...p, base, sig, by };
    });
    const theirs = sc.roster.opp.map((p) => ({ ...p, p: clamp(log5(shrinkShooter(p.g || 0, p.s || 0), 1 - svYou) + 0.03, 0.05, 0.8) }));
    if (!theirs.length) theirs.push({ n: 'Their shooter', p: 0.33 });
    const order = theirs.slice().sort((a, b) => b.p - a.p);
    const so = { shooters, theirs: order, gm, svOpp, svYou, youFirst: !!sc.you.home };
    so.win = soValue(so, { round: 0, you: 0, opp: 0, used: [] }).v;
    so.sc = sc;
    return so;
  }

  // win chance from a shootout state, with your best remaining shooter and move every round from here on.
  // Rounds 1-3 are worked out exactly; sudden death (tied after 3) uses the closed form for repeated rounds.
  function soValue(so, st) {
    const { round, you, opp } = st;
    const best = bestShot(so, st.used);
    const pY = best.p;
    const pO = so.theirs[round % so.theirs.length].p;
    if (round >= 3) { const a = pY * (1 - pO), b = pO * (1 - pY); return { v: a + b > 0 ? a / (a + b) : 0.5 }; }
    const used = st.used.length + 1 >= so.shooters.length ? [] : [...st.used, best.i];
    return { v: soRound(so, round, you, opp, used, pY, pO) };
  }
  // value of one round given both shooters' chances, then the rest
  function soRound(so, round, you, opp, used, pY, pO) {
    const after = (dy, dob) => {
      const ny = you + dy, no = opp + dob, nr = round + 1;
      if (nr >= 3 && ny !== no) return ny > no ? 1 : 0;
      if (nr < 3) { const left = 3 - nr; if (ny > no + left) return 1; if (no > ny + left) return 0; }
      return soValue(so, { round: nr, you: ny, opp: no, used }).v;
    };
    return pY * pO * after(1, 1) + pY * (1 - pO) * after(1, 0) + (1 - pY) * pO * after(0, 1) + (1 - pY) * (1 - pO) * after(0, 0);
  }
  function bestShot(so, used) {
    let best = { p: -1, i: 0, m: 0 };
    so.shooters.forEach((sh, i) => { if (used.includes(i)) return; sh.by.forEach((p, m) => { if (p > best.p) best = { p, i, m }; }); });
    return best;
  }
  // win chance of each shooter/move pick for your attempt in this round
  function soGrade(so, st) {
    const out = [];
    const pO = so.theirs[st.round % so.theirs.length].p;
    so.shooters.forEach((sh, i) => {
      if (st.used.includes(i)) return;
      const used = st.used.length + 1 >= so.shooters.length ? [] : [...st.used, i];
      sh.by.forEach((p, m) => {
        let v;
        if (st.round >= 3) {
          // sudden death: this round, then the closed form with your best remaining shooters
          const rest = soValue(so, { round: st.round + 1, you: 0, opp: 0, used }).v;
          v = p * (1 - pO) + (p * pO + (1 - p) * (1 - pO)) * rest;
        } else v = soRound(so, st.round, st.you, st.opp, used, p, pO);
        out.push({ i, m, p, wp: v });
      });
    });
    return out.sort((a, b) => b.wp - a.wp);
  }



  globalThis.Drill = { R, LQ, SETUPS, SETUPS3, DMODES, LOOKS, MOVES, newGame, options, resolve, grade, evaluate, verdict, phi, key, coach, coachBase,
    finish, clone, lookInfo, shootout, soValue, soGrade, mulberry, hash, fmt, skaters, diff, three };
})();
