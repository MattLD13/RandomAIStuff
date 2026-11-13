// Empty Net: the page. Reads window.DRILL_DATA (real endings + daily schedule) and window.Drill (the model).
// Every call is a target on the ice: tap it, drag the puck to it, tap a key, or press 1-4. The play then runs
// on the rink frame by frame (players skate, the puck carries, passes and shots fly, the goalie slides).
(function () {
  const D = window.Drill, DATA = window.DRILL_DATA;
  const $ = (id) => document.getElementById(id);
  const games = new Map(DATA.games.map((g) => [g.id, g]));
  const STORE = 'emptynet:v3';
  const SVGNS = 'http://www.w3.org/2000/svg';

  // ---------- day number ----------
  const launch = new Date(DATA.launch + 'T00:00:00');
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const DAY = Math.max(1, Math.round((today - launch) / 864e5) + 1);
  const gameForDay = (d) => games.get(DATA.schedule[(d - 1) % DATA.schedule.length]) || DATA.games[(d - 1) % DATA.games.length];

  // ---------- storage (optional; the game works without it) ----------
  const load = () => { try { return JSON.parse(localStorage.getItem(STORE)) || { days: {} }; } catch { return { days: {} }; } };
  const save = (st) => { try { localStorage.setItem(STORE, JSON.stringify(st)); } catch {} };

  // ---------- grading: a Web Worker when the page allows one, otherwise a smaller run on the page ----------
  // kind 'grade': your decision against the alternatives; kind 'wp': win chance from here with a typical bench
  let worker = null, jobId = 0, syncN = 400;
  const jobs = new Map();
  const typicalOf = (s) => Object.assign({}, D.coachBase(s), { setup: 'umb', d: 'safe' });
  const runJob = (j) => {
    const t = performance.now();
    const out = j.kind === 'grade' ? D.grade(j.s, j.mine, syncN, j.seed) : D.evaluate(j.s, [typicalOf(j.s)], syncN, j.seed)[0].wp;
    const ms = performance.now() - t;
    if (ms > 700 && syncN > 150) syncN = Math.max(150, Math.round(syncN * 700 / ms));   // keep a slow phone responsive
    return out;
  };
  const dropWorker = () => { worker = null; for (const [id, j] of jobs) { jobs.delete(id); j.res(runJob(j)); } };
  try {
    const src = $('engine-src').textContent;
    const glue = `\nonmessage = (e) => { const j = e.data; const out = j.kind === 'grade' ? Drill.grade(j.s, j.mine, j.n, j.seed) : Drill.evaluate(j.s, [Object.assign({}, Drill.coachBase(j.s), { setup: 'umb', d: 'safe' })], j.n, j.seed)[0].wp; postMessage({ id: j.id, out }); };`;
    worker = new Worker(URL.createObjectURL(new Blob([src, glue], { type: 'text/javascript' })));
    worker.onmessage = (e) => { const j = jobs.get(e.data.id); if (j) { jobs.delete(e.data.id); j.res(e.data.out); } };
    worker.onerror = (e) => { if (e && e.preventDefault) e.preventDefault(); dropWorker(); };
  } catch { worker = null; }
  function job(kind, s, mine, seed) {
    const j = { kind, s: D.clone(s), mine, seed };
    return new Promise((res) => {
      j.res = res;
      if (worker) {
        const id = ++jobId;
        jobs.set(id, j);
        try { worker.postMessage({ id, kind, s: j.s, mine, seed, n: kind === 'grade' ? 900 : 700 }); } catch { jobs.delete(id); dropWorker(); setTimeout(() => res(runJob(j)), 0); return; }
        setTimeout(() => { if (jobs.has(id)) dropWorker(); }, 12000);
        return;
      }
      setTimeout(() => res(runJob(j)), 20);
    });
  }


  // ---------- helpers ----------
  const fmt = D.fmt;
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const ink = (hex) => { const n = parseInt(hex.slice(1), 16); return (0.299 * (n >> 16) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) > 160 ? '#0b0f14' : '#ffffff'; };
  const OLD = { ATL: 'WPG', PHX: 'UTA', ARI: 'UTA' };
  const color = (ab, i = 0) => (DATA.colors[ab] || DATA.colors[OLD[ab]] || ['#4b5866', '#8d9cab'])[i];
  const dateStr = (iso) => new Date(iso + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  const perLabel = (s) => s.per === 'REG' ? '3RD' : s.per === 'SO' ? 'SO' : s.playoff && s.otNum > 1 ? `${s.otNum}OT` : 'OT';
  const last = (n) => (n || '').split(' ').slice(1).join(' ') || n || '';
  const pts = (x) => Math.abs(x) < 0.0005 ? '0.0' : `${x >= 0 ? '+' : '−'}${Math.abs(x * 100).toFixed(1)}`;
  const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
  const lerp = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
  const clamp = (x, a, b) => Math.max(a, Math.min(b, x));

  // ---------- sound (Web Audio, made on the fly; off with the speaker button) ----------
  const Sound = (() => {
    let ctx = null, on = load().sound !== false;
    const ac = () => {
      if (!ctx) { try { ctx = new (window.AudioContext || window.webkitAudioContext)(); } catch { ctx = null; } }
      if (ctx && ctx.state === 'suspended') ctx.resume().catch(() => {});
      return ctx;
    };
    const noise = (c, dur, type, freq, gain, at = 0) => {
      const n = Math.floor(c.sampleRate * dur), buf = c.createBuffer(1, n, c.sampleRate), d = buf.getChannelData(0);
      for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / n, 3);
      const src = c.createBufferSource(); src.buffer = buf;
      const f = c.createBiquadFilter(); f.type = type; f.frequency.value = freq;
      const g = c.createGain(); g.gain.value = gain;
      src.connect(f).connect(g).connect(c.destination); src.start(c.currentTime + at);
    };
    const tone = (c, type, freq, dur, gain, at = 0, vib = 0) => {
      const o = c.createOscillator(), g = c.createGain();
      o.type = type; o.frequency.value = freq;
      if (vib) { const l = c.createOscillator(), lg = c.createGain(); l.frequency.value = 28; lg.gain.value = vib; l.connect(lg).connect(o.frequency); l.start(c.currentTime + at); l.stop(c.currentTime + at + dur); }
      const t = c.currentTime + at;
      g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(gain, t + 0.03); g.gain.setValueAtTime(gain, t + dur - 0.12); g.gain.linearRampToValueAtTime(0, t + dur);
      o.connect(g).connect(c.destination); o.start(t); o.stop(t + dur + 0.02);
    };
    const play = (k) => {
      if (!on) return;
      const c = ac(); if (!c) return;
      try {
        if (k === 'stick') noise(c, 0.06, 'bandpass', 2600, 0.5);
        else if (k === 'pass') noise(c, 0.035, 'bandpass', 1900, 0.28);
        else if (k === 'save') { noise(c, 0.09, 'lowpass', 900, 0.55); }
        else if (k === 'board') noise(c, 0.12, 'lowpass', 380, 0.7);
        else if (k === 'post') { tone(c, 'triangle', 1480, 0.22, 0.12); tone(c, 'triangle', 2210, 0.18, 0.06); }
        else if (k === 'whistle') tone(c, 'sine', 2950, 0.42, 0.09, 0, 140);
        else if (k === 'horn') { [174.6, 220, 261.6].forEach((f) => tone(c, 'sawtooth', f, 1.7, 0.05)); }
        else if (k === 'thud') { tone(c, 'sine', 82, 0.45, 0.35); noise(c, 0.25, 'lowpass', 300, 0.4); }
        else if (k === 'skate') noise(c, 0.18, 'highpass', 5200, 0.05);
      } catch {}
    };
    return { play, wake: ac, get on() { return on; }, set(v) { on = v; const st = load(); st.sound = v; save(st); } };
  })();
  function soundIcon() { $('btn-sound').setAttribute('aria-pressed', String(Sound.on)); $('snd-wave').toggleAttribute('hidden', !Sound.on); $('snd-x').toggleAttribute('hidden', Sound.on); }
  $('btn-sound').onclick = () => { Sound.set(!Sound.on); soundIcon(); if (Sound.on) { Sound.wake(); Sound.play('pass'); } };
  soundIcon();

  // ---------- state ----------
  let G = null;
  let timers = [];
  const later = (fn, ms) => { const t = setTimeout(fn, ms); timers.push(t); return t; };
  const clearTimers = () => { timers.forEach(clearTimeout); timers = []; };

  function namesFor(sc) { return { G: last(sc.roster.youG?.n) || 'your goalie', oG: last(sc.roster.oppG?.n) || 'their goalie' }; }
  // the real lines and pairs from that game (or, for an older entry, the late-game lineup three times)
  function rosterOf(sc) {
    const nm = (p) => (p ? { n: p.n, num: p.num } : { n: '', num: '' });
    if (sc.lines) {
      const side = (x) => ({ lines: x.lines.map((l) => l.map(nm)), pairs: x.pairs.map((p) => p.map(nm)), fo: x.fo });
      return { you: side(sc.lines.you), opp: side(sc.lines.opp) };
    }
    const side = (u) => ({ lines: [0, 1, 2].map(() => [nm(u.C), nm(u.W1), nm(u.W2)]), pairs: [[nm(u.D1), nm(u.D2)], [nm(u.D1), nm(u.D2)]], fo: [[0, 0], [0, 0], [0, 0]] });
    return { you: side(sc.lineup?.you || {}), opp: side(sc.lineup?.opp || {}) };
  }
  // who is on the ice for a given pair of lines
  function namesAt(line, oline, xa) {
    const R = G.roster, yl = R.you.lines[line] || R.you.lines[0], ol = R.opp.lines[oline] || R.opp.lines[0];
    const yp = R.you.pairs[line === 2 ? 1 : 0] || R.you.pairs[0], op = R.opp.pairs[oline === 2 ? 1 : 0] || R.opp.pairs[0];
    const X = xa === 'D' ? ((R.you.pairs[1] && R.you.pairs[1][0]) || yp[0]) : (line === 0 ? R.you.lines[1][0] : R.you.lines[0][0]);
    return { C: yl[0], LW: yl[1], RW: yl[2], D1: yp[0], D2: yp[1], X, oC: ol[0], oLW: ol[1], oRW: ol[2], oD1: op[0], oD2: op[1] };
  }
  const fill = (text, d = {}) => {
    const m = namesAt(d.line ?? G.s.on, d.oline ?? G.s.oon, d.xa ?? G.s.xa);
    return text.replace(/\{(\w+)\}/g, (_, k) => (k === 'G' ? G.names.G : k === 'oG' ? G.names.oG : (m[k] && m[k].n) || k));
  };

  function setTeams(sc) {
    const st = document.documentElement.style;
    const y = color(sc.you.ab), o = color(sc.opp.ab);
    st.setProperty('--you', y); st.setProperty('--you-ink', ink(y));
    st.setProperty('--opp', o); st.setProperty('--opp-ink', ink(o));
  }
  function hideAll() { for (const id of ['intro', 'game', 'end', 'how', 'archive']) $(id).hidden = true; }

  // ---------- home ----------
  function showIntro(day, practiceSc) {
    clearTimers();
    const sc = practiceSc || gameForDay(day);
    setTeams(sc);
    hideAll();
    $('intro').hidden = false;
    $('dayline').textContent = practiceSc ? 'Practice game' : `No. ${day} · ${day === DAY ? today.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : 'from the archive'}`;
    $('intro-tag').textContent = practiceSc ? 'Practice · a real game' : day === DAY ? `Today's game · No. ${day}` : `Game No. ${day}`;
    $('intro-game').textContent = `${sc.label} · ${dateStr(sc.date)}`;
    $('intro-clock').textContent = `${fmt(sc.start.t)} left in the third`;
    $('intro-you').textContent = sc.you.ab; $('intro-opp').textContent = sc.opp.ab;
    $('intro-you-n').textContent = sc.you.name; $('intro-opp-n').textContent = sc.opp.name;
    $('intro-score').textContent = `${sc.start.you}–${sc.start.opp}`;
    const zone = { O: 'Faceoff in their end', D: 'Faceoff in your end', N: 'Faceoff at center' }[sc.start.zone];
    $('intro-facts').innerHTML = [zone, 'Your timeout: unused', sc.type === 3 ? 'Tied? Sudden-death OT' : 'Tied? 3-on-3, then a shootout', sc.you.home ? 'At home' : 'On the road']
      .map((f) => `<span class="fact">${esc(f)}</span>`).join('');
    $('intro-note').textContent = `The real ${sc.you.name} bench lost this one. Read what they're showing, make the calls on the ice, and see if you can do better. A typical NHL bench scores 50.`;
    const rec = !practiceSc && load().days[day];
    $('intro-played').textContent = rec ? `You played this one: ${rec.score}/100, ${rec.won ? 'won' : 'lost'} ${rec.final}.` : '';
    $('btn-start').onclick = () => { Sound.wake(); start(day, practiceSc); };
  }

  // ==================================================================================================
  // The rink: your five, their five, two goalies; a frame loop; a camera that follows the puck
  // ==================================================================================================
  const ENT = ['G', 'C', 'LW', 'RW', 'D1', 'D2', 'X', 'oG', 'oC', 'oLW', 'oRW', 'oD1', 'oD2'];
  const YOU = ['C', 'LW', 'RW', 'D1', 'D2', 'X'], OPP = ['oC', 'oLW', 'oRW', 'oD1', 'oD2'];
  const A = { speed: 0.62, e: {}, tw: [], skipping: false, busy: false, cam: { cx: 42.5, cy: 100, z: 1, tx: 42.5, ty: 100, tz: 1, follow: false }, trail: [], trailOn: false, last: 0 };
  const P = (id) => [A.e[id].x, A.e[id].y];

  function buildRink() {
    const g = $('players');
    g.innerHTML = '';
    A.e = {};
    ENT.forEach((id, i) => {
      const mine = !id.startsWith('o');
      const goalie = id === 'G' || id === 'oG';
      const el = document.createElementNS(SVGNS, 'g');
      el.setAttribute('class', `pl ${mine ? 'you' : 'opp'}${goalie ? ' goalie' : ''}`);
      el.id = `p-${id}`;
      const stick = goalie ? '' : `<line class="stick" x1="${mine ? 1.6 : -1.6}" y1="${mine ? -1.2 : 1.2}" x2="${mine ? 2.6 : -2.6}" y2="${mine ? -3.6 : 3.6}"/>`;
      el.innerHTML = `${stick}<circle r="${goalie ? 2.9 : 2.5}"/><text class="n">${goalie ? 'G' : ''}</text><text class="l" y="${mine ? 5.1 : -3.7}">${goalie ? esc(mine ? G.names.G : G.names.oG) : ''}</text>`;
      g.appendChild(el);
      A.e[id] = { x: 42.5, y: 100, el, ph: i * 1.7 };
    });
    A.e.puck = { x: 42.5, y: 100, el: $('puck'), ph: 0 };
  }
  // who is wearing which dot right now
  function relabel(line, oline, xa) {
    const m = namesAt(line, oline, xa);
    for (const id of ENT) {
      if (id === 'G' || id === 'oG') continue;
      const p = m[id] || {}, el = $(`p-${id}`);
      if (!el) continue;
      el.querySelector('.n').textContent = p.num ?? '';
      el.querySelector('.l').textContent = p.n || '';
    }
  }
  const setPos = (id, p) => { A.e[id].x = p[0]; A.e[id].y = p[1]; };
  const ease = (t) => t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
  const easeOut = (t) => 1 - Math.pow(1 - t, 3);
  const linear = (t) => t;
  // move an entity; ctrl bends the path (quadratic curve); with: other ids that ride along with an offset
  function tween(id, to, dur, o = {}) {
    return new Promise((res) => {
      const e = A.e[id]; if (!e) return res();
      if (A.skipping || dur <= 0) { setPos(id, to); return res(); }
      A.tw = A.tw.filter((t) => { if (t.id === id) { t.res(); return false; } return true; });
      A.tw.push({ id, from: [e.x, e.y], to, ctrl: o.ctrl, t0: performance.now(), dur: dur * A.speed, ease: o.ease || ease, res, carry: o.carry });
    });
  }
  const sleep = (ms) => new Promise((res) => { if (A.skipping) return res(); const t = setTimeout(res, ms * A.speed); timers.push(t); A.sleeps.push(res); });
  A.sleeps = [];
  // the puck rides along with a skater
  const carry = (id, to, dur, o = {}) => Promise.all([tween(id, to, dur, o), tween('puck', [to[0] + 1.6, to[1] - 1.6], dur, o)]);
  const puckTo = (to, dur, o = {}) => { A.trailOn = !!o.trail; A.trail = []; return tween('puck', to, dur, { ease: o.ease || easeOut, ctrl: o.ctrl }).then(() => { A.trailOn = false; }); };

  function frame(now) {
    const dt = Math.min(64, now - (A.last || now)); A.last = now;
    // tweens
    A.tw = A.tw.filter((t) => {
      const k = clamp((now - t.t0) / t.dur, 0, 1), e = t.ease(k);
      let x, y;
      if (t.ctrl) { const u = 1 - e; x = u * u * t.from[0] + 2 * u * e * t.ctrl[0] + e * e * t.to[0]; y = u * u * t.from[1] + 2 * u * e * t.ctrl[1] + e * e * t.to[1]; }
      else { x = t.from[0] + (t.to[0] - t.from[0]) * e; y = t.from[1] + (t.to[1] - t.from[1]) * e; }
      setPos(t.id, [x, y]);
      if (k >= 1) { t.res(); return false; }
      return true;
    });
    // draw: skaters drift a little while you think, so the ice never looks frozen
    const idle = !A.busy;
    for (const [id, e] of Object.entries(A.e)) {
      let x = e.x, y = e.y;
      if (idle && id !== 'puck' && id !== 'G' && id !== 'oG') { x += 0.45 * Math.sin(now / 820 + e.ph); y += 0.35 * Math.cos(now / 1030 + e.ph * 1.3); }
      e.el.setAttribute('transform', `translate(${x.toFixed(2)} ${y.toFixed(2)})`);
    }
    // puck trail
    if (A.trailOn) { A.trail.push(`${A.e.puck.x.toFixed(1)},${A.e.puck.y.toFixed(1)}`); if (A.trail.length > 9) A.trail.shift(); }
    else if (A.trail.length) A.trail.shift();
    $('trail').setAttribute('points', A.trail.join(' '));
    // camera
    const c = A.cam;
    if (c.follow) { c.ty = A.e.puck.y; c.tx = 42.5; }
    const half = 56 / c.tz, halfW = 42.5 / c.tz;
    const ty = clamp(c.ty, half, 200 - half), tx = c.tz > 1 ? clamp(c.tx, halfW, 85 - halfW) : 42.5;
    const kk = 1 - Math.exp(-dt / (c.follow ? 160 : 220));
    c.cy += (ty - c.cy) * kk; c.cx += (tx - c.cx) * kk; c.z += (c.tz - c.z) * kk;
    $('cam').setAttribute('transform', `translate(${(42.5 - c.cx * c.z).toFixed(2)} ${(56 - c.cy * c.z).toFixed(2)}) scale(${c.z.toFixed(3)})`);
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
  const camTo = (cy, z = 1, cx = 42.5, snap = false) => { const c = A.cam; c.follow = false; c.ty = cy; c.tz = z; c.tx = cx; if (snap) { c.cy = clamp(cy, 56 / z, 200 - 56 / z); c.z = z; c.cx = cx; } };

  function show(id, on) { $(`p-${id}`)?.classList.toggle('off', !on); }
  function hl(id) { document.querySelectorAll('.pl.hl').forEach((e) => e.classList.remove('hl')); if (id) $(`p-${id}`)?.classList.add('hl'); }
  function flash(text, cls, ms = 1300) { const f = $('flash'); f.hidden = false; f.className = `flash ${cls}`; f.textContent = text; later(() => { f.hidden = true; }, ms); }
  function tick(text) { $('ticker').hidden = !text; $('ticker').textContent = text || ''; }
  function lamp(side) { const l = $(`lamp-${side}`); l.classList.remove('on'); void l.getBBox(); l.classList.add('on'); later(() => l.classList.remove('on'), 2000); const n = $(`netg-${side}`); n.classList.remove('shake'); void n.getBBox(); n.classList.add('shake'); }

  // where everyone stands: by zone, who has the puck, your setup and their structure
  const SETPOS = {
    umb: { D1: [42, 68], D2: [70, 48], LW: [15, 48], C: [42, 38], RW: [42, 20], X: [26, 66] },
    over: { D1: [18, 68], D2: [56, 70], LW: [9, 42], C: [14, 16], RW: [37, 20], X: [42, 48] },
    crash: { D1: [24, 68], D2: [62, 68], LW: [12, 40], C: [37, 18], RW: [48, 18], X: [42, 46] },
  };
  const LOOKPOS = {
    box: { oD1: [36, 22], oD2: [49, 22], oLW: [33, 38], oRW: [52, 38], oC: [42, 30] },
    pressure: { oLW: [22, 60], oRW: [62, 60], oD1: [34, 24], oD2: [51, 24], oC: [42, 36] },
    sag: { oD1: [35, 26], oD2: [52, 26], oLW: [28, 46], oRW: [58, 48], oC: [44, 38] },
  };
  function formation(ctx) {
    const F = {};
    let puck = [42.5, 100], cy = 100;
    const fo = (dx, dy, zone) => {
      F.C = [dx, dy + 3.2]; F.oC = [dx, dy - 3.2];
      F.LW = [dx - 10, dy + 4]; F.RW = [dx + 10, dy + 4]; F.oLW = [dx - 10, dy - 4]; F.oRW = [dx + 10, dy - 4];
      if (zone === 'O') Object.assign(F, { D1: [22, 64], D2: [62, 64], oD1: [26, 16], oD2: [58, 16], X: [45, 50] });
      else if (zone === 'D') Object.assign(F, { D1: [26, 183], D2: [58, 183], oD1: [24, 134], oD2: [60, 134], X: [45, 150] });
      else Object.assign(F, { D1: [30, 116], D2: [55, 116], oD1: [30, 84], oD2: [55, 84], X: [42, 122] });
      puck = [dx, dy];
    };
    const z = ctx.z, mine = ctx.poss === 'you';
    if (ctx.fo) { const dz = ctx.fz; if (dz === 'O') { fo(20.5, 31, 'O'); cy = 56; } else if (dz === 'D') { fo(20.5, 169, 'D'); cy = 144; } else fo(42.5, 100, 'N'); }
    else if (z === 'O') {
      cy = 56;
      Object.assign(F, SETPOS[ctx.setup] || SETPOS.umb, LOOKPOS[ctx.look] || LOOKPOS.box);
      if (ctx.pulled && ctx.setup === 'umb') F.D1 = [58, 66];
      const car = mine ? (ctx.setup === 'over' ? 'LW' : ctx.setup === 'crash' ? 'LW' : 'D1') : 'oD1';
      puck = [F[car][0] + (mine ? 1.6 : -1.6), F[car][1] + (mine ? -1.6 : 1.6)];
    } else if (z === 'N') {
      cy = 100;
      if (mine) Object.assign(F, { D1: [32, 128], D2: [56, 132], C: [42, 110], LW: [16, 104], RW: [69, 104], X: [50, 120], oC: [42, 96], oLW: [16, 88], oRW: [70, 88], oD1: [32, 72], oD2: [55, 72] });
      else Object.assign(F, { oD1: [40, 82], oD2: [60, 78], oC: [42, 98], oLW: [16, 104], oRW: [70, 104], C: [42, 112], LW: [28, 96], RW: [58, 96], D1: [30, 134], D2: [56, 134], X: [42, 120] });
      puck = mine ? [F.D1[0] + 1.6, F.D1[1] - 1.6] : [F.oD1[0] - 1.6, F.oD1[1] + 1.6];
    } else {
      cy = 144;
      if (mine) Object.assign(F, { D1: [36, 192], D2: [60, 184], C: [42, 165], LW: [12, 150], RW: [72, 150], X: [42, 172], oC: [30, 175], oLW: [50, 160], oRW: [70, 150], oD1: [30, 128], oD2: [56, 128] });
      else Object.assign(F, { oLW: [12, 170], oC: [28, 178], oRW: [62, 166], oD1: [22, 132], oD2: [63, 132], D1: [34, 178], D2: [52, 178], C: [42, 160], LW: [26, 142], RW: [60, 142], X: [42, 150] });
      puck = mine ? [F.D1[0] + 1.6, F.D1[1] - 1.6] : [F.oLW[0] - 1.6, F.oLW[1] + 1.6];
    }
    F.oG = [42.5, 13];
    F.G = ctx.pulled ? [88, 100] : [42.5, 187];
    return { F, puck, cy };
  }
  const ctxOf = (s) => ({ fo: s.dec === 'FO', fz: s.fz, z: s.z, poss: s.poss, setup: s.setup, look: s.look, pulled: s.pulled, xa: s.xa });
  function onIceFor(ctx, s) {
    const sk = D.skaters(s), is3 = D.three(s);
    const you = sk.you - (ctx.pulled ? 1 : 0), opp = sk.opp - (s.oppPulled ? 1 : 0);
    return { LW: you >= 4, RW: !is3 && you >= 5, D2: !is3 && you >= 3, X: ctx.pulled, oLW: opp >= 4, oRW: !is3 && opp >= 5, oD2: !is3 && opp >= 3, G: !ctx.pulled, oG: !s.oppPulled };
  }
  // everyone skates to their spots
  function stage(ctx, instant, ms = 650) {
    const f = formation(ctx);
    const vis = onIceFor(ctx, G.s);
    const moves = [];
    for (const id of ENT) {
      show(id, vis[id] ?? true);
      const p = f.F[id] || P(id);
      if (instant || A.skipping) setPos(id, p); else moves.push(tween(id, p, ms + Math.random() * 180));
    }
    if (instant || A.skipping) setPos('puck', f.puck); else moves.push(tween('puck', f.puck, ms));
    camTo(f.cy, 1, 42.5, instant);
    $('rink').classList.toggle('empty', !!ctx.pulled);
    A.ctx = ctx;
    return Promise.all(moves);
  }
  function tagFor(s) {
    const sk = D.skaters(s);
    const where = s.dec === 'FO' ? { O: 'Faceoff, their end', N: 'Faceoff, center ice', D: 'Faceoff, your end' }[s.fz] : s.z === 'O' ? (s.poss === 'you' ? 'Your puck in their end' : 'Their puck in their end') : s.z === 'N' ? 'Neutral zone' : (s.poss === 'you' ? 'Your puck in your end' : 'Their puck in your end');
    const str = s.pulled ? `${sk.you} on ${sk.opp} · empty net` : s.pp > 0 ? `Power play ${fmt(s.pp)}` : s.pp < 0 ? `Penalty kill ${fmt(-s.pp)}` : `${sk.you} on ${sk.opp}`;
    return `${where} · ${str}`;
  }
  function drawTargets(list, origin, z = 1) {
    const g = $('targets');
    const sc = 1 / z;
    const F = null;   // where the skaters are heading
    g.innerHTML = list.map((t) => {
      const [x, y] = t.at, lx = clamp(x, 10 * sc, 85 - 10 * sc), above = y < 18 || y > (origin ? origin[1] : 0) ? 1 : -1;
      // a target on a teammate: label above him, clear of his name (names sit below your skaters)
      const onMate = !!F && ['C', 'W1', 'W2', 'D1', 'D2', 'X'].some((id) => F[id] && !$(`p-${id}`).classList.contains('off') && dist(F[id], t.at) < 2.5);
      let ly = y + (onMate ? -5.6 : above * 6.2) * sc, lxx = lx, anchor = 'middle';
      if (y < 18 && Math.abs(x - 42.5) < 6) { ly = y + 1; lxx = x - 4.5 * sc; anchor = 'end'; }        // at the net: label beside it, not on the goalie
      else if (y < 30 && Math.abs(x - 42.5) < 8) { ly = y + 1; lxx = x + 4.2 * sc; anchor = 'start'; } // in the slot: label to the side
      return `<g class="tgt" data-p="${t.play}">${origin ? `<path class="lane" d="M${origin[0]} ${origin[1]} L${x} ${y}" style="stroke-width:${0.45 * sc}"/>` : ''}
        <circle class="halo" cx="${x}" cy="${y}" r="${3.6 * sc}"/><circle class="ring" cx="${x}" cy="${y}" r="${2.9 * sc}" style="stroke-width:${0.4 * sc}"/>
        <text class="num" x="${x}" y="${y}" style="font-size:${3 * sc}px">${t.n}</text>
        <text class="lbl" x="${lxx}" y="${ly}" style="text-anchor:${anchor};font-size:${2.8 * sc}px;stroke-width:${0.9 * sc}px">${esc(t.label)}</text></g>`;
    }).join('');
    A.targets = list; A.tz = z;
    $('rink-tag').hidden = list.length > 0;   // the call header says the same thing; keep the corner clear for targets
    $('rink').classList.toggle('aim', list.length > 0);
  }
  const clearTargets = () => { $('targets').innerHTML = ''; A.targets = []; $('rink-tag').hidden = false; $('rink').classList.remove('aim'); $('dragline').setAttribute('visibility', 'hidden'); };
  function hotTarget(play) { document.querySelectorAll('.tgt').forEach((g) => g.classList.toggle('hot', g.dataset.p === play)); }

  // pointer on the ice: tap a target, or drag the puck to one
  const toRink = (ev) => { const pt = $('rink').createSVGPoint(); pt.x = ev.clientX; pt.y = ev.clientY; const m = $('cam').getScreenCTM(); return m ? (({ x, y }) => [x, y])(pt.matrixTransform(m.inverse())) : [0, 0]; };
  const nearest = (p, r) => { let best = null, bd = r / (A.tz || 1); for (const t of A.targets || []) { const d = dist(p, t.at); if (d < bd) { bd = d; best = t; } } return best; };
  let drag = null;
  $('rink').addEventListener('pointerdown', (ev) => {
    if (G && A.busy && G.skip) { G.skip(); return; }
    if (!A.targets || !A.targets.length || !A.onPick) return;
    drag = { start: toRink(ev), moved: false, id: ev.pointerId };
    try { $('rink').setPointerCapture(ev.pointerId); } catch {}
  });
  $('rink').addEventListener('pointermove', (ev) => {
    if (!A.targets || !A.targets.length) return;
    const p = toRink(ev);
    if (drag) {
      if (dist(p, drag.start) > 2.5 / (A.tz || 1)) drag.moved = true;
      if (drag.moved) { const pk = P('puck'), l = $('dragline'); l.setAttribute('x1', pk[0]); l.setAttribute('y1', pk[1]); l.setAttribute('x2', p[0]); l.setAttribute('y2', p[1]); l.setAttribute('visibility', 'visible'); l.style.strokeWidth = 0.9 / (A.tz || 1); }
    }
    const t = nearest(p, drag && drag.moved ? 12 : 8);
    hotTarget(t ? t.play : null);
  });
  const endDrag = (ev, cancel) => {
    if (!drag) return;
    const p = toRink(ev), moved = drag.moved;
    drag = null;
    $('dragline').setAttribute('visibility', 'hidden');
    if (cancel) return;
    const t = nearest(p, moved ? 12 : 8);
    if (t && A.onPick) A.onPick(t.play);
  };
  $('rink').addEventListener('pointerup', (ev) => endDrag(ev, false));
  $('rink').addEventListener('pointercancel', (ev) => endDrag(ev, true));
  $('rink').addEventListener('pointerleave', () => { if (!drag) hotTarget(null); });



  // ---------- scoreboard ----------
  function board() {
    const { s, sc } = G;
    $('b-you').textContent = sc.you.ab; $('b-opp').textContent = sc.opp.ab;
    $('b-ys').textContent = s.you; $('b-os').textContent = s.opp;
    $('b-per').textContent = perLabel(s);
    $('b-clock').textContent = s.per === 'SO' ? '0:00' : fmt(s.t);
    $('b-clock').classList.toggle('hot', s.per === 'REG' && s.t <= 60);
    $('b-to').innerHTML = s.per === 'REG' ? `<i class="${s.to ? '' : 'used'}"></i>` : '';
  }

  // ==================================================================================================
  // A game: you run the bench
  // ==================================================================================================
  function start(day, practiceSc) {
    clearTimers();
    const sc = practiceSc || gameForDay(day);
    setTeams(sc);
    G = { day, practice: !!practiceSc, sc, s: D.newGame(sc), step: 0, sumD: 0, sumV: 0, calls: [], names: null, roster: rosterOf(sc), pick: null, wpNow: null };
    G.names = namesFor(sc);
    $('game').appendChild($('pbp'));
    hideAll();
    $('game').hidden = false;
    $('result').hidden = true; $('so').hidden = true; $('call').hidden = false;
    $('feed').innerHTML = '';
    buildRink();
    relabel(G.s.on, G.s.oon, G.s.xa);
    stage(ctxOf(G.s), true);
    $('rink-tag').textContent = tagFor(G.s);
    board();
    feed(fmt(sc.start.t), `<b>Puck drop</b>${esc(sc.label)}. Down ${sc.start.you}-${sc.start.opp}.`);
    job('wp', G.s, null, 7).then((wp) => { if (G && G.step === 0) G.wpNow = wp; });
    spot();
    window.scrollTo({ top: 0 });
  }

  function feed(t, html, chip) {
    const li = document.createElement('li');
    li.innerHTML = `<span class="t">${esc(t)}</span><div class="what">${html}</div>${chip || ''}`;
    $('feed').prepend(li);
  }

  const setupList = (s) => (D.three(s) ? D.SETUPS3 : D.SETUPS);
  const setupName = (s, id) => (setupList(s).find((x) => x[0] === id) || [id, id])[1];
  const dName = (id) => (D.DMODES.find((x) => x[0] === id) || [id, id])[1];
  const lineNames = (i) => G.roster.you.lines[i].map((p) => p.n).filter(Boolean).join(', ');
  function goalieName(id) {
    const m = namesAt(G.s.on, G.s.oon, id === 'pullD' ? 'D' : 'F');
    return { in: 'Stay in', pullF: `Pull: extra F (${m.X.n || 'forward'})`, pullD: `Pull: extra D (${m.X.n || 'defenseman'})`, stay: 'Stay pulled', back: 'Back in the net' }[id] || id;
  }
  function describe(s, c) {
    const bits = [`Line ${c.line + 1}`, setupName(s, c.setup), dName(c.d)];
    if (c.goalie === 'pullF' || c.goalie === 'pullD') bits.push(c.goalie === 'pullF' ? 'pulled the goalie (extra F)' : 'pulled the goalie (extra D)');
    if (c.goalie === 'back') bits.push('goalie back in');
    if (c.timeout) bits.push('timeout');
    return bits.join(' · ');
  }
  // small half-rink diagrams for the setups
  const MINI = {
    umb: [[30, 30], [10, 19], [50, 19], [30, 18], [30, 8]], over: [[11, 30], [6, 18], [10, 7], [24, 9], [44, 31]], crash: [[14, 30], [46, 30], [8, 18], [25, 7], [35, 7]],
  };
  const MINI3 = { umb: [[30, 30], [12, 16], [48, 16]], over: [[30, 30], [22, 12], [40, 18]], crash: [[30, 30], [26, 7], [35, 7]] };
  function mini(s, id) {
    const pts = (D.three(s) ? MINI3 : MINI)[id];
    const lanes = id === 'umb' ? 'M30 30L10 19M30 30L50 19M30 30L30 18' : id === 'over' ? 'M11 30L6 18L10 7L24 9' : 'M14 30L25 7M46 30L35 7';
    return `<svg class="mini" viewBox="0 0 60 38" aria-hidden="true"><line x1="0" y1="35" x2="60" y2="35" class="bl"/><line x1="0" y1="4" x2="60" y2="4" class="gl"/><rect x="27" y="1" width="6" height="3" class="net"/><path class="ln" d="${lanes}"/>${pts.map(([x, y]) => `<circle class="me" cx="${x}" cy="${y}" r="2.6"/>`).join('')}</svg>`;
  }

  // the bench card
  function spot() {
    const s = G.s;
    board();
    if (s.over) return finish();
    if (s.per === 'SO') return shootout();
    if (G.wpNow != null && s.per === 'REG' && G.wpNow < 0.008) return outOfReach(false);
    if (G.wpNow != null && G.wpNow > 0.995) return outOfReach(true);
    const o = D.options(s);
    const base = D.coachBase(s);
    const prev = G.pick || { setup: 'umb', d: 'safe' };
    G.pick = { line: base.line, setup: o.setups.includes(prev.setup) ? prev.setup : 'umb', d: prev.d, goalie: o.goalie[0], timeout: false };
    const sk = D.skaters(s);
    $('c-title').textContent = s.dec === 'FO' ? 'Your bench: the whistle' : 'Your bench: change on the fly?';
    $('c-situ').textContent = `${perLabel(s)} ${fmt(s.t)} · ${s.pulled ? `${sk.you} on ${sk.opp}, net empty` : s.pp > 0 ? 'power play' : s.pp < 0 ? 'penalty kill' : `${sk.you} on ${sk.opp}`}`;
    const [, title, detail] = D.lookInfo(s);
    $('c-look').textContent = fill(title);
    $('c-detail').textContent = fill(detail);
    const ol = G.roster.opp.lines[s.oon].map((p) => p.n).filter(Boolean).join(', ');
    const oe = s.olines[s.oon].e;
    $('c-oline').textContent = `${s.oon === s.late ? 'Their go-to line' : `Their line ${s.oon + 1}`}: ${ol}`;
    $('c-odet').textContent = s.oppStuck ? `Stuck out there after the icing: ${Math.round(s.oonSec)} seconds, legs at ${Math.round(oe * 100)}%.` : `${Math.round(s.oonSec)} seconds into their shift, legs at ${Math.round(oe * 100)}%.`;
    // lines
    $('c-lines').innerHTML = o.lines.map((i) => {
      const e = s.lines[i].e, f = G.roster.you.fo[i] || [0, 0];
      const col = e > 0.7 ? 'var(--good)' : e > 0.45 ? 'var(--ok)' : 'var(--bad)';
      return `<button type="button" class="opt" data-dim="line" data-v="${i}">${i === s.on ? `<span class="tagon">${s.dec === 'FO' ? 'on ice' : `out ${Math.round(s.onSec)}s`}</span>` : ''}
        <b>Line ${i + 1}</b><span class="names">${esc(lineNames(i))}</span>
        <span class="legs"><i style="width:${Math.round(e * 100)}%;background:${col}"></i></span>
        <span class="meta"><span>Legs ${Math.round(e * 100)}%</span><span>${f[1] ? `FO ${f[0]}/${f[1]}` : ''}</span></span></button>`;
    }).join('');
    $('c-setups').innerHTML = setupList(s).map(([id, label, hint]) => `<button type="button" class="opt" data-dim="setup" data-v="${id}">${mini(s, id)}<b>${esc(label)}</b><small>${esc(hint)}</small></button>`).join('');
    $('c-d').innerHTML = D.DMODES.map(([id, label, hint]) => `<button type="button" class="opt" data-dim="d" data-v="${id}"><b>${esc(label)}</b><small>${esc(hint)}</small></button>`).join('');
    $('g-goalie').hidden = o.goalie.length < 2;
    $('c-goalie').innerHTML = o.goalie.map((id) => `<button type="button" class="opt" data-dim="goalie" data-v="${id}"><b>${esc(goalieName(id))}</b>${id === 'pullF' ? '<small>More offense. Weaker if they get it out.</small>' : id === 'pullD' ? '<small>A shot from the point, more cover behind.</small>' : ''}</button>`).join('');
    $('g-to').hidden = o.timeout.length < 2;
    $('c-to').innerHTML = o.timeout.map((v) => `<button type="button" class="opt" data-dim="timeout" data-v="${v ? 1 : 0}"><b>${v ? 'Use it now' : 'Save it'}</b>${v ? '<small>Your whole bench gets its legs back.</small>' : ''}</button>`).join('');
    document.querySelectorAll('#call .opt').forEach((b) => b.onclick = () => pickOpt(b.dataset.dim, b.dataset.v));
    markPicks();
    $('c-go').textContent = s.dec === 'FO' ? 'Drop the puck' : 'Go';
    $('c-go').disabled = false;
    $('c-go').onclick = commit;
    const firstGame = !load().tipped;
    $('c-tip').hidden = !(firstGame && G.step < 2);
    $('c-tip').textContent = G.step === 0 ? 'Pick your line, setup, D and goalie, then drop the puck. Read what they are showing and who they have out.' : 'Watch the shift play out. Tap the ice to skip ahead.';
    if (firstGame && G.step >= 1) { const st0 = load(); st0.tipped = true; save(st0); }
    $('call').hidden = false;
    G.accepting = true;
  }
  function pickOpt(dim, v) {
    if (!G.accepting) return;
    G.pick[dim] = dim === 'line' ? +v : dim === 'timeout' ? v === '1' : v;
    markPicks();
    Sound.play('pass');
    // preview: show the line you picked on the ice
    if (dim === 'line') relabel(G.pick.line, G.s.oon, G.s.xa);
  }
  function markPicks() {
    document.querySelectorAll('#call .opt').forEach((b) => {
      const v = G.pick[b.dataset.dim];
      const on = b.dataset.dim === 'line' ? +b.dataset.v === v : b.dataset.dim === 'timeout' ? (b.dataset.v === '1') === v : b.dataset.v === v;
      b.setAttribute('aria-pressed', String(on));
    });
  }

  // a game that is gone (under 1%), or won (over 99.5%), plays itself out to the horn
  function outOfReach(won) {
    const s = G.s;
    G.accepting = false;
    $('call').hidden = true;
    const r = D.mulberry(D.hash(`${G.sc.id}:out:${G.step}`));
    const was = `${s.you}-${s.opp}, ${fmt(s.t)} left`;
    D.finish(s, r);
    if (!s.over) { const p = s.per === 'SO' ? s.soWin : 0.5; s.how = s.per === 'SO' ? 'SO' : 'OT'; s.over = true; s.won = r() < p; if (s.won) s.you++; else s.opp++; }
    feed(perLabel(s), won ? `<b>Game in hand</b>${esc(was)}: over 99.5% from here. Played out to the final horn.` : `<b>Out of reach</b>${esc(was)}: under 1% from here. Played out to the final horn.`);
    flash(won ? 'Game in hand' : 'Out of reach', won ? 'good' : 'info', 1500);
    Sound.play('whistle');
    board();
    later(finish, 1600);
  }

  async function commit() {
    if (!G || !G.accepting) return;
    G.accepting = false;
    $('c-go').disabled = true;
    const s = G.s;
    const c = { ...G.pick };
    const before = { t: s.t, per: perLabel(s), look: fill(D.lookInfo(s)[1]), call: describe(s, c), state: D.clone(s), choice: c };
    const grading = job('grade', s, c, G.step + 1 + G.day * 1000);
    const events = [];
    const rng = D.mulberry(D.hash(`${G.sc.id}:${G.practice ? 'p' : G.day}:${G.step}`));
    const say = (k, text, data) => events.push({ k, text: fill(text, data), data: data || {} });
    D.resolve(s, c, rng, say);
    // playoff overtime: each decision covers a longer stretch
    if (s.per === 'OT' && s.playoff && !s.over && before.state.per === 'OT') {
      const t0 = s.t, ot0 = s.otNum, auto = [];
      while (!s.over && s.per === 'OT' && s.otNum === ot0 && t0 - s.t < 150) D.resolve(s, D.coach(s, rng), rng, (k, text, data) => auto.push({ k, text: fill(text, data), data: data || {} }));
      const big = auto.filter((e) => ['against', 'eng', 'pp', 'pk', 'ot', 'stop'].includes(e.k) || (e.k === 'shot' && e.data.res !== 'wide'));
      events.push({ k: 'play', text: `The next ${t0 - s.t} seconds: ${big.length ? '' : 'back and forth, no one breaks through.'}`, data: {} });
      events.push(...big.slice(-4));
    }
    G.step++;
    const after = s.over || s.per === 'SO' ? Promise.resolve(s.over ? (s.won ? 1 : 0) : s.soWin) : job('wp', s, null, G.step + 7);
    $('call').hidden = true;
    $('result').hidden = true;
    $('rink-hint').hidden = !(G.step < 3);
    Sound.play('whistle');
    await run(before, s, events);
    $('rink-hint').hidden = true;
    const g = await grading;
    const wpAfter = await after;
    G.wpNow = wpAfter;
    afterPlay(before, g, events, wpAfter);
  }

  // ==================================================================================================
  // The shift, frame by frame
  // ==================================================================================================
  async function run(before, s, events) {
    A.busy = true; A.skipping = false;
    G.skip = () => {
      A.skipping = true;
      A.tw.forEach((t) => { setPos(t.id, t.to); t.res(); }); A.tw = [];
      A.sleeps.forEach((r) => r()); A.sleeps = [];
      clearTimers(); $('flash').hidden = true;
    };
    A.cam.follow = false;
    A.cycles = 0;
    $('rink-tag').hidden = true;   // the ticker says what is happening; the corner label is for between shifts
    try {
      // your line (and theirs) take their spots
      relabel(before.choice.line, before.state.oon, before.choice.goalie === 'pullD' ? 'D' : before.choice.goalie === 'pullF' ? 'F' : before.state.xa);
      for (const e of events) await animate(e);
    } catch (err) { /* an animation glitch must never stop the game */ }
    A.trailOn = false;
    hl(null); tick('');
    A.skipping = false;
    if (!s.over && s.per !== 'SO') { relabel(s.on, s.oon, s.xa); await stage(ctxOf(s), false); }
    $('rink-tag').textContent = tagFor(s);
    $('rink-tag').hidden = false;
    A.busy = false;
    G.skip = null;
    board();
  }

  const role = (text) => { const m = text.match(/\{(\w+)\}/); return m ? m[1] : null; };
  const roleOf = (e, mine) => {
    // events keep their tokens in data.raw; text is already filled, so look the name up on the ice
    const ids = mine ? YOU : OPP;
    for (const id of ids) { const el = $(`p-${id}`); const n = el && el.querySelector('.l').textContent; if (n && e.text.includes(n) && !el.classList.contains('off')) return id; }
    return mine ? 'C' : 'oC';
  };
  const nearestOf = (ids, p) => ids.filter((id) => !$(`p-${id}`).classList.contains('off')).sort((a, b) => dist(P(a), p) - dist(P(b), p))[0];
  const PASSES = { umb: [['D1', 'LW'], ['LW', 'D1'], ['D1', 'C'], ['C', 'D1'], ['D1', 'D2'], ['D2', 'D1']], over: [['LW', 'C'], ['C', 'LW'], ['LW', 'D1'], ['D1', 'LW'], ['C', 'RW']], crash: [['LW', 'D1'], ['D1', 'D2'], ['D2', 'RW'], ['LW', 'C']] };

  async function restage(d, ms = 450) {
    if (!d || !d.z) return;
    const ctx = { fo: false, z: d.z, poss: d.poss, setup: d.setup, look: d.look, pulled: d.pulled, xa: d.xa };
    const cur = A.ctx || {};
    if (cur.fo || cur.z !== ctx.z || cur.poss !== ctx.poss || cur.setup !== ctx.setup || cur.pulled !== ctx.pulled) {
      if (d.line != null) relabel(d.line, d.oline, d.xa);
      await stage(ctx, false, ms);
    }
  }

  async function animate(e) {
    const k = e.k, d = e.data;
    if (e.text && k !== 'cycle') tick(e.text);
    if (k === 'timeout') { Sound.play('whistle'); flash('Timeout', 'info', 1000); await sleep(1000); return; }
    if (k === 'pull') { flash('Net empty', 'info', 1100); show('X', true); setPos('X', [88, 108]); await Promise.all([tween('G', [88, 100], 900), tween('X', [45, Math.min(P('puck')[1] + 10, 150)], 900)]); show('G', false); return; }
    if (k === 'return') { show('G', true); await tween('G', [42.5, 187], 700); return; }
    if (k === 'change' || k === 'ochange') {
      const ids = k === 'change' ? YOU : OPP;
      await Promise.all(ids.map((id) => tween(id, [86, P(id)[1]], 420)));
      relabel(d.line, d.oline, d.xa);
      await sleep(120);
      await stage({ ...(A.ctx || ctxOf(G.s)) }, false, 520);
      return;
    }
    if (k === 'stuck') { flash('Their line is stuck', 'info', 1300); await sleep(1300); return; }
    if (k === 'fo') {
      const fz = d.zone || 'N';
      await stage({ fo: true, fz, pulled: d.pulled, xa: d.xa }, false, 500);
      const dot = P('puck');
      Sound.play('whistle'); await sleep(220);
      Sound.play('stick');
      await Promise.all([tween('C', [dot[0], dot[1] + 2.4], 110), tween('oC', [dot[0], dot[1] - 2.4], 110)]);
      const w = d.won ? P('C') : P('oC');
      await puckTo([w[0] + (d.won ? -3 : 3), w[1] + (d.won ? 7 : -7)], 240, { trail: true });
      await restage(d, 520);
      return;
    }
    if (k === 'cycle') {
      A.cycles = (A.cycles || 0) + 1;
      if (A.cycles > 2) return;
      await restage(d);
      const lanes = PASSES[d.setup] || PASSES.umb;
      const [a, b] = lanes[Math.floor(Math.random() * lanes.length)];
      if ($(`p-${b}`).classList.contains('off')) return;
      Sound.play('pass');
      await puckTo([P(b)[0] + 1.4, P(b)[1] - 1.4], 300, { trail: true });
      await Promise.all(YOU.filter((id) => id !== b).map((id) => tween(id, [P(id)[0] + (Math.random() - 0.5) * 4, P(id)[1] + (Math.random() - 0.5) * 3], 300)));
      void a;
      return;
    }
    if (k === 'shot') {
      await restage({ ...d, z: 'O', poss: 'you' });
      const id = roleOf(e, true); const sp = P(id);
      A.cam.follow = true;
      if (dist(P('puck'), sp) > 3) { Sound.play('pass'); await puckTo([sp[0] + 1.4, sp[1] - 1.4], 260, { trail: true }); }
      hl(id);
      await tween(id, [sp[0], sp[1] + 1.2], 120);
      Sound.play('stick');
      const res = d.res;
      const tgt = res === 'goal' ? [42.5 + (Math.random() - 0.5) * 4, 8.7] : res === 'save' ? [42.5 + (Math.random() - 0.5) * 3, 12.4] : res === 'block' ? lerp(sp, [42.5, 11], 0.35) : [sp[0] < 42.5 ? 47.4 : 37.6, 4.2];
      const moves = [puckTo(tgt, res === 'block' ? 150 : 200, { trail: true, ease: linear })];
      if (res === 'save') moves.push(tween('oG', [tgt[0], 13], 160));
      if (res === 'goal') moves.push(tween('oG', [42.5 + (tgt[0] < 42.5 ? 2.5 : -2.5), 13.4], 190));
      if (res === 'block') { const b = nearestOf(OPP, tgt); if (b) moves.push(tween(b, [tgt[0] + 1, tgt[1] - 1.5], 150)); }
      await Promise.all(moves);
      if (res === 'goal') { lamp('opp'); Sound.play('horn'); flash('Goal!', 'good', 1700); await sleep(1700); }
      else if (res === 'save') { Sound.play('save'); await sleep(320); await tween('oG', [42.5, 13], 200); }
      else if (res === 'block') { Sound.play('board'); await sleep(260); }
      else { Sound.play(Math.random() < 0.3 ? 'post' : 'board'); await puckTo([tgt[0] < 42.5 ? 8 : 77, 12], 300); }
      hl(null); A.cam.follow = false;
      return;
    }
    if (k === 'freeze') { Sound.play('whistle'); await sleep(500); return; }
    if (k === 'against' || k === 'stop') {
      await restage({ ...d, z: 'D', poss: 'them' });
      const id = roleOf(e, false); const sp = P(id);
      A.cam.follow = true;
      if (dist(P('puck'), sp) > 3) await puckTo([sp[0] - 1.4, sp[1] + 1.4], 260, { trail: true });
      hl(id);
      Sound.play('stick');
      const tgt = k === 'against' ? [42.5 + (Math.random() - 0.5) * 4, 191.3] : [42.5 + (Math.random() - 0.5) * 3, 187.6];
      await Promise.all([puckTo(tgt, 210, { trail: true, ease: linear }), k === 'stop' && !$('p-G').classList.contains('off') ? tween('G', [tgt[0], 187], 160) : null]);
      if (k === 'against') { lamp('you'); Sound.play('thud'); flash('Goal against', 'bad', 1600); await sleep(1600); }
      else { Sound.play('save'); await sleep(500); await tween('G', [42.5, 187], 200); }
      hl(null); A.cam.follow = false;
      return;
    }
    if (k === 'eng') {
      Sound.play('stick'); A.cam.follow = true;
      const from = P('puck');
      await puckTo([42.5, 191.3], Math.max(700, (191 - from[1]) * 8), { trail: true, ease: linear });
      lamp('you'); Sound.play('thud'); flash('Empty net', 'bad', 1700); await sleep(1700);
      A.cam.follow = false;
      return;
    }
    if (k === 'icing') {
      Sound.play('stick'); A.cam.follow = true;
      await puckTo([26, 197], 900, { trail: true, ease: linear });
      Sound.play('whistle'); flash('Icing', 'info', 1100); await sleep(1100);
      A.cam.follow = false;
      return;
    }
    if (k === 'keep') { const who = d.z === 'O' ? 'D2' : 'D1'; await restage(d); await Promise.all([tween(who, [P(who)[0], 70], 300), puckTo([P(who)[0] + 1.4, 68.6], 300, { trail: true })]); Sound.play('stick'); hl(who); await sleep(220); hl(null); return; }
    if (k === 'turn' || k === 'chip' || k === 'badchange') {
      const them = nearestOf(OPP, P('puck'));
      if (them) { await tween(them, [P('puck')[0] - 1.4, P('puck')[1] - 1.4], 300); Sound.play('stick'); await puckTo([P(them)[0] - 1.4, P(them)[1] + 1.4], 160); }
      await sleep(250);
      await restage(d);
      return;
    }
    if (k === 'clear') { Sound.play('stick'); A.cam.follow = true; await puckTo([44 + (Math.random() - 0.5) * 20, 118], 700, { trail: true, ease: linear }); Sound.play('board'); A.cam.follow = false; await restage(d); return; }
    if (k === 'rush') {
      await restage({ ...d, z: 'N', poss: 'them' }, 300);
      A.cam.follow = true;
      const car = 'oC';
      await Promise.all([carry(car, [40, 160], 800, { ease: linear }), tween('oLW', [24, 158], 800), tween('D1', [38, 172], 800), tween('D2', [50, 176], 800)]);
      A.cam.follow = false;
      return;
    }
    if (k === 'entry') {
      if (d.ok) {
        await restage({ ...d, z: 'N', poss: 'you' }, 300);
        A.cam.follow = true;
        await Promise.all([carry('C', [36, 64], 700, { ease: linear }), tween('LW', [16, 60], 700), tween('RW', [66, 62], 700), tween('D1', [30, 86], 750), tween('D2', [56, 90], 750)]);
        A.cam.follow = false;
        await restage(d, 500);
      } else { const t = P('puck'); await tween('oD1', [t[0] + 1.5, t[1] - 1.5], 380); Sound.play('stick'); await sleep(200); await restage(d); }
      return;
    }
    if (k === 'take') { const me = nearestOf(YOU, P('puck')); await tween(me, [P('puck')[0] + 1.4, P('puck')[1] + 1.4], 320); Sound.play('board'); hl(me); await sleep(220); hl(null); await restage(d); return; }
    if (k === 'dumpin') { Sound.play('stick'); A.cam.follow = true; await puckTo([12, 194], 800, { ctrl: [10, 150] }); Sound.play('board'); A.cam.follow = false; await restage(d); return; }
    if (k === 'zone') { await restage({ ...d, z: 'N', poss: 'them' }, 300); A.cam.follow = true; await carry('oD1', [20, 150], 700); A.cam.follow = false; await restage(d); return; }
    if (k === 'breakout') { await restage({ ...d, z: 'D', poss: 'you' }, 300); Sound.play('pass'); await puckTo([P('LW')[0] + 1.4, P('LW')[1] - 1.4], 300, { trail: true }); A.cam.follow = true; await carry('LW', [20, 112], 600); A.cam.follow = false; await restage(d); return; }
    if (k === 'pp' || k === 'pk') { Sound.play('whistle'); flash(k === 'pp' ? 'Power play' : 'Penalty kill', 'info', 1300); await sleep(1300); return; }
    if (k === 'ot' || k === 'so' || k === 'end') { Sound.play('whistle'); flash(k === 'ot' ? 'Overtime' : k === 'so' ? 'Shootout' : 'Final', 'info', 1400); await sleep(1400); return; }
    await sleep(e.text ? 650 : 0);
  }

  // what the shift looked like, in a few words
  function headline(events) {
    const has = (k, f = () => true) => events.find((e) => e.k === k && f(e));
    if (has('shot', (e) => e.data.res === 'goal')) return 'Goal!';
    if (has('eng')) return 'Empty-net goal against';
    if (has('against')) return 'Goal against';
    if (has('icing') && has('stuck') == null) return 'Iced: their line is stuck';
    if (has('pp')) return 'Power play';
    if (has('pk')) return 'Penalty kill';
    const shots = events.filter((e) => e.k === 'shot').length;
    const saves = events.filter((e) => e.k === 'shot' && e.data.res === 'save').length;
    const zone = events.filter((e) => (e.k === 'cycle' || e.k === 'keep' || e.k === 'shot')).length;
    if (shots >= 2) return `${shots} shots, ${saves ? `${saves} save${saves > 1 ? 's' : ''}` : 'none through'}`;
    if (shots === 1) return saves ? 'One shot, saved' : 'One shot, no damage';
    if (has('stop')) return `Big save, ${G.names.G}`;
    if (zone >= 3) return 'Pinned them in';
    if (has('icing')) return 'Icing';
    if (has('clear') || has('turn')) return 'They got it out';
    return 'Back and forth';
  }

  function afterPlay(before, g, events, wpAfter) {
    const s = G.s;
    const loss = Math.max(0, g.bestWp - g.mine);
    const v = D.verdict(loss, g.bestWp);
    const d = g.mine - g.typ;
    if (v.k !== 'none') { G.sumD += d; G.sumV += g.typV; }
    G.calls.push({ t: before.t, per: before.per, look: before.look, call: before.call, best: describe(before.state, g.best), loss, v: v.k, d, choice: before.choice });
    $('r-big').textContent = headline(events);
    $('r-line').textContent = events.filter((e) => e.text && !['timeout', 'return', 'cycle', 'change', 'ochange'].includes(e.k)).slice(-2).map((e) => e.text).join(' ');
    $('r-wp').textContent = `Win chance ${(g.typ * 100).toFixed(1)}% → ${(wpAfter * 100).toFixed(1)}%`;
    const ptsEl = $('r-pts');
    ptsEl.className = `pts num ${v.k === 'best' || v.k === 'good' ? 'good' : v.k}`;
    ptsEl.textContent = v.k === 'none' ? '–' : pts(d);
    ptsEl.title = 'Win chance compared with a typical NHL bench in the same spot';
    // a verdict per decision
    const st = before.state, c = before.choice;
    const label = { line: (x) => `Line ${x + 1} (${lineNames(x).split(', ')[0]})`, setup: (x) => setupName(st, x), d: (x) => dName(x), goalie: (x) => goalieName(x), timeout: (x) => (x ? 'Use the timeout' : 'Save the timeout') };
    const title = { line: 'Line', setup: 'Setup', d: 'Your D', goalie: 'Goalie', timeout: 'Timeout' };
    const rows = Object.entries(g.perDim).map(([dim, r]) => {
      const gain = r.gain * Math.min(3, Math.max(1, 0.15 / Math.max(g.bestWp, 0.01)));
      const cls = gain <= 0.006 ? 'good' : gain <= 0.02 ? 'ok' : 'bad';
      const txt = r.best === c[dim] || gain <= 0.006 ? `${title[dim]}: <b>${esc(label[dim](c[dim]))}</b>, the right call.` : `${title[dim]}: ${esc(label[dim](r.best))} was better (+${(r.gain * 100).toFixed(1)}).`;
      return `<li class="${cls}"><span>${txt}</span></li>`;
    });
    $('r-verdict').innerHTML = v.k === 'none' ? '<p class="verdict none"><span>The game was out of reach. Not graded.</span></p>' : `<ul class="verdicts">${rows.join('')}</ul>`;
    $('result').hidden = false;
    feed(`${before.per === '3RD' ? '' : before.per + ' '}${fmt(before.t)}`, `<b>${esc(before.call)}</b>${esc(before.look)}. ${esc(events.map((e) => e.text).filter(Boolean).join(' '))}`,
      `<span class="d ${v.k === 'best' || v.k === 'good' ? 'good' : v.k}">${v.k === 'none' ? '–' : pts(d)}</span>`);
    if (s.over) return later(finish, 700);
    if (s.per === 'SO') return later(spot, 400);
    spot();
    const r = $('result').getBoundingClientRect();
    if (r.top < 0 || r.top > window.innerHeight * 0.6) $('result').scrollIntoView({ block: 'start', behavior: 'smooth' });
  }


  // ==================================================================================================
  // Shootout: pick a shooter, then pick your spot on the net
  // ==================================================================================================
  const SPOTS = { glove: [45.4, 8.4], blocker: [39.6, 10.3], five: [42.5, 10.4], deke: [36.8, 13.5] };   // where the puck goes
  const AIM = { glove: [52, 9], blocker: [33, 12], five: [42.5, 20], deke: [30, 22] };                    // where you tap
  const AIMLBL = { glove: 'Glove high', blocker: 'Blocker low', five: 'Five-hole', deke: 'Deke' };
  function shootout() {
    const { sc } = G;
    if (!G.so) {
      const so = D.shootout(sc);
      G.so = { so, st: { round: 0, you: 0, opp: 0, used: [] }, shots: { you: [], opp: [] }, youFirst: so.youFirst };
      feed('SO', `<b>Shootout</b>${esc(sc.you.home ? `${sc.you.name} (home) shoot first.` : `${sc.opp.name} (home) shoot first.`)}`);
    }
    $('call').hidden = true; $('so').hidden = false; $('result').hidden = true;
    clearTargets();
    for (const id of ENT) show(id, id === 'oG' || id === 'G' || id === 'C' || id === 'oC');
    $('rink-tag').textContent = 'Shootout';
    soRound();
  }
  function soDecided() {
    const { shots } = G.so;
    const y = shots.you.filter(Boolean).length, o = shots.opp.filter(Boolean).length, ny = shots.you.length, no = shots.opp.length;
    if (ny <= 3 && no <= 3) {
      if (y > o + (3 - no)) return 'you';
      if (o > y + (3 - ny)) return 'opp';
      if (ny === 3 && no === 3 && y !== o) return y > o ? 'you' : 'opp';
      return null;
    }
    if (ny === no && y !== o) return y > o ? 'you' : 'opp';
    return null;
  }
  function soScore() {
    const g = G.so;
    const row = (ab, cls, shots) => `<div class="so-row"><span class="tchip ${cls}">${esc(ab)}</span>${shots.map((x) => `<i class="${x ? 'g' : 'm'}"></i>`).join('')}${'<i></i>'.repeat(Math.max(0, 3 - shots.length))}</div>`;
    $('so-score').innerHTML = row(G.sc.you.ab, 'you-chip', g.shots.you) + row(G.sc.opp.ab, 'opp-chip', g.shots.opp);
  }
  async function oppShot() {
    const g = G.so, r = g.shots.opp.length;
    const sh = g.so.theirs[r % g.so.theirs.length];
    const goal = D.mulberry(D.hash(`${G.sc.id}:so-opp:${r}`))() < sh.p;
    g.shots.opp.push(goal);
    A.busy = true;
    const el = $('p-oC'); el.querySelector('.n').textContent = sh.num ?? ''; el.querySelector('.l').textContent = last(sh.n) || sh.n;
    show('oC', true); show('C', false);
    setPos('oC', [42.5, 100]); setPos('puck', [41, 101.6]); setPos('G', [42.5, 187]);
    camTo(178, 2.4, 42.5, true);
    tick(`${sh.n} skates in on ${G.names.G}…`);
    Sound.play('whistle');
    A.cam.follow = false;
    await carry('oC', [44, 172], 1300, { ease: linear });
    await carry('oC', [39, 180], 350);
    Sound.play('stick');
    const tgt = goal ? [42.5 + (Math.random() < 0.5 ? -2.4 : 2.4), 190.6] : [42.5, 187.4];
    await Promise.all([puckTo(tgt, 200, { trail: true, ease: linear }), tween('G', [goal ? 46 : 41.5, 187], 180)]);
    if (goal) { lamp('you'); Sound.play('thud'); flash('Scores', 'bad', 1100); } else { Sound.play('save'); flash('Save!', 'good', 1100); }
    tick(goal ? `${sh.n} scores.` : `${G.names.G} stops ${last(sh.n) || sh.n}.`);
    feed('SO', `<b>${esc(G.sc.opp.ab)}: ${esc(sh.n)}</b>${goal ? 'Scores.' : 'Stopped.'}`);
    await new Promise((res) => later(res, 1300));
    tick(''); A.busy = false;
    soScore();
  }
  async function soRound() {
    const g = G.so;
    soScore();
    const done = soDecided();
    if (done) return soEnd(done);
    const theirTurn = g.youFirst ? g.shots.opp.length < g.shots.you.length : g.shots.opp.length <= g.shots.you.length;
    if (theirTurn) { $('so-shooters').innerHTML = ''; $('so-moves').hidden = true; $('so-step').textContent = 'Their shooter'; await oppShot(); return soRound(); }
    const st = { round: g.shots.you.length, you: g.shots.you.filter(Boolean).length, opp: g.shots.opp.filter(Boolean).length, used: g.st.used };
    g.st = st;
    const so = g.so, goalie = G.sc.roster.oppG;
    const order = so.gm.map((v, m) => [v, m]).sort((a, b) => b[0] - a[0]);
    const sv = goalie && goalie.s ? `${((goalie.sv / goalie.s) * 100).toFixed(1)}% career shootout save rate (${goalie.sv} of ${goalie.s})` : 'Little shootout history';
    $('so-scout').innerHTML = `<span class="read-k">In net: ${esc(goalie?.n || 'their goalie')}</span><b>Beaten most: ${esc(D.MOVES[order[0][1]][1].toLowerCase())}</b><span>${esc(sv)}. Hardest to beat: ${esc(D.MOVES[order[3][1]][1].toLowerCase())}.</span>`;
    $('so-sub').textContent = st.round < 3 ? `Round ${st.round + 1} of 3` : `Sudden death, round ${st.round + 1}`;
    $('so-step').textContent = 'Pick your shooter';
    $('so-moves').hidden = true;
    show('oC', false); show('C', false); setPos('oG', [42.5, 13]);
    camTo(56, 1, 42.5, false);
    $('so-shooters').innerHTML = so.shooters.map((p, i) => {
      const used = st.used.includes(i);
      const pct = p.s ? `${p.g} for ${p.s} career (${Math.round((100 * p.g) / p.s)}%)` : 'No shootout history';
      return `<button type="button" class="shooter" data-i="${i}" ${used ? 'disabled' : ''} aria-pressed="false"><b>${p.num ? `#${p.num} ` : ''}${esc(p.n)}</b><span>${pct}</span><em>Favorite: ${esc(D.MOVES[p.sig][1].toLowerCase())}</em></button>`;
    }).join('');
    $('so-shooters').querySelectorAll('.shooter').forEach((b) => b.onclick = () => soPick(+b.dataset.i, b));
  }
  function soPick(i, btn) {
    const so = G.so.so, p = so.shooters[i];
    // collapse the list to the shooter you picked and bring the net into view
    $('so-shooters').querySelectorAll('.shooter').forEach((x) => { x.setAttribute('aria-pressed', 'false'); x.hidden = x !== btn; });
    btn.setAttribute('aria-pressed', 'true');
    btn.onclick = () => { $('so-shooters').querySelectorAll('.shooter').forEach((x) => { x.hidden = false; }); $('so-step').textContent = 'Pick your shooter'; $('so-moves').hidden = true; clearTargets(); A.onPick = null; show('C', false); camTo(56, 1, 42.5, false); $('so-shooters').querySelectorAll('.shooter').forEach((x) => { x.onclick = () => soPick(+x.dataset.i, x); }); };
    later(() => $('rink-box').scrollIntoView({ block: 'start', behavior: 'smooth' }), 30);
    const el = $('p-C'); el.querySelector('.n').textContent = p.num ?? ''; el.querySelector('.l').textContent = last(p.n) || p.n;
    show('C', true); setPos('C', [42.5, 44]); setPos('puck', [44.1, 42.4]);
    camTo(26, 2, 42.5, false);
    $('so-step').textContent = 'Now pick your spot: tap the net (tap the shooter to change him)';
    const mv = $('so-moves'); mv.hidden = false; mv.className = 'keys n4'; mv.style.setProperty('--n', 4);
    mv.innerHTML = D.MOVES.map(([, label], m) => `<button type="button" class="key" data-m="${m}"><span class="kn">${m + 1}</span><b>${esc(label)}</b></button>`).join('');
    mv.querySelectorAll('.key').forEach((k) => { k.onclick = () => soShoot(i, +k.dataset.m); k.onpointerenter = () => hotTarget(String(k.dataset.m)); k.onpointerleave = () => hotTarget(null); });
    drawTargets(D.MOVES.map(([id], m) => ({ play: String(m), at: AIM[id], label: AIMLBL[id], n: m + 1 })), null, 2);
    A.onPick = (m) => soShoot(i, +m);
  }
  async function soShoot(i, m) {
    const g = G.so, so = g.so;
    A.onPick = null; clearTargets();
    $('so-moves').querySelectorAll('.key').forEach((k) => { k.disabled = true; });
    $('so-shooters').querySelectorAll('.shooter').forEach((k) => { k.disabled = true; });
    const graded = D.soGrade(so, g.st);
    const mine = graded.find((x) => x.i === i && x.m === m), best = graded[0];
    // a typical bench: one of its three best shooters by reputation, any move
    const top = so.shooters.map((sh, j) => [sh, j]).filter(([, j]) => !g.st.used.includes(j)).sort((a, b) => b[0].base - a[0].base).slice(0, 3).map(([, j]) => j);
    const pool = graded.filter((x) => top.includes(x.i));
    const typ = pool.reduce((a, x) => a + x.wp, 0) / pool.length;
    const tv = pool.reduce((a, x) => a + (x.wp - typ) ** 2, 0) / pool.length;
    const v = D.verdict(best.wp - mine.wp, best.wp);
    const d = mine.wp - typ;
    G.sumD += d; G.sumV += tv;
    G.calls.push({ t: 0, per: 'SO', situ: 'Shootout', look: 'Shootout', call: `${so.shooters[i].n}, ${D.MOVES[m][1].toLowerCase()}`, best: `${so.shooters[best.i].n}, ${D.MOVES[best.m][1].toLowerCase()}`, wp: best.wp, mine: mine.wp, loss: best.wp - mine.wp, v: v.k, d });
    const goal = D.mulberry(D.hash(`${G.sc.id}:so-you:${g.shots.you.length}`))() < mine.p;
    g.shots.you.push(goal);
    g.st.used = g.st.used.length + 1 >= so.shooters.length ? [] : [...g.st.used, i];
    const sh = so.shooters[i], mvId = D.MOVES[m][0];
    A.busy = true;
    tick(`${sh.n} skates in on ${G.names.oG}…`);
    Sound.play('whistle');
    await carry('C', [41, 24], 1100, { ease: linear });
    if (mvId === 'deke') { await carry('C', [36.5, 17], 260); }
    else await carry('C', [42.5 + (mvId === 'glove' ? -1.5 : 1.5), 19], 220);
    Sound.play(mvId === 'deke' ? 'pass' : 'stick');
    const spot = SPOTS[mvId];
    const tgt = goal ? [spot[0], Math.min(spot[1], 9.4)] : [spot[0], 12.6];
    const goalieTo = goal ? [mvId === 'deke' ? 45 : mvId === 'glove' ? 40.5 : 44.5, 13] : [spot[0], 13];
    await Promise.all([puckTo(tgt, mvId === 'deke' ? 260 : 190, { trail: true, ease: linear }), tween('oG', goalieTo, mvId === 'deke' ? 240 : 170)]);
    if (goal) { lamp('opp'); Sound.play('horn'); flash('Scores!', 'good', 1300); } else { Sound.play('save'); flash('Saved', 'bad', 1300); }
    tick(goal ? `${sh.n} scores, ${D.MOVES[m][1].toLowerCase()}.` : `${G.names.oG} stops ${sh.n}.`);
    $('r-big').textContent = goal ? 'Scores!' : 'Saved';
    $('r-line').textContent = `${sh.n}: ${D.MOVES[m][1].toLowerCase()}.`;
    $('r-wp').textContent = `Chance on that shooter and move: ${Math.round(mine.p * 100)}%`;
    const ptsEl = $('r-pts'); ptsEl.className = `pts num ${v.k === 'best' || v.k === 'good' ? 'good' : v.k}`; ptsEl.textContent = pts(d);
    const vt = $('r-verdict'); vt.className = `verdict ${v.k}`;
    vt.innerHTML = v.k === 'best' || v.k === 'good' ? '<span>Your pick: <b>the best one.</b></span>' : `<span>Your pick: <b>${v.k === 'bad' ? 'costly' : 'decent'}.</b> ${esc(so.shooters[best.i].n)}, ${esc(D.MOVES[best.m][1].toLowerCase())} was the pick.</span>`;
    $('result').hidden = false;
    feed('SO', `<b>${esc(sh.n)}: ${esc(D.MOVES[m][1].toLowerCase())}</b>${goal ? 'Scores.' : 'Stopped.'}`, `<span class="d ${v.k === 'best' || v.k === 'good' ? 'good' : v.k}">${pts(d)}</span>`);
    await new Promise((res) => later(res, 1500));
    tick(''); A.busy = false; setPos('oG', [42.5, 13]);
    soRound();
  }
  function soEnd(who) {
    const s = G.s;
    if (who === 'you') s.you += 1; else s.opp += 1;
    s.over = true; s.won = who === 'you'; s.how = 'SO';
    board();
    finish();
  }

  // ==================================================================================================
  // The end
  // ==================================================================================================
  function realStory(sc) {
    const r = sc.real;
    const bits = [r.pulledAt != null ? `pulled the goalie with ${fmt(r.pulledAt)} left` : 'never pulled the goalie'];
    let you = sc.start.you, opp = sc.start.opp;
    for (const g of r.goals) {
      if (g.mine) { you++; bits.push(`${you === opp ? 'tied it' : 'scored'} on ${g.by}'s goal${g.per > 3 ? ' in overtime' : ` with ${fmt(g.t)} left`}`); }
      else { opp++; bits.push(g.empty ? `gave up an empty-netter to ${g.by}` : `gave up a goal to ${g.by}${g.per > 3 ? ' in overtime' : ''}`); }
    }
    const how = r.ended === 'SO' ? ' in a shootout' : r.ended === 'OT' ? (r.otNum > 1 ? ` in ${r.otNum}OT` : ' in overtime') : '';
    return `The real ${sc.you.name} bench ${bits.join(', ')}, and lost ${r.final.you}-${r.final.opp}${how}.`;
  }
  function style(score) {
    const calls = G.calls.map((c) => c.call.toLowerCase());
    const bold = calls.filter((c) => /seam|stretch|one-timer|carry|forecheck|pressure|net-front|attack|go/.test(c)).length;
    const safe = calls.filter((c) => /dump|collapse|trap|glass|regroup|back to the point|shoot|peel|circle back|stay above/.test(c)).length;
    const pull = G.s.pulls[0];
    if (score >= 85) return 'Bench genius';
    if (pull != null && pull >= 180) return 'The spreadsheet';
    if (bold > safe * 1.6) return 'Riverboat gambler';
    if (safe > bold * 1.6) return 'Old-time hockey';
    return 'Steady hand';
  }
  function finish() {
    const { s } = G;
    clearTimers();
    clearTargets(); A.onPick = null;
    $('call').hidden = true; $('so').hidden = true;
    const graded = G.calls.filter((c) => c.v !== 'none').length;
    const z = G.sumD / Math.sqrt(G.sumV + Math.max(1, graded) * 0.005 ** 2);
    const score = Math.max(1, Math.min(99, Math.round(100 * D.phi(z))));
    const how = s.how === 'SO' ? ' in a shootout' : s.how === 'OT' ? (s.playoff && s.otNum > 1 ? ` in ${s.otNum}OT` : ' in overtime') : '';
    const final = `${s.you}-${s.opp}${how}`;
    const st = load();
    if (!G.practice && !st.days[G.day]) { st.days[G.day] = { score, won: s.won, final, squares: G.calls.map((c) => c.v).join(',') }; save(st); }
    if (s.won) { Sound.play('horn'); }
    later(() => showEnd(score, final), 800);
  }
  function showEnd(score, final) {
    const { s, sc } = G;
    hideAll();
    $('end').hidden = false;
    $('pbp').open = false;
    $('end').appendChild($('pbp'));
    $('end-tag').textContent = `${G.practice ? 'Practice' : `No. ${G.day}`} · ${sc.you.name} vs ${sc.opp.name}`;
    $('end-score').textContent = score;
    $('end-cap').textContent = `Better than ${score}% of NHL benches from the same spots`;
    $('end-result').textContent = s.won ? `You won ${final}` : `You lost ${final}`;
    const st = load();
    let streak = 0; for (let d = DAY; d >= 1 && st.days[d]; d--) streak++;
    const ms = new Date(today.getTime() + 864e5) - Date.now();
    const hh = String(Math.floor(ms / 36e5)).padStart(2, '0'), mm = String(Math.floor((ms % 36e5) / 6e4)).padStart(2, '0');
    $('end-streak').textContent = G.practice ? 'Practice game. Your streak is untouched.' : G.day !== DAY ? `From the archive. Today's game is No. ${DAY}.` : `🔥 Day ${Math.max(streak, 1)} of your streak · next game in ${hh}:${mm}`;
    const forcedOT = s.how === 'OT' || s.how === 'SO';
    $('end-vs').textContent = s.won ? 'You beat them' : forcedOT ? 'Got further' : G.sumD > 0 ? 'Better calls' : 'Same result';
    $('end-style').textContent = style(score);
    $('end-squares').innerHTML = G.calls.map((c) => `<i class="${c.v}" title="${esc(c.call)}"></i>`).join('');
    const worst = G.calls.filter((c) => c.v === 'bad' || c.v === 'ok').sort((a, b) => b.loss - a.loss)[0];
    $('end-cost').textContent = worst
      ? `What cost the most: ${worst.per === 'SO' ? 'the shootout' : `${fmt(worst.t)} ${worst.per === '3RD' ? 'in the third' : worst.per}`}, against "${worst.look}". You called ${worst.call}; ${worst.best} was the call, ${(worst.loss * 100).toFixed(1)} points of win chance better.`
      : 'No costly calls. A clean game from the bench.';
    $('end-real').textContent = realStory(sc);
    const sq = { best: '🟩', good: '🟩', ok: '🟨', bad: '🟥', none: '⬜' };
    const text = `Empty Net ${G.practice ? '(practice)' : `No. ${G.day}`} 🥅 ${score}/100\n${sc.label.split(' · ')[0]} · ${sc.you.ab} vs ${sc.opp.ab}, ${dateStr(sc.date)}\n${G.calls.map((c) => sq[c.v]).join('')}\n${s.won ? 'Won' : 'Lost'} ${final} · the real bench lost ${sc.real.final.you}-${sc.real.final.opp}`;
    $('share-text').textContent = text;
    $('share-text').hidden = true;
    $('btn-share').textContent = 'Share your score';
    $('btn-share').onclick = () => {
      const ok = () => { $('btn-share').textContent = 'Copied'; };
      try { navigator.clipboard.writeText(text).then(ok, () => { $('share-text').hidden = false; }); } catch { $('share-text').hidden = false; }
    };
    $('btn-review').onclick = () => { $('pbp').open = true; $('pbp').scrollIntoView({ behavior: 'smooth' }); };
    $('btn-practice').onclick = () => { const pool = DATA.games; showIntro(DAY, pool[Math.floor(Math.random() * pool.length)]); };
    stats();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }
  function stats() {
    const days = Object.values(load().days);
    const avg = days.length ? Math.round(days.reduce((a, d) => a + d.score, 0) / days.length) : 0;
    let streak = 0; const st = load(); for (let d = DAY; d >= 1 && st.days[d]; d--) streak++;
    $('stats').innerHTML = [[days.length, 'Played'], [avg, 'Avg score'], [days.filter((d) => d.won).length, 'Comebacks'], [streak, 'Streak']]
      .map(([v, l]) => `<div><b>${v}</b><span>${l}</span></div>`).join('');
  }

  // ---------- panels, keys ----------
  function openArchive() {
    clearTimers();
    const st = load();
    const rows = [];
    for (let d = DAY; d >= 1; d--) {
      const sc = gameForDay(d), rec = st.days[d];
      rows.push(`<li><button type="button" data-d="${d}"><span class="n">${d}</span><span class="lbl"><b>${esc(sc.you.ab)} vs ${esc(sc.opp.ab)} · ${dateStr(sc.date)}</b><span>${esc(sc.label)}</span></span><span class="res">${rec ? rec.score : ''}</span></button></li>`);
    }
    rows.unshift(`<li><button type="button" data-d="practice"><span class="n">🎲</span><span class="lbl"><b>A random big game</b><span>Practice: any of ${DATA.games.length} real endings</span></span><span class="res"></span></button></li>`);
    $('arch-list').innerHTML = rows.join('');
    $('arch-list').querySelectorAll('button').forEach((b) => b.onclick = () => b.dataset.d === 'practice' ? showIntro(DAY, DATA.games[Math.floor(Math.random() * DATA.games.length)]) : showIntro(+b.dataset.d));
    hideAll();
    $('archive').hidden = false;
  }
  let back = null;
  $('btn-how').onclick = () => { if (!$('how').hidden) return; back = ['intro', 'game', 'end', 'archive'].filter((id) => !$(id).hidden); hideAll(); $('how').hidden = false; };
  $('btn-archive').onclick = openArchive;
  document.querySelectorAll('[data-close]').forEach((b) => b.onclick = () => {
    $(b.dataset.close).hidden = true;
    if (b.dataset.close === 'how' && back && back.length) { back.forEach((id) => { $(id).hidden = false; }); back = null; }
    else if (G && !G.s.over) $('game').hidden = false;
    else if (G && G.s.over) $('end').hidden = false;
    else showIntro(DAY);
  });
  document.addEventListener('keydown', (e) => {
    if (e.target.closest && e.target.closest('input, textarea')) return;
    if (!G || $('game').hidden) return;
    if ((e.key === ' ' || e.key === 'Enter') && A.busy && G.skip) { e.preventDefault(); G.skip(); return; }
    if (!$('so').hidden) {
      const keys = [...$('so-moves').querySelectorAll('.key')];
      const n = Number(e.key);
      if (n >= 1 && n <= keys.length && !keys[n - 1].disabled && !$('so-moves').hidden) { e.preventDefault(); keys[n - 1].click(); }
      return;
    }
    if (!G.accepting) return;
    const n = Number(e.key);
    if (n >= 1 && n <= 3) { e.preventDefault(); pickOpt('line', String(n - 1)); }
    else if (e.key === 'Enter') { e.preventDefault(); commit(); }
  });

  window.EmptyNet = { state: () => G, refresh: () => { relabel(G.s.on, G.s.oon, G.s.xa); stage(ctxOf(G.s), true); spot(); } };   // for testing from the console
  $('foot-built').textContent = `${DATA.games.length} real endings · updated ${new Date(DATA.built).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`;
  showIntro(DAY);
})();
