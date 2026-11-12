// Empty Net: the page. Reads window.DRILL_DATA (real endings + daily schedule) and window.Drill (the model).
(function () {
  const D = window.Drill, DATA = window.DRILL_DATA;
  const $ = (id) => document.getElementById(id);
  const games = new Map(DATA.games.map((g) => [g.id, g]));
  const N = 3000;                     // simulated endings per graded call
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

  // ---------- grading off the main thread ----------
  let worker = null, jobId = 0;
  const jobs = new Map();
  try {
    const src = $('engine-src').textContent;
    const glue = '\nonmessage = (e) => { const { id, s, n, seed } = e.data; postMessage({ id, graded: Drill.grade(s, n, seed) }); };';
    worker = new Worker(URL.createObjectURL(new Blob([src, glue], { type: 'text/javascript' })));
    worker.onmessage = (e) => { const j = jobs.get(e.data.id); if (j) { jobs.delete(e.data.id); j(e.data.graded); } };
    worker.onerror = () => { worker = null; };
  } catch { worker = null; }
  function gradeAsync(s, seed) {
    const snap = D.clone(s);
    return new Promise((res) => {
      if (worker) {
        const id = ++jobId;
        jobs.set(id, res);
        try { worker.postMessage({ id, s: snap, n: N, seed }); } catch { jobs.delete(id); setTimeout(() => res(D.grade(snap, N, seed)), 0); return; }
        setTimeout(() => { if (jobs.has(id)) { jobs.delete(id); res(D.grade(snap, N, seed)); } }, 6000);
        return;
      }
      setTimeout(() => res(D.grade(snap, N, seed)), 30);
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
  const callLabel = (s, id) => { const c = (s.per === 'OT' && !s.playoff ? D.OT_CALLS : D.CALLS)[D.tableKey(s)].find((x) => x[0] === id); return c ? c[1] : id; };
  const describe = (s, c) => [c.goalie ? (s.pulled ? 'Goalie back in' : 'Pull the goalie') : null, c.timeout ? 'Timeout' : null, callLabel(s, c.play)].filter(Boolean).join(' + ');

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
    $('intro-note').textContent = `The real ${sc.you.name} bench lost this one. Read what they're showing, make the calls, and see if you can do better. A typical NHL bench scores 50.`;
    const rec = !practiceSc && load().days[day];
    $('intro-played').textContent = rec ? `You played this one: ${rec.score}/100, ${rec.won ? 'won' : 'lost'} ${rec.final}.` : '';
    $('btn-start').onclick = () => start(day, practiceSc);
  }

  // ---------- the rink ----------
  const ENT = ['G', 'C', 'W1', 'W2', 'D1', 'D2', 'X', 'oG', 'oC', 'oW', 'oW2', 'oD', 'oD2'];
  const pos = {};
  function buildRink(sc) {
    const L = sc.lineup || { you: {}, opp: {} };
    const info = {
      G: { num: '', n: G.names.G }, oG: { num: '', n: G.names.oG },
      C: L.you.C, W1: L.you.W1, W2: L.you.W2, D1: L.you.D1, D2: L.you.D2, X: L.you.X,
      oC: L.opp.C, oW: L.opp.W1, oW2: L.opp.W2, oD: L.opp.D1, oD2: L.opp.D2,
    };
    const g = $('players');
    g.innerHTML = '';
    for (const id of ENT) {
      const mine = !id.startsWith('o');
      const goalie = id === 'G' || id === 'oG';
      const p = info[id] || {};
      const el = document.createElementNS(SVGNS, 'g');
      el.setAttribute('class', `pl mover ${mine ? 'you' : 'opp'}${goalie ? ' goalie' : ''}`);
      el.id = `p-${id}`;
      el.innerHTML = `<circle r="${goalie ? 2.9 : 2.6}"/><text class="n">${goalie ? 'G' : esc(p.num ?? '')}</text><text class="l" y="${mine ? 5.2 : -3.8}">${esc(p.n || '')}</text>`;
      g.appendChild(el);
    }
  }
  function place(id, x, y) {
    pos[id] = [x, y];
    const el = id === 'puck' ? $('puck') : $(`p-${id}`);
    if (el) el.style.transform = `translate(${x}px, ${y}px)`;
  }
  function show(id, on) { const el = $(`p-${id}`); if (el) el.classList.toggle('off', !on); }
  const CAM = { O: 0, N: 44, D: 88 };
  function cam(k) { $('cam').style.transform = `translateY(${-CAM[k]}px)`; G.cam = k; }

  // where everyone stands for a spot, given what they are showing
  function formation(s) {
    const P = {}, L = s.look;
    let puck = [42.5, 100], c = 'N';
    const fo = (dx, dy, zone) => {
      P.C = [dx, dy + 3]; P.oC = [dx, dy - 3];
      P.W1 = [dx - 10, dy + 4]; P.W2 = [dx + 10, dy + 4];
      P.oW = L === 'cheat' ? [dx - 6, dy - 2] : [dx - 10, dy - 4]; P.oW2 = L === 'cheat' ? [dx + 6, dy - 2] : [dx + 10, dy - 4];
      if (zone === 'O') { P.D1 = [22, 64]; P.D2 = [62, 64]; P.oD = [26, 16]; P.oD2 = [58, 16]; P.X = [45, 50]; }
      else if (zone === 'D') { P.D1 = [26, 183]; P.D2 = [58, 183]; P.oD = [24, 134]; P.oD2 = [60, 134]; P.X = [45, 150]; }
      else { P.D1 = [30, 116]; P.D2 = [55, 116]; P.oD = [30, 84]; P.oD2 = [55, 84]; P.X = [42, 122]; }
      puck = [dx, dy];
    };
    if (s.phase === 'FO_O') { fo(20.5, 31, 'O'); c = 'O'; }
    else if (s.phase === 'FO_D') { fo(20.5, 169, 'D'); c = 'D'; }
    else if (s.phase === 'FO_N') { fo(42.5, 100, 'N'); c = 'N'; }
    else if (s.phase === 'ENTRY') {
      c = 'N';
      Object.assign(P, { D1: [32, 140], C: [42, 118], W1: [16, 112], W2: [69, 112], D2: [60, 142], X: [50, 128] });
      Object.assign(P, {
        trap: { oC: [42, 112], oW: [14, 92], oW2: [71, 92], oD: [42, 90], oD2: [42, 68] },
        high: { oC: [34, 129], oW: [56, 133], oW2: [70, 112], oD: [22, 98], oD2: [62, 98] },
        change: { oC: [80, 104], oW: [81, 94], oW2: [30, 88], oD: [30, 72], oD2: [56, 72] },
        gap: { oC: [28, 108], oW: [62, 108], oW2: [44, 96], oD: [30, 78], oD2: [56, 78] },
      }[L] || { oC: [42, 112], oW: [14, 92], oW2: [71, 92], oD: [42, 90], oD2: [42, 68] });
      puck = [P.D1[0] + 2, P.D1[1] - 2];
    } else if (s.phase === 'ZONE') {
      c = 'O';
      Object.assign(P, { D1: [16, 70], D2: [69, 70], C: [27, 30], W1: [64, 38], W2: [42, 22], X: [42, 56] });
      Object.assign(P, {
        box: { oD: [36, 22], oD2: [49, 22], oW: [34, 36], oW2: [51, 36], oC: [42, 29] },
        points: { oW: [20, 61], oW2: [65, 61], oD: [34, 24], oD2: [52, 24], oC: [36, 36] },
        door: { oD: [31, 24], oD2: [38, 31], oW: [28, 46], oW2: [50, 50], oC: [24, 38] },
        tired: { oD: [36, 24], oD2: [54, 27], oW: [28, 45], oW2: [58, 47], oC: [45, 36] },
        rebound: { oD: [35, 23], oD2: [51, 23], oW: [30, 42], oW2: [56, 44], oC: [42, 33] },
      }[L] || {});
      if (L === 'door') P.W1 = [67, 27];
      puck = [P.C[0] + 2, P.C[1] + 1];
    } else if (s.phase === 'THEIRS' && !s.deep) {
      c = 'N';
      Object.assign(P, { C: [42, 112], W1: [28, 96], W2: [58, 96], D1: [30, 134], D2: [56, 134], X: [42, 120] });
      Object.assign(P, {
        dump: { oC: [44, 97], oW: [79, 92], oW2: [80, 84], oD: [30, 78], oD2: [56, 76] },
        stretch: { oD: [40, 82], oD2: [62, 78], oC: [42, 98], oW: [16, 104], oW2: [72, 128] },
        slow: { oD: [40, 68], oD2: [62, 64], oC: [42, 86], oW: [16, 92], oW2: [70, 92] },
      }[L] || { oD: [40, 82], oD2: [62, 78], oC: [42, 98], oW: [16, 104], oW2: [70, 104] });
      puck = L === 'dump' ? [P.oC[0], P.oC[1] + 2] : [P.oD[0], P.oD[1] + 2];
    } else {
      c = 'D';
      Object.assign(P, { D1: [34, 178], D2: [52, 178], C: [42, 160], W1: [26, 142], W2: [60, 142], X: [42, 150] });
      Object.assign(P, {
        cycle: { oW: [10, 172], oC: [14, 186], oW2: [66, 165], oD: [22, 132], oD2: [63, 132] },
        shot: { oW: [14, 170], oC: [30, 180], oW2: [62, 166], oD: [24, 131], oD2: [62, 131] },
        screen: { oW: [12, 170], oC: [28, 176], oW2: [42, 183], oD: [22, 132], oD2: [63, 132] },
      }[L] || { oW: [12, 170], oC: [28, 176], oW2: [62, 166], oD: [22, 132], oD2: [63, 132] });
      puck = L === 'shot' ? [P.oD[0], P.oD[1] + 2] : L === 'cycle' ? [P.oC[0] + 1, P.oC[1]] : [P.oW[0] + 1, P.oW[1]];
    }
    P.oG = [42.5, 13];
    P.G = s.pulled ? [92, 100] : [42.5, 187];
    return { P, puck, c };
  }
  function stage(s, instant) {
    const f = formation(s);
    const sk = D.skaters(s);
    const is3 = s.per === 'OT' && !s.playoff;
    const onIce = {
      W2: !is3 && sk.you - (s.pulled ? 1 : 0) >= 5, D2: !is3 && sk.you - (s.pulled ? 1 : 0) >= 4, X: s.pulled,
      oW2: !is3 && sk.opp - (s.oppPulled ? 1 : 0) >= 5, oD2: !is3 && sk.opp - (s.oppPulled ? 1 : 0) >= 4, G: !s.pulled, oG: !s.oppPulled,
    };
    for (const id of ENT) {
      const el = $(`p-${id}`); if (!el) continue;
      if (instant) el.classList.add('fast');
      show(id, onIce[id] ?? true);
      const p = f.P[id] || pos[id] || [42.5, 100];
      place(id, p[0], p[1]);
    }
    place('puck', f.puck[0], f.puck[1]);
    cam(f.c);
    $('rink').classList.toggle('empty', s.pulled);
    $('rink-tag').textContent = tagFor(s);
    if (instant) requestAnimationFrame(() => document.querySelectorAll('.pl.fast').forEach((e) => e.classList.remove('fast')));
  }
  function tagFor(s) {
    const sk = D.skaters(s);
    const where = { FO_O: 'Faceoff, their end', FO_N: 'Faceoff, center ice', FO_D: 'Faceoff, your end', ENTRY: 'Your puck, coming up ice', ZONE: 'Your puck in their end', THEIRS: s.deep ? 'Their puck in your end' : 'Their puck, neutral zone' }[s.phase];
    const str = s.pulled ? `${sk.you} on ${sk.opp} · empty net` : s.pp > 0 ? `Power play ${fmt(s.pp)}` : s.pp < 0 ? `Penalty kill ${fmt(-s.pp)}` : `${sk.you} on ${sk.opp}`;
    return `${where} · ${str}`;
  }

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

  // ---------- a game ----------
  function start(day, practiceSc) {
    clearTimers();
    const sc = practiceSc || gameForDay(day);
    setTeams(sc);
    G = { day, practice: !!practiceSc, sc, s: D.newGame(sc), step: 0, sumD: 0, sumV: 0, calls: [], pick: { goalie: false, timeout: false }, names: null, cam: 'N' };
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
    $('c-look').textContent = title;
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
    keys.style.setProperty('--n', o.plays.length);
    keys.innerHTML = o.plays.map((p, i) => `<button type="button" class="key" data-p="${p.id}" disabled><span class="kn">${i + 1}</span><b>${esc(p.label)}</b><small>${esc(p.hint)}</small></button>`).join('');
    keys.querySelectorAll('.key').forEach((b) => b.onclick = () => commit(b.dataset.p));
    const firstGame = !load().tipped;
    $('c-tip').hidden = !(firstGame && G.step < 2);
    $('c-tip').textContent = G.step === 0 ? 'Read what they are showing, then make the call. Pulling the goalie and the timeout are optional.' : 'Tap the ice to skip a replay. Green means you read it right.';
    if (firstGame && G.step >= 1) { const st0 = load(); st0.tipped = true; save(st0); }
    G.accepting = true;
    G.pending.then((graded) => {
      if (!G || G.s !== s) return;
      G.graded = graded;
      if (graded[0].wp < 0.01 && s.per === 'REG') return outOfReach(false);
      if (graded[0].wp > 0.995) return outOfReach(true);
      keys.querySelectorAll('.key').forEach((b) => b.disabled = false);
      const r = keys.getBoundingClientRect();
      if (r.bottom > window.innerHeight) keys.scrollIntoView({ block: 'end', behavior: 'smooth' });
    });
  }
  // a game that is gone (under 1% with the best call) skips to the final horn instead of dragging on
  function outOfReach(won) {
    const s = G.s;
    const r = D.mulberry(D.hash(`${G.sc.id}:out:${G.step}`));
    const was = `${s.you}-${s.opp}, ${fmt(s.t)} left`;
    D.finish(s, r);
    if (!s.over) { const p = s.per === 'SO' ? s.soWin : 0.5; s.how = s.per === 'SO' ? 'SO' : 'OT'; s.over = true; s.won = r() < p; if (s.won) s.you++; else s.opp++; }
    feed(perLabel(s), won ? `<b>Game in hand</b>${esc(was)}: over 99.5% from here. Played out to the final horn.` : `<b>Out of reach</b>${esc(was)}: under 1% even with the best call. Played out to the final horn.`);
    const f = $('flash'); f.hidden = false; f.className = `flash ${won ? 'good' : 'info'}`; f.textContent = won ? 'Game in hand' : 'Out of reach';
    board();
    later(() => { f.hidden = true; finish(); }, 1600);
  }
  function toggle(k) {
    G.pick[k] = !G.pick[k];
    const b = $('c-toggles').querySelector(`[data-k="${k}"]`);
    if (b) b.setAttribute('aria-pressed', String(G.pick[k]));
  }

  function commit(play) {
    if (!G.accepting || !G.graded) return;
    G.accepting = false;
    const s = G.s;
    const c = { play, goalie: G.pick.goalie, timeout: G.pick.timeout };
    const graded = G.graded;
    const mine = graded.find((g) => D.key(g) === D.key(c)) || graded[graded.length - 1];
    const best = graded[0];
    const typ = D.typical(s, graded);
    const v = D.verdict(best.wp - mine.wp, best.wp);
    const d = mine.wp - typ.wp;
    if (v.k !== 'none') { G.sumD += d; G.sumV += typ.v; }
    const before = { t: s.t, per: perLabel(s), situ: $('rink-tag').textContent, look: D.lookInfo(s)[1], call: describe(s, c), best: describe(s, best), wp: best.wp, mine: mine.wp, loss: best.wp - mine.wp };
    // play it
    const events = [];
    const rng = D.mulberry(D.hash(`${G.sc.id}:${G.practice ? 'p' : G.day}:${G.step}`));
    const prev = D.clone(s);
    const say = (k, text, data) => events.push({ k, text: fill(text), raw: text, data: data || {} });
    D.resolve(s, c, rng, say);
    // overtime: each call covers a longer stretch; the next stretch plays itself out until a goal or the horn
    if (s.per === 'OT' && !s.over) {
      const budget = s.playoff ? 60 : 24, t0 = s.t, ot0 = s.otNum, auto = [];
      while (!s.over && s.per === 'OT' && s.otNum === ot0 && t0 - s.t < budget) {
        D.resolve(s, D.coach(s, rng), rng, (k, text, data) => auto.push({ k, text: fill(text), raw: text, data: data || {} }));
      }
      const big = auto.filter((e) => ['shot', 'against', 'eng', 'pp', 'pk', 'ot', 'so', 'stop'].includes(e.k) && (e.k !== 'shot' || e.data.res === 'goal' || e.data.res === 'save'));
      events.push({ k: 'play', text: `${t0 - s.t > 0 ? `The next ${t0 - s.t} seconds:` : ''} ${big.length ? '' : 'back and forth, no one breaks through.'}`.trim(), raw: '', data: {} });
      events.push(...big.slice(-3));
    }
    G.step++;
    G.pending = s.over || s.per === 'SO' ? Promise.resolve(null) : gradeAsync(s, G.step + 1 + G.day * 1000);
    G.calls.push({ ...before, v: v.k, d });
    $('c-keys').querySelectorAll('.key').forEach((b) => { b.disabled = true; if (b.dataset.p === play) b.classList.add('down'); });
    $('result').hidden = true;
    animate(prev, s, events, () => afterPlay(before, v, d, events));
  }

  // ---------- the play, on the ice ----------
  function animate(prev, s, events, done) {
    const steps = [];
    let puck = (pos.puck || [42.5, 100]).slice();
    const at = (id) => (pos[id] || [42.5, 100]).slice();
    const shooterOf = (raw, mineSide) => { const t = tokens(raw).find((k) => mineSide ? !k.startsWith('o') && k !== 'G' : k.startsWith('o') && k !== 'oG'); return t || (mineSide ? 'C' : 'oW'); };
    const push = (o) => steps.push(o);
    for (const e of events) {
      const k = e.k, d = e.data;
      if (k === 'timeout') push({ tick: e.text, flash: ['Timeout', 'info'], wait: 1000 });
      else if (k === 'pull') push({ tick: e.text, move: { G: [92, 100] }, showX: true, flash: ['Net empty', 'info'], wait: 1100 });
      else if (k === 'return') push({ tick: e.text, move: { G: [42.5, 187] }, wait: 600 });
      else if (k === 'fo') { const p = d.won ? at('C') : at('oC'); push({ tick: e.text, puck: [p[0] + (d.won ? -3 : 3), p[1] + (d.won ? 6 : -6)], wait: 650 }); }
      else if (k === 'shot') {
        const id = shooterOf(e.raw, true); const p = at(id);
        const fromEng = d.from === 'eng';
        const target = fromEng ? [42.5, 9] : d.res === 'goal' ? [42.5 + (Math.random() - 0.5) * 3, 9.5] : d.res === 'save' ? [42.5, 14.5] : d.res === 'block' ? [(p[0] + 42.5) / 2, (p[1] + 18) / 2] : [p[0] < 42 ? 49 : 36, 6];
        push({ puck: [p[0] + 1, p[1] - 1.5], hl: id, cam: p[1] < 125 ? 'O' : null, wait: 300 });
        push({ tick: e.text, puck: target, fast: true, flash: d.res === 'goal' ? ['Goal!', 'good'] : null, wait: d.res === 'goal' ? 1700 : 900 });
      } else if (k === 'against' || k === 'stop') {
        const id = shooterOf(e.raw, false); const p = at(id);
        push({ puck: [p[0], p[1] + 1.5], hl: id, cam: 'D', wait: 450 });
        push({ tick: e.text, puck: k === 'against' ? [42.5, 190.5] : [42.5, 185.5], fast: true, flash: k === 'against' ? ['Goal against', 'bad'] : null, wait: k === 'against' ? 1700 : 900 });
      } else if (k === 'eng') {
        push({ tick: e.text, cam: 'D', puck: [42.5, 191], flash: d.res === 'goal' ? ['Empty net', 'bad'] : null, wait: 1800 });
      } else if (k === 'icing') push({ tick: e.text, cam: 'D', puck: [28, 196], flash: ['Icing', 'info'], wait: 1300 });
      else if (k === 'pass') {
        const tk = tokens(e.raw); const to = d.ok ? tk.filter((t) => !t.startsWith('o')).pop() : (tk.find((t) => t.startsWith('o')) || 'oD');
        const p = at(to || 'W1');
        const mv = {};
        if (d.ok && d.type === 'stretch') { mv[to] = [p[0], Math.max(60, p[1] - 30)]; }
        push({ tick: e.text, puck: d.ok && d.type === 'stretch' ? mv[to] : [p[0], p[1]], move: mv, cam: d.ok && d.type === 'stretch' ? 'O' : null, fast: true, hl: to, wait: 800 });
      } else if (k === 'entry') {
        if (d.ok) push({ tick: e.text, cam: 'O', move: { C: [30, 58], W1: [16, 50], W2: [66, 52], D1: [24, 82], D2: [58, 84], X: [44, 70] }, puck: d.type === 'dump' ? [70, 8] : [30, 55], wait: 1000 });
        else { const p = at('oD'); push({ tick: e.text, puck: [p[0], p[1] + 2], wait: 900 }); }
      } else if (k === 'keep') push({ tick: e.text, cam: 'O', puck: [66, 72], wait: 750 });
      else if (k === 'clear') push({ tick: e.text, cam: 'N', puck: [44, 128], wait: 850 });
      else if (k === 'take') { const t = tokens(e.raw).find((x) => !x.startsWith('o')) || 'C'; const p = at(t); push({ tick: e.text, puck: [p[0] + 1, p[1] - 1], hl: t, wait: 800 }); }
      else if (k === 'turn' || k === 'beat') { const t = tokens(e.raw).find((x) => x.startsWith('o')) || 'oW'; const p = at(t); push({ tick: e.text, puck: [p[0], p[1] + 1.5], hl: t, wait: 850 }); }
      else if (k === 'dumpin') push({ tick: e.text, cam: 'D', puck: [12, 194], wait: 900 });
      else if (k === 'zone') push({ tick: e.text, cam: 'D', puck: [18, 160], wait: 800 });
      else if (k === 'change') push({ tick: e.text, fade: true, wait: 900 });
      else if (k === 'pp') push({ tick: e.text, flash: ['Power play', 'info'], wait: 1300 });
      else if (k === 'pk') push({ tick: e.text, flash: ['Penalty kill', 'info'], wait: 1300 });
      else if (k === 'ot') push({ tick: e.text, flash: ['Overtime', 'info'], wait: 1500 });
      else if (k === 'so') push({ tick: e.text, flash: ['Shootout', 'info'], wait: 1500 });
      else if (k === 'end') push({ tick: e.text, flash: ['Final', 'info'], wait: 1200 });
      else push({ tick: e.text, wait: 700 });
    }
    void puck;
    G.animating = true;
    $('rink-box').classList.add('playing');
    let i = 0;
    const finishAnim = () => {
      clearTimers();
      G.animating = false;
      $('flash').hidden = true; $('ticker').hidden = true;
      document.querySelectorAll('.pl.hl').forEach((e) => e.classList.remove('hl'));
      document.querySelectorAll('.pl').forEach((e) => { e.style.opacity = ''; });
      if (!s.over && s.per !== 'SO') stage(s, false);
      board();
      done();
    };
    G.skip = finishAnim;
    const run = () => {
      if (i >= steps.length) { later(finishAnim, 250); return; }
      const st = steps[i++];
      document.querySelectorAll('.pl.hl').forEach((e) => e.classList.remove('hl'));
      if (st.cam) cam(st.cam);
      if (st.move) for (const [id, p] of Object.entries(st.move)) place(id, p[0], p[1]);
      if (st.showX) show('X', true);
      if (st.hl) $(`p-${st.hl}`)?.classList.add('hl');
      if (st.puck) { $('puck').classList.toggle('fast', !!st.fast); place('puck', st.puck[0], st.puck[1]); }
      if (st.fade) { document.querySelectorAll('.pl.you:not(.goalie)').forEach((e) => { e.style.opacity = '0.25'; }); later(() => document.querySelectorAll('.pl.you').forEach((e) => { e.style.opacity = ''; }), 500); }
      if (st.tick) { $('ticker').hidden = false; $('ticker').textContent = st.tick; }
      if (st.flash) { const f = $('flash'); f.hidden = false; f.className = `flash ${st.flash[1]}`; f.textContent = st.flash[0]; later(() => { f.hidden = true; }, Math.min(st.wait, 1500)); }
      board();
      later(run, st.wait);
    };
    run();
  }

  const BIG = (events) => {
    const has = (k, f = () => true) => events.find((e) => e.k === k && f(e));
    if (has('shot', (e) => e.data.res === 'goal')) return ['Goal!', 'good'];
    if (has('eng', (e) => e.data.res === 'goal')) return ['Empty-net goal against', 'bad'];
    if (has('against')) return ['Goal against', 'bad'];
    if (has('pp')) return ['Power play', ''];
    if (has('pk')) return ['Penalty kill', ''];
    if (has('icing')) return ['Icing', ''];
    const shots = events.filter((e) => e.k === 'shot');
    if (shots.length) return [{ save: 'Save', block: 'Blocked', wide: 'Wide' }[shots[shots.length - 1].data.res] || 'Shot', ''];
    if (has('stop')) return [`Big save, ${G.names.G}`, ''];
    const lastE = [...events].reverse().find((e) => !['fo', 'timeout', 'pull', 'return', 'play'].includes(e.k)) || events[events.length - 1];
    if (!lastE) return ['', ''];
    if (lastE.k === 'play' || lastE.k === 'change') { const sent = lastE.text.split(/(?<=\.)\s+/).filter(Boolean); const tail = sent[sent.length - 1].replace(/\.$/, ''); if (tail.length <= 28) return [tail, '']; }
    const m = { keep: 'Still in their end', clear: 'Cleared', take: 'Puck won', turn: 'Turnover', beat: 'Beaten', dumpin: 'Dumped in', zone: 'They get in', change: 'Fresh legs', entry: lastE.data.ok ? 'In the zone' : 'Turned over', pass: lastE.data.ok ? 'On the tape' : 'Picked off', fo: lastE.data.won ? 'Won the draw' : 'Lost the draw' };
    return [m[lastE.k] || 'Play on', ''];
  };

  function afterPlay(before, v, d, events) {
    const s = G.s;
    const [big] = BIG(events);
    $('r-big').textContent = big;
    const lines = events.filter((e) => !['timeout', 'return'].includes(e.k)).slice(-2).map((e) => e.text);
    $('r-line').textContent = lines.join(' ');
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
    feed(`${before.per === '3RD' ? '' : before.per + ' '}${fmt(before.t)}`, `<b>${esc(before.call)}</b>${esc(before.look)}. ${esc(events.map((e) => e.text).join(' '))}`,
      `<span class="d ${v.k === 'best' || v.k === 'good' ? 'good' : v.k}">${v.k === 'none' ? '–' : pts(d)}</span>`);
    if (s.over) { setWp(s.won ? 1 : 0); return later(finish, 900); }
    if (s.per === 'SO') { setWp(s.soWin); return later(spot, 600); }
    G.pending.then((g) => { if (g) setWp(g[0].wp); });
    spot();
  }

  // ---------- shootout ----------
  function shootout() {
    const { sc } = G;
    if (!G.so) {
      const so = D.shootout(sc);
      G.so = { so, st: { round: 0, you: 0, opp: 0, used: [] }, shots: { you: [], opp: [] }, youFirst: so.youFirst };
      feed('SO', `<b>Shootout</b>${esc(sc.you.home ? `${sc.you.name} (home) shoot first.` : `${sc.opp.name} (home) shoot first.`)}`);
    }
    $('call').hidden = true; $('so').hidden = false;
    for (const id of ENT) show(id, id === 'oG' || id === 'G' || id === 'C');
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
  function oppShot(next) {
    const g = G.so, r = g.shots.opp.length;
    const sh = g.so.theirs[r % g.so.theirs.length];
    const goal = D.mulberry(D.hash(`${G.sc.id}:so-opp:${r}`))() < sh.p;
    g.shots.opp.push(goal);
    cam('D'); place('oC', 42.5, 140); show('oC', true); place('puck', 42.5, 142);
    $('ticker').hidden = false; $('ticker').textContent = `${last(sh.n) || sh.n} skates in on ${G.names.G}…`;
    later(() => {
      place('puck', goal ? 42.5 : 44, goal ? 190.5 : 185.5);
      $('ticker').textContent = goal ? `${sh.n} scores.` : `${G.names.G} stops ${last(sh.n) || sh.n}.`;
      const f = $('flash'); f.hidden = false; f.className = `flash ${goal ? 'bad' : 'good'}`; f.textContent = goal ? 'Scores' : 'Save!';
      feed('SO', `<b>${esc(G.sc.opp.ab)}: ${esc(sh.n)}</b>${goal ? 'Scores.' : 'Stopped.'}`);
      later(() => { f.hidden = true; $('ticker').hidden = true; soScore(); next(); }, 1300);
    }, 900);
  }
  function soRound() {
    const g = G.so;
    soScore();
    const done = soDecided();
    if (done) return soEnd(done);
    const theirTurn = g.youFirst ? g.shots.opp.length < g.shots.you.length : g.shots.opp.length <= g.shots.you.length;
    if (theirTurn) { $('so-shooters').innerHTML = ''; $('so-moves').hidden = true; $('so-step').textContent = 'Their shooter'; return oppShot(soRound); }
    const st = { round: g.shots.you.length, you: g.shots.you.filter(Boolean).length, opp: g.shots.opp.filter(Boolean).length, used: g.st.used };
    g.st = st;
    const so = g.so, goalie = G.sc.roster.oppG;
    const order = so.gm.map((v, m) => [v, m]).sort((a, b) => b[0] - a[0]);
    const sv = goalie && goalie.s ? `${((goalie.sv / goalie.s) * 100).toFixed(1)}% career shootout save rate (${goalie.sv} of ${goalie.s})` : 'Little shootout history';
    $('so-scout').innerHTML = `<span class="read-k">In net: ${esc(goalie?.n || 'their goalie')}</span><b>Beaten most: ${esc(D.MOVES[order[0][1]][1].toLowerCase())}</b><span>${esc(sv)}. Hardest to beat: ${esc(D.MOVES[order[3][1]][1].toLowerCase())}.</span>`;
    $('so-sub').textContent = st.round < 3 ? `Round ${st.round + 1} of 3` : `Sudden death, round ${st.round + 1}`;
    $('so-step').textContent = 'Pick your shooter';
    $('so-moves').hidden = true;
    cam('O'); place('oG', 42.5, 13); place('C', 42.5, 70); place('puck', 42.5, 67); show('C', true);
    $('so-shooters').innerHTML = so.shooters.map((p, i) => {
      const used = st.used.includes(i);
      const pct = p.s ? `${p.g} for ${p.s} career (${Math.round((100 * p.g) / p.s)}%)` : 'No shootout history';
      return `<button type="button" class="shooter" data-i="${i}" ${used ? 'disabled' : ''} aria-pressed="false"><b>${p.num ? `#${p.num} ` : ''}${esc(p.n)}</b><span>${pct}</span><em>Favorite: ${esc(D.MOVES[p.sig][1].toLowerCase())}</em></button>`;
    }).join('');
    $('so-shooters').querySelectorAll('.shooter').forEach((b) => b.onclick = () => {
      $('so-shooters').querySelectorAll('.shooter').forEach((x) => x.setAttribute('aria-pressed', 'false'));
      b.setAttribute('aria-pressed', 'true');
      const p = so.shooters[+b.dataset.i];
      const el = $('p-C'); el.querySelector('.n').textContent = p.num ?? ''; el.querySelector('.l').textContent = last(p.n) || p.n;
      $('so-step').textContent = 'Pick the move';
      const mv = $('so-moves'); mv.hidden = false; mv.className = 'keys';
      mv.innerHTML = D.MOVES.map(([, label], m) => `<button type="button" class="key" data-m="${m}"><span class="kn">${m + 1}</span><b>${esc(label)}</b></button>`).join('');
      mv.querySelectorAll('.key').forEach((k) => k.onclick = () => soShoot(+b.dataset.i, +k.dataset.m));
    });
  }
  function soShoot(i, m) {
    const g = G.so, so = g.so;
    $('so-moves').querySelectorAll('.key').forEach((k) => k.disabled = true);
    $('so-shooters').querySelectorAll('.shooter').forEach((k) => k.disabled = true);
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
    const sh = so.shooters[i];
    $('ticker').hidden = false; $('ticker').textContent = `${sh.n} skates in on ${G.names.oG}…`;
    place('C', 42.5, 30); place('puck', 42.5, 27);
    later(() => {
      const tgt = { glove: [46.5, 9.5], blocker: [38.5, 10], five: [42.5, 10], deke: [40, 9.5] }[D.MOVES[m][0]];
      place('puck', goal ? tgt[0] : 42.5, goal ? tgt[1] : 14.5);
      if (D.MOVES[m][0] === 'deke') place('oG', 45, 13);
      const f = $('flash'); f.hidden = false; f.className = `flash ${goal ? 'good' : 'bad'}`; f.textContent = goal ? 'Scores!' : 'Saved';
      $('ticker').textContent = goal ? `${sh.n} scores, ${D.MOVES[m][1].toLowerCase()}.` : `${G.names.oG} stops ${sh.n}.`;
      $('r-big').textContent = goal ? 'Scores!' : 'Saved';
      $('r-line').textContent = `${sh.n}: ${D.MOVES[m][1].toLowerCase()}.`;
      $('r-wp').textContent = `Shooter's chance on that move: ${Math.round(mine.p * 100)}%`;
      const ptsEl = $('r-pts'); ptsEl.className = `pts num ${v.k === 'best' || v.k === 'good' ? 'good' : v.k}`; ptsEl.textContent = pts(d);
      const vt = $('r-verdict'); vt.className = `verdict ${v.k}`;
      vt.innerHTML = v.k === 'best' || v.k === 'good' ? '<span>Your pick: <b>the best one.</b></span>' : `<span>Your pick: <b>${v.k === 'bad' ? 'costly' : 'decent'}.</b> ${esc(so.shooters[best.i].n)}, ${esc(D.MOVES[best.m][1].toLowerCase())} was the pick.</span>`;
      $('result').hidden = false;
      feed('SO', `<b>${esc(sh.n)}: ${esc(D.MOVES[m][1].toLowerCase())}</b>${goal ? 'Scores.' : 'Stopped.'}`, `<span class="d ${v.k === 'best' || v.k === 'good' ? 'good' : v.k}">${pts(d)}</span>`);
      later(() => { f.hidden = true; $('ticker').hidden = true; place('oG', 42.5, 13); soRound(); }, 1500);
    }, 900);
  }
  function soEnd(who) {
    const s = G.s;
    if (who === 'you') s.you += 1; else s.opp += 1;
    s.over = true; s.won = who === 'you'; s.how = 'SO';
    board();
    finish();
  }

  // ---------- the end ----------
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
    const { s, sc } = G;
    clearTimers();
    $('call').hidden = true; $('so').hidden = true;
    const graded = G.calls.filter((c) => c.v !== 'none').length;
    const z = G.sumD / Math.sqrt(G.sumV + Math.max(1, graded) * 0.005 ** 2);
    const score = Math.max(1, Math.min(99, Math.round(100 * D.phi(z))));
    const how = s.how === 'SO' ? ' in a shootout' : s.how === 'OT' ? (s.playoff && s.otNum > 1 ? ` in ${s.otNum}OT` : ' in overtime') : '';
    const final = `${s.you}-${s.opp}${how}`;
    const st = load();
    if (!G.practice && !st.days[G.day]) { st.days[G.day] = { score, won: s.won, final, squares: G.calls.map((c) => c.v).join(',') }; save(st); }
    if (G.practice) { st.practice = (st.practice || 0) + 1; save(st); }
    later(() => showEnd(score, final), 700);
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
    $('call').hidden = true; $('so').hidden = true;
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
    $('arch-list').innerHTML = rows.join('');
    $('arch-list').querySelectorAll('button').forEach((b) => b.onclick = () => showIntro(+b.dataset.d));
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
  $('rink-box').addEventListener('click', () => { if (G && G.animating && G.skip) G.skip(); });
  document.addEventListener('keydown', (e) => {
    if (e.target.closest && e.target.closest('input, textarea')) return;
    if (!G || $('game').hidden) return;
    if ((e.key === ' ' || e.key === 'Enter') && G.animating) { e.preventDefault(); G.skip && G.skip(); return; }
    const keys = !$('so').hidden ? [...$('so-moves').querySelectorAll('.key')] : [...$('c-keys').querySelectorAll('.key')];
    const n = Number(e.key);
    if (n >= 1 && n <= keys.length && !keys[n - 1].disabled) { e.preventDefault(); keys[n - 1].click(); }
    else if ((e.key === 'p' || e.key === 'P') && $('c-toggles').querySelector('[data-k="goalie"]')) toggle('goalie');
    else if ((e.key === 't' || e.key === 'T') && $('c-toggles').querySelector('[data-k="timeout"]')) toggle('timeout');
  });

  window.EmptyNet = { state: () => G, refresh: () => { stage(G.s, true); G.pending = gradeAsync(G.s, 99); spot(); } };   // for testing from the console
  $('foot-built').textContent = `${DATA.games.length} real endings · updated ${new Date(DATA.built).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`;
  showIntro(DAY);
})();
