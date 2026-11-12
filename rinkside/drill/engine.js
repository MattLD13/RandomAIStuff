// Empty Net: the game model. Plain script (no imports/exports) so it can be inlined into the page
// and also loaded by node for calibration (drill/check.mjs). Sets globalThis.Drill.
//
// The game is played one shift-sized call at a time: a faceoff, a zone entry, an offensive-zone play,
// a defensive stand. Before each call the opponent shows a look (their center owns the dot, a 1-3-1 trap,
// a sagging box, the back door is open...). Each look makes some calls better and others worse, so the
// skill is reading it. Every call is graded by Monte Carlo: the same spot is replayed thousands of times
// with each call you could make, and the rest of the game is finished by a typical NHL bench.
(function () {
  // ---------- rates ----------
  // Tuned by drill/check.mjs so the typical bench reproduces ~950 real late one-goal endings.
  const R = {
    adv: { '-2': 0.18, '-1': 0.42, '0': 1, '1': 1.75, '2': 2.4, '3': 2.8 }, // shot quality by skater advantage
    otOpen: 1.45,          // 3-on-3 chance quality vs 5-on-5 plays (60% of 3-on-3 OTs end before the shootout, as in the NHL)
    fo: 0.5,               // faceoff win rate
    engClear: 0.18,        // a clear from their end goes in your empty net
    engTurn: 0.32,         // a turnover at your blue line goes in your empty net
    icing: 0.32,           // a long empty-net attempt that misses is icing: faceoff back in their end
    penOpp: 0.045,         // opponent minor per 60 s of your pressure (refs swallow whistles late)
    penYou: 0.03,
    pullAt: { '-1': 100, '-2': 200 }, // when a typical bench pulls: seconds left (real benches 2010-2026: 1:41 on average down one)
    youQ: 0.78, tiedQ: 1, themQ: 0.75, themTied: 1.1, them3: 0.31, // shot-quality scales: you while trailing (they protect the lead),
                                                                  // you once level, them while leading / level / at 3-on-3
    pace: 1.3,             // multiplies every shift's length (about 11 calls to the end of regulation)
  };

  const mulberry = (a) => () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const hash = (str) => { let h = 2166136261; for (const c of String(str)) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); } return h >>> 0; };
  const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
  const pick = (r, arr) => arr[Math.floor(r() * arr.length) % arr.length];

  // ---------- calls: [id, button, what it does] ----------
  const CALLS = {
    FO_O: [['back', 'Back to the point', 'Win it back, shot through traffic.'], ['set', 'One-timer set', 'Win it to the circle, one-timer.'], ['tie', 'Tie-up', 'Wingers jump the loose puck.']],
    FO_N: [['fwd', 'Win it forward', 'Chip it in and chase.'], ['back', 'Win it back', 'Control first, then attack.']],
    FO_D: [['out', 'Clean breakout', 'Win it and go up the middle.'], ['glass', 'Off the glass', 'Safe exit, usually gives it away.']],
    ENTRY: [['carry', 'Carry in', 'Controlled entry with speed.'], ['dump', 'Dump & chase', 'Get it deep, go win it back.'], ['stretch', 'Stretch pass', 'Hit a forward at their blue line.'], ['change', 'Regroup', 'Swing back, fresh legs. Costs time.']],
    ZONE: [['shoot', 'Shoot', 'Point shot through traffic.'], ['cycle', 'Cycle low', 'Work it below the dots.'], ['seam', 'Seam pass', 'Cross-ice for the one-timer.'], ['net', 'Net-front', 'Bump it to the slot.']],
    THEIRS_N: [['press', 'Forecheck', 'Two in deep, force a turnover.'], ['sit', 'Trap', 'Clog the middle and wait.']],
    THEIRS_D: [['press', 'Pressure', 'Go take it from them.'], ['sit', 'Collapse', 'Protect the slot.']],
  };
  const OT_CALLS = {
    FO_O: [['back', 'Win it back', 'Keep it, wait for a lane.'], ['go', 'Win it and go', 'Strike before they set up.']],
    ENTRY: [['carry', 'Attack', 'Take it in with speed.'], ['change', 'Circle back', 'Keep it, change on the fly.'], ['stretch', 'Stretch pass', 'Home-run pass for a breakaway.']],
    ZONE: [['shoot', 'Shoot', 'Get it on net and crash.'], ['seam', 'Back door', 'Wait for the defender to bite.'], ['peel', 'Peel back', 'Reset. Nothing given up.']],
    THEIRS_N: [['press', 'Go get it', 'Strip them before they set up.'], ['sit', 'Stay above', 'Protect the middle.']],
    THEIRS_D: [['press', 'Go get it', 'Win it back right now.'], ['sit', 'Stay above', 'Keep them to the outside.']],
  };
  OT_CALLS.FO_N = OT_CALLS.FO_O; OT_CALLS.FO_D = OT_CALLS.FO_O;

  // ---------- looks: what the other team is showing. [id, headline, detail] ----------
  const FO_LOOKS = [
    ['even', 'Even matchup on the dot', '{oC} against {C}. A coin flip.'],
    ['strong', 'Their center owns the dot', '{oC} has been winning almost every draw.'],
    ['weak', 'Their center is struggling', '{oC} keeps getting beat clean.'],
    ['cheat', 'Their wingers are cheating in', 'Two of them leaning on the dot to swarm a loose puck. Your point is open.'],
  ];
  const LOOKS = {
    FO_O: FO_LOOKS, FO_N: FO_LOOKS, FO_D: FO_LOOKS,
    ENTRY: [
      ['trap', '1-3-1 trap', 'Three across the neutral zone. Nothing up the middle.'],
      ['high', 'They are forechecking high', 'Their D are pinching up. Open ice behind them.'],
      ['change', 'They are changing', 'Two forwards heading for the bench.'],
      ['gap', 'Tight gap at the line', 'Their D are standing up at the blue line.'],
    ],
    ZONE: [
      ['box', 'Sagging box', 'Five in front of the net. Shooting lanes are clogged.'],
      ['points', 'Pressuring your points', 'Their wingers are jumping your D.'],
      ['door', 'The back door is open', 'Their weak-side D is puck-watching.'],
      ['tired', 'Their legs are gone', 'They have been out for 50 seconds.'],
      ['rebound', 'Their goalie is fighting it', '{oG} is not holding anything. Rebounds everywhere.'],
    ],
    THEIRS_N: [
      ['dump', 'They are dumping it to change', 'Getting it deep and heading for the bench.'],
      ['stretch', 'They are looking for a stretch pass', 'A forward is hanging at your blue line.'],
      ['slow', 'Their D is killing clock', 'Carrying it slowly behind their own line.'],
    ],
    THEIRS_D: [
      ['cycle', 'They are cycling to kill clock', 'Along the boards, not looking to shoot.'],
      ['shot', 'Their D is looking to shoot', 'Walking the line for a lane.'],
      ['screen', 'They have a man at your net', 'Screen in front of {G}.'],
    ],
  };

  // ---------- state ----------
  function phaseFor(zone) { return zone === 'O' ? 'FO_O' : zone === 'D' ? 'FO_D' : 'FO_N'; }
  const tableKey = (s) => s.phase === 'THEIRS' ? (s.deep ? 'THEIRS_D' : 'THEIRS_N') : s.phase;
  const three = (s) => s.per === 'OT' && !s.playoff;

  function newGame(sc) {
    const so = shootout(sc);
    const s = {
      id: sc.id, playoff: sc.type === 3, otNum: 0, per: 'REG', t: sc.start.t, you: sc.start.you, opp: sc.start.opp,
      pulled: false, oppPulled: false, phase: phaseFor(sc.start.zone), deep: false, legs: 0.75, to: true, pp: 0, bonus: 0,
      over: false, won: null, how: null, soWin: so.win, pulls: [], look: 'even',
    };
    s.look = pickLook(s, mulberry(hash(`look${sc.id}`)));
    return s;
  }
  const clone = (s) => ({ ...s, pulls: s.pulls.slice() });
  const diff = (s) => s.you - s.opp;

  function pickLook(s, r) {
    const list = LOOKS[tableKey(s)];
    const w = list.map(([id]) => {
      if (id === 'box' && s.pulled) return 2.2;            // a team defending 6-on-5 collapses
      if (id === 'tired' && s.legs > 0.8) return 0.5;
      if ((id === 'cycle' || id === 'slow' || id === 'dump') && diff(s) < 0 && s.per === 'REG') return 1.5; // protecting a lead
      return 1;
    });
    let x = r() * w.reduce((a, b) => a + b, 0);
    for (let i = 0; i < list.length; i++) { if (x < w[i]) return list[i][0]; x -= w[i]; }
    return list[0][0];
  }
  function lookInfo(s) { return LOOKS[tableKey(s)].find((l) => l[0] === s.look) || LOOKS[tableKey(s)][0]; }

  function callsFor(s) { return (three(s) ? OT_CALLS : CALLS)[tableKey(s)]; }
  function options(s) {
    const plays = callsFor(s).map(([id, label, hint]) => ({ id, label, hint }));
    const reg = s.per === 'REG';
    const stoppage = s.phase.startsWith('FO_');
    const withPuck = s.phase === 'ENTRY' || s.phase === 'ZONE';
    return { plays, canPull: reg && !s.pulled && (stoppage || withPuck), canReturn: reg && s.pulled && stoppage, canTimeout: reg && s.to && stoppage };
  }
  function choices(s) {
    const o = options(s);
    const pulls = o.canPull || o.canReturn ? [false, true] : [false];
    const tos = o.canTimeout ? [false, true] : [false];
    const out = [];
    for (const p of o.plays) for (const g of pulls) for (const to of tos) out.push({ play: p.id, goalie: g, timeout: to });
    return out;
  }

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
  const fmt = (t) => `${Math.floor(t / 60)}:${String(Math.round(t) % 60).padStart(2, '0')}`;

  // ---------- one call ----------
  // say(kind, text, data) narrates for the page. Names are tokens the page fills from the real lineups:
  // {C} {W1} {W2} {D1} {D2} {G} are yours; {oC} {oW} {oD} {oG} are theirs.
  const FROM = {
    point: 'from the point', circle: 'one-timer from the circle', slot: 'from the slot', door: 'one-timer at the back door',
    rush: 'off the rush', rebound: 'on the rebound', breakaway: 'on a breakaway', quick: 'quick shot off the draw',
  };
  const RES = { save: 'saved by {oG}.', block: 'blocked.', wide: 'just wide.' };

  function resolve(s, c, rng, say = () => {}) {
    const r = rng;
    if (c.timeout && s.to) { s.to = false; s.legs = 1; s.bonus += 0.08; say('timeout', 'Timeout. Your top unit gets its legs back.'); }
    if (c.goalie) {
      if (!s.pulled) { s.pulled = true; s.pulls.push(s.t); say('pull', `{G} to the bench with ${fmt(s.t)} left. Six attackers.`); }
      else if (s.phase.startsWith('FO_')) { s.pulled = false; say('return', '{G} back in the net.'); }
    }
    s.oppPulled = s.per === 'REG' && diff(s) > 0 && s.t <= 150;
    const is3 = three(s);
    const sk = skaters(s);
    const L = s.look, ph = s.phase, p = c.play;
    const youMul = s.per === 'REG' && diff(s) < 0 ? R.youQ : R.tiedQ;
    const themMul = s.per === 'REG' && diff(s) < 0 ? R.themQ : is3 ? R.them3 : R.themTied;
    const off = adv(sk.you - sk.opp) * (is3 ? R.otOpen : 1) * (0.82 + 0.3 * s.legs) * youMul * (L === 'tired' && ph === 'ZONE' ? 1.15 : 1);
    const def = adv(sk.opp - sk.you) * (is3 ? R.otOpen : 1) * (1.22 - 0.3 * s.legs) * themMul;
    let dur = 0;
    const spend = (a, b) => { dur += Math.round((a + (b - a) * r()) * R.pace); };
    const look = (m) => m[L] ?? 0;

    const goal = (mine, empty = false) => {
      if (mine) s.you += 1; else s.opp += 1;
      if ((mine && s.pp > 0) || (!mine && s.pp < 0)) s.pp = 0;
      s.phase = 'FO_N'; s.deep = false; s.legs = Math.min(1, s.legs + 0.25);
      if (s.pulled) s.pulled = false;
      if (s.per === 'OT') s.over = true;
      void empty;
    };
    // your shot; returns 'goal' | 'save' | 'block' | 'wide'
    const shot = (q, from, who, block = from === 'point' ? 0.3 : 0.12) => {
      const pg = clamp(q * off * (1 + s.bonus), 0, 0.75);
      s.bonus = 0;
      if (r() < pg) { say('shot', `${who} ${FROM[from]}. GOAL!`, { from, res: 'goal' }); goal(true); return 'goal'; }
      const x = r();
      const res = x < block ? 'block' : x < block + (1 - block) * 0.72 ? 'save' : 'wide';
      say('shot', `${who} ${FROM[from]}: ${RES[res]}`, { from, res });
      return res;
    };
    // they fire at your empty net; true if it went in, 'icing' if it missed the net from their end
    const engAttempt = (prob, who = '{oD}') => {
      if (r() < prob) { say('eng', `${who} from distance. Into the empty net.`, { res: 'goal' }); goal(false, true); return true; }
      if (r() < R.icing) { s.phase = 'FO_O'; say('icing', `${who} fires at the empty net and misses. Icing.`); return 'icing'; }
      return false;
    };
    const against = (q, from, who = '{oW}') => {
      if (s.pulled) return engAttempt(clamp(q * 2.2, 0.08, 0.6), who) === true;
      if (r() < clamp(q * def, 0, 0.75)) { say('against', `${who} ${FROM[from]}. Goal.`, { from, res: 'goal' }); goal(false); return true; }
      say('stop', `${who} ${FROM[from]}: {G} makes the save.`, { from });
      return false;
    };
    // they win the puck in their end and try to get it out
    const clear = (risk = 1, keep = 0.35) => {
      if (s.pulled) {
        const e = engAttempt(R.engClear * risk);
        if (e) return;
        if (r() < keep) { s.phase = 'ZONE'; say('keep', '{D2} keeps it in at the line.'); return; }
        s.phase = 'ENTRY'; say('clear', '{oD} clears it. You go back for it.');
        return;
      }
      if (s.oppPulled && r() < 0.12) { say('shot', '{D1} into their empty net. GOAL!', { from: 'eng', res: 'goal' }); goal(true, true); return; }
      const x = r();
      if (x < keep) { s.phase = 'ZONE'; say('keep', '{D2} keeps it in at the line.'); }
      else if (x < keep + 0.35) { s.phase = 'ENTRY'; say('clear', '{oD} clears it. You regroup.'); }
      else { s.phase = 'THEIRS'; s.deep = false; say('clear', '{oD} clears it and they come up ice.'); }
    };
    const theirs = (deep) => { s.phase = 'THEIRS'; s.deep = deep; };
    const faceoff = (bonus = 0) => {
      const won = r() < R.fo + (s.legs - 0.5) * 0.05 + look({ strong: -0.12, weak: 0.12 }) + bonus;
      say('fo', won ? '{C} wins the draw.' : '{oC} wins the draw.', { won });
      return won;
    };

    if (!is3) {
      if (ph === 'FO_O') {
        if (p === 'back') {
          spend(10, 16);
          if (faceoff()) {
            const res = shot(0.045 * (L === 'cheat' ? 1.6 : 1), 'point', '{D1}', L === 'cheat' ? 0.12 : 0.3);
            if (res !== 'goal' && !(res === 'save' && r() < 0.25 && shot(0.1, 'rebound', '{C}') === 'goal')) clear(1, 0.42);
          } else clear(1.4, 0.3);
        } else if (p === 'set') {
          spend(8, 13);
          if (faceoff()) {
            if (r() < 0.52 + look({ weak: 0.14, strong: -0.14 })) { if (shot(0.14, 'circle', '{W1}') !== 'goal') clear(1, 0.32); }
            else { say('turn', 'The set play gets broken up.'); clear(1.3, 0.3); }
          } else clear(1.4, 0.3);
        } else {
          spend(15, 24);
          if (faceoff(0.04 + look({ cheat: -0.14, strong: 0.1 }))) { say('keep', '{W2} comes out of the scrum with it. Zone time.'); s.phase = 'ZONE'; s.bonus += 0.12; }
          else clear(1.4, 0.3);
        }
      } else if (ph === 'FO_N') {
        spend(8, 14);
        if (faceoff()) {
          if (p === 'fwd') {
            if (r() < 0.45 + look({ cheat: 0.1 })) { say('entry', '{W1} chips it in and wins the race.', { ok: true, type: 'dump' }); s.phase = 'ZONE'; }
            else { say('entry', 'Chipped in. {oD} gets there first.', { ok: false, type: 'dump' }); theirs(false); }
          } else { say('play', '{D1} has it. Building up.'); s.phase = 'ENTRY'; }
        } else if (s.pulled && r() < 0.5) { if (!engAttempt(0.06)) s.phase = s.phase === 'FO_O' ? 'FO_O' : 'ENTRY'; }
        else theirs(false);
      } else if (ph === 'FO_D') {
        spend(8, 14);
        if (faceoff()) {
          if (p === 'out') { if (r() < 0.82) { say('play', '{D1} goes up the middle. Clean breakout.'); s.phase = 'ENTRY'; } else { say('turn', 'The outlet is picked off.'); theirs(true); } }
          else { say('play', 'Chipped off the glass and out.'); if (r() < 0.55) theirs(false); else s.phase = 'ENTRY'; }
        } else if (s.pulled) { if (r() < 0.5) { say('eng', '{oC} wins it straight back into the empty net.', { res: 'goal' }); goal(false, true); } else theirs(true); }
        else if (!against(p === 'out' ? 0.06 : 0.045, 'quick', '{oC}')) theirs(true);
      } else if (ph === 'ENTRY') {
        if (p === 'carry') {
          spend(10, 16);
          if (r() < 0.57 + (s.legs - 0.5) * 0.15 + look({ trap: -0.2, high: 0.05, change: 0.28, gap: -0.12 })) {
            say('entry', '{C} carries it in with speed.', { ok: true, type: 'carry' });
            if (r() < 0.32 + look({ change: 0.3 })) { if (shot(0.085 * (L === 'change' ? 1.4 : 1), 'rush', '{W1}') !== 'goal') clear(1, 0.4); }
            else { s.phase = 'ZONE'; s.bonus += 0.12; }
          } else {
            say('entry', '{oD} steps up and takes it off {C}.', { ok: false, type: 'carry' });
            if (s.pulled) { if (!engAttempt(R.engTurn)) s.phase = r() < 0.6 ? 'ENTRY' : s.phase; }
            else { const x = r(); if (x < 0.3) { if (!against(0.07, 'rush')) theirs(true); } else if (x < 0.75) theirs(false); }
          }
        } else if (p === 'dump') {
          spend(14, 22);
          if (r() < 0.42 + (s.legs - 0.5) * 0.12 + (s.pulled ? 0.08 : 0) + look({ trap: 0.1, high: -0.08, gap: 0.12, change: 0.05 })) {
            say('entry', '{W2} dumps it in and {W1} wins the battle.', { ok: true, type: 'dump' }); s.phase = 'ZONE';
          } else { say('entry', 'Dumped in. {oD} gets there first.', { ok: false, type: 'dump' }); clear(0.7, 0.2); }
        } else if (p === 'stretch') {
          spend(6, 12);
          if (r() < 0.3 + look({ high: 0.34, change: 0.12, trap: -0.12, gap: -0.05 })) {
            say('pass', '{D1} hits {W1} with the stretch pass.', { ok: true, type: 'stretch' });
            if (r() < 0.4) { if (shot(0.16, 'breakaway', '{W1}') !== 'goal') clear(1, 0.3); }
            else s.phase = 'ZONE';
          } else {
            say('pass', 'Stretch pass picked off by {oD}.', { ok: false, type: 'stretch' });
            if (s.pulled) { if (!engAttempt(R.engTurn * 1.1)) s.phase = 'ENTRY'; }
            else if (r() < 0.35) { if (!against(0.08, 'rush')) theirs(true); } else theirs(false);
          }
        } else {
          spend(15, 22);
          s.legs = Math.max(s.legs, 0.92);
          if (r() < 0.08) { say('turn', 'Picked off on the regroup.'); if (s.pulled) { if (!engAttempt(R.engTurn * 0.8)) s.phase = 'ENTRY'; } else theirs(true); }
          else say('change', `Swing back to {D1}. Fresh legs on.${L === 'change' ? ' They got their change too.' : ''}`);
        }
      } else if (ph === 'ZONE') {
        if (p === 'shoot') {
          spend(10, 16);
          if (L === 'points' && r() < 0.15) {
            say('turn', '{oW} jumps the point and is gone.', {});
            if (s.pulled) { if (!engAttempt(0.4, '{oW}')) s.phase = 'ENTRY'; }
            else if (!against(0.15, 'breakaway')) s.phase = 'ENTRY';
          } else {
            const res = shot(0.045 * (L === 'rebound' ? 1.3 : 1), 'point', '{D1}', look({ box: 0.62, points: 0.55, rebound: 0.18 }) || 0.3);
            if (res !== 'goal' && !(res === 'save' && r() < (L === 'rebound' ? 0.75 : 0.22) && shot(0.1 * (L === 'rebound' ? 1.5 : 1), 'rebound', '{C}') === 'goal')) clear(1, 0.42);
          }
        } else if (p === 'cycle') {
          spend(18, 28);
          if (r() < 0.64 + (s.legs - 0.5) * 0.12 + look({ box: 0.1, tired: 0.15, points: 0.05 })) {
            say('play', '{C} and {W2} work it low.');
            if (shot(0.1 * (L === 'tired' ? 1.25 : 1), 'slot', '{W2}') !== 'goal') clear(1, 0.38);
          } else { say('turn', 'Cycle broken up along the wall.'); clear(1.25, 0.25); }
        } else if (p === 'seam') {
          spend(10, 15);
          if (r() < 0.45 + look({ door: 0.27, box: -0.05 })) {
            say('pass', '{C} threads it across to {W1}.', { ok: true, type: 'seam' });
            if (shot(0.165, 'door', '{W1}') !== 'goal') clear(1, 0.32);
          } else {
            say('pass', 'Seam pass picked off by {oD}.', { ok: false, type: 'seam' });
            if (s.pulled) { if (!engAttempt(R.engTurn * 1.1)) s.phase = 'ENTRY'; }
            else { const x = r(); if (x < 0.35) { if (!against(0.09, 'rush')) theirs(true); } else if (x < 0.7) theirs(false); else s.phase = 'ENTRY'; }
          }
        } else {
          spend(12, 18);
          if (r() < 0.5 + look({ points: 0.22, box: -0.15 })) {
            say('pass', '{D2} bumps it to {C} in the slot.', { ok: true, type: 'bump' });
            if (shot(0.11 * (L === 'points' ? 1.25 : 1), 'slot', '{C}') !== 'goal') clear(1, 0.4);
          } else { say('turn', '{oD} ties up {C} in front.'); clear(1.1, 0.3); }
        }
      } else if (ph === 'THEIRS' && !s.deep) {
        if (p === 'press') {
          spend(10, 16);
          if (r() < 0.42 + look({ slow: 0.25, dump: -0.12, stretch: -0.18 })) { say('take', '{W1} forces the turnover.'); s.phase = r() < 0.5 ? 'ZONE' : 'ENTRY'; }
          else {
            say('beat', 'They chip it past the forecheck.');
            if (s.pulled) { if (!engAttempt(L === 'stretch' ? 0.3 : 0.22)) s.phase = 'ENTRY'; }
            else if (!against(0.075 * (L === 'stretch' ? 2.4 : 1), L === 'stretch' ? 'breakaway' : 'rush')) { if (r() < 0.5) theirs(true); else s.phase = 'ENTRY'; }
          }
        } else {
          spend(15, 24);
          const x = r();
          if (x < 0.28 + look({ stretch: 0.12, slow: -0.05 })) { say('take', 'Picked off in the neutral zone.'); s.phase = 'ENTRY'; }
          else if (x < 0.7 + look({ dump: 0.2 })) { say('dumpin', '{oD} dumps it in. {D1} goes back for it.'); if (!(s.pulled && engAttempt(0.07))) s.phase = s.phase === 'FO_O' ? 'FO_O' : 'ENTRY'; }
          else { say('zone', 'They gain the zone.'); if (s.pulled) { if (!engAttempt(0.3)) s.phase = 'ENTRY'; } else theirs(true); }
        }
      } else {
        if (p === 'press') {
          spend(10, 16);
          if (r() < 0.45 + look({ cycle: 0.3, shot: -0.1, screen: -0.08 })) { say('take', '{D2} wins the puck battle.'); s.phase = 'ENTRY'; }
          else { say('beat', 'They beat the pressure.'); if (!against(0.1 * (look({ shot: 1.5, screen: 1.4 }) || 1), 'slot')) { if (r() < 0.55) s.phase = 'ENTRY'; } }
        } else {
          spend(18, 28); if (L === 'cycle') spend(6, 10);
          say('play', 'Collapsed in front of {G}.');
          if (!against(0.055 * (look({ shot: 0.7, screen: 0.8 }) || 1), 'point', '{oD}')) { const x = r(); if (x < 0.55) s.phase = 'ENTRY'; else if (x < 0.8) theirs(false); }
        }
      }
    } else {
      // 3-on-3 overtime: possession and odd-man rushes
      const rush = (q) => against(q, 'rush');
      if (ph.startsWith('FO_')) {
        spend(5, 10);
        if (!faceoff()) { if (ph === 'FO_D' && against(0.06, 'quick', '{oC}')) {} else theirs(ph === 'FO_D'); }
        else if (p === 'go') { if (shot(ph === 'FO_O' ? 0.11 : 0.06, ph === 'FO_O' ? 'circle' : 'rush', '{W1}') !== 'goal') { if (r() < 0.45) s.phase = 'ZONE'; else theirs(false); } }
        else s.phase = ph === 'FO_O' ? 'ZONE' : 'ENTRY';
      } else if (ph === 'ENTRY') {
        if (p === 'carry') {
          spend(8, 13);
          if (r() < 0.6 + (s.legs - 0.5) * 0.2 + look({ change: 0.15, gap: -0.1, trap: -0.1, high: 0.05 })) {
            say('entry', '{C} attacks with speed.', { ok: true, type: 'carry' });
            if (r() < 0.45) { if (shot(0.1, 'rush', '{C}') !== 'goal') { if (r() < 0.5) s.phase = 'ZONE'; else theirs(false); } }
            else s.phase = 'ZONE';
          } else { say('entry', 'Turned over in the neutral zone.', { ok: false, type: 'carry' }); if (!(r() < 0.45 && rush(0.16))) theirs(r() < 0.5); }
        } else if (p === 'change') {
          spend(12, 20); s.legs = Math.min(1, s.legs + 0.35);
          if (r() < 0.06) { say('turn', 'Picked off on the regroup.'); if (!rush(0.14)) theirs(true); }
          else say('change', 'Circle back, change on the fly. Fresh legs.');
        } else {
          spend(5, 9);
          if (r() < 0.28 + look({ high: 0.15, change: 0.1 })) { say('pass', 'Stretch pass on the tape.', { ok: true, type: 'stretch' }); if (shot(0.26, 'breakaway', '{W1}') !== 'goal') { if (r() < 0.5) theirs(false); else s.phase = 'ZONE'; } }
          else { say('pass', 'Stretch pass picked off.', { ok: false, type: 'stretch' }); if (!(r() < 0.5 && rush(0.17))) theirs(r() < 0.5); }
        }
      } else if (ph === 'ZONE') {
        if (p === 'shoot') {
          spend(8, 13);
          const res = shot(0.07, 'point', '{D1}');
          if (res !== 'goal' && !(res === 'save' && r() < (L === 'rebound' ? 0.5 : 0.25) && shot(0.11, 'rebound', '{C}') === 'goal')) {
            const x = r(); if (x < 0.3) s.phase = 'ZONE'; else if (x < 0.55) { if (!rush(0.13)) theirs(true); } else theirs(false);
          }
        } else if (p === 'seam') {
          spend(15, 24);
          if (r() < 0.62 + (s.legs - 0.5) * 0.2 + look({ door: 0.15, tired: 0.1, box: -0.05 })) {
            say('pass', '{C} waits, then finds {W1} at the back door.', { ok: true, type: 'seam' });
            if (shot(0.15, 'door', '{W1}') !== 'goal') { if (r() < 0.4) s.phase = 'ZONE'; else theirs(false); }
          } else { say('turn', 'Lost it down low.'); if (!(r() < 0.4 && rush(0.15))) theirs(false); }
        } else { spend(6, 10); say('change', 'Peeled back to center. Still yours.'); s.phase = r() < 0.07 ? 'THEIRS' : 'ENTRY'; }
      } else {
        if (p === 'press') {
          spend(8, 13);
          if (r() < 0.4 + (s.legs - 0.5) * 0.2 + look({ slow: 0.15, cycle: 0.15, stretch: -0.1 })) {
            say('take', 'Stripped them. Your puck.');
            if (!(r() < 0.3 && shot(0.12, 'rush', '{W1}') === 'goal') && !s.over) s.phase = 'ENTRY';
          } else { say('beat', 'Missed the check.'); if (!rush((s.deep ? 0.19 : 0.16) * (L === 'stretch' ? 1.2 : 1))) { if (r() < 0.5) theirs(true); else s.phase = 'ENTRY'; } }
        } else {
          spend(14, 22);
          if (!against(s.deep ? 0.07 : 0.055, 'point', '{oD}')) { const x = r(); if (x < 0.45) s.phase = 'ENTRY'; else theirs(x > 0.75); }
        }
      }
    }

    // legs, penalties and the clock
    dur = Math.max(dur, 3);
    s.legs = clamp(s.legs - dur / (is3 ? 55 : 80), 0, 1);
    if (s.pp) { const left = Math.abs(s.pp) - dur; s.pp = left > 0 ? Math.sign(s.pp) * left : 0; }
    if (!s.over && s.pp === 0) {
      const attacking = ['FO_O', 'ZONE', 'ENTRY'].includes(ph);
      if (r() < (attacking ? R.penOpp : R.penYou) * dur / 60) {
        if (attacking) { s.pp = 120; s.phase = 'FO_O'; say('pp', 'Penalty on {oD}. Power play, faceoff in their end.'); }
        else { s.pp = -120; s.phase = 'FO_D'; say('pk', 'Penalty on {D2}. Penalty kill.'); }
      }
    }
    s.t = Math.max(0, s.t - dur);
    s.last = dur;
    finishClock(s, say);
    if (!s.over) s.look = pickLook(s, r);
    return s;
  }

  function finishClock(s, say) {
    if (s.over) { s.won = s.you > s.opp; s.how = s.how || 'OT'; return; }
    if (s.t > 0) return;
    if (s.per === 'REG') {
      if (s.you !== s.opp) { s.over = true; s.won = s.you > s.opp; s.how = 'REG'; say('end', 'Final horn.'); return; }
      s.per = 'OT'; s.otNum = 1; s.t = s.playoff ? 1200 : 300; s.phase = 'FO_N'; s.pulled = false; s.oppPulled = false; s.legs = 1;
      if (s.pp) s.pp = Math.sign(s.pp) * Math.min(Math.abs(s.pp), 120);
      say('ot', s.playoff ? 'Tied at the end of regulation. Sudden-death overtime: 20 minutes, full strength, next goal wins.' : 'Tied at the end of regulation. 3-on-3 overtime.');
    } else if (s.per === 'OT' && s.playoff) {
      s.otNum += 1; s.t = 1200; s.phase = 'FO_N'; s.legs = 1;
      say('ot', `Still tied. ${s.otNum === 2 ? 'Double' : s.otNum === 3 ? 'Triple' : `${s.otNum}x`} overtime.`);
    } else if (s.per === 'OT') {
      s.per = 'SO';
      say('so', 'Still tied after overtime. Shootout.');
    }
  }

  // ---------- the typical NHL bench, who finishes every simulated game ----------
  const MIX = {
    REG: { FO_O: { back: 0.45, set: 0.25, tie: 0.3 }, FO_N: { fwd: 0.5, back: 0.5 }, FO_D: { out: 0.6, glass: 0.4 },
      ENTRY: { carry: 0.45, dump: 0.4, stretch: 0.08, change: 0.07 }, ZONE: { shoot: 0.38, cycle: 0.32, seam: 0.15, net: 0.15 },
      THEIRS_N: { press: 0.55, sit: 0.45 }, THEIRS_D: { press: 0.5, sit: 0.5 } },
    OT: { FO_O: { back: 0.6, go: 0.4 }, FO_N: { back: 0.6, go: 0.4 }, FO_D: { back: 0.6, go: 0.4 },
      ENTRY: { carry: 0.5, change: 0.4, stretch: 0.1 }, ZONE: { shoot: 0.4, seam: 0.4, peel: 0.2 },
      THEIRS_N: { press: 0.45, sit: 0.55 }, THEIRS_D: { press: 0.45, sit: 0.55 } },
  };
  const mixFor = (s) => MIX[three(s) ? 'OT' : 'REG'][tableKey(s)];
  function coachToggles(s) {
    const o = options(s);
    const d = diff(s);
    let goalie = false;
    if (o.canPull && d < 0 && s.t <= (R.pullAt[String(Math.max(d, -2))] ?? 300)) goalie = true;
    if (o.canReturn && (d >= 0 || s.phase === 'FO_D')) goalie = true;
    const pulledNow = s.pulled !== goalie;
    const timeout = o.canTimeout && d < 0 && s.phase === 'FO_O' && ((pulledNow && s.t < 120) || s.t < 60);
    return { goalie, timeout };
  }
  function coach(s, r) {
    const mix = mixFor(s);
    let x = r(), play = Object.keys(mix)[0];
    for (const [k, w] of Object.entries(mix)) { if (x < w) { play = k; break; } x -= w; }
    return { play, ...coachToggles(s) };
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
  function grade(s, n = 3000, seed = 1) {
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
    return cs.map((c, i) => ({ ...c, wp: wins[i] / n })).sort((a, b) => b.wp - a.wp);
  }
  const key = (c) => `${c.play}|${c.goalie ? 1 : 0}|${c.timeout ? 1 : 0}`;
  // what a typical bench would get here on average, and how much benches vary
  function typical(s, graded) {
    const t = coachToggles(s), mix = mixFor(s);
    let wp = 0;
    const rows = Object.entries(mix).map(([play, w]) => { const g = graded.find((x) => key(x) === key({ play, ...t })); wp += w * g.wp; return [w, g.wp]; });
    const v = rows.reduce((a, [w, x]) => a + w * (x - wp) ** 2, 0);
    return { wp, v };
  }
  // the verdict on one call, in words
  const MARGIN = 0.01;   // replaying 3,000 times leaves about half a point of noise between two calls
  function verdict(loss, best) {
    if (best < 0.01) return { k: 'none', text: 'Out of reach. Not graded.' };
    const l = loss * clamp(0.15 / best, 1, 3);   // edges count for more when there is less to play with
    if (l <= 0.002) return { k: 'best', text: 'The best call.' };
    if (l <= MARGIN) return { k: 'good', text: 'As good as any (inside the margin).' };
    if (l <= 0.03) return { k: 'ok', text: 'Decent.' };
    return { k: 'bad', text: 'Costly.' };
  }
  // normal CDF for the bench percentile
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

  globalThis.Drill = { R, CALLS, OT_CALLS, LOOKS, MOVES, newGame, options, choices, resolve, grade, typical, verdict, phi, key, coach, coachToggles,
    finish, clone, lookInfo, tableKey, shootout, soValue, soGrade, mulberry, hash, fmt, skaters, diff };
})();
