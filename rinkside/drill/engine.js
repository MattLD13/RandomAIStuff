// Empty Net: the game model. Plain script (no imports/exports) so it can be inlined into the page
// and also loaded by node for calibration (drill/check.mjs). Sets globalThis.Drill.
//
// One call per possession. With the puck: go now, set it up, get it to the point, crash the net, dump and
// change; in their end: shoot now, work it low; off a draw in their end: the one-timer set play. The goalie
// pull and the timeout are options on the same menu ("Pull the goalie, then attack", "Five forwards, all in",
// "Timeout, draw up a play"). Without it: play it straight, forecheck hard, sell out. You can feed one of
// your real players (their real shooting talent counts; picking a star on the bench sends his line out).
// Lines change on their own as legs go. Every call is graded by Monte Carlo against the other calls you had.
(function () {
  // ---------- rates (tuned by drill/check.mjs against ~950 real late one-goal endings) ----------
  const R = {
    adv: { '-2': 0.18, '-1': 0.42, '0': 1, '1': 1.75, '2': 2.4, '3': 2.8 },
    youQ: 0.39, tiedQ: 1, themQ: 1, themTied: 1.6, them3: 2.5, otOpen: 0.5, engMul: 1.7,
    engClear: 0.1, icing: 0.35, penOpp: 0.05, penYou: 0.03,
    pullAt: { '-1': 100, '-2': 200 }, lgSh: 0.095, pace: 1.4,
  };
  const LQ = [{ off: 1.25, def: 0.97 }, { off: 1.0, def: 1.0 }, { off: 0.8, def: 1.1 }];

  const mulberry = (a) => () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const hash = (str) => { let h = 2166136261; for (const c of String(str)) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); } return h >>> 0; };
  const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
  const fmt = (t) => `${Math.floor(t / 60)}:${String(Math.round(t) % 60).padStart(2, '0')}`;

  // ---------- the calls ----------
  const CALLS = {
    oneT: ['One-timer off the draw', 'Win it to the circle and let it go.'],
    point: ['Get it to the point', 'Shots through traffic, bodies at the net.'],
    crash: ['Crash the net', 'Drive it, chaos in the crease. Thin behind.'],
    go: ['Go now', 'Carry it in with speed, first good look.'],
    setup: ['Set it up', 'Enter clean, cycle, work for a better shot.'],
    dump: ['Dump and change', 'Fresh legs. Gives up the puck.'],
    shoot: ['Shoot now', 'Get it on net before they set.'],
    low: ['Work it low', 'Below the dots, find the slot.'],
    pull: ['Pull the goalie, then attack', 'Six on five.'],
    allin: ['Five forwards, all in', 'Goalie out, no D back. Everything for the tying goal.'],
    to: ['Timeout, draw up a play', 'Fresh legs and a set play off the draw.'],
    straight: ['Play it straight', 'Protect the slot. They burn clock.'],
    press: ['Forecheck hard', 'Go for the turnover. Odd-man rush if it fails.'],
    sellout: ['Sell out, everyone up', 'All five hunt the puck. Burned if they get by.'],
  };
  // the reads: what they are showing, by situation
  const LOOKS = {
    YOU_N: [['trap', '1-3-1 trap', 'Three across the neutral zone. Nothing up the middle.'], ['change', 'They are changing', 'Two forwards heading for the bench.'], ['gap', 'Tight gap at the line', 'Their D are standing up at the blue line.'], ['soft', 'Soft through the middle', 'Their forwards are slow getting back.']],
    YOU_O: [['box', 'Collapsing in front', 'Five inside the dots. They will give you the point.'], ['pressure', 'Jumping your points', 'Their wingers are pressuring your D at the line.'], ['sag', 'Sagging off', 'Soft on the puck, and {oG} is leaking rebounds.']],
    THEM: [['clock', 'Killing clock', 'Cycling along the wall, not looking to shoot.'], ['stretch', 'Looking long', 'A forward is hanging at your blue line.'], ['shoot', 'Looking to shoot', 'Their D are walking the line for a lane.']],
  };
  LOOKS.FO_O = LOOKS.YOU_O;

  // ---------- players ----------
  // shooting talent from the season: goals per shot, shrunk toward league average
  const talent = (p) => (p && p.ss ? clamp(((p.sg || 0) + R.lgSh * 60) / (p.ss + 60) / R.lgSh, 0.7, 1.5) : 1);
  function rosterOf(sc) {
    const L = sc.lines;
    const fake = (n) => ({ n, num: '', sg: 0, ss: 0 });
    if (!L) return { you: { lines: [0, 1, 2].map((i) => [fake(`C${i}`), fake(`LW${i}`), fake(`RW${i}`)]), pairs: [[fake('D1'), fake('D2')], [fake('D3'), fake('D4')]], fo: [[0, 0], [0, 0], [0, 0]] }, opp: null };
    return { you: L.you, opp: L.opp };
  }

  // ---------- state ----------
  function newGame(sc) {
    const so = shootout(sc);
    const L = sc.lines, ro = rosterOf(sc);
    const on = L ? L.you.onIce : 0, oon = L ? L.opp.onIce : 0;
    const shiftSec = L ? L.you.shiftSec : 15, oShift = L ? L.opp.shiftSec : 15;
    const s = {
      id: sc.id, playoff: sc.type === 3, otNum: 0, per: 'REG', t: sc.start.t, you: sc.start.you, opp: sc.start.opp,
      pulled: false, five: false, oppPulled: false, to: true, pp: 0,
      lines: [0, 1, 2].map((i) => ({ e: i === on ? clamp(1 - shiftSec / 70, 0.3, 1) : 0.9 })),
      olines: [0, 1, 2].map((i) => ({ e: i === oon ? clamp(1 - oShift / 70, 0.3, 1) : 0.9 })),
      on, oon, onSec: shiftSec, oonSec: oShift,
      fo: ro.you.fo.map(([w, t]) => (w + 5) / (t + 10)), ofo: L ? L.opp.fo.map(([w, t]) => (w + 5) / (t + 10)) : [0.5, 0.5, 0.5],
      tal: { lines: ro.you.lines.map((l) => l.map(talent)), pairs: ro.you.pairs.map((p) => p.map(talent)) },
      ctx: sc.start.zone === 'O' ? 'FO_O' : 'FO', fz: sc.start.zone, look: 'box', oppStuck: false, bonus: 0,
      over: false, won: null, how: null, soWin: so.win, pulls: [], last: null,
    };
    if (s.ctx === 'FO') drawFaceoff(s, mulberry(hash(`fo${sc.id}`)), () => {});
    s.look = pickLook(s, mulberry(hash(`look${sc.id}`)));
    return s;
  }
  const clone = (s) => ({ ...s, pulls: s.pulls.slice(), lines: s.lines.map((l) => ({ ...l })), olines: s.olines.map((l) => ({ ...l })) });
  const diff = (s) => s.you - s.opp;
  const three = (s) => s.per === 'OT' && !s.playoff;
  const pairOf = (line) => (line === 2 ? 1 : 0);

  function pickLook(s, r) {
    const list = LOOKS[s.ctx] || LOOKS.YOU_O;
    const w = list.map(([id]) => (id === 'box' && s.pulled ? 2.2 : id === 'clock' && diff(s) < 0 ? 1.6 : id === 'change' && s.olines[s.oon].e < 0.5 ? 2 : 1));
    let x = r() * w.reduce((a, b) => a + b, 0);
    for (let i = 0; i < list.length; i++) { if (x < w[i]) return list[i][0]; x -= w[i]; }
    return list[0][0];
  }
  const lookInfo = (s) => (LOOKS[s.ctx] || LOOKS.YOU_O).find((l) => l[0] === s.look) || (LOOKS[s.ctx] || LOOKS.YOU_O)[0];

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

  // what can be called right now
  function options(s) {
    const pullOK = s.per === 'REG' && !s.pulled && diff(s) < 0;
    let base;
    if (s.ctx === 'FO_O') base = ['oneT', 'point', 'crash'];
    else if (s.ctx === 'YOU_N') base = ['go', 'setup', 'point', 'crash'].concat(s.lines[s.on].e < 0.5 && !s.pulled ? ['dump'] : []);
    else if (s.ctx === 'YOU_O') base = ['shoot', 'low', 'point', 'crash'];
    else return ['straight', 'press'].concat(s.per === 'REG' && diff(s) < 0 && s.t < 240 ? ['sellout'] : []);
    if (pullOK) base = base.concat(['pull', 'allin']);
    if (s.ctx === 'FO_O' && s.to && s.per === 'REG') base = base.concat(['to']);
    return base;
  }
  // players you can feed: everyone on the ice, plus the top forwards on the bench
  function feedable(s) {
    if (s.ctx === 'THEM') return [];
    const out = [];
    for (let i = 0; i < 3; i++) out.push({ key: `L${s.on}-${i}`, on: true });
    for (let i = 0; i < 2; i++) out.push({ key: `P${pairOf(s.on)}-${i}`, on: true });
    for (const l of [0, 1, 2]) if (l !== s.on) for (let i = 0; i < 3; i++) out.push({ key: `L${l}-${i}`, on: false });
    return out;
  }
  const keyTal = (s, k) => { if (!k) return 1; const [g, a, b] = [k[0], +k[1], +k[3]]; return g === 'L' ? s.tal.lines[a][b] : s.tal.pairs[a][b]; };
  const key = (c) => `${c.call}|${c.focus || ''}`;

  // ---------- faceoffs outside their end resolve on their own ----------
  function drawFaceoff(s, r, say) {
    const won = r() < clamp(0.5 + (s.fo[s.on] - s.ofo[s.oon]) * 0.6, 0.3, 0.7);
    say('fo', won ? '{C} wins the draw.' : '{oC} wins the draw.', { won, zone: s.fz });
    s.ctx = s.fz === 'D' ? (won ? 'YOU_N' : 'THEM') : won ? 'YOU_N' : 'THEM';
    s.t = Math.max(0, s.t - 2);
  }

  // ---------- one possession ----------
  // say(kind, text, data): names are tokens: {C} {LW} {RW} {D1} {D2} {X} {S} (the shooter) {G}; {oC} {oLW} {oRW} {oD1} {oD2} {oG}
  const FROM = { point: 'from the point', circle: 'one-timer from the circle', slot: 'from the slot', rush: 'off the rush', rebound: 'on the rebound', crease: 'at the crease', wall: 'from the half-wall', breakaway: 'on a breakaway' };
  const RES = { save: 'saved by {oG}.', block: 'blocked.', wide: 'wide.' };

  function resolve(s, c, rng, say = () => {}) {
    const r = rng;
    const tag = (extra = {}) => ({ line: s.on, oline: s.oon, ctx: s.ctx, look: s.look, pulled: s.pulled, five: s.five, ...extra });
    const sayT = (k, text, extra) => say(k, text, tag(extra));
    let call = c.call, focus = c.focus || null;
    const ctx0 = s.ctx;
    // the menu items that are also decisions about the goalie and the timeout
    let intent = call;
    if (call === 'pull' || call === 'allin') {
      s.pulled = true; s.five = call === 'allin'; s.pulls.push(s.t);
      sayT('pull', s.five ? `{G} to the bench with ${fmt(s.t)} left. Five forwards on.` : `{G} to the bench with ${fmt(s.t)} left. Six on five.`);
      intent = call === 'allin' ? 'crash' : ctx0 === 'YOU_N' ? 'setup' : 'point';
    }
    if (call === 'to') { s.to = false; s.lines.forEach((l) => { l.e = Math.min(1, l.e + 0.25); }); s.bonus += 0.12; sayT('timeout', 'Timeout. A set play, fresh legs.'); intent = 'oneT'; }
    // lines: a star you feed brings his line out; otherwise tired lines change at a stoppage or a regroup
    const want = focus && focus[0] === 'L' ? +focus[1] : null;
    let changed = false;
    if (want != null && want !== s.on) { s.on = want; s.onSec = 0; changed = true; }
    else if (ctx0 !== 'YOU_O' && s.lines[s.on].e < 0.42) { const best = [0, 1, 2].sort((a, b) => s.lines[b].e + (b === 0 ? 0.12 : 0) - (s.lines[a].e + (a === 0 ? 0.12 : 0)))[0]; if (best !== s.on) { s.on = best; s.onSec = 0; changed = true; } }
    if (changed) sayT('change', 'Line change: {C}, {LW}, {RW} on.');
    if (focus && focus[0] === 'P' && +focus[1] !== pairOf(s.on)) focus = null;
    // their line: changes when tired, except stuck after an icing
    if (!s.oppStuck && s.olines[s.oon].e < 0.45) { const best = [0, 1, 2].sort((a, b) => s.olines[b].e - s.olines[a].e)[0]; if (best !== s.oon) { s.oon = best; s.oonSec = 0; sayT('ochange', 'They change: {oC}, {oLW}, {oRW} out.'); } }
    if (s.oppStuck && ctx0 === 'FO_O') sayT('stuck', `Their line is stuck out there after the icing: ${Math.round(s.oonSec)} seconds.`);
    s.oppStuck = false;
    s.oppPulled = s.per === 'REG' && diff(s) > 0 && s.t <= 150;

    const is3 = three(s);
    const sk = skaters(s);
    const eY = s.lines[s.on].e, eO = s.olines[s.oon].e;
    const youMul = s.per === 'REG' && diff(s) < 0 ? R.youQ : R.tiedQ;
    const themMul = s.per === 'REG' && diff(s) < 0 ? R.themQ : is3 ? R.them3 : R.themTied;
    const gassed = eO < 0.4 || s.oonSec > 50;
    const L = s.look;
    const Y = adv(sk.you - sk.opp) * (is3 ? R.otOpen : 1) * LQ[s.on].off * (0.65 + 0.35 * eY) * youMul * (gassed ? 1.35 : 1) * (s.five ? 1.15 : 1) * (1 + s.bonus) * (changed && ctx0 === 'YOU_O' ? 0.9 : 1);
    s.bonus = 0;
    const T = adv(sk.opp - sk.you) * (is3 ? R.otOpen : 1) * LQ[s.oon].off * (0.65 + 0.35 * eO) * (1.25 - 0.25 * eY) / LQ[s.on].def * themMul;
    const look = (m) => m[L] ?? 1;      // multiplies
    const lk = (m) => m[L] ?? 0;        // adds
    let dur = 0;
    const spend = (a, b) => { dur += Math.round((a + r() * (b - a)) * R.pace); };
    // the shooter: the player you fed, or whoever the play finds
    const pickShooter = (role) => {
      if (focus) return { tok: tokOf(s, focus), tal: keyTal(s, focus) * 0.95 };   // keyed on: a little harder to get him clean
      const pool = role === 'point' ? ['P0', 'P1'] : role === 'any' ? ['L0', 'L1', 'L2', 'P0'] : ['L0', 'L1', 'L2'];
      const k = pool[Math.floor(r() * pool.length)];
      const kk = k[0] === 'L' ? `L${s.on}-${+k[1]}` : `P${pairOf(s.on)}-${+k[1]}`;
      return { tok: tokOf(s, kk), tal: keyTal(s, kk) };
    };
    const goal = (mine) => {
      if (mine) s.you += 1; else s.opp += 1;
      if ((mine && s.pp > 0) || (!mine && s.pp < 0)) s.pp = 0;
      s.pulled = false; s.five = false;
      if (s.per === 'OT') s.over = true;
      s.ctx = 'FO'; s.fz = 'N';
    };
    // a shot of yours; returns the result
    const shot = (q, from, role, block = from === 'point' ? 0.3 : 0.12) => {
      const sh = pickShooter(role);
      const p = clamp(q * Y * sh.tal, 0, 0.7);
      if (r() < p) { sayT('shot', `${sh.tok} ${FROM[from]}. GOAL!`, { from, res: 'goal', who: sh.tok }); goal(true); return 'goal'; }
      const x = r();
      const res = x < block ? 'block' : x < block + (1 - block) * 0.72 ? 'save' : 'wide';
      sayT('shot', `${sh.tok} ${FROM[from]}: ${RES[res]}`, { from, res, who: sh.tok });
      return res;
    };
    // they fire at your empty net
    const engTry = (p, who = '{oD1}') => {
      if (r() < clamp(p * R.engMul * (s.five ? 1.5 : 1), 0, 0.85)) { sayT('eng', `${who} from distance. Into the empty net.`); goal(false); return true; }
      return false;
    };
    const against = (q, from, who = '{oRW}') => {
      if (s.pulled) return engTry(0.5, who);
      if (r() < clamp(q * T, 0, 0.75)) { sayT('against', `${who} ${FROM[from]}. Goal.`, { from }); goal(false); return true; }
      sayT('stop', `${who} ${FROM[from]}: {G} makes the save.`, { from });
      return false;
    };
    // after your shot: they freeze it, you keep it, or they get it
    const after = (res, keep, reb = 0, rebQ = 0.1) => {
      if (res === 'goal') return;
      if (res === 'save' && r() < 0.3) { s.ctx = 'FO_O'; sayT('freeze', '{oG} freezes it. Faceoff in their end.'); return; }
      if (res === 'save' && reb && r() < reb) { if (shot(rebQ, 'rebound', 'fwd') === 'goal') return; }
      if (r() < keep + (s.pulled ? 0.1 : 0)) { s.ctx = 'YOU_O'; sayT('keep', '{D1} keeps it alive at the line.'); return; }
      clear();
    };
    // they have it in their end and try to get it out
    const clear = (risk = 1) => {
      if (s.pulled) {
        if (engTry(R.engClear * risk)) return;
        if (r() < R.icing) { s.ctx = 'FO_O'; s.oppStuck = true; sayT('icing', '{oD1} fires at the empty net and misses. Icing: their line has to stay out.'); return; }
        s.ctx = r() < 0.55 ? 'YOU_N' : 'THEM'; sayT('clear', s.ctx === 'YOU_N' ? 'Cleared. {D1} goes back for it.' : 'Cleared. They have it at center.');
        return;
      }
      if (r() < 0.12) { s.ctx = 'FO_O'; s.oppStuck = true; sayT('icing', 'They ice it. Their line has to stay out.'); return; }
      s.ctx = r() < 0.45 ? 'YOU_N' : 'THEM'; sayT('clear', '{oD1} clears it.');
    };
    // a turnover at their blue line: the rush comes back at you
    const turnover = (q) => {
      if (s.pulled) { if (engTry(0.28, '{oC}')) return; s.ctx = 'YOU_N'; sayT('take', 'It misses. {D1} retrieves.'); return; }
      if (r() < 0.45) { if (against(q, 'rush', '{oC}')) return; s.ctx = r() < 0.5 ? 'YOU_N' : 'THEM'; return; }
      s.ctx = 'THEM';
    };

    // ---------- the possession ----------
    if (ctx0 === 'FO_O') {
      spend(6, 12);
      const won = r() < clamp(0.5 + (s.fo[s.on] - s.ofo[s.oon]) * 0.6 + (eY - eO) * 0.05 + (call === 'to' ? 0.04 : 0), 0.28, 0.72);
      sayT('fo', won ? '{C} wins the draw.' : '{oC} wins the draw.', { won, zone: 'O' });
      if (!won) clear(1.2);
      else if (intent === 'oneT') {
        if (r() < 0.6 + (call === 'to' ? 0.12 : 0)) after(shot(0.13 * look({ pressure: 1.3, box: 0.8 }), 'circle', 'fwd'), 0.35, 0.15);
        else { sayT('turn', 'The set play gets broken up.'); clear(1.2); }
      } else if (intent === 'point') after(shot(0.045 * look({ box: 2.1, pressure: 0.5, sag: 0.9 }), 'point', 'point', L === 'box' ? 0.18 : 0.32), 0.5, 0.3 * look({ sag: 1.4 }));
      else after(shot(0.055 * look({ sag: 2.1, box: 0.65, pressure: 0.9 }), 'crease', 'fwd'), 0.42, 0.45 * look({ sag: 1.3 }), 0.12);
    } else if (ctx0 === 'YOU_N') {
      if (intent === 'dump') {
        spend(8, 12);
        const best = [0, 1, 2].sort((a, b) => s.lines[b].e - s.lines[a].e)[0];
        if (best !== s.on) { s.on = best; s.onSec = 0; sayT('change', 'Dumped in. Fresh legs: {C}, {LW}, {RW} on.'); }
        if (r() < 0.42 + lk({ trap: 0.12, gap: 0.12 })) { s.ctx = 'YOU_O'; sayT('dumpin', '{LW} wins the race to the puck.', { ok: true }); }
        else { sayT('dumpin', '{oD1} gets there first.', { ok: false }); clear(0.8); }
      } else {
        const entryP = { go: 0.6, setup: 0.78, point: 0.72, crash: 0.68 }[intent] + lk({ trap: intent === 'go' ? -0.22 : -0.06, change: intent === 'go' ? 0.25 : 0.05, gap: intent === 'go' ? -0.12 : 0, soft: intent === 'go' ? 0.1 : 0.03 }) + (s.pulled ? 0.06 : 0) + (eY - 0.6) * 0.15;
        spend(4, 7);
        if (r() < clamp(entryP, 0.15, 0.95)) {
          sayT('entry', intent === 'go' ? '{C} carries it in with speed.' : '{C} gets it in clean.', { ok: true, kind: intent === 'go' ? 'carry' : 'enter' });
          if (intent === 'go') { spend(2, 4); after(shot(0.085 * look({ change: 1.9, soft: 1.4, trap: 0.8, gap: 0.8 }), 'rush', 'fwd', 0.1), 0.35, 0.2); }
          else if (intent === 'setup') { spend(12, 20); if (r() < 0.78) { sayT('cycle', '{C} and {LW} work it low.'); after(shot(0.075, 'slot', 'fwd'), 0.45, 0.15); } else { sayT('turn', '{oC} picks it off on the cycle.'); clear(); } }
          else if (intent === 'point') { spend(8, 14); sayT('cycle', 'Back to the point, bodies to the net.'); after(shot(0.045, 'point', 'point'), 0.5, 0.3); }
          else { spend(6, 10); after(shot(0.055, 'crease', 'fwd'), 0.42, 0.45, 0.12); }
        } else { sayT('entry', '{oD1} stands up {C} at the line.', { ok: false }); turnover(0.08); }
      }
    } else if (ctx0 === 'YOU_O') {
      if (intent === 'shoot') { spend(3, 6); after(shot(0.05 * look({ box: 0.9, pressure: 1.1, sag: 1.2 }), 'wall', 'any', L === 'box' ? 0.35 : 0.2), 0.35, 0.25 * look({ sag: 1.5 })); }
      else if (intent === 'low') {
        spend(10, 18);
        if (r() < 0.62 + lk({ pressure: 0.15, box: -0.08, sag: 0.05 })) { sayT('cycle', '{C} and {LW} work it below the dots.'); after(shot(0.1 * look({ pressure: 1.9, box: 0.6, sag: 0.9 }), 'slot', 'fwd'), 0.42, 0.15); }
        else { sayT('turn', 'Broken up along the wall.'); clear(1.1); }
      } else if (intent === 'point') {
        spend(6, 12);
        if (L === 'pressure' && r() < 0.2) { sayT('turn', '{oLW} jumps the point and is gone.'); if (s.pulled) { if (!engTry(0.45, '{oLW}')) s.ctx = 'YOU_N'; } else if (!against(0.15, 'breakaway', '{oLW}')) s.ctx = 'YOU_N'; }
        else after(shot(0.045 * look({ box: 2.1, pressure: 0.5, sag: 0.9 }), 'point', 'point', L === 'box' ? 0.18 : 0.32), 0.5, 0.3 * look({ sag: 1.4 }));
      } else { spend(5, 9); after(shot(0.055 * look({ sag: 2.1, box: 0.65, pressure: 0.9 }), 'crease', 'fwd'), 0.42, 0.45 * look({ sag: 1.3 }), 0.12); }
    } else {
      // their puck
      if (call === 'straight') {
        spend(14, 24);
        sayT('play', s.look === 'clock' ? 'They cycle it along the wall. The clock runs.' : 'You protect the slot.');
        if (s.pulled) { if (!engTry(0.3, '{oD1}')) s.ctx = 'YOU_N'; }
        else if (r() < 0.45 * look({ shoot: 1.5, clock: 0.5 })) { if (!against(0.06 * look({ shoot: 1.3 }), r() < 0.5 ? 'point' : 'slot', r() < 0.5 ? '{oD1}' : '{oRW}')) s.ctx = r() < 0.4 ? 'FO_D' : 'YOU_N'; }
        else { s.ctx = 'YOU_N'; sayT('take', 'They dump it. {D1} retrieves.'); }
      } else {
        const sell = call === 'sellout';
        spend(sell ? 4 : 6, sell ? 8 : 11);
        const steal = (sell ? 0.52 : 0.36) + lk({ clock: 0.12, stretch: -0.12 }) + (eY - 0.6) * 0.1;
        if (r() < steal) {
          sayT('take', sell ? 'Everyone up. {LW} strips them in their end.' : '{LW} forces the turnover.');
          s.ctx = 'YOU_O';
          if (r() < (sell ? 0.6 : 0.45)) after(shot(sell ? 0.1 : 0.08, 'slot', 'fwd'), 0.4, 0.2);
        } else {
          sayT('beat', sell ? 'They get by everyone.' : 'They beat the forecheck.');
          const q = (sell ? 0.24 : 0.12) * look({ stretch: 1.5 });
          if (s.pulled) { if (!engTry(sell ? 0.7 : 0.45, '{oC}')) s.ctx = 'YOU_N'; }
          else if (!against(q, sell ? 'breakaway' : 'rush', '{oC}')) s.ctx = r() < 0.6 ? 'YOU_N' : 'THEM';
        }
      }
      if (s.ctx === 'FO_D') { s.ctx = 'FO'; s.fz = 'D'; }
    }

    // the clock, legs, penalties
    dur = Math.max(dur, 3);
    s.t = Math.max(0, s.t - dur);
    s.onSec += dur; s.oonSec += dur;
    s.lines.forEach((l, i) => { l.e = clamp(l.e + (i === s.on ? -dur / 70 : dur / 95), 0, 1); });
    s.olines.forEach((l, i) => { l.e = clamp(l.e + (i === s.oon ? -dur / 70 * (ctx0 === 'YOU_O' || ctx0 === 'FO_O' ? 1.25 : 1) : dur / 95), 0, 1); });
    if (s.pp) { const left = Math.abs(s.pp) - dur; s.pp = left > 0 ? Math.sign(s.pp) * left : 0; }
    if (!s.over && s.pp === 0 && s.t > 0 && r() < (ctx0 === 'THEM' ? R.penYou : R.penOpp) * dur / 60) {
      if (ctx0 !== 'THEM') { s.pp = 120; s.ctx = 'FO_O'; sayT('pp', 'Penalty on {oD2}. Power play.'); }
      else { s.pp = -120; s.ctx = 'FO'; s.fz = 'D'; sayT('pk', 'Penalty on {D2}. Penalty kill.'); }
    }
    s.last = { ctx: ctx0, call, dur };
    finishClock(s, say);
    if (!s.over && s.per !== 'SO' && s.ctx === 'FO') drawFaceoff(s, r, (k, t, d) => sayT(k, t, d));
    if (!s.over) s.look = pickLook(s, r);
    return s;
  }
  const tokOf = (s, k) => {
    if (k[0] === 'P') return +k[3] === 0 ? '{D1}' : '{D2}';
    if (+k[1] !== s.on) return `{${k}}`;
    return ['{C}', '{LW}', '{RW}'][+k[3]];
  };

  function finishClock(s, say) {
    if (s.over) { s.won = s.you > s.opp; s.how = s.how || 'OT'; return; }
    if (s.t > 0) return;
    if (s.per === 'REG') {
      if (s.you !== s.opp) { s.over = true; s.won = s.you > s.opp; s.how = 'REG'; say('end', 'Final horn.', {}); return; }
      s.per = 'OT'; s.otNum = 1; s.t = s.playoff ? 1200 : 300; s.ctx = 'FO'; s.fz = 'N'; s.pulled = false; s.five = false; s.oppPulled = false;
      s.lines.forEach((l) => { l.e = 1; }); s.olines.forEach((l) => { l.e = 1; });
      if (s.pp) s.pp = Math.sign(s.pp) * Math.min(Math.abs(s.pp), 120);
      say('ot', s.playoff ? 'Tied at the end of regulation. Sudden-death overtime: 20 minutes, full strength, next goal wins.' : 'Tied at the end of regulation. 3-on-3 overtime.', {});
    } else if (s.per === 'OT' && s.playoff) {
      s.otNum += 1; s.t = 1200; s.ctx = 'FO'; s.fz = 'N'; s.lines.forEach((l) => { l.e = 1; }); s.olines.forEach((l) => { l.e = 1; });
      say('ot', `Still tied. ${s.otNum === 2 ? 'Double' : s.otNum === 3 ? 'Triple' : `${s.otNum}x`} overtime.`, {});
    } else if (s.per === 'OT') {
      s.per = 'SO';
      say('so', 'Still tied after overtime. Shootout.', {});
    }
  }

  // ---------- the typical NHL bench ----------
  const MIX = {
    FO_O: { oneT: 0.3, point: 0.45, crash: 0.25 }, YOU_N: { go: 0.38, setup: 0.32, point: 0.2, crash: 0.1 },
    YOU_O: { shoot: 0.3, low: 0.3, point: 0.25, crash: 0.15 }, THEM: { straight: 0.55, press: 0.45 },
  };
  function coach(s, r) {
    const o = options(s);
    if (o.includes('pull') && s.t <= (R.pullAt[String(Math.max(diff(s), -2))] ?? 300) && (s.ctx === 'FO_O' || s.ctx === 'YOU_N')) return { call: s.ctx === 'FO_O' && o.includes('to') && s.t < 120 ? 'to' : 'pull', focus: null };
    if (o.includes('to') && s.pulled && s.t < 90 && diff(s) < 0) return { call: 'to', focus: null };
    const mix = MIX[s.ctx];
    let x = r(), call = Object.keys(mix)[0];
    for (const [k, w] of Object.entries(mix)) { if (x < w) { call = k; break; } x -= w; }
    return { call, focus: null };
  }
  function finish(s, r) {
    let guard = 0;
    while (!s.over && s.per !== 'SO' && s.otNum < 3 && guard++ < 400) resolve(s, coach(s, r), r);
    if (!s.over && s.otNum >= 3) return 0.5;
    if (s.per === 'SO' && !s.over) return s.soWin;
    return s.won ? 1 : 0;
  }

  // ---------- grading ----------
  function evaluate(s, list, n = 800, seed = 1) {
    const wins = new Float64Array(list.length);
    for (let k = 0; k < n; k++) for (let i = 0; i < list.length; i++) {
      const r = mulberry(seed * 7919 + k * 104729 + 13);
      const g = clone(s);
      resolve(g, list[i], r);
      wins[i] += finish(g, r);
    }
    return list.map((c, i) => ({ ...c, wp: wins[i] / n }));
  }
  // your call against every other call (with the same player), and your player against the others (same call);
  // plus what a typical bench gets here
  function grade(s, mine, n = 800, seed = 1) {
    const o = options(s);
    const list = [], seen = new Set();
    const add = (c) => { const k = key(c); if (!seen.has(k)) { seen.add(k); list.push(c); } };
    add(mine);
    for (const call of o) add({ call, focus: mine.focus || null });
    if (s.ctx !== 'THEM') { add({ call: mine.call, focus: null }); for (const f of feedable(s)) add({ call: mine.call, focus: f.key }); }
    // the typical bench's calls
    const mix = MIX[s.ctx] || {};
    for (const call of Object.keys(mix)) add({ call, focus: null });
    const cb = coach(s, () => 0.5);
    add(cb);
    const res = evaluate(s, list, n, seed);
    const wp = (c) => (res.find((x) => key(x) === key(c)) || { wp: 0 }).wp;
    const best = res.reduce((a, x) => (x.wp > a.wp ? x : a), res[0]);
    const bestCall = o.map((call) => ({ call, wp: wp({ call, focus: mine.focus || null }) })).sort((a, b) => b.wp - a.wp)[0];
    // a typical bench: pulls and timeouts on its schedule, otherwise its usual mix with nobody singled out
    let typ, typV;
    if (cb.call === 'pull' || cb.call === 'to') { typ = wp(cb); typV = 0.0001; }
    else {
      typ = Object.entries(mix).reduce((a, [call, w]) => a + w * wp({ call, focus: null }), 0);
      typV = Object.entries(mix).reduce((a, [call, w]) => a + w * (wp({ call, focus: null }) - typ) ** 2, 0);
    }
    return { mine: wp(mine), best, bestWp: best.wp, bestCall, anyone: wp({ call: mine.call, focus: null }), typ, typV, all: res };
  }
  function verdict(loss, best) {
    if (best < 0.01) return { k: 'none', text: 'Out of reach. Not graded.' };
    const l = loss * clamp(0.15 / best, 1, 3);
    if (l <= 0.003) return { k: 'best', text: 'The best call.' };
    if (l <= 0.012) return { k: 'good', text: 'As good as any.' };
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



  globalThis.Drill = { R, LQ, CALLS, LOOKS, MOVES, newGame, options, feedable, resolve, grade, evaluate, verdict, phi, key, coach, finish, clone,
    lookInfo, shootout, soValue, soGrade, mulberry, hash, fmt, skaters, diff, three, talent, pairOf };
})();
