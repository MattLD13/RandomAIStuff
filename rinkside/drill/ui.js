// Empty Net: the page. Reads window.DRILL_DATA (real endings + daily schedule) and window.Drill (the model).
(function () {
  const D = window.Drill, DATA = window.DRILL_DATA;
  const $ = (id) => document.getElementById(id);
  const games = new Map(DATA.games.map((g) => [g.id, g]));
  const N = 3000;                               // simulated endings per graded call
  const STORE = 'emptynet:v1';

  // ---------- day number ----------
  const launch = new Date(DATA.launch + 'T00:00:00');
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const DAY = Math.max(1, Math.round((today - launch) / 864e5) + 1);
  const gameForDay = (d) => games.get(DATA.schedule[(d - 1) % DATA.schedule.length]) || DATA.games[(d - 1) % DATA.games.length];

  // ---------- storage (optional) ----------
  const load = () => { try { return JSON.parse(localStorage.getItem(STORE)) || { days: {} }; } catch { return { days: {} }; } };
  const save = (st) => { try { localStorage.setItem(STORE, JSON.stringify(st)); } catch {} };

  // ---------- helpers ----------
  const fmt = D.fmt;
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const ink = (hex) => {
    const n = parseInt(hex.slice(1), 16), r = n >> 16, g = (n >> 8) & 255, b = n & 255;
    return (0.299 * r + 0.587 * g + 0.114 * b) > 160 ? '#0a0e13' : '#ffffff';
  };
  const OLD = { ATL: 'WPG', PHX: 'UTA', ARI: 'UTA' };
  const color = (ab, i = 0) => (DATA.colors[ab] || DATA.colors[OLD[ab]] || ['#4b5866', '#8d9cab'])[i];
  const dateStr = (iso) => new Date(iso + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  const perLabel = (s) => s.per === 'REG' ? '3RD' : s.per === 'SO' ? 'SO' : s.playoff ? (s.otNum > 1 ? `${s.otNum}OT` : 'OT') : 'OT';
  const PHASE = {
    FO_O: ['Faceoff in their end', 'Their zone, their dot. A clean win means a look at the net.'],
    FO_N: ['Faceoff at center ice', 'Neutral zone draw.'],
    FO_D: ['Faceoff in your end', 'Win it and get out. Lose it and hang on.'],
    PUCK_N: ['Your puck, coming up ice', 'You have it in the neutral zone. How do you get in?'],
    PUCK_O: ['You have it in their zone', 'Possession in the offensive zone. What is the play?'],
    OPP_N: ['Their puck at center', 'They are trying to get it deep and kill time.'],
    DEF: ['They have it in your end', 'Defend, or go win it back.'],
  };
  const PUCK = { FO_O: [169, 22], FO_N: [100, 43], FO_D: [31, 64], PUCK_N: [88, 52], PUCK_O: [160, 34], OPP_N: [110, 30], DEF: [42, 40] };

  // ---------- game state ----------
  let G = null;   // { day, sc, s, step, log, wp, pulls, graded, so }

  function setTeams(sc) {
    const root = document.documentElement.style;
    const y = color(sc.you.ab), o = color(sc.opp.ab);
    root.setProperty('--you', y); root.setProperty('--you-ink', ink(y));
    root.setProperty('--opp', o); root.setProperty('--opp-ink', ink(o));
  }

  function showIntro(day) {
    const sc = gameForDay(day);
    setTeams(sc);
    hideAll();
    $('intro').hidden = false;
    $('dayline').textContent = `#${day} · ${day === DAY ? 'Today' : 'Archive'} · ${today.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}`;
    if (day !== DAY) $('dayline').textContent = `#${day} · from the archive`;
    $('intro-tag').textContent = `${sc.label} · ${dateStr(sc.date)}`;
    const venue = sc.you.home ? `${sc.opp.name} at ${sc.you.name}` : `${sc.you.name} at ${sc.opp.name}`;
    $('intro-title').textContent = venue;
    const zone = { O: 'faceoff in their end', D: 'faceoff in your end', N: 'faceoff at center' }[sc.start.zone];
    $('intro-sit').textContent = `You coach the ${sc.you.name}. Down ${sc.start.you}-${sc.start.opp}, ${fmt(sc.start.t)} left in the third, ${zone}.`;
    const rec = load().days[day];
    $('intro-played').textContent = rec ? `You played this one: ${rec.won ? 'won' : 'lost'} ${rec.score}.` : '';
    $('btn-start').onclick = () => start(day);
  }

  function hideAll() { for (const id of ['intro', 'game', 'end', 'how', 'archive']) $(id).hidden = true; }

  function start(day) {
    const sc = gameForDay(day);
    setTeams(sc);
    G = { day, sc, s: D.newGame(sc), step: 0, log: [], wp: [], loss: 0, grades: [], so: null };
    hideAll();
    $('game').hidden = false;
    $('feed').innerHTML = '';
    $('so').hidden = true; $('decide').hidden = false;
    event(`${fmt(sc.start.t)}`, 'Puck drop', `${sc.label}. Down ${sc.start.you}-${sc.start.opp}. Your bench.`);
    render();
    spot();
  }

  // ---------- rendering ----------
  function render() {
    const { s, sc } = G;
    $('sb-you').querySelector('.ab').textContent = sc.you.ab;
    $('sb-you').querySelector('.sc').textContent = s.you;
    $('sb-opp').querySelector('.ab').textContent = sc.opp.ab;
    $('sb-opp').querySelector('.sc').textContent = s.opp;
    $('sb-clock').textContent = s.per === 'SO' ? '0:00' : fmt(s.t);
    $('sb-per').textContent = perLabel(s);
    const sk = D.skaters(s);
    const chips = [];
    if (s.per !== 'SO') {
      chips.push(`<span class="chip${s.pulled ? ' hot' : ''}">${sk.you} on ${sk.opp}${s.pulled ? ' · empty net' : ''}</span>`);
      if (s.pp > 0) chips.push(`<span class="chip pp">Power play ${fmt(s.pp)}</span>`);
      if (s.pp < 0) chips.push(`<span class="chip hot">Penalty kill ${fmt(-s.pp)}</span>`);
      if (s.oppPulled) chips.push('<span class="chip">Their net is empty</span>');
      if (s.per === 'REG') chips.push(`<span class="chip">Timeout ${s.to ? 'left' : 'used'}</span>`);
      chips.push(`<span class="chip">Legs<span class="meter"><i style="width:${Math.round(s.legs * 100)}%"></i></span></span>`);
    }
    $('chips').innerHTML = chips.join('');
    $('g-you').classList.toggle('out', s.pulled);
    $('rink').classList.toggle('empty-net', s.pulled);
    const [x, y] = PUCK[s.phase] || PUCK.FO_N;
    $('puck').setAttribute('transform', `translate(${x} ${y})`);
    $('puck').style.transform = `translate(${x}px, ${y}px)`;
    $('puck').removeAttribute('transform');
    spark();
  }

  function spark() {
    const pts = G.wp;
    const el = $('wp-spark');
    const now = pts.length ? pts[pts.length - 1] : null;
    $('wp-num').textContent = now == null ? '--' : `${(now * 100).toFixed(1)}%`;
    if (pts.length < 2) { el.innerHTML = '<line x1="0" y1="35" x2="200" y2="35" class="base"/>'; return; }
    const max = Math.max(0.3, ...pts);
    const xy = pts.map((v, i) => [(i / (pts.length - 1)) * 200, 34 - (v / max) * 32]);
    const d = xy.map(([a, b], i) => `${i ? 'L' : 'M'}${a.toFixed(1)} ${b.toFixed(1)}`).join('');
    el.innerHTML = `<line x1="0" y1="35" x2="200" y2="35" class="base"/><path class="ar" d="${d}L200 35L0 35Z"/><path class="ln" d="${d}"/>`;
  }

  function event(t, title, text, cls = 'ev') {
    const li = document.createElement('li');
    li.className = cls;
    li.innerHTML = `<span class="t">${esc(t)}</span><div class="what"><div class="call">${esc(title)}</div>${text ? `<p class="lines">${text}</p>` : ''}</div>`;
    $('feed').prepend(li);
  }

  // ---------- one decision ----------
  function spot() {
    const s = G.s;
    render();
    if (s.over) return finish();
    if (s.per === 'SO') return shootout();
    const o = D.options(s);
    const [title, sub] = PHASE[s.phase];
    $('d-title').textContent = title;
    $('d-sub').textContent = sub;
    const pick = { goalie: false, timeout: false };
    const tog = [];
    if (o.canPull) tog.push(['goalie', 'Pull the goalie', s.phase.startsWith('FO_') ? 'Six attackers for the draw.' : 'On the fly, while you have it.']);
    if (o.canReturn) tog.push(['goalie', 'Goalie back in', 'For this faceoff.']);
    if (o.canTimeout) tog.push(['timeout', 'Call your timeout', 'Top unit gets its legs back.']);
    $('d-toggles').innerHTML = tog.map(([k, l, h]) => `<button type="button" class="tog" data-k="${k}" aria-pressed="false"><span class="sw"></span><span>${esc(l)}<small>${esc(h)}</small></span></button>`).join('');
    $('d-toggles').querySelectorAll('.tog').forEach((b) => b.onclick = () => {
      const k = b.dataset.k; pick[k] = !pick[k]; b.setAttribute('aria-pressed', String(pick[k]));
    });
    $('d-plays').innerHTML = o.plays.map((p) => `<button type="button" class="play" data-p="${p.id}" disabled><b>${esc(p.label)}</b><span>${esc(p.hint)}</span></button>`).join('');
    $('d-thinking').hidden = false;
    // grade every possible call before the choice, off the main paint
    setTimeout(() => {
      G.graded = D.grade(s, N, G.step + 1 + G.day * 1000);
      if (G.wp.length === 0 || G.wp[G.wp.length - 1] !== G.graded[0].wp) G.wp.push(G.graded[0].wp);
      spark();
      $('d-thinking').hidden = true;
      $('d-plays').querySelectorAll('.play').forEach((b) => { b.disabled = false; b.onclick = () => commit({ play: b.dataset.p, goalie: pick.goalie, timeout: pick.timeout }); });
    }, 30);
  }

  const playLabel = (s, id) => (s.per === 'OT' && !s.playoff ? D.OT_PLAYS : D.PLAYS)[s.phase].find((p) => p[0] === id)[1];
  function describe(s, c) {
    const bits = [];
    if (c.goalie) bits.push(s.pulled ? 'Goalie back in' : 'Pull the goalie');
    if (c.timeout) bits.push('Timeout');
    bits.push(playLabel(s, c.play));
    return bits.join(' + ');
  }

  function commit(c) {
    const s = G.s;
    $('d-plays').querySelectorAll('.play').forEach((b) => b.disabled = true);
    const graded = G.graded;
    const mine = graded.find((g) => D.key(g) === D.key(c)) || graded[graded.length - 1];
    const best = graded[0];
    const loss = Math.max(0, best.wp - mine.wp);
    const letter = D.letter(loss, best.wp);
    const before = { t: s.t, per: perLabel(s), callText: describe(s, c), bestText: describe(s, best) };
    const lines = [];
    const rng = D.mulberry(D.hash(`${G.sc.id}:${G.step}`));
    D.resolve(s, c, rng, (kind, text) => lines.push(`<span class="k-${kind}">${esc(text)}</span>`));
    G.step++;
    G.loss += loss;
    if (letter !== '–') G.grades.push(letter);
    const li = document.createElement('li');
    li.innerHTML = `<span class="t">${before.per === '3RD' ? '' : before.per + ' '}${fmt(before.t)}</span>
      <div class="what"><div class="call">${esc(before.callText)}</div><p class="lines">${lines.join(' ')}</p>
      ${letter === 'A' ? '' : `<p class="best">Best call: ${esc(before.bestText)} (${(100 * best.wp).toFixed(1)}% vs ${(100 * mine.wp).toFixed(1)}%)</p>`}</div>
      <span class="grade ${letter === '–' ? 'X' : letter}" title="Win chance given up: ${(loss * 100).toFixed(1)} pts">${letter}</span>`;
    $('feed').prepend(li);
    spot();
  }

  // ---------- shootout ----------
  function shootout() {
    const { sc } = G;
    if (!G.so) {
      const so = D.shootout(sc);
      G.so = { so, st: { round: 0, you: 0, opp: 0, used: [] }, shots: { you: [], opp: [] }, youFirst: so.youFirst, pick: null };
      event('SO', 'Shootout', `${sc.you.home ? `${sc.you.name} (home) shoot first.` : `${sc.opp.name} (home) shoot first.`} Pick a shooter and a move each round.`);
      G.wp.push(so.win);
    }
    $('decide').hidden = true;
    $('so').hidden = false;
    soRound();
  }

  function soDecided() {
    const { shots } = G.so;
    const y = shots.you.filter(Boolean).length, o = shots.opp.filter(Boolean).length;
    const ny = shots.you.length, no = shots.opp.length;
    if (ny <= 3 && no <= 3) {
      if (y > o + (3 - no)) return 'you';
      if (o > y + (3 - ny)) return 'opp';
      if (ny === 3 && no === 3 && y !== o) return y > o ? 'you' : 'opp';
      return null;
    }
    if (ny === no && y !== o) return y > o ? 'you' : 'opp';
    return null;
  }

  function oppShoots() {
    const g = G.so, r = g.shots.opp.length;
    const sh = g.so.theirs[r % g.so.theirs.length];
    const rng = D.mulberry(D.hash(`${G.sc.id}:so-opp:${r}`));
    const goal = rng() < sh.p;
    g.shots.opp.push(goal);
    const goalie = G.sc.roster.youG?.n || 'your goalie';
    event('SO', `${G.sc.opp.ab}: ${sh.n}`, goal ? `<span class="k-against">Scores on ${esc(goalie)}.</span>` : `<span class="k-goal">Stopped by ${esc(goalie)}.</span>`);
  }

  function soRound() {
    const g = G.so;
    // their turn first if they shoot first this round
    while (!soDecided() && (g.youFirst ? g.shots.opp.length < g.shots.you.length : g.shots.opp.length <= g.shots.you.length)) oppShoots();
    soScore();
    const done = soDecided();
    if (done) return soEnd(done);
    const st = { round: g.shots.you.length, you: g.shots.you.filter(Boolean).length, opp: g.shots.opp.filter(Boolean).length, used: g.st.used };
    g.st = st;
    const so = g.so;
    const goalie = G.sc.roster.oppG;
    const order = so.gm.map((v, m) => [v, m]).sort((a, b) => b[0] - a[0]);
    const svPct = goalie && goalie.s ? `${((goalie.sv / goalie.s) * 100).toFixed(1)}% career shootout save rate (${goalie.sv}/${goalie.s})` : 'little shootout history';
    $('so-scout').innerHTML = `<b>In net: ${esc(goalie?.n || 'their goalie')}</b>${svPct}. Scouting: beaten most often <b style="display:inline;font-size:inherit">${D.MOVES[order[0][1]][1].toLowerCase()}</b>; hardest to beat <b style="display:inline;font-size:inherit">${D.MOVES[order[3][1]][1].toLowerCase()}</b>.`;
    $('so-sub').textContent = st.round < 3 ? `Round ${st.round + 1} of 3` : `Sudden death, round ${st.round + 1}`;
    $('so-step').textContent = 'Pick your shooter';
    $('so-moves').hidden = true;
    $('so-shooters').innerHTML = so.shooters.map((p, i) => {
      const used = st.used.includes(i);
      const pct = p.s ? `${p.g}/${p.s} career (${Math.round((100 * p.g) / p.s)}%)` : 'no shootout history';
      return `<button type="button" class="shooter" data-i="${i}" ${used ? 'disabled' : ''} aria-pressed="false"><b>${p.num ? `#${p.num} ` : ''}${esc(p.n)}</b><span>${pct}</span><em>Favorite: ${D.MOVES[p.sig][1].toLowerCase()}</em></button>`;
    }).join('');
    $('so-shooters').querySelectorAll('.shooter').forEach((b) => b.onclick = () => {
      $('so-shooters').querySelectorAll('.shooter').forEach((x) => x.setAttribute('aria-pressed', 'false'));
      b.setAttribute('aria-pressed', 'true');
      soMoves(+b.dataset.i);
    });
  }

  function soMoves(i) {
    $('so-step').textContent = 'Pick the move';
    $('so-moves').hidden = false;
    $('so-moves').innerHTML = D.MOVES.map(([id, label], m) => `<button type="button" class="play" data-m="${m}"><b>${esc(label)}</b></button>`).join('');
    $('so-moves').querySelectorAll('.play').forEach((b) => b.onclick = () => soShoot(i, +b.dataset.m));
  }

  function soShoot(i, m) {
    const g = G.so, so = g.so;
    const graded = D.soGrade(so, g.st);
    const mine = graded.find((x) => x.i === i && x.m === m);
    const best = graded[0];
    const loss = Math.max(0, best.wp - mine.wp);
    const letter = D.letter(loss, best.wp);
    G.loss += loss; if (letter !== '–') G.grades.push(letter);
    const rng = D.mulberry(D.hash(`${G.sc.id}:so-you:${g.shots.you.length}`));
    const goal = rng() < mine.p;
    g.shots.you.push(goal);
    g.st.used = g.st.used.length + 1 >= so.shooters.length ? [] : [...g.st.used, i];
    const sh = so.shooters[i];
    const li = document.createElement('li');
    li.innerHTML = `<span class="t">SO</span><div class="what"><div class="call">${esc(sh.n)}: ${esc(D.MOVES[m][1].toLowerCase())}</div>
      <p class="lines">${goal ? '<span class="k-goal">Scores.</span>' : `<span class="k-against">Stopped by ${esc(G.sc.roster.oppG?.n || 'the goalie')}.</span>`}</p>
      ${letter === 'A' ? '' : `<p class="best">Best pick: ${esc(so.shooters[best.i].n)}, ${esc(D.MOVES[best.m][1].toLowerCase())}</p>`}</div>
      <span class="grade ${letter === '–' ? 'X' : letter}">${letter}</span>`;
    $('feed').prepend(li);
    soRound();
  }

  function soScore() {
    const g = G.so;
    const row = (ab, shots) => `<div class="so-row">${esc(ab)} ${shots.map((x) => `<i class="${x ? 'g' : 'm'}"></i>`).join('')}${'<i></i>'.repeat(Math.max(0, 3 - shots.length))}</div>`;
    $('so-score').innerHTML = row(G.sc.you.ab, g.shots.you) + row(G.sc.opp.ab, g.shots.opp);
  }

  function soEnd(who) {
    const s = G.s;
    if (who === 'you') s.you += 1; else s.opp += 1;
    s.over = true; s.won = who === 'you'; s.how = 'SO';
    render();
    finish();
  }

  // ---------- the end ----------
  function realStory(sc) {
    const r = sc.real;
    const bits = [];
    bits.push(r.pulledAt != null ? `pulled the goalie with ${fmt(r.pulledAt)} left` : 'never pulled the goalie');
    let you = sc.start.you, opp = sc.start.opp;
    for (const g of r.goals) {
      if (g.mine) { you++; bits.push(`${you === opp ? 'tied it' : 'scored'} on ${g.by}'s goal (${g.per > 3 ? 'OT' : fmt(g.t)})`); }
      else { opp++; bits.push(g.empty ? `gave up an empty-netter to ${g.by}` : `gave up a goal to ${g.by}${g.per > 3 ? ' in overtime' : ''}`); }
    }
    const how = r.ended === 'SO' ? ' in a shootout' : r.ended === 'OT' ? (r.otNum > 1 ? ` in ${r.otNum}OT` : ' in overtime') : '';
    return `The ${sc.you.name} ${bits.join(', ')}, and lost ${r.final.you}-${r.final.opp}${how}.`;
  }

  function finish() {
    const { s, sc } = G;
    $('decide').hidden = true; $('so').hidden = true;
    const how = s.how === 'SO' ? ' in a shootout' : s.how === 'OT' ? (s.playoff && s.otNum > 1 ? ` in ${s.otNum}OT` : ' in overtime') : '';
    const score = `${s.you}-${s.opp}`;
    event(perLabel(s), s.won ? 'You win' : 'Final', `${sc.you.ab} ${s.you}, ${sc.opp.ab} ${s.opp}${how}.`);
    const st = load();
    const first = !st.days[G.day];
    if (first) { st.days[G.day] = { won: s.won, score, grades: G.grades.join(''), loss: +G.loss.toFixed(3) }; save(st); }
    setTimeout(() => showEnd(score, how), 600);
  }

  function showEnd(score, how) {
    const { s, sc } = G;
    $('end').hidden = false;
    $('end-tag').textContent = `Empty Net #${G.day} · ${sc.label}`;
    $('end-title').textContent = s.won ? `You won ${score}${how}` : `You lost ${score}${how}`;
    const myPull = s.pulls.length ? `You pulled with ${fmt(s.pulls[0])} left` : 'You never pulled the goalie';
    $('end-you').textContent = `${myPull}. ${s.won ? 'Comeback complete' : 'Came up short'}${s.won ? ', and the real team lost this one.' : '.'}`;
    $('end-real').textContent = realStory(sc);
    $('end-grades').innerHTML = G.grades.map((l) => `<span class="grade ${l}">${l}</span>`).join('');
    const a = G.grades.filter((l) => l === 'A').length;
    $('end-loss').textContent = `${G.grades.length} calls, ${a} graded A. Win chance given up against perfect calls: ${(G.loss * 100).toFixed(1)} points.`;
    const sq = { A: '🟩', B: '🟩', C: '🟨', D: '🟧', F: '🟥' };
    const text = `Empty Net #${G.day} 🥅\n${sc.label}\n${sc.you.ab} vs ${sc.opp.ab}, ${dateStr(sc.date)}\n${G.grades.map((l) => sq[l]).join('')}\n${s.won ? `Won ${score}${how}` : `Lost ${score}${how}`} · the real ${sc.you.name} lost ${sc.real.final.you}-${sc.real.final.opp}`;
    $('share-text').textContent = text;
    $('btn-share').onclick = () => {
      const done = () => { $('btn-share').textContent = 'Copied'; };
      try { navigator.clipboard.writeText(text).then(done, () => { $('share-text').hidden = false; }); } catch { $('share-text').hidden = false; }
    };
    $('btn-review').onclick = () => $('feed').scrollIntoView({ behavior: 'smooth' });
    $('btn-more').onclick = openArchive;
    stats();
    $('end').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function stats() {
    const days = Object.values(load().days);
    const won = days.filter((d) => d.won).length;
    const allGrades = days.map((d) => d.grades).join('');
    const aRate = allGrades.length ? Math.round((100 * (allGrades.match(/A/g) || []).length) / allGrades.length) : 0;
    let streak = 0;
    for (let d = DAY; d >= 1 && load().days[d]; d--) streak++;
    $('stats').innerHTML = [[days.length, 'Played'], [won, 'Comebacks'], [`${aRate}%`, 'A calls'], [streak, 'Day streak']]
      .map(([v, l]) => `<div><b>${v}</b><span>${l}</span></div>`).join('');
  }

  // ---------- panels ----------
  function openArchive() {
    const st = load();
    const rows = [];
    for (let d = DAY; d >= 1; d--) {
      const sc = gameForDay(d), rec = st.days[d];
      rows.push(`<li><button type="button" data-d="${d}"><span class="n">#${d}</span><span class="lbl"><b>${esc(sc.you.ab)} vs ${esc(sc.opp.ab)} · ${dateStr(sc.date)}</b><span>${esc(sc.label)}</span></span><span class="res${rec?.won ? ' w' : ''}">${rec ? (rec.won ? 'W ' : 'L ') + rec.score : ''}</span></button></li>`);
    }
    $('arch-list').innerHTML = rows.join('');
    $('arch-list').querySelectorAll('button').forEach((b) => b.onclick = () => showIntro(+b.dataset.d));
    hideAll();
    $('archive').hidden = false;
  }
  let back = null;
  $('btn-how').onclick = () => {
    if (!$('how').hidden) return;
    back = ['intro', 'game', 'end', 'archive'].filter((id) => !$(id).hidden);
    hideAll(); $('how').hidden = false;
  };
  $('btn-archive').onclick = openArchive;
  document.querySelectorAll('[data-close]').forEach((b) => b.onclick = () => {
    $(b.dataset.close).hidden = true;
    if (b.dataset.close === 'how' && back && back.length) { back.forEach((id) => $(id).hidden = false); back = null; }
    else if (G) { $('game').hidden = false; if (G.s.over) $('end').hidden = false; }
    else showIntro(DAY);
  });

  window.EmptyNet = { state: () => G, refresh: () => spot() };   // for testing from the console
  $('foot-built').textContent = `${DATA.games.length} real endings · updated ${new Date(DATA.built).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`;
  showIntro(DAY);
})();
