// Empty Net: the game model. Plain script (no imports/exports) so it can be inlined into the page
// and also loaded by node for calibration (drill/check.mjs). Sets globalThis.Drill.
//
// The game is played in "sequences": a faceoff, a zone entry, a cycle, a defensive stand. At each one the
// coach picks a play (and, at the right moments, whether to pull the goalie or call the timeout). The play
// sets the odds of a shot, a goal, a turnover and the next spot. Every call is graded by Monte Carlo:
// the same spot is replayed ~1,000 times with each available call, and the rest of the game is finished by a
// typical NHL coach. A call's grade is the win probability it gives up against the best call.
(function () {
  // ---------- rates ----------
  // Calibrated by drill/check.mjs against league rates for these situations (see that file for the targets).
  const R = {
    adv: { '-2': 0.18, '-1': 0.42, '0': 1, '1': 1.75, '2': 2.4, '3': 2.8 }, // shot quality by skater advantage
    otOpen: 0.7,           // 3-on-3 chance quality vs 5-on-5 plays (tuned: ~57% of 3-on-3 OTs end before the shootout; NHL ~60%)
    fo: 0.5,               // faceoff win rate
    engClear: 0.075,       // a clear from their end goes in your empty net
    engTurn: 0.16,         // a turnover at your blue line goes in your empty net
    icing: 0.32,           // a long empty-net attempt that misses is icing: faceoff back in your end of the ice
    penOpp: 0.045,         // opponent minor per 60 s of your pressure (refs swallow whistles late)
    penYou: 0.03,
    pullAt: { '-1': 100, '-2': 200 }, // when a typical coach pulls: seconds left (real coaches, 2010-2026: 1:41 on average down one)
    youQ: 0.4, tiedQ: 1, themQ: 0.75, themTied: 1.3, them3: 0.35, // shot-quality scales (you while trailing vs a team protecting a lead, you once level, them),
                                   // tuned by drill/check.mjs so simulated endings match ~950 real ones
  };

  const mulberry = (a) => () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const hash = (str) => { let h = 2166136261; for (const c of String(str)) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); } return h >>> 0; };
  const between = (rng, a, b) => Math.round(a + (b - a) * rng());
  const clamp = (x, a, b) => Math.max(a, Math.min(b, x));

  // ---------- plays ----------
  const PLAYS = {
    FO_O: [
      ['point', 'Win it back to the point', 'Shot through traffic, bodies at the net for the rebound.'],
      ['oneT', 'Set play: one-timer off the draw', 'Straight to the circle for a one-timer. Big chance if it works, easy to break up.'],
      ['tie', 'Tie up the center', 'Wingers jump the loose puck and set up zone time. No quick shot.'],
    ],
    FO_N: [
      ['fwd', 'Win it forward and chase', 'Get it deep right away and go hunt it.'],
      ['back', 'Win it back and build', 'Get control first, then come with speed.'],
    ],
    FO_D: [
      ['out', 'Win it and break out', 'Clean exit up the middle. A lost draw means a scramble in front.'],
      ['glass', 'Win it off the glass', 'Safe exit, but it usually hands them the puck at center.'],
    ],
    PUCK_N: [
      ['carry', 'Carry it in', 'Controlled entry with speed. Best looks, but a turnover goes the other way.'],
      ['dump', 'Dump it in and chase', 'Safe entry. You have to win the puck back.'],
      ['regroup', 'Regroup and change', 'Fresh legs on the ice. Costs time.'],
    ],
    PUCK_O: [
      ['point', 'Point shot through traffic', 'Quick and low-danger. Rebounds can kill.'],
      ['cycle', 'Cycle low for a better look', 'Takes time, gets a better chance.'],
      ['seam', 'Cross-seam pass for the one-timer', 'Best chance if it connects. If it gets picked off, trouble.'],
    ],
    OPP_N: [
      ['forecheck', 'Forecheck hard', 'Two in deep to force a turnover. Gives up odd-man rushes.'],
      ['trap', 'Clog the neutral zone', 'Make them dump it. Safe, slow.'],
    ],
    DEF: [
      ['pressure', 'Pressure the puck', 'Go get it back. Leaves the slot open if it fails.'],
      ['collapse', 'Collapse to the slot', 'Protect the net and wait. Burns clock.'],
    ],
  };
  const OT_PLAYS = {
    FO_N: [
      ['hold', 'Win it back and keep it', 'Possession is everything at 3-on-3. Wait for a lane.'],
      ['attack', 'Win it and attack', 'Go right now, before they set up.'],
    ],
    FO_O: [
      ['oneT', 'Set play: one-timer off the draw', 'Quick strike off a clean win.'],
      ['tie', 'Win it back and set up', 'Keep it, make them chase.'],
    ],
    FO_D: [
      ['out', 'Win it and break out', 'Get it and go the other way.'],
      ['glass', 'Win it off the glass', 'Get it out, change, reset.'],
    ],
    PUCK_N: [
      ['carry', 'Attack with speed', 'Take it in with the trailer. Odd-man looks both ways.'],
      ['regroup', 'Circle back and change', 'Keep the puck, get fresh legs. Burns clock.'],
      ['stretch', 'Stretch pass for a breakaway', 'Home run. Usually it misses and they come back 3-on-2.'],
    ],
    PUCK_O: [
      ['shoot', 'Shoot and crash', 'Get it on net, chase the rebound.'],
      ['cycle', 'Be patient, find the back door', 'Wait for the defender to bite.'],
      ['peel', 'Peel back and keep it', 'Pull it out of the zone and reset. Nothing given up.'],
    ],
    OPP_N: [
      ['pressure', 'Go get the puck', 'Strip them before they set up. If it fails, it is a 2-on-1.'],
      ['protect', 'Stay above, protect the middle', 'Keep them to the outside and wait.'],
    ],
    DEF: [
      ['pressure', 'Go get the puck', 'Win it back now. Miss and someone is open.'],
      ['protect', 'Stay above, protect the middle', 'Collapse and make them shoot from outside.'],
    ],
  };

  // ---------- state ----------
  function phaseFor(zone) { return zone === 'O' ? 'FO_O' : zone === 'D' ? 'FO_D' : 'FO_N'; }

  function newGame(sc) {
    const so = shootout(sc);
    return {
      id: sc.id, playoff: sc.type === 3, otNum: 0, per: 'REG', t: sc.start.t, you: sc.start.you, opp: sc.start.opp,
      pulled: false, oppPulled: false, phase: phaseFor(sc.start.zone), legs: 0.75, to: true, pp: 0, bonus: 0,
      over: false, won: null, how: null, soWin: so.win, pulls: [], stoppage: true,
    };
  }
  const clone = (s) => ({ ...s, pulls: s.pulls.slice() });
  const diff = (s) => s.you - s.opp;

  // what can be decided right now
  function options(s) {
    const table = s.per === 'OT' && !s.playoff ? OT_PLAYS : PLAYS;
    const plays = table[s.phase].map(([id, label, hint]) => ({ id, label, hint }));
    const reg = s.per === 'REG';
    const stoppage = s.phase.startsWith('FO_');
    const withPuck = s.phase === 'PUCK_N' || s.phase === 'PUCK_O';
    return {
      plays,
      canPull: reg && !s.pulled && (stoppage || withPuck),
      canReturn: reg && s.pulled && stoppage,
      canTimeout: reg && s.to && stoppage,
    };
  }

  function choices(s) {
    const o = options(s);
    const pulls = o.canPull || o.canReturn ? [false, true] : [false];
    const tos = o.canTimeout ? [false, true] : [false];
    const out = [];
    for (const p of o.plays) for (const g of pulls) for (const to of tos) out.push({ play: p.id, goalie: g, timeout: to });
    return out;
  }

  // ---------- one sequence ----------
  const names = { you: ['your top line'], opp: ['them'] };

  function skaters(s) {
    const three = s.per === 'OT' && !s.playoff;
    const base = three ? 3 : 5;
    let you = base, opp = base;
    if (s.pp > 0) opp -= 1; else if (s.pp < 0) you -= 1;
    if (three && s.pp !== 0) { if (s.pp > 0) you += 1; else opp += 1; opp = Math.min(opp, 4); you = Math.min(you, 4); }
    if (s.pulled) you += 1;
    if (s.oppPulled) opp += 1;
    return { you, opp };
  }
  const adv = (n) => R.adv[String(clamp(n, -2, 3))];

  function resolve(s, c, rng, say = () => {}) {
    // pre-play decisions
    if (c.timeout && s.to) { s.to = false; s.legs = 1; s.bonus += 0.08; say('timeout', 'Timeout. Top unit rested, play drawn up.'); }
    if (c.goalie) {
      if (!s.pulled) { s.pulled = true; s.pulls.push(s.t); say('pull', `Goalie pulled with ${fmt(s.t)} left. Six attackers.`); }
      else if (s.phase.startsWith('FO_')) { s.pulled = false; say('return', 'Goalie back in the net for the draw.'); }
    }
    // the opponent pulls theirs when they trail late
    s.oppPulled = s.per === 'REG' && diff(s) > 0 && s.t <= 150;

    const ot = s.per === 'OT';
    const three = ot && !s.playoff;   // regular-season OT is 3-on-3; playoff OT is full-strength hockey
    const sk = skaters(s);
    const off = adv(sk.you - sk.opp) * (three ? R.otOpen : 1) * (0.82 + 0.3 * s.legs);
    const def = adv(sk.opp - sk.you) * (three ? R.otOpen : 1) * (1.22 - 0.3 * s.legs);
    let dur = 0;
    const r = rng;

    const spend = (a, b) => { dur = between(r, a, b); };
    const shot = (q, what) => {          // your chance
      const p = clamp(q * off * (s.per === 'REG' && diff(s) < 0 ? R.youQ : R.tiedQ) * (1 + s.bonus), 0, 0.75);
      s.bonus = 0;
      if (r() < p) { goal(true, what); return true; }
      return false;
    };
    const chanceAgainst = (q, what) => {
      if (s.pulled) return engAttempt(clamp(q * 2.2, 0.08, 0.6), what);
      const p = clamp(q * def * (s.per === 'REG' && diff(s) < 0 ? R.themQ : three ? R.them3 : R.themTied), 0, 0.75);
      if (r() < p) { goal(false, what); return true; }
      return false;
    };
    // they have it in their end or at center and fire at your empty net
    const engAttempt = (p, what = 'Their long clear') => {
      if (r() < p) { goal(false, 'Empty-net goal', true); return true; }
      if (r() < R.icing) { s.phase = 'FO_O'; say('icing', `${what} misses the net. Icing, faceoff in their end.`); return 'icing'; }
      return false;
    };
    // they win the puck in their own end and get it out
    const clear = (risk = 1, rebound = 0.35) => {
      if (s.pulled) {
        const e = engAttempt(R.engClear * risk);
        if (e) return;
        if (r() < rebound) { s.phase = 'PUCK_O'; say('keep', 'Kept in at the line.'); return; }
        s.phase = 'PUCK_N'; say('clear', 'Cleared. You go back for it.');
        return;
      }
      if (s.oppPulled && r() < 0.12) { goal(true, 'Empty-net goal', true); return; }
      const x = r();
      if (x < rebound) { s.phase = 'PUCK_O'; say('keep', 'Kept in at the line.'); }
      else if (x < rebound + 0.35) { s.phase = 'PUCK_N'; say('clear', 'They clear it. You regroup.'); }
      else { s.phase = 'OPP_N'; say('clear', 'They clear it and come up ice.'); }
    };
    const goal = (mine, what, empty = false) => {
      if (mine) s.you += 1; else s.opp += 1;
      say(mine ? 'goal' : 'against', mine ? `GOAL. ${what}.` : (empty ? `${what}.` : `Goal against. ${what}.`));
      if ((mine && s.pp > 0) || (!mine && s.pp < 0)) s.pp = 0;
      s.phase = 'FO_N'; s.legs = Math.min(1, s.legs + 0.25);
      if (s.pulled) s.pulled = false;
      if (ot) { s.over = true; }
    };

    const p = c.play, ph = s.phase;
    s.stoppage = false;
    if (!three) {
      if (ph === 'FO_O') {
        const winP = R.fo + (s.legs - 0.5) * 0.05 + (p === 'tie' ? 0.12 : 0);
        spend(4, 9);
        if (r() < winP) {
          if (p === 'point') { say('play', 'Won it back. Point shot through traffic.'); if (!shot(0.045, 'Point shot through traffic') && !(r() < 0.25 && shot(0.1, 'Rebound in the crease'))) clear(1, 0.42); }
          else if (p === 'oneT') { if (r() < 0.55) { say('play', 'Clean win to the circle, one-timer.'); if (!shot(0.13, 'One-timer off the draw')) clear(1, 0.32); } else { say('play', 'The set play gets broken up.'); clear(1.3, 0.3); } }
          else { spend(8, 14); say('play', 'Tied up, wingers win the battle. Zone time.'); s.phase = 'PUCK_O'; s.bonus += 0.15; }
        } else { say('play', 'Lost the draw.'); clear(1.4, 0.3); }
      } else if (ph === 'FO_N') {
        spend(4, 8);
        if (r() < R.fo + (s.legs - 0.5) * 0.05) {
          if (p === 'fwd') { spend(8, 13); if (r() < 0.45) { say('play', 'Won forward, chased it down. Zone time.'); s.phase = 'PUCK_O'; } else { say('play', 'Won forward, but they get there first.'); s.phase = 'OPP_N'; } }
          else { say('play', 'Won it back. Building up.'); s.phase = 'PUCK_N'; }
        } else { say('play', 'Lost the draw at center.'); s.phase = s.pulled && r() < 0.5 ? (engAttempt(0.06, 'Their dump from center') ? s.phase : 'PUCK_N') : 'OPP_N'; }
      } else if (ph === 'FO_D') {
        spend(4, 9);
        if (r() < R.fo + (s.legs - 0.5) * 0.05) {
          if (p === 'out') { spend(6, 10); if (r() < 0.82) { say('play', 'Won it, clean breakout.'); s.phase = 'PUCK_N'; } else { say('play', 'Won it but the outlet is picked off.'); s.phase = 'DEF'; } }
          else { say('play', 'Won it and chipped out.'); s.phase = r() < 0.55 ? 'OPP_N' : 'PUCK_N'; }
        } else {
          say('play', 'Lost the draw in your end.');
          if (s.pulled) { if (r() < 0.5) goal(false, 'Off the draw into the empty net', true); else s.phase = 'DEF'; }
          else if (!chanceAgainst(p === 'out' ? 0.06 : 0.045, 'Quick shot off the draw')) s.phase = 'DEF';
        }
      } else if (ph === 'PUCK_N') {
        if (p === 'carry') {
          spend(6, 11);
          if (r() < 0.57 + (s.legs - 0.5) * 0.15) { say('play', 'Carried in with speed.'); if (!(r() < 0.32 && shot(0.085, 'Off the rush'))) { s.phase = 'PUCK_O'; s.bonus += 0.12; } }
          else {
            say('play', 'Turned over at the line.');
            if (s.pulled) { if (!engAttempt(R.engTurn, 'Their shot from center')) s.phase = r() < 0.6 ? 'PUCK_N' : s.phase; }
            else { const x = r(); if (x < 0.3) { if (!chanceAgainst(0.07, 'Counterattack')) s.phase = 'DEF'; } else s.phase = x < 0.75 ? 'OPP_N' : 'PUCK_N'; }
          }
        } else if (p === 'dump') {
          spend(9, 15);
          if (r() < 0.42 + (s.legs - 0.5) * 0.12 + (s.pulled ? 0.08 : 0)) { say('play', 'Dumped in and won it back.'); s.phase = 'PUCK_O'; }
          else { say('play', 'Dumped in. They get to it first.'); clear(0.7, 0.2); }
        } else {
          spend(12, 20); s.legs = Math.max(s.legs, 0.92);
          if (r() < 0.08) { say('play', 'Regrouping, picked off.'); s.phase = s.pulled ? (engAttempt(R.engTurn * 0.8, 'Their shot from center') ? s.phase : 'PUCK_N') : 'DEF'; }
          else { say('play', 'Regrouped. Fresh legs.'); s.phase = 'PUCK_N'; }
        }
      } else if (ph === 'PUCK_O') {
        if (p === 'point') { spend(6, 12); say('play', 'Point shot through traffic.'); if (!shot(0.045, 'Point shot through traffic') && !(r() < 0.22 && shot(0.1, 'Rebound in the crease'))) clear(1, 0.42); }
        else if (p === 'cycle') {
          spend(12, 22);
          if (r() < 0.64 + (s.legs - 0.5) * 0.12) { say('play', 'Worked it low. Good look from the slot.'); if (!shot(0.1, 'From the slot off the cycle')) clear(1, 0.38); }
          else { say('play', 'Cycle broken up along the wall.'); clear(1.25, 0.25); }
        } else {
          spend(5, 10);
          if (r() < 0.45) { say('play', 'Seam pass connects. One-timer.'); if (!shot(0.165, 'Cross-seam one-timer')) clear(1, 0.32); }
          else {
            say('play', 'Seam pass picked off.');
            if (s.pulled) { if (!engAttempt(R.engTurn * 1.1, 'Their clear')) s.phase = r() < 0.5 ? 'PUCK_N' : s.phase; }
            else { const x = r(); if (x < 0.35) { if (!chanceAgainst(0.09, 'Odd-man rush the other way')) s.phase = 'DEF'; } else s.phase = x < 0.7 ? 'OPP_N' : 'PUCK_N'; }
          }
        }
      } else if (ph === 'OPP_N') {
        if (p === 'forecheck') {
          spend(7, 12);
          if (r() < 0.42) { say('play', 'Forecheck forces a turnover.'); s.phase = r() < 0.5 ? 'PUCK_O' : 'PUCK_N'; }
          else { say('play', 'They beat the forecheck.'); if (s.pulled) { if (!engAttempt(0.22, 'Shot at the empty net')) s.phase = 'PUCK_N'; } else if (!chanceAgainst(0.075, 'Rush chance')) s.phase = r() < 0.5 ? 'DEF' : 'PUCK_N'; }
        } else {
          spend(12, 20);
          if (r() < 0.28) { say('play', 'Neutral-zone turnover.'); s.phase = 'PUCK_N'; }
          else if (r() < 0.7) { say('play', 'They dump it in. You retrieve.'); if (s.pulled && engAttempt(0.07, 'Their dump-in')) {} else s.phase = 'PUCK_N'; }
          else { say('play', 'They gain the zone.'); s.phase = s.pulled ? (engAttempt(0.3, 'Shot at the empty net') ? s.phase : 'PUCK_N') : 'DEF'; }
        }
      } else if (ph === 'DEF') {
        if (p === 'pressure') {
          spend(6, 12);
          if (r() < 0.45) { say('play', 'Pressure wins it back.'); s.phase = 'PUCK_N'; }
          else { say('play', 'They beat the pressure.'); if (!chanceAgainst(0.1, 'Open man in the slot')) s.phase = r() < 0.55 ? 'PUCK_N' : 'DEF'; }
        } else {
          spend(14, 24); say('play', 'Collapsed to the slot.');
          if (!chanceAgainst(0.055, 'Shot from the point')) { const x = r(); s.phase = x < 0.55 ? 'PUCK_N' : x < 0.8 ? 'OPP_N' : 'DEF'; }
        }
      }
    } else {
      // 3-on-3 overtime: possession and odd-man rushes
      const rush = (q) => chanceAgainst(q, 'Odd-man rush');
      if (ph === 'FO_N' || ph === 'FO_O' || ph === 'FO_D') {
        spend(3, 7);
        const won = r() < R.fo + (s.legs - 0.5) * 0.05;
        if (!won) { say('play', 'Lost the draw.'); s.phase = ph === 'FO_O' ? (r() < 0.6 ? 'OPP_N' : 'PUCK_N') : (ph === 'FO_D' ? (chanceAgainst(0.06, 'Quick shot off the draw') ? s.phase : 'DEF') : 'OPP_N'); }
        else if (p === 'attack' || p === 'oneT') { say('play', 'Won it and went.'); if (!shot(ph === 'FO_O' ? 0.11 : 0.06, ph === 'FO_O' ? 'One-timer off the draw' : 'Off the rush')) s.phase = r() < 0.45 ? 'PUCK_O' : 'OPP_N'; }
        else if (p === 'out') { say('play', 'Won it, breaking out.'); s.phase = r() < 0.85 ? 'PUCK_N' : 'DEF'; }
        else { say('play', 'Won it back. Holding it.'); s.phase = ph === 'FO_O' ? 'PUCK_O' : 'PUCK_N'; if (p === 'glass') s.legs = Math.max(s.legs, 0.9); }
      } else if (ph === 'PUCK_N') {
        if (p === 'carry') {
          spend(6, 10);
          if (r() < 0.6 + (s.legs - 0.5) * 0.2) { say('play', 'Attacked with speed.'); if (!(r() < 0.45 && shot(0.1, 'Off the rush'))) s.phase = 'PUCK_O'; }
          else { say('play', 'Turned over in the neutral zone.'); if (!(r() < 0.45 && rush(0.16))) s.phase = r() < 0.5 ? 'OPP_N' : 'DEF'; }
        } else if (p === 'regroup') {
          spend(10, 18); s.legs = Math.min(1, s.legs + 0.35);
          if (r() < 0.06) { say('play', 'Picked off on the regroup.'); if (!rush(0.14)) s.phase = 'DEF'; }
          else { say('play', 'Circled back and changed. Fresh legs.'); s.phase = 'PUCK_N'; }
        } else {
          spend(4, 8);
          if (r() < 0.28) { say('play', 'Stretch pass on the tape. Breakaway.'); if (!shot(0.26, 'On the breakaway')) s.phase = r() < 0.5 ? 'OPP_N' : 'PUCK_O'; }
          else { say('play', 'Stretch pass picked off.'); if (!(r() < 0.5 && rush(0.17))) s.phase = r() < 0.5 ? 'OPP_N' : 'DEF'; }
        }
      } else if (ph === 'PUCK_O') {
        if (p === 'shoot') { spend(5, 10); say('play', 'Shot and crash.'); if (!shot(0.07, 'Shot through a screen') && !(r() < 0.25 && shot(0.11, 'Rebound'))) { const x = r(); if (x < 0.3) s.phase = 'PUCK_O'; else if (x < 0.55) { if (!rush(0.13)) s.phase = 'DEF'; } else s.phase = 'OPP_N'; } }
        else if (p === 'cycle') {
          spend(12, 22);
          if (r() < 0.62 + (s.legs - 0.5) * 0.2) { say('play', 'Patient. Found the back door.'); if (!shot(0.15, 'Back-door tap-in')) s.phase = r() < 0.4 ? 'PUCK_O' : 'OPP_N'; }
          else { say('play', 'Lost it down low.'); if (!(r() < 0.4 && rush(0.15))) s.phase = 'OPP_N'; }
        } else { spend(5, 9); say('play', 'Peeled back to center. Still yours.'); s.phase = 'PUCK_N'; if (r() < 0.07) s.phase = 'OPP_N'; }
      } else {
        // OPP_N / DEF
        const inZone = ph === 'DEF';
        if (p === 'pressure') {
          spend(5, 10);
          if (r() < 0.4 + (s.legs - 0.5) * 0.2) { say('play', 'Stripped them. Your puck.'); if (!(r() < 0.3 && shot(0.12, 'Quick strike off the turnover'))) s.phase = 'PUCK_N'; }
          else { say('play', 'Missed the check.'); if (!rush(inZone ? 0.19 : 0.16)) s.phase = r() < 0.5 ? 'DEF' : 'PUCK_N'; }
        } else {
          spend(10, 18); say('play', 'Protected the middle.');
          if (!chanceAgainst(inZone ? 0.07 : 0.055, 'Shot from the outside')) { const x = r(); s.phase = x < 0.45 ? 'PUCK_N' : x < 0.75 ? 'OPP_N' : 'DEF'; }
        }
      }
    }

    // legs, penalties and the clock
    const oldT = s.t;
    dur = Math.max(dur, 2);
    s.legs = clamp(s.legs - dur / (three ? 55 : 80), 0, 1);
    if (s.pp) { const left = Math.abs(s.pp) - dur; s.pp = left > 0 ? Math.sign(s.pp) * left : 0; }
    if (!s.over && s.you === s.you) {
      const attacking = ['FO_O', 'PUCK_O', 'PUCK_N'].includes(ph);
      if (s.pp === 0 && r() < (attacking ? R.penOpp : R.penYou) * dur / 60) {
        if (attacking) { s.pp = 120; s.phase = 'FO_O'; say('pp', 'Penalty on them. Power play, faceoff in their end.'); }
        else { s.pp = -120; s.phase = 'FO_D'; say('pk', 'Penalty on you. Penalty kill.'); }
      }
    }
    s.t = Math.max(0, s.t - dur);
    if (s.phase.startsWith('FO_')) s.stoppage = true;
    finishClock(s, oldT, say);
    return s;
  }

  function finishClock(s, oldT, say) {
    if (s.over) { s.won = s.you > s.opp; s.how = s.how || 'OT'; return; }
    if (s.t > 0) return;
    if (s.per === 'REG') {
      if (s.you !== s.opp) { s.over = true; s.won = s.you > s.opp; s.how = 'REG'; say('end', 'Final horn.'); return; }
      s.per = 'OT'; s.otNum = 1; s.t = s.playoff ? 1200 : 300; s.phase = 'FO_N'; s.pulled = false; s.oppPulled = false; s.legs = 1; s.stoppage = true;
      if (s.pp) s.pp = Math.sign(s.pp) * Math.min(Math.abs(s.pp), 120);
      say('ot', s.playoff ? 'End of regulation. Tied. Sudden-death overtime: 20 minutes, full strength, until someone scores.' : 'End of regulation. Tied. 3-on-3 overtime.');
    } else if (s.per === 'OT' && s.playoff) {
      s.otNum += 1; s.t = 1200; s.phase = 'FO_N'; s.legs = 1; s.stoppage = true;
      say('ot', `Still tied. ${s.otNum === 2 ? 'Double' : s.otNum === 3 ? 'Triple' : `${s.otNum}x`} overtime.`);
    } else if (s.per === 'OT') {
      s.per = 'SO'; s.over = false; s.stoppage = true;
      say('so', 'Still tied after overtime. Shootout.');
    }
    void oldT;
  }

  // ---------- the typical coach, who finishes every simulated game ----------
  const MIX = {
    REG: { FO_O: { point: 0.45, oneT: 0.25, tie: 0.3 }, FO_N: { fwd: 0.5, back: 0.5 }, FO_D: { out: 0.6, glass: 0.4 },
      PUCK_N: { carry: 0.5, dump: 0.42, regroup: 0.08 }, PUCK_O: { point: 0.4, cycle: 0.4, seam: 0.2 },
      OPP_N: { forecheck: 0.55, trap: 0.45 }, DEF: { pressure: 0.5, collapse: 0.5 } },
    OT: { FO_N: { hold: 0.6, attack: 0.4 }, FO_O: { oneT: 0.5, tie: 0.5 }, FO_D: { out: 0.6, glass: 0.4 },
      PUCK_N: { carry: 0.5, regroup: 0.4, stretch: 0.1 }, PUCK_O: { shoot: 0.4, cycle: 0.4, peel: 0.2 },
      OPP_N: { pressure: 0.45, protect: 0.55 }, DEF: { pressure: 0.45, protect: 0.55 } },
  };
  function coach(s, r) {
    const mix = MIX[s.per === 'OT' && s.playoff ? 'REG' : s.per][s.phase];
    let x = r(), play = Object.keys(mix)[0];
    for (const [k, w] of Object.entries(mix)) { if (x < w) { play = k; break; } x -= w; }
    const o = options(s);
    const d = diff(s);
    let goalie = false;
    if (o.canPull && d < 0 && s.t <= (R.pullAt[String(Math.max(d, -2))] ?? 300)) goalie = true;
    if (o.canReturn && (d >= 0 || s.phase === 'FO_D')) goalie = true;
    const timeout = o.canTimeout && s.pulled !== goalie && d < 0 && s.phase === 'FO_O' && s.t < 120;
    return { play, goalie, timeout: timeout || (o.canTimeout && d < 0 && s.t < 60 && s.phase === 'FO_O') };
  }

  // play the game out; returns the win value (shootouts count at their real win chance)
  function finish(s, r) {
    let guard = 0;
    while (!s.over && s.per !== 'SO' && s.otNum < 3 && guard++ < 400) resolve(s, coach(s, r), r);
    if (!s.over && s.otNum >= 3) return 0.5;   // a third overtime is a coin flip
    if (s.per === 'SO' && !s.over) return s.soWin;
    return s.won ? 1 : 0;
  }

  // ---------- grading ----------
  function grade(s, n = 1000, seed = 1) {
    const cs = choices(s);
    const wins = new Float64Array(cs.length);
    for (let k = 0; k < n; k++) {
      for (let i = 0; i < cs.length; i++) {
        const r = mulberry(seed * 7919 + k * 104729 + 13);  // the same luck for every choice
        const g = clone(s);
        resolve(g, cs[i], r);
        wins[i] += finish(g, r);
      }
    }
    const res = cs.map((c, i) => ({ ...c, wp: wins[i] / n }));
    res.sort((a, b) => b.wp - a.wp);
    return res;
  }
  const key = (c) => `${c.play}|${c.goalie ? 1 : 0}|${c.timeout ? 1 : 0}`;
  // Grade by win chance given up. Small edges count for more when there is less to play with, and a call
  // made when the game is gone (best call under 1%) is not graded.
  function letter(loss, best = 0.15) {
    if (best < 0.01) return '–';
    loss *= clamp(0.15 / best, 1, 3);
    // replaying 3,000 times leaves about half a point of noise between two calls, so A covers a 1-point band
    if (loss <= 0.01) return 'A';
    if (loss <= 0.025) return 'B';
    if (loss <= 0.04) return 'C';
    if (loss <= 0.06) return 'D';
    return 'F';
  }

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

  const fmt = (t) => `${Math.floor(t / 60)}:${String(Math.round(t) % 60).padStart(2, '0')}`;

  globalThis.Drill = { R, PLAYS, OT_PLAYS, MOVES, newGame, options, choices, resolve, grade, key, letter, coach, finish, clone,
    shootout, soValue, soGrade, mulberry, hash, fmt, skaters, shrinkShooter, shrinkGoalie, names };
})();
