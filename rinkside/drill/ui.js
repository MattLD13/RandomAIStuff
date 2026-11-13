// Empty Net: the page. Reads window.DRILL_DATA (real endings + daily schedule) and window.Drill (the model).
// Every call is a target on the ice: tap it, drag the puck to it, tap a key, or press 1-4. The play then runs
// on the rink frame by frame (players skate, the puck carries, passes and shots fly, the goalie slides).
(function () {
  const D = window.Drill, DATA = window.DRILL_DATA;
  const $ = (id) => document.getElementById(id);
  const games = new Map(DATA.games.map((g) => [g.id, g]));
  const STORE = 'emptynet:v2';
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
  let worker = null, jobId = 0, syncN = 1500;
  const jobs = new Map();
  const syncGrade = (snap, seed) => {
    const t = performance.now();
    const g = D.grade(snap, syncN, seed);
    const ms = performance.now() - t;
    if (ms > 350 && syncN > 600) syncN = Math.max(600, Math.round(syncN * 350 / ms));   // keep a slow phone responsive
    return g;
  };
  const dropWorker = () => {
    worker = null;
    for (const [id, j] of jobs) { jobs.delete(id); j.res(syncGrade(j.snap, j.seed)); }
  };
  try {
    const src = $('engine-src').textContent;
    const glue = '\nonmessage = (e) => { const { id, s, n, seed } = e.data; postMessage({ id, graded: Drill.grade(s, n, seed) }); };';
    worker = new Worker(URL.createObjectURL(new Blob([src, glue], { type: 'text/javascript' })));
    worker.onmessage = (e) => { const j = jobs.get(e.data.id); if (j) { jobs.delete(e.data.id); j.res(e.data.graded); } };
    worker.onerror = (e) => { if (e && e.preventDefault) e.preventDefault(); dropWorker(); };
  } catch { worker = null; }
  function gradeAsync(s, seed) {
    const snap = D.clone(s);
    return new Promise((res) => {
      if (worker) {
        const id = ++jobId;
        jobs.set(id, { res, snap, seed });
        try { worker.postMessage({ id, s: snap, n: 3000, seed }); } catch { jobs.delete(id); dropWorker(); setTimeout(() => res(syncGrade(snap, seed)), 0); return; }
        setTimeout(() => { if (jobs.has(id)) dropWorker(); }, 4000);
        return;
      }
      setTimeout(() => res(syncGrade(snap, seed)), 20);
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
  const callsOf = (s) => (s.per === 'OT' && !s.playoff ? D.OT_CALLS : D.CALLS)[D.tableKey(s)];
  const callLabel = (s, id) => { const c = callsOf(s).find((x) => x[0] === id); return c ? c[1] : id; };
  const describe = (s, c) => [c.goalie ? (s.pulled ? 'Goalie back in' : 'Pull the goalie') : null, c.timeout ? 'Timeout' : null, callLabel(s, c.play)].filter(Boolean).join(' + ');
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

  function namesFor(sc) {
    const L = sc.lineup || { you: {}, opp: {} };
    const n = (p, fb) => (p && p.n) || fb;
    return {
      C: n(L.you.C, 'your center'), W1: n(L.you.W1, 'your winger'), W2: n(L.you.W2, 'your winger'), X: n(L.you.X, 'the extra man'),
      D1: n(L.you.D1, 'your defenseman'), D2: n(L.you.D2, 'your defenseman'), G: last(sc.roster.youG?.n) || 'your goalie',
      oC: n(L.opp.C, 'their center'), oW: n(L.opp.W1, 'their winger'), oW2: n(L.opp.W2, 'their winger'),
      oD: n(L.opp.D1, 'their defenseman'), oD2: n(L.opp.D2, 'their defenseman'), oG: last(sc.roster.oppG?.n) || 'their goalie',
    };
  }
  const fill = (text) => text.replace(/\{(\w+)\}/g, (_, k) => G.names[k] ?? k);
  const tokens = (text) => [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]);

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
  // The rink: entities, a frame loop, a camera that follows the puck
  // ==================================================================================================
  const ENT = ['G', 'C', 'W1', 'W2', 'D1', 'D2', 'X', 'oG', 'oC', 'oW', 'oW2', 'oD', 'oD2'];
  const A = { e: {}, tw: [], skipping: false, busy: false, cam: { cx: 42.5, cy: 100, z: 1, tx: 42.5, ty: 100, tz: 1, follow: false }, trail: [], trailOn: false, last: 0 };
  const P = (id) => [A.e[id].x, A.e[id].y];

  function buildRink(sc) {
    const L = sc.lineup || { you: {}, opp: {} };
    const info = {
      G: { n: G.names.G }, oG: { n: G.names.oG },
      C: L.you.C, W1: L.you.W1, W2: L.you.W2, D1: L.you.D1, D2: L.you.D2, X: L.you.X,
      oC: L.opp.C, oW: L.opp.W1, oW2: L.opp.W2, oD: L.opp.D1, oD2: L.opp.D2,
    };
    const g = $('players');
    g.innerHTML = '';
    A.e = {};
    ENT.forEach((id, i) => {
      const mine = !id.startsWith('o');
      const goalie = id === 'G' || id === 'oG';
      const p = info[id] || {};
      const el = document.createElementNS(SVGNS, 'g');
      el.setAttribute('class', `pl ${mine ? 'you' : 'opp'}${goalie ? ' goalie' : ''}`);
      el.id = `p-${id}`;
      const stick = goalie ? '' : `<line class="stick" x1="${mine ? 1.6 : -1.6}" y1="${mine ? -1.2 : 1.2}" x2="${mine ? 2.6 : -2.6}" y2="${mine ? -3.6 : 3.6}"/>`;
      el.innerHTML = `${stick}<circle r="${goalie ? 2.9 : 2.5}"/><text class="n">${goalie ? 'G' : esc(p.num ?? '')}</text><text class="l" y="${mine ? 5.1 : -3.7}">${esc(p.n || '')}</text>`;
      g.appendChild(el);
      A.e[id] = { x: 42.5, y: 100, el, ph: i * 1.7 };
    });
    A.e.puck = { x: 42.5, y: 100, el: $('puck'), ph: 0 };
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
      A.tw.push({ id, from: [e.x, e.y], to, ctrl: o.ctrl, t0: performance.now(), dur, ease: o.ease || ease, res, carry: o.carry });
    });
  }
  const sleep = (ms) => new Promise((res) => { if (A.skipping) return res(); const t = setTimeout(res, ms); timers.push(t); A.sleeps.push(res); });
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

  // where everyone stands for a spot, given what the other team is showing
  function formation(s) {
    const F = {}, L = s.look;
    let puck = [42.5, 100], cy = 100;
    const fo = (dx, dy, zone) => {
      F.C = [dx, dy + 3.2]; F.oC = [dx, dy - 3.2];
      F.W1 = [dx - 10, dy + 4]; F.W2 = [dx + 10, dy + 4];
      F.oW = L === 'cheat' ? [dx - 6, dy - 2] : [dx - 10, dy - 4]; F.oW2 = L === 'cheat' ? [dx + 6, dy - 2] : [dx + 10, dy - 4];
      if (zone === 'O') { Object.assign(F, { D1: [22, 64], D2: [62, 64], oD: [26, 16], oD2: [58, 16], X: [45, 50] }); }
      else if (zone === 'D') { Object.assign(F, { D1: [26, 183], D2: [58, 183], oD: [24, 134], oD2: [60, 134], X: [45, 150] }); }
      else { Object.assign(F, { D1: [30, 116], D2: [55, 116], oD: [30, 84], oD2: [55, 84], X: [42, 122] }); }
      puck = [dx, dy];
    };
    if (s.phase === 'FO_O') { fo(20.5, 31, 'O'); cy = 56; }
    else if (s.phase === 'FO_D') { fo(20.5, 169, 'D'); cy = 144; }
    else if (s.phase === 'FO_N') { fo(42.5, 100, 'N'); cy = 100; }
    else if (s.phase === 'ENTRY') {
      cy = 80;
      Object.assign(F, { D1: [32, 128], C: [42, 112], W1: [16, 106], W2: [69, 106], D2: [58, 132], X: [50, 120] });
      Object.assign(F, {
        trap: { oC: [42, 104], oW: [14, 88], oW2: [71, 88], oD: [42, 86], oD2: [42, 64] },
        high: { oC: [34, 120], oW: [56, 124], oW2: [70, 104], oD: [22, 94], oD2: [62, 94] },
        change: { oC: [80, 100], oW: [81, 92], oW2: [30, 84], oD: [30, 68], oD2: [56, 68] },
        gap: { oC: [28, 102], oW: [62, 102], oW2: [44, 92], oD: [30, 77], oD2: [56, 77] },
      }[L] || { oC: [42, 104], oW: [14, 88], oW2: [71, 88], oD: [42, 86], oD2: [42, 64] });
      puck = [F.D1[0] + 1.6, F.D1[1] - 1.6];
    } else if (s.phase === 'RUSH') {
      cy = 56;
      Object.assign(F, { C: [36, 66], W1: [16, 60], W2: [66, 62], D1: [44, 88], D2: [62, 98], X: [52, 80] });
      Object.assign(F, {
        odd: { oD: [30, 42], oD2: [56, 42], oC: [50, 96], oW: [22, 100], oW2: [72, 104] },
        trailer: { oD: [30, 46], oD2: [56, 46], oC: [38, 72], oW: [20, 98], oW2: [72, 104] },
        backcheck: { oD: [32, 40], oD2: [55, 40], oC: [39, 70], oW: [19, 68], oW2: [70, 92] },
        gap: { oD: [33, 24], oD2: [52, 24], oC: [50, 94], oW: [22, 100], oW2: [72, 104] },
      }[L] || { oD: [30, 42], oD2: [56, 42], oC: [50, 96], oW: [22, 100], oW2: [72, 104] });
      if (L === 'trailer') F.D1 = [46, 84];
      puck = [F.C[0] + 1.6, F.C[1] - 1.6];
    } else if (s.phase === 'BREAK') {
      cy = 40;
      Object.assign(F, { W1: [42.5, 42], C: [30, 92], W2: [64, 96], D1: [36, 120], D2: [56, 124], X: [48, 110], oD: [38, 62], oD2: [60, 86], oC: [44, 100], oW: [24, 104], oW2: [70, 108] });
      puck = [44.1, 40.4];
    } else if (s.phase === 'ZONE') {
      cy = 56;
      Object.assign(F, { D1: [16, 70], D2: [69, 70], C: [27, 30], W1: [64, 38], W2: [42, 22], X: [42, 56] });
      Object.assign(F, {
        box: { oD: [36, 22], oD2: [49, 22], oW: [34, 36], oW2: [51, 36], oC: [42, 29] },
        points: { oW: [20, 61], oW2: [65, 61], oD: [34, 24], oD2: [52, 24], oC: [36, 36] },
        door: { oD: [31, 24], oD2: [38, 31], oW: [28, 46], oW2: [50, 50], oC: [24, 38] },
        tired: { oD: [36, 24], oD2: [54, 27], oW: [28, 45], oW2: [58, 47], oC: [45, 36] },
        rebound: { oD: [35, 23], oD2: [51, 23], oW: [30, 42], oW2: [56, 44], oC: [42, 33] },
      }[L] || { oD: [36, 24], oD2: [52, 24], oW: [30, 42], oW2: [56, 44], oC: [42, 33] });
      if (L === 'door') F.W1 = [67, 27];
      if (s.atPoint) { F.D1 = [18, 68]; F.C = [24, 40]; }
      puck = s.atPoint ? [F.D1[0] + 1.6, F.D1[1] - 1.6] : [F.C[0] + 1.6, F.C[1] - 1.6];
    } else if (s.phase === 'THEIRS' && !s.deep) {
      cy = 100;
      Object.assign(F, { C: [42, 112], W1: [28, 96], W2: [58, 96], D1: [30, 134], D2: [56, 134], X: [42, 120] });
      Object.assign(F, {
        dump: { oC: [44, 97], oW: [79, 92], oW2: [80, 84], oD: [30, 78], oD2: [56, 76] },
        stretch: { oD: [40, 82], oD2: [62, 78], oC: [42, 98], oW: [16, 104], oW2: [72, 128] },
        slow: { oD: [40, 68], oD2: [62, 64], oC: [42, 86], oW: [16, 92], oW2: [70, 92] },
      }[L] || { oD: [40, 82], oD2: [62, 78], oC: [42, 98], oW: [16, 104], oW2: [70, 104] });
      const car = L === 'dump' ? 'oC' : 'oD';
      puck = [F[car][0] - 1.6, F[car][1] + 1.6];
    } else {
      cy = 144;
      Object.assign(F, { D1: [34, 178], D2: [52, 178], C: [42, 160], W1: [26, 142], W2: [60, 142], X: [42, 150] });
      Object.assign(F, {
        cycle: { oW: [10, 172], oC: [14, 186], oW2: [66, 165], oD: [22, 132], oD2: [63, 132] },
        shot: { oW: [14, 170], oC: [30, 180], oW2: [62, 166], oD: [24, 131], oD2: [62, 131] },
        screen: { oW: [12, 170], oC: [28, 176], oW2: [42, 183], oD: [22, 132], oD2: [63, 132] },
      }[L] || { oW: [12, 170], oC: [28, 176], oW2: [62, 166], oD: [22, 132], oD2: [63, 132] });
      const car = L === 'shot' ? 'oD' : L === 'cycle' ? 'oC' : 'oW';
      puck = [F[car][0] - 1.6, F[car][1] + 1.6];
    }
    F.oG = s.phase === 'BREAK' && L === 'out' ? [42.5, 19] : s.phase === 'BREAK' && L === 'deep' ? [42.5, 11.6] : [42.5, 13];
    F.G = s.pulled ? [88, 100] : [42.5, 187];
    return { F, puck, cy };
  }
  const carrierOf = (s) => {
    if (s.phase === 'ENTRY') return 'D1';
    if (s.phase === 'RUSH') return 'C';
    if (s.phase === 'BREAK') return 'W1';
    if (s.phase === 'ZONE') return s.atPoint ? 'D1' : 'C';
    if (s.phase === 'THEIRS') return s.deep ? (s.look === 'shot' ? 'oD' : s.look === 'cycle' ? 'oC' : 'oW') : (s.look === 'dump' ? 'oC' : 'oD');
    return null;
  };
  function onIce(s) {
    const sk = D.skaters(s), is3 = s.per === 'OT' && !s.playoff;
    const you = sk.you - (s.pulled ? 1 : 0), opp = sk.opp - (s.oppPulled ? 1 : 0);
    return { W2: !is3 && you >= 5, D2: !is3 && you >= 4, X: s.pulled, oW2: !is3 && opp >= 5, oD2: !is3 && opp >= 4, G: !s.pulled, oG: !s.oppPulled };
  }
  // everyone skates to the next spot
  function stage(s, instant) {
    const f = formation(s);
    const vis = onIce(s);
    const moves = [];
    for (const id of ENT) {
      show(id, vis[id] ?? true);
      const p = f.F[id] || P(id);
      if (instant) setPos(id, p); else moves.push(tween(id, p, 650 + Math.random() * 200));
    }
    if (instant) setPos('puck', f.puck); else moves.push(tween('puck', f.puck, 650));
    camTo(f.cy, s.phase === 'BREAK' ? 1.5 : 1, 42.5, instant);
    $('rink').classList.toggle('empty', s.pulled);
    $('rink-tag').textContent = tagFor(s);
    return Promise.all(moves);
  }
  function tagFor(s) {
    const sk = D.skaters(s);
    const where = { FO_O: 'Faceoff, their end', FO_N: 'Faceoff, center ice', FO_D: 'Faceoff, your end', ENTRY: 'Your puck, coming up ice', RUSH: 'On the rush', BREAK: 'Breakaway!', ZONE: s.atPoint ? 'Your puck at the point' : 'Your puck in their end', THEIRS: s.deep ? 'Their puck in your end' : 'Their puck, neutral zone' }[s.phase];
    const str = s.pulled ? `${sk.you} on ${sk.opp} · empty net` : s.pp > 0 ? `Power play ${fmt(s.pp)}` : s.pp < 0 ? `Penalty kill ${fmt(-s.pp)}` : `${sk.you} on ${sk.opp}`;
    return `${where} · ${str}`;
  }

  // ---------- targets: every call is a spot on the ice ----------
  function targetsFor(s) {
    const f = formation(s).F, n = G.names, L = s.look;
    const at = (id) => f[id] || P(id);
    const three = s.per === 'OT' && !s.playoff;
    const k = D.tableKey(s);
    const T = {};
    if (k === 'FO_O' && !three) Object.assign(T, { back: [at('D1'), `Back to ${n.D1}`], set: [[at('W1')[0], at('W1')[1] - 2], `One-timer: ${n.W1}`], tie: [[29, 25], 'Tie-up'] });
    else if (k.startsWith('FO_') && three) Object.assign(T, { back: [k === 'FO_D' ? [42, 150] : at('D1'), 'Win it back'], go: [k === 'FO_O' ? [42.5, 14] : k === 'FO_D' ? [42, 128] : [42, 70], 'Win it and go'] });
    else if (k === 'FO_N') Object.assign(T, { fwd: [[24, 72], 'Chip it in'], back: [at('D1'), `Back to ${n.D1}`] });
    else if (k === 'FO_D') Object.assign(T, { out: [[42, 130], 'Up the middle'], glass: [[9, 150], 'Off the glass'] });
    else if (k === 'ENTRY') {
      Object.assign(T, { carry: [[42, 66], three ? 'Attack' : 'Carry in'], stretch: [[16, 74], `Stretch to ${n.W1}`] });
      if (three) T.change = [[42, 132], 'Circle back'];
      else { T.dump = [[12, 28], 'Dump in']; T.change = [[79, 124], 'Regroup']; T.wide = [[70, 62], `Wide with ${n.W1}`]; }
    } else if (k === 'RUSH') {
      Object.assign(T, { shoot: [[42.5, 7.5], `Shoot (${n.W1})`], drop: [at('D1'), `Drop to ${n.D1}`], drive: [[56, 22], 'Drive the net'], delay: [[14, 74], 'Pull up'] });
    } else if (k === 'BREAK') {
      Object.assign(T, { high: [[52, 8], 'Shoot high'], five: [[42.5, 23], 'Five-hole'], deke: [[31, 18], 'Deke'] });
    } else if (k === 'ZONE') {
      T.shoot = [[42.5, 7.5], three ? 'Shoot' : `Point shot (${n.D1})`];
      if (!three) { T.quick = [[at('C')[0] - 6, at('C')[1] + 7], `${n.C} shoots`]; T.point = [at('D2'), s.atPoint ? `Swing it back (${n.D2})` : `D-to-D (${n.D2})`]; }
      T.seam = [at('W1'), three ? `Back door: ${n.W1}` : `Seam to ${n.W1}`];
      if (three) T.peel = [[42, 68], 'Peel back'];
      else { T.cycle = [[9, 21], 'Cycle low']; T.net = [at('W2'), `Bump to ${n.C}`]; }
    } else {
      const car = carrierOf(s);
      T.press = [at(car), three ? 'Go get it' : s.deep ? 'Pressure' : 'Forecheck'];
      T.sit = [s.deep ? [42, 177] : [42, 116], three ? 'Stay above' : s.deep ? 'Collapse' : 'Trap'];
    }
    void L;
    // keep every target well inside the boards so it is easy to hit
    return callsOf(s).map(([id], i) => T[id] && { play: id, at: [clamp(T[id][0][0], 8, 77), clamp(T[id][0][1], 6, 194)], label: T[id][1], n: i + 1 }).filter(Boolean);
  }
  function drawTargets(list, origin, z = 1) {
    const g = $('targets');
    const sc = 1 / z;
    const F = G && G.s && G.s.per !== 'SO' && origin ? formation(G.s).F : null;   // where the skaters are heading
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
  // A game
  // ==================================================================================================
  function start(day, practiceSc) {
    clearTimers();
    const sc = practiceSc || gameForDay(day);
    setTeams(sc);
    G = { day, practice: !!practiceSc, sc, s: D.newGame(sc), step: 0, sumD: 0, sumV: 0, calls: [], pick: { goalie: false, timeout: false }, names: null };
    G.names = namesFor(sc);
    $('game').appendChild($('pbp'));
    hideAll();
    $('game').hidden = false;
    $('result').hidden = true; $('so').hidden = true; $('call').hidden = false;
    $('feed').innerHTML = '';
    buildRink(sc);
    stage(G.s, true);
    board();
    feed(fmt(sc.start.t), `<b>Puck drop</b>${esc(sc.label)}. Down ${sc.start.you}-${sc.start.opp}.`);
    G.pending = gradeAsync(G.s, 1 + G.day * 1000);
    spot();
    window.scrollTo({ top: 0 });
  }

  function feed(t, html, chip) {
    const li = document.createElement('li');
    li.innerHTML = `<span class="t">${esc(t)}</span><div class="what">${html}</div>${chip || ''}`;
    $('feed').prepend(li);
  }

  function spot() {
    const s = G.s;
    board();
    if (s.over) return finish();
    if (s.per === 'SO') return shootout();
    const o = D.options(s);
    const [, title, detail] = D.lookInfo(s);
    $('c-look').textContent = fill(title);
    $('c-detail').textContent = fill(detail);
    const sk = D.skaters(s);
    $('c-situ').textContent = `${perLabel(s)} ${fmt(s.t)} · ${s.pulled ? `${sk.you} on ${sk.opp}, net empty` : s.pp > 0 ? 'power play' : s.pp < 0 ? 'penalty kill' : `${sk.you} on ${sk.opp}`}`;
    G.pick = { goalie: false, timeout: false };
    const tg = [];
    if (o.canPull) tg.push(['goalie', 'Pull the goalie', 'P']);
    if (o.canReturn) tg.push(['goalie', 'Goalie back in', 'P']);
    if (o.canTimeout) tg.push(['timeout', 'Use your timeout', 'T']);
    $('c-toggles').innerHTML = tg.map(([k, l, kb]) => `<button type="button" class="tg" data-k="${k}" aria-pressed="false"><i></i>${esc(l)} <kbd>${kb}</kbd></button>`).join('');
    $('c-toggles').querySelectorAll('.tg').forEach((b) => b.onclick = () => toggle(b.dataset.k));
    const keys = $('c-keys');
    keys.className = `keys n${o.plays.length}`;
    keys.style.setProperty('--n', o.plays.length > 4 ? 3 : o.plays.length);
    keys.innerHTML = o.plays.map((p, i) => `<button type="button" class="key" data-p="${p.id}" disabled><span class="kn">${i + 1}</span><b>${esc(p.label)}</b><small>${esc(p.hint)}</small></button>`).join('');
    keys.querySelectorAll('.key').forEach((b) => {
      b.onclick = () => commit(b.dataset.p);
      b.onpointerenter = () => hotTarget(b.dataset.p); b.onpointerleave = () => hotTarget(null);
      b.onfocus = () => hotTarget(b.dataset.p); b.onblur = () => hotTarget(null);
    });
    const firstGame = !load().tipped;
    $('c-tip').hidden = !(firstGame && G.step < 2);
    $('c-tip').textContent = G.step === 0 ? 'Read what they are showing, then make the call: tap a target on the ice or a key below.' : 'Tap the ice to skip a replay. Green means you read it right.';
    if (firstGame && G.step >= 1) { const st0 = load(); st0.tipped = true; save(st0); }
    // targets go up right away; the call is accepted once the grade is in (usually already, from the worker)
    const car = carrierOf(s);
    drawTargets(targetsFor(s), car ? formation(s).F[car] || P(car) : P('puck'), s.phase === 'BREAK' ? 1.5 : 1);
    $('rink-hint').hidden = !(firstGame && G.step < 3);
    A.onPick = (play) => commit(play);
    G.accepting = true;
    G.pending.then((graded) => {
      if (!G || G.s !== s) return;
      G.graded = graded;
      if (graded[0].wp < 0.01 && s.per === 'REG') return outOfReach(false);
      if (graded[0].wp > 0.995) return outOfReach(true);
      keys.querySelectorAll('.key').forEach((b) => b.disabled = false);
      if (G.queued) { const q = G.queued; G.queued = null; commit(q); return; }
      const r = keys.getBoundingClientRect();
      if (r.bottom > window.innerHeight) keys.scrollIntoView({ block: 'end', behavior: 'smooth' });
    });
  }
  function toggle(k) {
    if (!G.accepting) return;
    G.pick[k] = !G.pick[k];
    const b = $('c-toggles').querySelector(`[data-k="${k}"]`);
    if (b) b.setAttribute('aria-pressed', String(G.pick[k]));
    Sound.play('pass');
  }
  // a game that is gone (under 1%), or won (over 99.5%), plays itself out to the horn
  function outOfReach(won) {
    const s = G.s;
    clearTargets(); A.onPick = null; G.accepting = false;
    const r = D.mulberry(D.hash(`${G.sc.id}:out:${G.step}`));
    const was = `${s.you}-${s.opp}, ${fmt(s.t)} left`;
    D.finish(s, r);
    if (!s.over) { const p = s.per === 'SO' ? s.soWin : 0.5; s.how = s.per === 'SO' ? 'SO' : 'OT'; s.over = true; s.won = r() < p; if (s.won) s.you++; else s.opp++; }
    feed(perLabel(s), won ? `<b>Game in hand</b>${esc(was)}: over 99.5% from here. Played out to the final horn.` : `<b>Out of reach</b>${esc(was)}: under 1% even with the best call. Played out to the final horn.`);
    flash(won ? 'Game in hand' : 'Out of reach', won ? 'good' : 'info', 1500);
    Sound.play('whistle');
    board();
    later(finish, 1600);
  }

  function commit(play) {
    if (!G || !G.accepting) return;
    if (!G.graded) { G.queued = play; hotTarget(play); return; }   // the grade is a moment away: take the call now
    G.accepting = false;
    A.onPick = null;
    const s = G.s;
    const c = { play, goalie: G.pick.goalie, timeout: G.pick.timeout };
    const graded = G.graded;
    G.graded = null;
    const mine = graded.find((g) => D.key(g) === D.key(c)) || graded[graded.length - 1];
    const best = graded[0];
    const typ = D.typical(s, graded);
    const v = D.verdict(best.wp - mine.wp, best.wp);
    const d = mine.wp - typ.wp;
    if (v.k !== 'none') { G.sumD += d; G.sumV += typ.v; }
    const before = { t: s.t, per: perLabel(s), situ: $('rink-tag').textContent, look: fill(D.lookInfo(s)[1]), call: describe(s, c), best: describe(s, best), wp: best.wp, mine: mine.wp, loss: best.wp - mine.wp };
    const events = [];
    const rng = D.mulberry(D.hash(`${G.sc.id}:${G.practice ? 'p' : G.day}:${G.step}`));
    const prev = D.clone(s);
    const say = (k, text, data) => events.push({ k, text: fill(text), raw: text, data: data || {} });
    D.resolve(s, c, rng, say);
    // overtime: each call covers a longer stretch; the next stretch plays itself out until a goal or the horn
    if (s.per === 'OT' && !s.over && prev.per === 'OT') {
      const budget = s.playoff ? 60 : 24, t0 = s.t, ot0 = s.otNum, auto = [];
      while (!s.over && s.per === 'OT' && s.otNum === ot0 && t0 - s.t < budget) {
        D.resolve(s, D.coach(s, rng), rng, (k, text, data) => auto.push({ k, text: fill(text), raw: text, data: data || {} }));
      }
      const big = auto.filter((e) => ['against', 'eng', 'pp', 'pk', 'ot', 'so', 'stop'].includes(e.k) || (e.k === 'shot' && (e.data.res === 'goal' || e.data.res === 'save')));
      events.push({ k: 'play', text: big.length ? `The next ${t0 - s.t} seconds:` : `The next ${t0 - s.t} seconds: back and forth, no one breaks through.`, raw: '', data: {} });
      events.push(...big.slice(-3));
    }
    G.step++;
    G.pending = s.over || s.per === 'SO' ? Promise.resolve(null) : gradeAsync(s, G.step + 1 + G.day * 1000);
    G.calls.push({ ...before, v: v.k, d });
    $('c-keys').querySelectorAll('.key').forEach((b) => { b.disabled = true; if (b.dataset.p === play) b.classList.add('down'); });
    $('c-toggles').querySelectorAll('.tg').forEach((b) => { b.disabled = true; });
    $('result').hidden = true;
    $('rink-hint').hidden = true;
    clearTargets();
    Sound.play('pass');
    run(prev, s, events, play).then(() => afterPlay(before, v, d, events));
  }

  // ==================================================================================================
  // The play, frame by frame
  // ==================================================================================================
  async function run(prev, s, events, play) {
    A.busy = true; A.skipping = false;
    G.skip = () => {
      A.skipping = true;
      A.tw.forEach((t) => { setPos(t.id, t.to); t.res(); }); A.tw = [];
      A.sleeps.forEach((r) => r()); A.sleeps = [];
      clearTimers(); $('flash').hidden = true;
    };
    A.cam.follow = true;
    try {
      // the call itself: the carrier makes the move the call names
      await opening(prev, play, events);
      for (const e of events) await animate(e);
    } catch (err) { /* an animation glitch must never stop the game */ }
    A.cam.follow = false;
    A.trailOn = false;
    hl(null); tick('');
    if (!s.over && s.per !== 'SO') { A.skipping = false; await stage(s, false); }
    A.busy = false; A.skipping = false;
    G.skip = null;
    $('flash').hidden = A.skipping ? true : $('flash').hidden;
    board();
  }

  // a short lead-in that shows the call you made before the result plays
  async function opening(prev, play, events) {
    const k = D.tableKey(prev);
    if (events[0] && events[0].k === 'pull') return;
    if (k === 'ENTRY' && play === 'change') { tick(`${G.names.D1} swings back with it.`); await carry('D1', [36, 150], 650); return; }
    if (k === 'RUSH' && play === 'drive') { tick(`${G.names.C} drives the net.`); await carry('C', [46, 22], 650); return; }
    if (k === 'RUSH' && play === 'delay') { tick(`${G.names.C} pulls up on the half-wall.`); await Promise.all([carry('C', [14, 46], 650), tween('W1', [24, 30], 650), tween('W2', [60, 34], 650), tween('D1', [22, 70], 650), tween('D2', [64, 70], 650)]); return; }
    if (k === 'BREAK') { tick(`${G.names.W1} is in alone on ${G.names.oG}…`); await Promise.all([carry('W1', [42.5, play === 'deke' ? 24 : 26], 900, { ease: linear }), tween('oD', [40, 48], 900)]); if (play === 'deke') { await carry('W1', [36, 18], 260); } return; }
    if (k === 'ENTRY' && play === 'wide') { tick(`${G.names.W1} takes it wide.`); await puckTo([P('W1')[0] + 1.4, P('W1')[1] - 1.4], 260, { trail: true }); A.cam.follow = true; await carry('W1', [8, 64], 700); return; }
    if (k === 'ZONE' && play === 'cycle') { tick(`${G.names.C} takes it below the dots.`); await carry('C', [14, 18], 600); return; }
    if (k === 'ZONE' && play === 'peel') { tick(`${G.names.C} peels back.`); await carry('C', [40, 66], 600); return; }
    if (k.startsWith('THEIRS') && play === 'press') { const car = carrierOf(prev); const me = prev.deep ? 'D2' : 'W1'; tick(`${G.names[me]} goes after ${G.names[car] || 'the puck'}.`); await tween(me, [P(car)[0] + 2, P(car)[1] + 2.5], 550); return; }
    if (k.startsWith('THEIRS') && play === 'sit') { tick(prev.deep ? 'Everyone collapses to the slot.' : 'Three across the neutral zone.'); await Promise.all(prev.deep ? [tween('D1', [37, 180], 500), tween('D2', [48, 180], 500), tween('C', [42, 170], 500)] : [tween('W1', [20, 108], 500), tween('C', [42, 108], 500), tween('W2', [65, 108], 500)]); }
  }

  const shooterOf = (raw, mine) => tokens(raw).find((t) => mine ? !t.startsWith('o') && t !== 'G' : t.startsWith('o') && t !== 'oG') || (mine ? 'C' : 'oW');
  const nearestOf = (ids, p) => ids.filter((id) => !$(`p-${id}`).classList.contains('off')).sort((a, b) => dist(P(a), p) - dist(P(b), p))[0];
  const OPP = ['oC', 'oW', 'oW2', 'oD', 'oD2'], YOU = ['C', 'W1', 'W2', 'D1', 'D2', 'X'];

  async function animate(e) {
    const k = e.k, d = e.data;
    if (e.text) tick(e.text);
    if (k === 'timeout') { Sound.play('whistle'); flash('Timeout', 'info', 1000); await sleep(1000); }
    else if (k === 'pull') { tick(e.text); flash('Net empty', 'info', 1100); await Promise.all([tween('G', [88, 100], 1000), (async () => { show('X', true); setPos('X', [88, 108]); await tween('X', [45, Math.min(P('puck')[1] + 10, 150)], 1000); })()]); }
    else if (k === 'return') { await tween('G', [42.5, 187], 700); }
    else if (k === 'fo') {
      const dot = P('puck');
      Sound.play('whistle'); await sleep(250);
      setPos('puck', [dot[0], dot[1] - 0.01]); Sound.play('stick');
      await Promise.all([tween('C', [dot[0], dot[1] + 2.4], 120), tween('oC', [dot[0], dot[1] - 2.4], 120)]);
      const w = d.won ? P('C') : P('oC');
      await puckTo([w[0] + (d.won ? -3 : 3), w[1] + (d.won ? 7 : -7)], 260, { trail: true });
    } else if (k === 'shot') {
      const id = d.from === 'eng' ? 'D1' : shooterOf(e.raw, true);
      const sp = P(id);
      if (dist(P('puck'), sp) > 3) { Sound.play('pass'); await puckTo([sp[0] + 1.4, sp[1] - 1.4], 280, { trail: true }); }
      hl(id);
      await tween(id, [sp[0], sp[1] + 1.4], 140);
      Sound.play('stick');
      const res = d.res;
      const bspot = { bhigh: [45.6, 8.2], bfive: [42.5, 10.2], bdeke: [39.6, 9.4] }[d.from];
      const tgt = bspot && res === 'goal' ? bspot : bspot && res === 'save' ? [bspot[0], 12.2] : d.from === 'eng' ? [42.5, 8.6] : res === 'goal' ? [42.5 + (Math.random() - 0.5) * 4, 8.7] : res === 'save' ? [42.5 + (Math.random() - 0.5) * 3, 12.4] : res === 'block' ? lerp(sp, [42.5, 11], 0.35) : [sp[0] < 42.5 ? 47.4 : 37.6, 4.2];
      const moves = [puckTo(tgt, res === 'block' ? 150 : 210, { trail: true, ease: linear })];
      if (res === 'save') moves.push(tween('oG', [tgt[0], 13], 170));
      if (res === 'goal' && d.from !== 'eng') moves.push(tween('oG', [42.5 + (tgt[0] < 42.5 ? 2.5 : -2.5), 13.4], 200));
      if (res === 'block') { const b = nearestOf(OPP, tgt); if (b) moves.push(tween(b, [tgt[0] + 1, tgt[1] - 1.5], 150)); }
      await Promise.all(moves);
      if (res === 'goal') { lamp('opp'); Sound.play('horn'); flash('Goal!', 'good', 1700); await sleep(1700); }
      else if (res === 'save') { Sound.play('save'); await sleep(250); await puckTo([tgt[0] + (Math.random() - 0.5) * 8, 20], 260); await sleep(250); }
      else if (res === 'block') { Sound.play('board'); await puckTo([tgt[0] + 3, tgt[1] + 6], 220); await sleep(200); }
      else { Sound.play(Math.random() < 0.3 ? 'post' : 'board'); await puckTo([tgt[0] < 42.5 ? 8 : 77, 12], 320); await sleep(150); }
      hl(null);
    } else if (k === 'against' || k === 'stop') {
      const id = shooterOf(e.raw, false); const sp = P(id);
      A.cam.follow = true;
      if (dist(P('puck'), sp) > 3) await puckTo([sp[0] - 1.4, sp[1] + 1.4], 280, { trail: true });
      hl(id);
      await tween(id, [sp[0], sp[1] - 1.4], 140);
      Sound.play('stick');
      const tgt = k === 'against' ? [42.5 + (Math.random() - 0.5) * 4, 191.3] : [42.5 + (Math.random() - 0.5) * 3, 187.6];
      await Promise.all([puckTo(tgt, 220, { trail: true, ease: linear }), k === 'stop' && !$('p-G').classList.contains('off') ? tween('G', [tgt[0], 187], 170) : null]);
      if (k === 'against') { lamp('you'); Sound.play('thud'); flash('Goal against', 'bad', 1600); await sleep(1600); }
      else { Sound.play('save'); flash('Save!', 'good', 800); await sleep(800); await tween('G', [42.5, 187], 200); }
      hl(null);
    } else if (k === 'eng') {
      const from = P('puck');
      Sound.play('stick');
      A.cam.follow = true;
      await puckTo([42.5, d.res === 'goal' ? 191.3 : 190], Math.max(700, (191 - from[1]) * 9), { trail: true, ease: linear });
      if (d.res === 'goal') { lamp('you'); Sound.play('thud'); flash('Empty net', 'bad', 1700); await sleep(1700); }
    } else if (k === 'icing') {
      Sound.play('stick'); A.cam.follow = true;
      await puckTo([26, 197], 900, { trail: true, ease: linear });
      Sound.play('whistle'); flash('Icing', 'info', 1000); await sleep(1000);
    } else if (k === 'pass') {
      const tk = tokens(e.raw);
      const recv = d.ok ? tk.filter((t) => !t.startsWith('o')).pop() || 'W1' : tk.find((t) => t.startsWith('o')) || nearestOf(OPP, P('puck'));
      let rp = P(recv);
      Sound.play('pass');
      if (d.ok && d.type === 'point') {
        const p2 = P('D2'), p1 = P('D1');
        await puckTo([p2[0] - 1.4, p2[1] - 1.4], 320, { trail: true }); hl('D2'); Sound.play('pass');
        await Promise.all([tween('oW2', [p2[0] - 6, p2[1] - 6], 420), tween('oW', [p1[0] + 6, p1[1] - 6], 520), tween('oD', [32, 26], 520), tween('oD2', [46, 27], 520)]);
        await puckTo([p1[0] + 1.6, p1[1] - 1.6], 420, { trail: true }); hl('D1'); await sleep(200);
        return;
      }
      if (d.ok && d.type === 'stretch') { rp = [42.5, 42]; await Promise.all([tween(recv, rp, 700, { ease: easeOut }), puckTo([rp[0] + 1, rp[1] - 1], 620, { trail: true, ctrl: [rp[0] + 14, (rp[1] + P('puck')[1]) / 2] })]); }
      else if (d.ok) { await puckTo([rp[0] + 1.2, rp[1] - 1.2], 300, { trail: true }); hl(recv); }
      else { const mid = lerp(P('puck'), d.type === 'stretch' ? [16, 74] : P(tk.filter((t) => !t.startsWith('o')).pop() || 'W1'), 0.55); await Promise.all([tween(recv, mid, 320), puckTo(mid, 320, { trail: true })]); Sound.play('stick'); hl(recv); }
      await sleep(250);
    } else if (k === 'entry') {
      if (d.ok && d.type === 'carry') {
        const who = tokens(e.raw).find((t) => !t.startsWith('o')) || 'C';
        if (dist(P('puck'), P(who)) > 3) await puckTo([P(who)[0] + 1.6, P(who)[1] - 1.6], 250, { trail: true });
        A.cam.follow = true;
        await Promise.all([carry(who, [36, 66], 800, { ease: linear }), tween('W1', [16, 60], 800), tween(who === 'W2' ? 'C' : 'W2', [66, 62], 800), tween('D1', [44, 88], 850), tween('D2', [62, 98], 850)]);
      } else if (d.ok && d.type === 'wide') {
        await Promise.all([carry('W1', [10, 26], 700), tween('C', [34, 36], 700), tween('W2', [56, 28], 700), tween('D1', [20, 70], 700), tween('D2', [62, 70], 700)]);
      } else if (d.ok) {
        Sound.play('stick'); A.cam.follow = true;
        await Promise.all([puckTo([72, 8], 800, { ctrl: [70, 50] }), tween('W1', [66, 13], 950), tween('C', [40, 34], 950), tween('W2', [56, 30], 950), tween('D1', [24, 70], 950), tween('D2', [62, 70], 950)]);
        await puckTo([P('W1')[0] + 1.4, P('W1')[1] + 1.4], 200); Sound.play('board'); hl('W1');
      } else {
        const t = d.type === 'dump' ? [72, 8] : lerp(P('puck'), [42, 70], 0.5);
        if (d.type === 'dump') { Sound.play('stick'); A.cam.follow = true; await Promise.all([puckTo(t, 800, { ctrl: [70, 50] }), tween('oD', [70, 12], 850), tween('W1', [60, 22], 950)]); }
        else { const who = nearestOf(OPP, t); await Promise.all([carry('C', t, 500), tween(who, [t[0] + 2, t[1] - 2], 480)]); Sound.play('stick'); await puckTo([t[0] + 2, t[1] - 4], 200); }
      }
      await sleep(200);
    } else if (k === 'keep') { Sound.play('stick'); await Promise.all([tween('D2', [64, 72], 450), puckTo([65.5, 70.5], 450, { trail: true })]); hl('D2'); await sleep(200); }
    else if (k === 'clear') { const who = nearestOf(OPP, P('puck')); if (who) hl(who); Sound.play('stick'); A.cam.follow = true; await puckTo([44 + (Math.random() - 0.5) * 20, 128], 800, { trail: true, ease: linear }); Sound.play('board'); await sleep(250); }
    else if (k === 'take') {
      const me = tokens(e.raw).find((t) => !t.startsWith('o')) || nearestOf(YOU, P('puck'));
      const pk = P('puck');
      await tween(me, [pk[0] + 1.5, pk[1] + 1.5], 380); Sound.play('board');
      await carry(me, [pk[0] + 2, pk[1] + 6], 380); hl(me); await sleep(250);
    } else if (k === 'turn' || k === 'beat') {
      const them = tokens(e.raw).find((t) => t.startsWith('o')) || nearestOf(OPP, P('puck'));
      const pk = P('puck');
      await tween(them, [pk[0] - 1.5, pk[1] - 1.5], 380); Sound.play('stick');
      await carry(them, [pk[0] - 2, pk[1] + 8], 400); hl(them); await sleep(250);
    } else if (k === 'dumpin') { Sound.play('stick'); A.cam.follow = true; await Promise.all([puckTo([12, 194], 900, { ctrl: [10, 150] }), tween('D1', [16, 188], 1000)]); Sound.play('board'); await sleep(200); }
    else if (k === 'zone') { const who = nearestOf(OPP, P('puck')); A.cam.follow = true; await carry(who, [20, 158], 800); await sleep(200); }
    else if (k === 'change') {
      document.querySelectorAll('.pl.you:not(.goalie)').forEach((el) => { el.style.opacity = '0.2'; });
      await sleep(600);
      document.querySelectorAll('.pl.you').forEach((el) => { el.style.opacity = ''; });
      await sleep(300);
    } else if (k === 'pp' || k === 'pk') { Sound.play('whistle'); flash(k === 'pp' ? 'Power play' : 'Penalty kill', 'info', 1300); await sleep(1300); }
    else if (k === 'ot' || k === 'so' || k === 'end') { Sound.play('whistle'); flash(k === 'ot' ? 'Overtime' : k === 'so' ? 'Shootout' : 'Final', 'info', 1400); await sleep(1400); }
    else await sleep(e.text ? 650 : 0);
  }

  const BIG = (events) => {
    if (events.find((e) => e.k === 'pass' && e.data.ok && e.data.type === 'stretch') && !events.find((e) => e.k === 'shot')) return 'Breakaway!';
    const has = (k, f = () => true) => events.find((e) => e.k === k && f(e));
    if (has('shot', (e) => e.data.res === 'goal')) return 'Goal!';
    if (has('eng', (e) => e.data.res === 'goal')) return 'Empty-net goal against';
    if (has('against')) return 'Goal against';
    if (has('pp')) return 'Power play';
    if (has('pk')) return 'Penalty kill';
    if (has('icing')) return 'Icing';
    const shots = events.filter((e) => e.k === 'shot');
    if (shots.length) return { save: 'Save', block: 'Blocked', wide: 'Wide' }[shots[shots.length - 1].data.res] || 'Shot';
    if (has('stop')) return `Big save, ${G.names.G}`;
    const lastE = [...events].reverse().find((e) => !['fo', 'timeout', 'pull', 'return', 'play'].includes(e.k)) || events[events.length - 1];
    if (!lastE) return '';
    if (lastE.k === 'play' || lastE.k === 'change') { const sent = lastE.text.split(/(?<=\.)\s+/).filter(Boolean); const tail = (sent[sent.length - 1] || '').replace(/\.$/, ''); if (tail && tail.length <= 28) return tail; }
    const m = { keep: 'Still in their end', clear: 'Cleared', take: 'Puck won', turn: 'Turnover', beat: 'Beaten', dumpin: 'Dumped in', zone: 'They get in', change: 'Fresh legs', entry: lastE.data.ok ? (lastE.data.type === 'carry' ? 'On the rush' : 'In the zone') : 'Turned over', pass: lastE.data.ok ? 'On the tape' : 'Picked off', fo: lastE.data.won ? 'Won the draw' : 'Lost the draw' };
    return m[lastE.k] || 'Play on';
  };

  function afterPlay(before, v, d, events) {
    const s = G.s;
    $('r-big').textContent = BIG(events);
    $('r-line').textContent = events.filter((e) => !['timeout', 'return'].includes(e.k) && e.text).slice(-2).map((e) => e.text).join(' ');
    const ptsEl = $('r-pts');
    ptsEl.className = `pts num ${v.k === 'best' || v.k === 'good' ? 'good' : v.k}`;
    ptsEl.textContent = v.k === 'none' ? '–' : pts(d);
    ptsEl.title = 'Win chance compared with a typical NHL bench in the same spot';
    const vt = $('r-verdict');
    vt.className = `verdict ${v.k}`;
    const gain = (before.wp - before.mine) * 100;
    vt.innerHTML = v.k === 'best' ? '<span>Your call: <b>the best one.</b></span>'
      : v.k === 'good' ? `<span>Your call: <b>as good as any</b> (${esc(before.best)} was +${gain.toFixed(1)}, inside the margin).</span>`
      : v.k === 'ok' ? `<span>Your call: <b>decent.</b> ${esc(before.best)} was a bit better (+${gain.toFixed(1)}).</span>`
      : v.k === 'bad' ? `<span>Your call: <b>costly.</b> ${esc(before.best)} was the call (+${gain.toFixed(1)} win chance).</span>`
      : '<span>The game was out of reach. Not graded.</span>';
    const setWp = (after) => { $('r-wp').textContent = `Win chance ${(before.wp * 100).toFixed(1)}% → ${(after * 100).toFixed(1)}%`; };
    $('r-wp').textContent = `Win chance ${(before.wp * 100).toFixed(1)}% → …`;
    $('result').hidden = false;
    feed(`${before.per === '3RD' ? '' : before.per + ' '}${fmt(before.t)}`, `<b>${esc(before.call)}</b>${esc(before.look)}. ${esc(events.map((e) => e.text).filter(Boolean).join(' '))}`,
      `<span class="d ${v.k === 'best' || v.k === 'good' ? 'good' : v.k}">${v.k === 'none' ? '–' : pts(d)}</span>`);
    if (s.over) { setWp(s.won ? 1 : 0); return later(finish, 700); }
    if (s.per === 'SO') { setWp(s.soWin); return later(spot, 400); }
    G.pending.then((g) => { if (g) setWp(g[0].wp); });
    spot();
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
    const keys = !$('so').hidden ? [...$('so-moves').querySelectorAll('.key')] : [...$('c-keys').querySelectorAll('.key')];
    const n = Number(e.key);
    if (n >= 1 && n <= keys.length) { e.preventDefault(); if (!$('so').hidden) { if (!keys[n - 1].disabled && !$('so-moves').hidden) keys[n - 1].click(); } else commit(keys[n - 1].dataset.p); }
    else if ((e.key === 'p' || e.key === 'P') && $('c-toggles').querySelector('[data-k="goalie"]')) toggle('goalie');
    else if ((e.key === 't' || e.key === 'T') && $('c-toggles').querySelector('[data-k="timeout"]')) toggle('timeout');
  });

  window.EmptyNet = { state: () => G, refresh: () => { stage(G.s, true); G.pending = gradeAsync(G.s, 99); G.graded = null; spot(); } };   // for testing from the console
  $('foot-built').textContent = `${DATA.games.length} real endings · updated ${new Date(DATA.built).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`;
  showIntro(DAY);
})();
