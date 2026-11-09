// Rinkside renderer: reads data/<TEAM>.json (built by scripts/build-data.mjs) and draws the board.
//
// The board is a set of fixed slots (two wide charts, four grid sections, the playoff picture, two
// stat boxes, three leader rows, an upper and a lower list). Each slot can show any widget that fits
// it; the default layout reproduces the original graphic. Viewers change slots in Customize mode.
(() => {
  const W = 921, H = 1145;
  const params = new URLSearchParams(location.search);
  const wallpaper = params.has('wallpaper');
  const I = !wallpaper; // interactive extras (popups, customizing) only on the live page
  const board = document.getElementById('board');
  const stage = document.getElementById('stage');

  // ---------- helpers ----------
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const logo = (src, alt = '') => `<img class="logo" src="${esc(src)}" alt="${esc(alt)}" loading="eager" decoding="async">`;
  const pop = (key) => (I ? ` data-pop="${esc(key)}"` : '');
  const icon = (home, result) => `<svg class="icon ${home ? 'home' : 'away'} ${result || ''}"><use href="#i-${home ? 'home' : 'away'}"/></svg>`;
  const color = (r) => (r === 'W' ? 'var(--win)' : r === 'L' ? 'var(--loss)' : r === 'O' ? 'var(--otl)' : 'var(--future)');
  const sign = (n) => (n > 0 ? `+${n}` : n < 0 ? `−${-n}` : '0');
  const suffix = (n) => {
    const s = ['th', 'st', 'nd', 'rd'], v = n % 100;
    return s[(v - 20) % 10] || s[v] || s[0];
  };
  const pct3 = (v) => Number(v).toFixed(3).replace(/^0/, '');

  // ---------- live game state (polled through the Cloudflare relay; see cloudflare/live-proxy.js) ----------
  let live = null;            // parsed state of the team's game in progress
  const inProgress = () => live && (live.state === 'LIVE' || live.state === 'CRIT');
  const isLiveGame = (id) => live && live.id === id && live.state !== 'FUT';

  // ---------- layout ----------
  const DEFAULT_LAYOUT = {
    chart1: 'margins', chart2: 'playoffLine',
    col1: ['grid:Atlantic', 'grid:Metropolitan'], col2: ['grid:Pacific', 'grid:Central'],
    picture: 'own', boxes: ['pp', 'pk'], leaders: ['points', 'shots', 'svpct'],
    upper: 'next5', lower: 'last5',
  };
  const LAYOUT_KEY = 'rinkside-layout';
  const clone = (o) => JSON.parse(JSON.stringify(o));
  const b64 = { enc: (o) => btoa(unescape(encodeURIComponent(JSON.stringify(o)))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''),
    dec: (s) => JSON.parse(decodeURIComponent(escape(atob(s.replace(/-/g, '+').replace(/_/g, '/'))))) };
  let layout = clone(DEFAULT_LAYOUT);

  function loadLayout(indexDefault) {
    let l = null;
    try { if (params.get('layout')) l = b64.dec(params.get('layout')); } catch {}
    if (!l && !wallpaper) try { l = JSON.parse(localStorage.getItem(LAYOUT_KEY) || 'null'); } catch {}
    if (!l) l = indexDefault;
    layout = { ...clone(DEFAULT_LAYOUT), ...(l || {}) };
  }
  function saveLayout() {
    try { localStorage.setItem(LAYOUT_KEY, JSON.stringify(layout)); } catch {}
    if (params.has('layout')) {   // a shared layout link stops overriding once you edit
      params.delete('layout');
      const url = new URL(location.href); url.searchParams.delete('layout'); history.replaceState(null, '', url);
    }
  }

  // What each kind of slot can show. Labels appear in the Customize menus.
  const DIVS = ['Atlantic', 'Metropolitan', 'Central', 'Pacific'];
  const CATALOG = {
    chart: (d, slot) => [...CHARTS, ...wideOptions(d, slot)],
  };
  const CHARTS = [['margins', 'Game by game (goal margin)'], ['playoffLine', 'Playoff line'], ['goalDiff', 'Goal differential'], ['race', 'Division points race'],
      ['xg', 'Expected goals by game'], ['pace', 'Points vs playoff pace'], ['rollingXg', 'Rolling xG share (5 games)'], ['shots', 'Shots on goal by game'],
      ['hd', 'High-danger chances by game'], ['confRank', 'Conference rank over time']];
  // big blocks that can take over a chart slot (the shorter middle slot only gets the ones that fit)
  function wideOptions(d, slot) {
    const tall = slot === 'chart1';
    const o = [];
    if (tall) for (const r of (d.ratings || []).slice(0, 5)) o.push([`wideCard:${r.id}`, `Block: player card \u2014 ${r.name}`]);
    if (tall) o.push(['wideOdds', 'Block: playoff odds (conference)'], ['wideRatings', 'Block: player ratings grid']);
    o.push(['wideRun', 'Block: playoff run odds (opens the Cup wheel)'], ['wideMatchup', 'Block: next-game matchup'], ['wideStats', 'Block: team stats wall'], ['wideEdge', 'Block: EDGE + xG stats wall']);
    if (lastChances(d) != null) o.push(['wideChances', 'Block: last game scoring chances']);
    o.push(['wideLeaders', 'Block: team leaders strip']);
    return o;
  }
  const CATALOG2 = {
    section: () => [...DIVS.map((d) => [`grid:${d}`, `${d}: results vs each team`]), ...DIVS.map((d) => [`table:${d}`, `${d} standings`]),
      ['table:league', 'League top 8'], ['table:conference', 'Your conference top 8']],
    picture: (d) => [['own', 'Playoff picture (your conference)'], ...(d.pictures.other ? [['other', `Playoff picture (${d.pictures.other.conference})`]] : []),
      ['wildcard', 'Wild card race'], ['league', 'League standings (top 10)'], ['teamStats', 'Team stats with ranks'],
      ...(d.stats.topSpeed ? [['edgeStats', 'NHL EDGE stats with ranks']] : []), ['results', 'Last 10 results'], ['schedule', 'Next 10 games'],
      ...(d.ratings?.length ? [['ratings', 'Player ratings (overall %)']] : []), ['odds', 'Playoff odds (simulated)']],
    box: (d) => Object.entries(d.stats).map(([k, v]) => [k, v.label + (v.edge ? ' (EDGE)' : v.xg ? ' (xG)' : v.sim ? ' (model)' : '')]),
    leader: (d) => Object.entries(d.leaderBoard).map(([k, v]) => [k, v.label]),
    upper: (d) => [['next5', 'Next 5 (cards)'], ['last5cards', 'Last 5 (cards)'], ['next5rows', 'Next 5 (list)'], ['last5', 'Last 5 (list)'],
      ...(lastChances(d) != null ? [['chances', 'Scoring chances (last game)'], ['seasonChances', 'Season scoring chances']] : []),
      ['nextOpp', 'Next opponent comparison'], ['scorers', 'Top scorers'], ['goalies', 'Goalies'], ['form', 'Recent form (last 10)'],
      ...(d.ratings?.length ? [['ratings', 'Player ratings (overall %)']] : [])],
    lower: (d) => [['last5', 'Last 5 (list)'], ['next5rows', 'Next 5 (list)'],
      ...(lastChances(d) != null ? [['chances', 'Scoring chances (last game)'], ['seasonChances', 'Season scoring chances']] : []),
      ['nextOpp', 'Next opponent comparison'], ['scorers', 'Top scorers'], ['goalies', 'Goalies'], ['form', 'Recent form (last 10)'],
      ...(d.ratings?.length ? [['ratings', 'Player ratings (overall %)']] : [])],
  };
  Object.assign(CATALOG, CATALOG2);
  // slot id -> [kind, read, write]
  const SLOTS = {
    chart1: ['chart', (l) => l.chart1, (l, v) => (l.chart1 = v)],
    chart2: ['chart', (l) => l.chart2, (l, v) => (l.chart2 = v)],
    'col1.0': ['section', (l) => l.col1[0], (l, v) => (l.col1[0] = v)], 'col1.1': ['section', (l) => l.col1[1], (l, v) => (l.col1[1] = v)],
    'col2.0': ['section', (l) => l.col2[0], (l, v) => (l.col2[0] = v)], 'col2.1': ['section', (l) => l.col2[1], (l, v) => (l.col2[1] = v)],
    picture: ['picture', (l) => l.picture, (l, v) => (l.picture = v)],
    'boxes.0': ['box', (l) => l.boxes[0], (l, v) => (l.boxes[0] = v)], 'boxes.1': ['box', (l) => l.boxes[1], (l, v) => (l.boxes[1] = v)],
    'leaders.0': ['leader', (l) => l.leaders[0], (l, v) => (l.leaders[0] = v)], 'leaders.1': ['leader', (l) => l.leaders[1], (l, v) => (l.leaders[1] = v)],
    'leaders.2': ['leader', (l) => l.leaders[2], (l, v) => (l.leaders[2] = v)],
    upper: ['upper', (l) => l.upper, (l, v) => (l.upper = v)], lower: ['lower', (l) => l.lower, (l, v) => (l.lower = v)],
  };
  // a slot's widget, falling back to the default when the saved choice isn't available for this team
  function pick(d, slot) {
    const [kind, read] = SLOTS[slot];
    const v = read(layout), ok = CATALOG[kind](d, slot).some(([k]) => k === v);
    return ok ? v : read(DEFAULT_LAYOUT);
  }
  const slotBox = (slot, x, y, w, h, html, cls = '') =>
    `<div class="abs slot ${cls}" data-slot="${slot}" style="left:${x}px;top:${y}px;width:${w}px;height:${h}px">${html}</div>`;

  // ---------- wide charts ----------
  // charts are CW wide (840 on the full board, narrower on phones); the plot leaves room for axis labels
  let CW = 840, PLOT_X1 = 808;
  const PLOT_X0 = 2;
  const setChartWidth = (w) => { CW = w; PLOT_X1 = w - 32; };
  const slotW = (n) => (PLOT_X1 - PLOT_X0) / Math.max(n, 1);
  const gridLabels = (vals, y, fmt) => vals.map((v) => `<text x="${CW - 14}" y="${y(v) + 3.5}" fill="#8d8d8d" font-size="10" font-weight="500" text-anchor="middle">${fmt(v)}</text>`).join('');

  function chartMargins(d, h) {
    const season = d.season, n = Math.max(season.total, 1), slot = slotW(n);
    const unit = (h - 50) / 10, zero = 6 + 5 * unit, cap = 5;
    const cx = (i) => PLOT_X0 + (i + 0.5) * slot;
    let s = gridLabels([3, 2, 1, -1, -2, -3], (v) => zero - v * unit, (v) => `${v > 0 ? '+' : '−'}${Math.abs(v)}`);
    for (const v of [4, 3, 2, 1, -1, -2, -3, -4])
      s += `<line x1="${PLOT_X0}" x2="${PLOT_X1}" y1="${zero - v * unit}" y2="${zero - v * unit}" stroke="#262626" stroke-dasharray="1 4.8"/>`;
    for (let i = season.played; i < n; i++)
      s += `<rect x="${(cx(i) - slot * 0.32).toFixed(2)}" y="${zero - 1.5}" width="${(slot * 0.64).toFixed(2)}" height="3" fill="#4d4d4d"/>`;
    const bw = Math.min(7.2, slot * 0.75);
    season.games.forEach((g, i) => {
      if (!g.result) return;
      const m = Math.max(-cap, Math.min(cap, g.margin || (g.result === 'W' ? 1 : -1)));
      const bh = Math.abs(m) * unit;
      s += `<rect x="${(cx(i) - bw / 2).toFixed(2)}" y="${m > 0 ? zero - bh : zero}" width="${bw.toFixed(2)}" height="${bh}" fill="${color(g.result)}"/>`;
    });
    season.games.forEach((g, i) => {
      const c = g.result ? '#c4c4c4' : '#8a8a8a';
      s += g.home ? `<circle cx="${cx(i).toFixed(2)}" cy="${h - 32}" r="2.6" fill="${c}"/>`
        : `<circle cx="${cx(i).toFixed(2)}" cy="${h - 32}" r="2.1" fill="none" stroke="${c}" stroke-width="1"/>`;
    });
    const count = {};
    season.games.forEach((g) => (count[g.month] = (count[g.month] || 0) + 1));
    let prev = null;
    season.games.forEach((g, i) => {
      if (g.month !== prev && count[g.month] >= 3)
        s += `<text x="${Math.min(Math.max(cx(i), 13), PLOT_X1 - 13).toFixed(1)}" y="${h - 9}" fill="#9a9a9a" font-size="13" font-weight="500" text-anchor="middle">${esc(g.month)}</text>`;
      prev = g.month;
    });
    // the game in progress: an outlined bar at the current margin
    const li = live && inProgress() ? season.games.findIndex((g) => g.id === live.id) : -1;
    if (li >= 0) {
      const m = Math.max(-cap, Math.min(cap, live.us - live.them)), bh = Math.max(Math.abs(m) * unit, 2);
      s += `<rect class="livebar" x="${(cx(li) - bw / 2).toFixed(2)}" y="${m > 0 ? zero - bh : m < 0 ? zero : zero - 1}" width="${bw.toFixed(2)}" height="${bh}" fill="none" stroke="#fff" stroke-width="1.4" stroke-dasharray="2 1.5"/>`;
      s += `<text x="${cx(li).toFixed(1)}" y="${zero - 5 * unit - 2}" fill="var(--loss)" font-size="9" font-weight="700" text-anchor="middle">LIVE</text>`;
    }
    // one tap target per played game: the only place a game's score opens
    if (I) season.games.forEach((g, i) => {
      if (g.result) s += `<rect class="hit"${pop(`game:${i}`)} x="${(cx(i) - slot / 2).toFixed(2)}" y="2" width="${slot.toFixed(2)}" height="${h - 26}"/>`;
      else if (i === li) s += `<rect class="hit"${pop('live')} x="${(cx(i) - slot / 2).toFixed(2)}" y="2" width="${slot.toFixed(2)}" height="${h - 26}"/>`;
    });
    return {
      title: `<span${pop('season')}>The season, game by game</span>`,
      note: `${season.played} of ${season.total} played, bar height = goal margin`, svg: s,
    };
  }

  // a running value per played game, drawn as a green/red area around zero
  function lineArea(d, h, series, cap, hitKind, id) {
    const n = Math.max(d.season.total, 1), slot = slotW(n);
    const unit = (h - 26) / (2 * cap), zero = 11 + cap * unit;
    const xk = (k) => PLOT_X0 + Math.max(0, k - 0.5) * slot;
    const yv = (v) => zero - Math.max(-cap - 1, Math.min(cap + 1, v)) * unit;
    const ticks = [cap, cap / 2, 0, -cap / 2, -cap];
    let s = gridLabels(ticks, yv, (v) => `${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(v)}`);
    for (const v of ticks.filter((t) => t)) s += `<line x1="${PLOT_X0}" x2="${PLOT_X1}" y1="${yv(v)}" y2="${yv(v)}" stroke="#1f1f1f" stroke-dasharray="1 3"/>`;
    s += `<line x1="${PLOT_X0}" x2="${PLOT_X1}" y1="${zero}" y2="${zero}" stroke="#6a6a6a" stroke-width="1.2" stroke-dasharray="4 3"/>`;
    const pts = series.map((v, k) => [xk(k), yv(v)]);
    if (pts.length > 1) {
      const path = pts.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(2)} ${y.toFixed(2)}`).join('');
      const area = `${path}L${pts[pts.length - 1][0].toFixed(2)} ${zero}L${pts[0][0].toFixed(2)} ${zero}Z`;
      s += `<defs><clipPath id="${id}-up"><rect x="0" y="0" width="${CW}" height="${zero}"/></clipPath><clipPath id="${id}-dn"><rect x="0" y="${zero}" width="${CW}" height="${h}"/></clipPath></defs>`;
      s += `<g clip-path="url(#${id}-up)"><path d="${area}" fill="#173f1d"/><path d="${path}" fill="none" stroke="#2f8a3a" stroke-width="1.6" stroke-linejoin="round"/></g>`;
      s += `<g clip-path="url(#${id}-dn)"><path d="${area}" fill="#4a1018"/><path d="${path}" fill="none" stroke="#c42a3c" stroke-width="1.6" stroke-linejoin="round"/></g>`;
    }
    const [lx, ly] = pts[pts.length - 1] || [xk(0), zero];
    s += `<circle cx="${lx}" cy="${ly}" r="4.4" fill="#fff"/>`;
    if (I) for (let k = 1; k < series.length; k++)
      s += `<rect class="hit"${pop(`${hitKind}:${k}`)} x="${(xk(k) - slot / 2).toFixed(2)}" y="2" width="${slot.toFixed(2)}" height="${h - 6}"/>`;
    return s;
  }

  function chartPlayoffLine(d, h, id) {
    return {
      title: `<span${pop('cut')}>Playoff line<span class="big">${esc(d.playoffLine.label)}</span></span>`,
      note: d.playoffLine.text, svg: lineArea(d, h, d.playoffLine.history, 10, 'line', id),
    };
  }

  const goalDiffSeries = (d) => {
    const out = [0];
    for (const g of d.season.games) if (g.result) out.push(out[out.length - 1] + g.info.us - g.info.them);
    return out;
  };
  function chartGoalDiff(d, h, id) {
    const s = goalDiffSeries(d), last = s[s.length - 1];
    const cap = Math.max(10, Math.ceil(Math.max(...s.map(Math.abs)) / 10) * 10);
    return { title: `Goal differential<span class="big">${esc(sign(last))}</span>`, note: `running goals for minus goals against, ${d.season.played} games`, svg: lineArea(d, h, s, cap, 'gd', id) };
  }

  function chartRace(d, h) {
    const r = d.race, me = d.team.abbrev, K = Math.max(r.pts[me].length - 1, 1);
    const top = Math.ceil(Math.max(10, ...r.teams.map((t) => Math.max(...r.pts[t]))) / 10) * 10;
    const right = PLOT_X1 - 34;   // room for team labels at the line ends
    const xk = (k) => PLOT_X0 + (k / K) * (right - PLOT_X0);
    const y = (v) => 8 + (1 - v / top) * (h - 20);
    let s = gridLabels([top, top / 2, 0], y, (v) => v);
    for (const v of [top, top / 2]) s += `<line x1="${PLOT_X0}" x2="${PLOT_X1}" y1="${y(v)}" y2="${y(v)}" stroke="#1f1f1f" stroke-dasharray="1 3"/>`;
    s += `<line x1="${PLOT_X0}" x2="${PLOT_X1}" y1="${y(0)}" y2="${y(0)}" stroke="#3a3a3a"/>`;
    const order = [...r.teams.filter((t) => t !== me), me];
    const ends = [];
    for (const t of order) {
      const p = r.pts[t].map((v, k) => [xk(k), y(v)]), mine = t === me;
      s += `<path d="${p.map(([a, b], i) => `${i ? 'L' : 'M'}${a.toFixed(1)} ${b.toFixed(1)}`).join('')}" fill="none" stroke="${mine ? '#fff' : '#555'}" stroke-width="${mine ? 2.2 : 1.2}" stroke-linejoin="round"/>`;
      ends.push({ t, mine, x: p[p.length - 1][0], y: p[p.length - 1][1] });
    }
    // spread the end labels so none overlap (at least 11px apart)
    ends.sort((a, b) => a.y - b.y);
    for (let i = 1; i < ends.length; i++) ends[i].ly = Math.max(ends[i].y, (ends[i - 1].ly ?? ends[i - 1].y) + 11);
    ends[0].ly = ends[0].y;
    for (const e of ends) {
      s += `<line x1="${e.x + 2}" x2="${e.x + 7}" y1="${e.y}" y2="${e.ly}" stroke="${e.mine ? '#fff' : '#555'}" stroke-width="0.8"/>`;
      s += `<text x="${e.x + 9}" y="${e.ly + 3.5}" fill="${e.mine ? '#fff' : '#8a8a8a'}" font-size="10" font-weight="${e.mine ? 700 : 500}">${esc(e.t)}</text>`;
    }
    if (I) for (let k = 1; k <= K; k++) {
      const w = (right - PLOT_X0) / K;
      s += `<rect class="hit"${pop(`race:${k}`)} x="${(xk(k) - w / 2).toFixed(2)}" y="2" width="${w.toFixed(2)}" height="${h - 6}"/>`;
    }
    return { title: 'Division race', note: `points after each game, ${esc(d.pictures.own.divisionName)}`, svg: s };
  }

  function chartXg(d, h) {
    const season = d.season, n = Math.max(season.total, 1), slot = slotW(n);
    const unit = (h - 50) / 10, zero = 6 + 5 * unit, cap = 5;
    const cx = (i) => PLOT_X0 + (i + 0.5) * slot;
    let s = gridLabels([4, 2, -2, -4], (v) => zero - v * unit, (v) => `${Math.abs(v)}`);
    for (const v of [4, 2, -2, -4]) s += `<line x1="${PLOT_X0}" x2="${PLOT_X1}" y1="${zero - v * unit}" y2="${zero - v * unit}" stroke="#262626" stroke-dasharray="1 4.8"/>`;
    s += `<line x1="${PLOT_X0}" x2="${PLOT_X1}" y1="${zero}" y2="${zero}" stroke="#4d4d4d"/>`;
    const bw = Math.min(7.2, slot * 0.75);
    let xf = 0, xa = 0, gf = 0, ga = 0;
    season.games.forEach((g, i) => {
      const c = g.chances;
      if (!c) return;
      xf += c.us.xg; xa += c.them.xg; gf += c.us.goals; ga += c.them.goals;
      const up = Math.min(cap, c.us.xg) * unit, dn = Math.min(cap, c.them.xg) * unit, x = cx(i);
      s += `<rect x="${(x - bw / 2).toFixed(2)}" y="${zero - up}" width="${bw.toFixed(2)}" height="${up}" fill="#2f8a3a"/>`;
      s += `<rect x="${(x - bw / 2).toFixed(2)}" y="${zero}" width="${bw.toFixed(2)}" height="${dn}" fill="#a3303f"/>`;
      s += `<circle cx="${x.toFixed(2)}" cy="${zero - Math.min(cap, c.us.goals) * unit}" r="2.2" fill="#fff"/>`;
      s += `<circle cx="${x.toFixed(2)}" cy="${zero + Math.min(cap, c.them.goals) * unit}" r="2.2" fill="#fff"/>`;
      if (I) s += `<rect class="hit"${pop(`chances:${i}`)} x="${(x - slot / 2).toFixed(2)}" y="2" width="${slot.toFixed(2)}" height="${h - 26}"/>`;
    });
    const li = live && inProgress() && live.chances ? season.games.findIndex((g) => g.id === live.id) : -1;
    if (li >= 0) {
      const c = live.chances, x = cx(li), up = Math.min(cap, c.us.xg) * unit, dn = Math.min(cap, c.them.xg) * unit;
      s += `<rect x="${(x - bw / 2).toFixed(2)}" y="${zero - up}" width="${bw.toFixed(2)}" height="${up}" fill="none" stroke="#2f8a3a" stroke-width="1.4" stroke-dasharray="2 1.5"/>`;
      s += `<rect x="${(x - bw / 2).toFixed(2)}" y="${zero}" width="${bw.toFixed(2)}" height="${dn}" fill="none" stroke="#c42a3c" stroke-width="1.4" stroke-dasharray="2 1.5"/>`;
      s += `<text x="${x.toFixed(1)}" y="${zero - 5 * unit - 2}" fill="var(--loss)" font-size="9" font-weight="700" text-anchor="middle">LIVE</text>`;
      if (I) s += `<rect class="hit"${pop('live')} x="${(x - slot / 2).toFixed(2)}" y="2" width="${slot.toFixed(2)}" height="${h - 26}"/>`;
    }
    const count = {};
    season.games.forEach((g) => (count[g.month] = (count[g.month] || 0) + 1));
    let prev = null;
    season.games.forEach((g, i) => {
      if (g.month !== prev && count[g.month] >= 3)
        s += `<text x="${Math.min(Math.max(cx(i), 13), PLOT_X1 - 13).toFixed(1)}" y="${h - 9}" fill="#9a9a9a" font-size="13" font-weight="500" text-anchor="middle">${esc(g.month)}</text>`;
      prev = g.month;
    });
    return { title: `<span${pop('xginfo')}>Expected goals<span class="big">${xf.toFixed(1)}–${xa.toFixed(1)}</span></span>`,
      note: `xG for (up) and against (down), dots = actual goals · goals ${gf}–${ga}`, svg: s };
  }

  function chartSlot(d, slot, x, top, w, svgTop, h) {
    setChartWidth(w);
    const kind = pick(d, slot);
    if (kind.startsWith('wide')) {
      const b = wideBlock(d, kind, w, h);
      return slotBox(slot, x, top, w, svgTop + h - 2,
        `<div class="abs title" style="left:0;top:0">${b.title}</div><div class="abs note" style="${MODE === 'stack' ? 'left:0;top:28px' : 'right:0;top:6px'}">${esc(b.note)}</div>` +
        `<div class="abs wblock" style="left:0;top:${svgTop}px;width:${w}px;height:${h - 4}px">${b.html}</div>`);
    }
    const c = kind === 'playoffLine' ? chartPlayoffLine(d, h, slot) : kind === 'goalDiff' ? chartGoalDiff(d, h, slot)
      : kind === 'race' ? chartRace(d, h) : kind === 'xg' ? chartXg(d, h) : kind === 'pace' ? chartPace(d, h, slot)
      : kind === 'rollingXg' ? chartRollingXg(d, h, slot) : kind === 'shots' ? chartShots(d, h) : kind === 'hd' ? chartHd(d, h)
      : kind === 'confRank' ? chartConfRank(d, h) : chartMargins(d, h);
    return slotBox(slot, x, top, w, svgTop + h - 2,
      `<div class="abs title" style="left:0;top:0">${c.title}</div><div class="abs note" style="${MODE === 'stack' ? 'left:0;top:28px' : 'right:32px;top:6px'}">${esc(c.note)}</div>` +
      `<svg class="abs" style="left:0;top:${svgTop}px" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">${c.svg}</svg>`);
  }

  // ---------- grid-column sections ----------
  function sectionGrid(d, name) {
    const dv = d.divisions.find((x) => x.name === name);
    if (!dv) return '';
    const rows = dv.teams.map((t) => `<div class="drow"${pop(`series:${t.abbrev}`)}>${logo(t.logo, t.abbrev)}<div class="icons">${t.games.map((g) => icon(g.home, g.result)).join('')}</div></div>`).join('');
    return `<section class="div"><div class="colhead"${pop(`div:${name}`)}><span class="t">${esc(name)}</span><span class="r">${esc(dv.record)}</span></div><div class="drows">${rows}</div></section>`;
  }
  function sectionTable(d, which) {
    const all = Object.entries(d.teams).map(([a, t]) => ({ a, ...t }));
    let title, rows;
    if (which === 'league') { title = 'League'; rows = all.sort((x, y) => x.leagueSeq - y.leagueSeq).slice(0, 8); }
    else if (which === 'conference') { const c = d.teams[d.team.abbrev].conf; title = c; rows = all.filter((t) => t.conf === c).sort((x, y) => x.confSeq - y.confSeq).slice(0, 8); }
    else { title = which; rows = all.filter((t) => t.div === which).sort((x, y) => x.divSeq - y.divSeq).slice(0, 8); }
    const body = rows.map((t, i) => `<div class="trow${t.a === d.team.abbrev ? ' me' : ''}"${pop(`team:${t.a}`)}><span class="tn">${i + 1}</span>${logo(t.logo, t.a)}<span class="ab">${esc(t.a)}</span><span class="gp">${t.gp}</span><span class="pts">${t.pts}</span></div>`).join('');
    return `<section class="div"><div class="colhead"><span class="t">${esc(title)}</span><span class="r small">GP&nbsp;&nbsp;PTS</span></div><div class="drows">${body}</div></section>`;
  }
  const section = (d, slot) => {
    const v = pick(d, slot), [kind, arg] = v.split(':');
    return kind === 'table' ? sectionTable(d, arg) : sectionGrid(d, arg);
  };

  // ---------- picture, boxes, leaders ----------
  function pictureRows(rows) {
    return rows.map((r) => `<div class="prow${r.me ? ' me' : ''}"${pop(`team:${r.abbrev}`)}><span class="lbl">${esc(r.label)}</span>${logo(r.logo, r.abbrev)}<span class="ab">${esc(r.abbrev)}</span><span class="gp">${r.gp}</span><span class="pts">${r.pts}</span></div>`).join('');
  }
  function picture(d, slot) {
    const which = pick(d, slot);
    if (PICTURE_PANELS[which]) return PICTURE_PANELS[which](d);
    const p = d.pictures[pick(d, slot)] || d.pictures.own;
    return `<div class="colhead big"><span class="t">Playoff picture</span></div>` +
      `<div class="sub first"><span>${esc(p.divisionName)}</span><span class="gp">GP</span><span class="pts">PTS</span></div>${pictureRows(p.divRows)}` +
      `<div class="sub"><span>Wild card${p !== d.pictures.own ? ` · ${esc(p.conference)}` : ''}</span></div>${pictureRows(p.wcRows)}<div class="cutline"></div>${pictureRows(p.outRows)}`;
  }
  // short names that fit a stat box on one line (full names stay in the menu and popup)
  const SHORT = { playoffOdds: 'Playoff odds', projPts: 'Proj. points', divOdds: 'Division odds', strength: 'Strength', xgPct: 'xG share', finishing: 'Finishing', hdcPct: 'HD chance %', pp: 'Power play', pk: 'Penalty kill', gfpg: 'Goals for/gm', gapg: 'Goals agst/gm', sfpg: 'Shots for/gm',
    sapg: 'Shots agst/gm', fo: 'Faceoffs', shpct: 'Shooting', svpct: 'Team save %', ptspct: 'Points %', gdpg: 'Goal diff/gm',
    topSpeed: 'Top speed', bursts20: '20+ mph bursts', bursts22: '22+ mph bursts', topShot: 'Hardest shot', shots90: '90+ mph shots',
    distance: 'Distance', hdShots: 'HD shots', hdPct: 'HD shooting', ozTime: 'O-zone time', dzTime: 'D-zone time', satDiff: 'Shot att. diff' };
  function statBox(d, slot) {
    const k = pick(d, slot), v = d.stats[k];
    if (!v) return '<div class="box"></div>';
    return `<div class="box"${pop(`stat:${k}`)}><div class="k" title="${esc(v.label)}">${esc(SHORT[k] || v.label)}</div><div class="rk">${v.rank}${suffix(v.rank)} of ${v.of}</div><div class="v">${esc(v.value)}<small>${esc(v.unit.trim() ? ` ${v.unit.trim()}` : '')}</small></div></div>`;
  }
  function leaderRow(d, slot) {
    const k = pick(d, slot), l = d.leaderBoard[k];
    if (!l) return '<div class="lrow"></div>';
    return `<div class="lrow"${pop(cardKey(d, l.id) || `leader:${k}`)}><div class="face"><img src="${esc(l.headshot)}" alt=""></div><div class="who"><div class="k">${esc(l.label.replace(' (EDGE)', ''))}</div><div class="n">${esc(l.name)}</div><div class="s">${esc(l.sub)}</div></div><div class="v">${esc(l.value)}</div></div>`;
  }

  // ---------- upper / lower lists ----------
  const nextCards = (d) => `<div class="colhead big"><span class="t">Next 5</span><span class="r small">EASTERN TIME</span></div><div class="nlist">${
    d.nextGames.length ? d.nextGames.map((g, i) => {
      const L = isLiveGame(g.id);
      return `<div class="ncard${L ? ' live' : ''}"${pop(L ? 'live' : `next:${i}`)}><div class="date"><span class="dow">${esc(g.dow)}</span><span class="day">${esc(g.day)}</span></div><span class="at">${g.home ? 'vs' : '@'}${!L && g.winPct != null ? `<small class="wp">${g.winPct}%</small>` : ''}</span>${logo(g.logo, g.opp)}<span class="time">${L ? liveShort() : esc(g.time)}</span></div>`;
    }).join('')
      : '<div class="note" style="margin-top:12px">No games scheduled</div>'}</div>`;
  const lastCards = (d) => `<div class="colhead big"><span class="t">Last 5</span><span class="r small">FINAL SCORES</span></div><div class="nlist"${pop('form')}>${
    d.lastGames.map((g) => `<div class="ncard"><div class="date"><span class="dow">${esc(g.dow)}</span><span class="day">${esc(g.day)}</span></div><span class="at">${g.info.home ? 'vs' : '@'}</span>${logo(g.logo, g.opp)}<span class="time"><span class="res ${g.result}">${esc(g.result)}</span> ${esc(g.score.replace('-', '–'))}</span></div>`).join('')}</div>`;
  const lastRows = (d) => `<div class="colhead big"><span class="t">Last 5</span></div><div class="llist"${pop('form')}>${
    d.lastGames.map((g) => `<div class="lgrow">${logo(g.logo, g.opp)}<span class="res ${g.result}">${esc(g.result)}</span><span class="sc">${esc(g.score.replace('-', '–'))}</span></div>`).join('')}</div>`;
  const nextRows = (d) => `<div class="colhead big"><span class="t">Next 5</span><span class="r small">EASTERN TIME</span></div><div class="llist">${
    d.nextGames.map((g, i) => {
      const L = isLiveGame(g.id);
      return `<div class="lgrow${L ? ' live' : ''}"${pop(L ? 'live' : `next:${i}`)}>${logo(g.logo, g.opp)}<span class="nd">${L ? 'LIVE' : `${esc(g.dow)} ${esc(g.day)}`}</span><span class="sc nt">${L ? liveShort() : `${g.home ? 'vs' : '@'} ${esc(g.time)}`}</span>${!L && g.winPct != null ? `<small class="wp">${g.winPct}%</small>` : ''}</div>`;
    }).join('')}</div>`;

  // ---------- geometry: the full board, or a narrower two-column board for phones ----------
  const GEOM = {
    board: { W: 921, H: 1145, chart1: [40, 112, 840, 33, 200], chart2: [40, 352, 840, 28, 110],
      'col1.0': [40, 485, 162, 268], 'col1.1': [40, 753, 162, 350], 'col2.0': [220, 485, 162, 268], 'col2.1': [220, 753, 162, 350],
      picture: [402, 485, 228, 294], boxes: [402, 787], leaders: [402, 857], upper: [650, 485, 230, 346], lower: [650, 846, 230, 250], foot: [40, 1118, 840] },
    // phones: notes sit on their own line under each chart title
    stack: { W: 500, H: 1840, chart1: [16, 212, 468, 53, 200], chart2: [16, 472, 468, 48, 110],
      'col1.0': [16, 640, 230, 268], 'col1.1': [16, 908, 230, 260], 'col2.0': [254, 640, 230, 268], 'col2.1': [254, 908, 230, 260],
      picture: [16, 1180, 230, 294], boxes: [16, 1482], leaders: [16, 1552], upper: [254, 1180, 230, 346], lower: [254, 1541, 230, 250], foot: [16, 1792, 468] },
  };
  let MODE = 'board';
  const modeFor = () => (!wallpaper && (document.documentElement.clientWidth || innerWidth) < 700 ? 'stack' : 'board');

  // ---------- scoring chances report ----------
  const lastChances = (d) => {
    for (let i = d.season.games.length - 1; i >= 0; i--) if (d.season.games[i].chances) return i;
    return null;
  };
  const DANGER = [['hi', 'High danger', 'var(--win)'], ['mid', 'Mid danger', '#e0b23a'], ['low', 'Low danger', 'var(--loss)']];
  function chancesTable(d, g, compact) {
    const c = g.chances, me = d.team.abbrev, opp = g.opp;
    const cell = (v, sub, win, tint) => `<div class="cv${win ? ' win' : ''}"${win && tint ? ` style="--tint:${tint}"` : ''}><b class="m">${v}</b>${sub ? `<small>${sub}</small>` : ''}</div>`;
    const row = (label, a, b, dot, tint, subA, subB) =>
      `<div class="chr">${cell(a, subA, +a > +b, tint)}<div class="cl">${dot ? `<i style="background:${dot}"></i>` : ''}${label}</div>${cell(b, subB, +b > +a, tint)}</div>`;
    const lg = (t) => d.teams[t]?.logo;
    const ot = g.liveLabel ? '' : g.info.status.includes('/') ? '/' + g.info.status.split('/')[1] : '';
    const fu = g.info?.us ?? c.us.goals, ft = g.info?.them ?? c.them.goals;   // official final (adds the shootout winner)
    let h = `<div class="chh">${logo(lg(me), me)}<span class="m">${fu}</span><span class="cf">${g.home ? 'vs' : '@'} ${esc(opp)} \u00b7 ${g.liveLabel ? `<b class="lv">${esc(g.liveLabel)}</b>` : `Final${ot}`}<br>${esc(g.info.date)}</span><span class="m">${ft}</span>${logo(lg(opp), opp)}</div>`;
    h += row('Chances', c.us.chances, c.them.chances);
    for (const [k, label, col] of DANGER)
      h += row(label, c.us[k].n, c.them[k].n, col, col, `xG ${c.us[k].xg.toFixed(2)} · G ${c.us[k].g}`, `xG ${c.them[k].xg.toFixed(2)} · G ${c.them[k].g}`);
    h += row('Expected goals', c.us.xg.toFixed(2), c.them.xg.toFixed(2), null, '#5b8fd6');
    // goals = goals on chances + empty-net goals + long-range goals, so the row always matches the score
    const so = (g.info?.status || '').endsWith('SO');
    const extra = (x, won) => {
      const parts = [x.en ? `${x.en} empty net` : '', x.dumpGoals ? `${x.dumpGoals} long range` : ''].filter(Boolean);
      return [parts.length ? `incl. ${parts.join(', ')}` : '', so && won ? 'won shootout' : ''].filter(Boolean).join(' \u00b7 ');
    };
    h += row('Goals', c.us.goals, c.them.goals, null, null, extra(c.us, fu > ft), extra(c.them, ft > fu));
    if (!compact) h += `<div class="chf"><span>Empty net <b class="m">${c.us.en}–${c.them.en}</b></span><span>Dumps <b class="m">${c.us.dumps}–${c.them.dumps}</b></span><span>Blocked <b class="m">${c.us.blocked}–${c.them.blocked}</b></span></div>`;
    return `<div class="ch${compact ? ' compact' : ''}">${h}</div>`;
  }
  const liveGameObj = (d) => {
    if (!inProgress() || !live.chances) return null;
    return { opp: live.opp, home: live.home, chances: live.chances, liveLabel: `${live.period} ${live.clock}`.trim(),
      info: { us: live.us, them: live.them, date: 'In progress', status: 'Live' } };
  };
  const chancesPanel = (d, compact) => {
    const lg = liveGameObj(d), i = lastChances(d);
    if (!lg && i == null) return '';
    return `<div class="colhead big"><span class="t">Scoring chances</span><span class="r small">${lg ? '<b class="lv">LIVE</b>' : 'LAST GAME'}</span></div><div${pop(lg ? 'live' : 'xginfo')}>${chancesTable(d, lg || d.season.games[i], compact)}</div>`;
  };

  // ======================= more panels =======================
  const playedGames = (d) => d.season.games.filter((g) => g.result);
  const withChances = (d) => d.season.games.filter((g) => g.result && g.chances);
  const r1 = (v) => (Math.round(v * 10) / 10).toFixed(1);
  function monthLabels(season, h, cx) {
    const count = {};
    season.games.forEach((g) => (count[g.month] = (count[g.month] || 0) + 1));
    let prev = null, s = '';
    season.games.forEach((g, i) => {
      if (g.month !== prev && count[g.month] >= 3)
        s += `<text x="${Math.min(Math.max(cx(i), 13), PLOT_X1 - 13).toFixed(1)}" y="${h - 9}" fill="#9a9a9a" font-size="13" font-weight="500" text-anchor="middle">${esc(g.month)}</text>`;
      prev = g.month;
    });
    return s;
  }

  // paired bars per played game: up = us, down = them
  function pairBars(d, h, upF, dnF, cap, step, key) {
    const season = d.season, n = Math.max(season.total, 1), slot = slotW(n);
    const top = 6, bot = h - 30, zero = (top + bot) / 2, unit = (bot - top) / 2 / cap;
    const cx = (i) => PLOT_X0 + (i + 0.5) * slot;
    const ticks = [cap, step, -step, -cap];
    let s = gridLabels(ticks, (v) => zero - v * unit, (v) => `${Math.abs(v)}`);
    for (const v of ticks) s += `<line x1="${PLOT_X0}" x2="${PLOT_X1}" y1="${zero - v * unit}" y2="${zero - v * unit}" stroke="#262626" stroke-dasharray="1 4.8"/>`;
    s += `<line x1="${PLOT_X0}" x2="${PLOT_X1}" y1="${zero}" y2="${zero}" stroke="#4d4d4d"/>`;
    const bw = Math.min(7.2, slot * 0.75);
    season.games.forEach((g, i) => {
      if (!g.result || !g.chances) return;
      const u = Math.min(cap, upF(g)) * unit, dn = Math.min(cap, dnF(g)) * unit, x = cx(i);
      s += `<rect x="${(x - bw / 2).toFixed(2)}" y="${zero - u}" width="${bw.toFixed(2)}" height="${u}" fill="#2f8a3a"/>`;
      s += `<rect x="${(x - bw / 2).toFixed(2)}" y="${zero}" width="${bw.toFixed(2)}" height="${dn}" fill="#a3303f"/>`;
      if (I) s += `<rect class="hit"${pop(`${key}:${i}`)} x="${(x - slot / 2).toFixed(2)}" y="2" width="${slot.toFixed(2)}" height="${h - 26}"/>`;
    });
    return s + monthLabels(season, h, cx);
  }

  function chartShots(d, h) {
    const gs = withChances(d), n = gs.length || 1;
    const f = gs.reduce((a, g) => a + g.chances.us.sog, 0) / n, a = gs.reduce((x, g) => x + g.chances.them.sog, 0) / n;
    return { title: `Shots on goal<span class="big">${r1(f)}–${r1(a)}</span>`, note: 'per game: for (up) and against (down)',
      svg: pairBars(d, h, (g) => g.chances.us.sog, (g) => g.chances.them.sog, 50, 25, 'shots') };
  }
  function chartHd(d, h) {
    const gs = withChances(d);
    const f = gs.reduce((a, g) => a + g.chances.us.hi.n, 0), a = gs.reduce((x, g) => x + g.chances.them.hi.n, 0);
    return { title: `High-danger chances<span class="big">${f}–${a}</span>`, note: 'for (up) and against (down) each game',
      svg: pairBars(d, h, (g) => g.chances.us.hi.n, (g) => g.chances.them.hi.n, 15, 5, 'hd') };
  }
  const paceSeries = (d) => {
    const cut = d.pictures.own.wcRows[d.pictures.own.wcRows.length - 1];
    const perGame = cut && cut.gp ? cut.pts / cut.gp : 1.1;
    let pts = 0;
    const out = [0];
    playedGames(d).forEach((g, k) => { pts += g.result === 'W' ? 2 : g.result === 'O' ? 1 : 0; out.push(+(pts - perGame * (k + 1)).toFixed(1)); });
    return { out, perGame };
  };
  function chartPace(d, h, id) {
    const { out, perGame } = paceSeries(d), last = out[out.length - 1];
    return { title: `Points vs playoff pace<span class="big">${sign(Math.round(last))}</span>`,
      note: `points minus the last wild card's pace (${perGame.toFixed(2)} pts/game)`, svg: lineArea(d, h, out, 10, 'pace', id) };
  }
  const rollingXg = (d, n = 5) => {
    const gs = playedGames(d), out = [0];
    gs.forEach((g, k) => {
      const win = gs.slice(Math.max(0, k - n + 1), k + 1).filter((x) => x.chances);
      const f = win.reduce((a, x) => a + x.chances.us.xg, 0), a = win.reduce((x2, x) => x2 + x.chances.them.xg, 0);
      out.push(f + a ? +((100 * f) / (f + a) - 50).toFixed(1) : 0);
    });
    return out;
  };
  function chartRollingXg(d, h, id) {
    const s = rollingXg(d), last = s[s.length - 1];
    return { title: `Rolling xG share<span class="big">${(50 + last).toFixed(1)}%</span>`, note: 'last 5 games’ expected-goals share, above or below 50%',
      svg: lineArea(d, h, s, 20, 'rxg', id) };
  }
  function chartConfRank(d, h) {
    const n = Math.max(d.season.total, 1), slot = slotW(n), N = d.confSize || 16, ranks = d.rankHistory || [];
    const xk = (k) => PLOT_X0 + Math.max(0, k - 0.5) * slot;
    const y = (r) => 8 + ((r - 1) / (N - 1)) * (h - 22);
    let s = gridLabels([1, 8, N], y, (v) => `${v}${suffix(v)}`);
    s += `<line x1="${PLOT_X0}" x2="${PLOT_X1}" y1="${y(8.5)}" y2="${y(8.5)}" stroke="#6a6a6a" stroke-width="1.2" stroke-dasharray="4 3"/>`;
    s += `<text x="${PLOT_X1 - 4}" y="${y(8.5) - 4}" fill="#8a8a8a" font-size="9.5" text-anchor="end">playoff line</text>`;
    if (ranks.length) {
      const pts = ranks.map((r, i) => [xk(i + 1), y(r)]);
      s += `<path d="${pts.map(([a, b], i) => `${i ? 'L' : 'M'}${a.toFixed(1)} ${b.toFixed(1)}`).join('')}" fill="none" stroke="#bdbdbd" stroke-width="1.5" stroke-linejoin="round"/>`;
      ranks.forEach((r, i) => { s += `<circle cx="${pts[i][0].toFixed(1)}" cy="${pts[i][1].toFixed(1)}" r="2.6" fill="${r <= 8 ? 'var(--win)' : 'var(--loss)'}"/>`; });
      if (I) ranks.forEach((r, i) => { s += `<rect class="hit"${pop(`rank:${i + 1}`)} x="${(xk(i + 1) - slot / 2).toFixed(2)}" y="2" width="${slot.toFixed(2)}" height="${h - 6}"/>`; });
    }
    const last = ranks[ranks.length - 1];
    return { title: `Conference rank<span class="big">${last ? `${last}${suffix(last)}` : '–'}</span>`, note: `after each game, of ${N} (top 8 make the playoffs)`, svg: s };
  }

  // ---------- picture-slot panels ----------
  const prow = (label, t, a, me) => `<div class="prow${a === me ? ' me' : ''}"${pop(`team:${a}`)}><span class="lbl">${esc(label)}</span>${logo(t.logo, a)}<span class="ab">${esc(a)}</span><span class="gp">${t.gp}</span><span class="pts">${t.pts}</span></div>`;
  function wildcardRace(d) {
    const me = d.team.abbrev, conf = d.teams[me].conf;
    const rows = Object.entries(d.teams).filter(([, t]) => t.conf === conf && t.wcSeq > 0).sort((a, b) => a[1].wcSeq - b[1].wcSeq).slice(0, 9);
    return `<div class="colhead big"><span class="t">Wild card race</span></div><div class="sub first tight"><span>${esc(conf)}</span><span class="gp">GP</span><span class="pts">PTS</span></div>` +
      `<div class="tightrows">${rows.map(([a, t], i) => (i === 2 ? '<div class="cutline"></div>' : '') + prow(i < 2 ? `WC${i + 1}` : `${i + 1}`, t, a, me)).join('')}</div>`;
  }
  function leagueTable(d) {
    const me = d.team.abbrev, rows = Object.entries(d.teams).sort((a, b) => a[1].leagueSeq - b[1].leagueSeq).slice(0, 10);
    return `<div class="colhead big"><span class="t">League standings</span></div><div class="sub first tight"><span>Top 10</span><span class="gp">GP</span><span class="pts">PTS</span></div>` +
      `<div class="tightrows">${rows.map(([a, t], i) => prow(`${i + 1}`, t, a, me)).join('')}</div>`;
  }
  function statTiles(d, title, keys) {
    const tiles = keys.filter((k) => d.stats[k]).slice(0, 8).map((k) => {
      const v = d.stats[k];
      return `<div class="tile"${pop(`stat:${k}`)}><div class="k">${esc(SHORT[k] || v.label)}</div><div class="v">${esc(v.value)}<small>${esc(v.unit.trim() ? ` ${v.unit.trim()}` : '')}</small></div><div class="rk">${v.rank}${suffix(v.rank)} of ${v.of}</div></div>`;
    }).join('');
    return `<div class="colhead big"><span class="t">${esc(title)}</span><span class="r small">LEAGUE RANK</span></div><div class="tiles">${tiles}</div>`;
  }
  function resultsList(d) {
    const gs = playedGames(d).slice(-10).reverse();
    return `<div class="colhead big"><span class="t">Last 10</span><span class="r small">${esc(d.teams[d.team.abbrev].l10)}</span></div><div class="glist"${pop('form')}>` +
      gs.map((g) => `<div class="grow"><span class="gd">${esc(g.info.date.replace(/^\w+, /, ''))}</span><span class="ga">${g.home ? 'vs' : '@'}</span>${logo(g.info.oppLogo, g.opp)}<span class="res ${g.result === 'O' ? (g.info.status.split('/')[1] || 'OT') : g.result}">${g.result === 'O' ? (g.info.status.split('/')[1] || 'OT') : g.result}</span><span class="gs m">${g.info.us}–${g.info.them}</span></div>`).join('') + '</div>';
  }
  function scheduleList(d) {
    const gs = d.season.games.map((g, i) => [g, i]).filter(([g]) => !g.result).slice(0, 10);
    return `<div class="colhead big"><span class="t">Coming up</span><span class="r small">EASTERN TIME</span></div><div class="glist">` +
      gs.map(([g, i]) => `<div class="grow"${pop(`sched:${i}`)}><span class="gd">${esc(g.info.date.replace(/^\w+, /, ''))}</span><span class="ga">${g.home ? 'vs' : '@'}</span>${logo(g.info.oppLogo, g.opp)}<span class="gn">${esc(g.opp)}</span><span class="gs">${esc(g.info.time.replace(' ET', ''))}</span></div>`).join('') + '</div>';
  }

  // ---------- list-slot panels ----------
  // a comparison row: our value | label | their value, better side tinted
  const cmpRow = (label, a, b, better, fa = (v) => v) => {
    const win = better === 'high' ? [+a > +b, +b > +a] : better === 'low' ? [+a < +b, +b < +a] : [false, false];
    const cell = (v, w) => `<div class="cv${w ? ' win' : ''}"${w ? ' style="--tint:#5b8fd6"' : ''}><b class="m">${esc(fa(v))}</b></div>`;
    return `<div class="chr">${cell(a, win[0])}<div class="cl">${esc(label)}</div>${cell(b, win[1])}</div>`;
  };
  const f1 = (v) => (v == null ? '\u2013' : Number(v).toFixed(1));
  function nextOpponent(d, compact) {
    const g = d.nextGames[0];
    if (!g) return `<div class="colhead big"><span class="t">Next opponent</span></div><div class="note" style="margin-top:12px">No games scheduled</div>`;
    const me = d.team.abbrev, t = d.teams[me], o = d.teams[g.opp] || {};
    const series = d.season.games.filter((x) => x.opp === g.opp && x.result);
    const c = (r) => series.filter((x) => x.result === r).length;
    const rows = [
      ...(g.winPct != null ? [['Win chance', `${g.winPct}%`, `${100 - g.winPct}%`, null, null, g.winPct, 100 - g.winPct]] : []),
      ['Points %', pct3(t.pct), pct3(o.pct ?? 0), 'high'], ['Goal diff', sign(t.diff), sign(o.diff ?? 0), 'high', null, t.diff, o.diff],
      ['Last 10', t.l10, o.l10 || '\u2013'], ['xG share', f1(t.xgPct), f1(o.xgPct), 'high'],
      ['Power play', f1(t.pp), f1(o.pp), 'high'], ['Penalty kill', f1(t.pk), f1(o.pk), 'high'],
      ['Goals for / gm', t.gfpg ?? '–', o.gfpg ?? '–', 'high'], ['Goals agst / gm', t.gapg ?? '–', o.gapg ?? '–', 'low'],
    ].slice(0, compact ? 4 : 6);
    let h = `<div class="colhead big"><span class="t">Next opponent</span><span class="r small">${esc(g.dow)} ${esc(g.day)} · ${esc(g.time)}</span></div>`;
    h += `<div class="ch opp${compact ? ' compact' : ''}"${pop(`team:${g.opp}`)}><div class="chh">${logo(t.logo, me)}<span class="cf">${esc(me)}<br>${esc(t.record)}</span><span class="cmid">${g.home ? 'vs' : '@'}<small>series ${c('W')}-${c('L')}-${c('O')}</small></span><span class="cf">${esc(g.opp)}<br>${esc(o.record || '')}</span>${logo(o.logo || g.logo, g.opp)}</div>`;
    h += rows.map(([label, a, b, better, , na, nb]) => {
      if (na !== undefined) {   // compare on the raw numbers when the label is formatted
        const w = [na > nb, nb > na];
        return `<div class="chr"><div class="cv${w[0] ? ' win' : ''}" style="--tint:#5b8fd6"><b class="m">${esc(a)}</b></div><div class="cl">${esc(label)}</div><div class="cv${w[1] ? ' win' : ''}" style="--tint:#5b8fd6"><b class="m">${esc(b)}</b></div></div>`;
      }
      return cmpRow(label, a, b, better);
    }).join('');
    return h + '</div>';
  }
  function topScorers(d, compact) {
    const list = (d.scorers || []).slice(0, compact ? 4 : 6);
    return `<div class="colhead big"><span class="t">Top scorers</span><span class="r small">G · A · P</span></div><div class="plist">` +
      list.map((x, i) => `<div class="prw"${pop(cardKey(d, x.id) || `scorer:${i}`)}><span class="face"><img src="${esc(x.headshot)}" alt=""></span><span class="pn"><b>${esc(x.name)}</b><small>${esc(x.pos)} · ${x.gp} GP</small></span><span class="pga m">${x.g}·${x.a}</span><span class="pv m">${x.p}</span></div>`).join('') + '</div>';
  }
  function goalieList(d, compact) {
    const list = (d.goalies || []).slice(0, compact ? 3 : 4);
    return `<div class="colhead big"><span class="t">Goalies</span><span class="r small">SV% · GAA</span></div><div class="plist">` +
      list.map((x, i) => `<div class="prw"${pop(cardKey(d, x.id) || `goalie:${i}`)}><span class="face"><img src="${esc(x.headshot)}" alt=""></span><span class="pn"><b>${esc(x.name)}</b><small>${esc(x.record)} · ${x.gp} GP</small></span><span class="pga m">${esc(x.gaa)}</span><span class="pv m">${esc(x.sv)}</span></div>`).join('') + '</div>';
  }
  function seasonChances(d, compact) {
    const gs = withChances(d), n = gs.length || 1;
    const avg = (f) => gs.reduce((a, g) => a + f(g), 0) / n;
    const rows = [
      ['Chances / gm', avg((g) => g.chances.us.chances), avg((g) => g.chances.them.chances), 'high', 1],
      ['High danger', avg((g) => g.chances.us.hi.n), avg((g) => g.chances.them.hi.n), 'high', 1],
      ['Mid danger', avg((g) => g.chances.us.mid.n), avg((g) => g.chances.them.mid.n), 'high', 1],
      ['Low danger', avg((g) => g.chances.us.low.n), avg((g) => g.chances.them.low.n), 'high', 1],
      ['xG / gm', avg((g) => g.chances.us.xg), avg((g) => g.chances.them.xg), 'high', 2],
      ['Goals / gm', avg((g) => g.chances.us.goals), avg((g) => g.chances.them.goals), 'high', 2],
      ['Shots / gm', avg((g) => g.chances.us.sog), avg((g) => g.chances.them.sog), 'high', 1],
    ].slice(0, compact ? 5 : 7);
    return `<div class="colhead big"><span class="t">Season chances</span><span class="r small">PER GAME</span></div><div class="ch${compact ? ' compact' : ''}"${pop('xginfo')}>` +
      rows.map(([label, a, b, better, dp]) => cmpRow(label, a.toFixed(dp), b.toFixed(dp), better)).join('') + '</div>';
  }
  function formPanel(d, compact) {
    const gs = playedGames(d).slice(-10);
    const c = (r) => gs.filter((g) => g.result === r).length;
    const gf = gs.reduce((a, g) => a + g.info.us, 0), ga = gs.reduce((a, g) => a + g.info.them, 0);
    const xs = gs.filter((g) => g.chances), xf = xs.reduce((a, g) => a + g.chances.us.xg, 0), xa = xs.reduce((a, g) => a + g.chances.them.xg, 0);
    const home = gs.filter((g) => g.home), road = gs.filter((g) => !g.home);
    const rec3 = (a) => `${a.filter((g) => g.result === 'W').length}-${a.filter((g) => g.result === 'L').length}-${a.filter((g) => g.result === 'O').length}`;
    const chips = gs.map((g) => `<span class="res ${g.result === 'O' ? 'OT' : g.result}">${g.result === 'O' ? 'OT' : g.result}</span>`).join('');
    const rows = [['Record', `${c('W')}-${c('L')}-${c('O')}`], ['Goals', `${gf}–${ga} (${sign(gf - ga)})`], ['xG share', xf + xa ? `${((100 * xf) / (xf + xa)).toFixed(1)}%` : '–'],
      ['Home', rec3(home)], ['Road', rec3(road)], ['Streak', d.teams[d.team.abbrev].streak]].slice(0, compact ? 4 : 6);
    return `<div class="colhead big"><span class="t">Recent form</span><span class="r small">LAST ${gs.length}</span></div><div class="formp"${pop('form')}><div class="chips">${chips}</div>` +
      `<dl class="frows">${rows.map(([k, v]) => `<div><dt>${esc(k)}</dt><dd class="m">${esc(v)}</dd></div>`).join('')}</dl></div>`;
  }
  const LIST_PANELS = {
    next5: (d) => nextCards(d), last5cards: (d) => lastCards(d), next5rows: (d) => nextRows(d), last5: (d) => lastRows(d),
    chances: (d, c) => chancesPanel(d, c), nextOpp: (d, c) => nextOpponent(d, c), scorers: (d, c) => topScorers(d, c),
    goalies: (d, c) => goalieList(d, c), seasonChances: (d, c) => seasonChances(d, c), form: (d, c) => formPanel(d, c),
  };
  const PICTURE_PANELS = {
    wildcard: wildcardRace, league: leagueTable, results: resultsList, schedule: scheduleList,
    teamStats: (d) => statTiles(d, 'Team stats', ['pp', 'pk', 'gfpg', 'gapg', 'sfpg', 'fo', 'xgPct', 'ptspct']),
    edgeStats: (d) => statTiles(d, 'NHL EDGE', ['topSpeed', 'bursts20', 'topShot', 'shots90', 'distance', 'hdShots', 'ozTime', 'satDiff']),
  };

  // ======================= player cards, ratings, odds =======================
  // percentile tiles: blue when strong, red when weak
  const pctColor = (p) => (p == null ? '#2a2a2a' : p >= 80 ? '#2f6fd1' : p >= 60 ? '#3b5d92' : p >= 40 ? '#3a4150' : p >= 20 ? '#6a3341' : '#a3303f');
  const pctText = (p) => (p == null ? 'NA' : `${p}%`);
  const cardKey = (d, id) => (id && d.cards && d.cards[id] ? `card:${id}` : null);

  function trendSvg(trend) {
    if (!trend || !trend.length) return '';
    const W2 = 390, H2 = 120, x = (i) => (trend.length === 1 ? W2 / 2 : 22 + (i * (W2 - 44)) / (trend.length - 1)), y = (v) => 10 + (1 - v / 100) * (H2 - 34);
    let s = '';
    for (const v of [100, 50, 0]) s += `<line x1="18" x2="${W2 - 4}" y1="${y(v)}" y2="${y(v)}" stroke="#262626" stroke-dasharray="1 3"/><text x="14" y="${y(v) + 3}" fill="#7a7a7a" font-size="8" text-anchor="end">${v}</text>`;
    for (const [k, col] of [['evDef', '#e2475b'], ['evOff', '#5b9cf5'], ['overall', '#ffffff']]) {
      const pts = trend.map((t, i) => [x(i), t[k] == null ? null : y(t[k])]).filter(([, v]) => v != null);
      if (pts.length > 1) s += `<path d="${pts.map(([a, b], i) => `${i ? 'L' : 'M'}${a} ${b}`).join('')}" fill="none" stroke="${col}" stroke-width="2"${k === 'evOff' ? ' stroke-dasharray="4 2"' : ''}/>`;
      for (const [a, b] of pts) s += `<circle cx="${a}" cy="${b}" r="3" fill="${col}"/>`;
    }
    trend.forEach((t, i) => { s += `<text x="${x(i)}" y="${H2 - 6}" fill="#9a9a9a" font-size="9" text-anchor="middle">${esc(t.season)}</text>`; });
    return `<svg viewBox="0 0 ${W2} ${H2}" width="100%" height="${H2}">${s}</svg>`;
  }

  function cardHtml(d, id) {
    const c = d.cards[id];
    if (!c) return '';
    const isG = c.kind === 'G', group = isG ? 'goalies' : c.group === 'D' ? 'defencemen' : 'forwards';
    const info = [['Pos', c.pos], ['Age', c.age ?? '–'], ['Role', c.usage || '–'], [isG ? 'GP' : 'TOI', isG ? c.gp : `${c.toi} / gm`]];
    let h = `<div class="pc-head">${logo(d.team.logo, d.team.abbrev)}<div class="pc-name">${esc(c.full)}${c.number != null ? ` <span class="m">#${c.number}</span>` : ''}</div></div>`;
    h += `<div class="pc-top"><span class="pc-face"><img src="${esc(c.headshot)}" alt=""></span>` +
      `<div class="pc-ovr"><small>Rinkside overall</small><b class="m" style="background:${pctColor(c.overall)}">${pctText(c.overall)}</b></div>` +
      `<dl class="pc-info">${info.map(([k, v]) => `<div><dt>${esc(k)}:</dt><dd>${esc(v)}</dd></div>`).join('')}</dl></div>`;
    if (!c.qualified) h += note(`Not enough games yet to rate against other ${group}.`);
    h += `<div class="pc-tiles${isG ? ' g' : ''}">${c.tiles.map(([label, p]) => `<div class="pt2"><small>${esc(label)}</small><b class="m" style="background:${pctColor(p)}">${pctText(p)}</b></div>`).join('')}</div>`;
    const ex = c.extra;
    if (ex && !isG) h += `<div class="pc-extra"><span>Individual xG <b class="m">${ex.ixg ?? '–'}</b></span><span>Goals − xG <b class="m">${ex.finishing == null ? '–' : (ex.finishing > 0 ? '+' : '') + ex.finishing}</b></span><span>Shot quality <b class="m">${pctText(ex.quality)}</b></span></div>`;
    if (ex && isG) h += `<div class="pc-extra"><span>Goals saved above exp. <b class="m">${ex.gsax > 0 ? '+' : ''}${ex.gsax}</b></span><span>xG faced <b class="m">${ex.xga}</b></span><span>HD save % <b class="m">${ex.hdSv == null ? '–' : pct3(ex.hdSv)}</b></span></div>`;
    if (c.trend && c.trend.length) h += `<div class="pc-trend"><div class="pc-tt">Trend <i style="background:#fff"></i>Overall <i style="background:#5b9cf5"></i>EV off. <i style="background:#e2475b"></i>EV def.</div>${trendSvg(c.trend)}</div>`;
    h += `<div class="pgrid">${(c.stats || []).map(([k, v]) => `<div><b class="m">${esc(v)}</b><span>${esc(k)}</span></div>`).join('')}</div>`;
    h += note(isG
      ? 'Percentiles among NHL goalies with 3+ games. Goals saved above expected uses Rinkside’s xG for every shot faced. Overall: 50% GSAx per 60, 25% save %, 25% high-danger save %.'
      : `Percentiles among NHL ${group} (25%+ of games played). Rinkside overall blends EV offence 28%, EV defence 17%, power play 10%, finishing 10%, goals 10%, 1st assists 10%, penalty kill 5%, penalties 5%, possession 5%.`);
    return h;
  }

  let cardEl = null;
  function openCard(id) {
    closeCard();
    const html = cardHtml(current, id);
    if (!html) return;
    cardEl = document.createElement('div');
    cardEl.className = 'cardwrap';
    cardEl.innerHTML = `<div class="pcard" role="dialog" aria-label="Player card"><button class="px" aria-label="Close">×</button>${html}</div>`;
    cardEl.addEventListener('click', (e) => { if (e.target === cardEl || e.target.closest('.px')) closeCard(); });
    document.body.appendChild(cardEl);
  }
  function closeCard() { cardEl?.remove(); cardEl = null; }

  function ratingsPanel(d, n, title = 'Player ratings') {
    const list = (d.ratings || []).slice(0, n);
    return `<div class="colhead big"><span class="t">${esc(title)}</span><span class="r small">OVERALL %</span></div><div class="rlist">` +
      list.map((r) => `<div class="rrow"${pop(`card:${r.id}`)}><span class="rn m">${r.number ?? ''}</span><span class="rname"><b>${esc(r.name)}</b><small>${esc(r.pos)}${r.usage ? ` · ${esc(r.usage)}` : ''}</small></span><span class="rp m" style="background:${pctColor(r.overall)}">${r.overall}</span></div>`).join('') + '</div>';
  }
  function oddsPanel(d) {
    const me = d.team.abbrev, conf = d.teams[me].conf;
    let rows = Object.entries(d.teams).filter(([, t]) => t.conf === conf).sort((a, b) => b[1].odds.playoff - a[1].odds.playoff || b[1].odds.projPts - a[1].odds.projPts);
    const mine = rows.findIndex(([a]) => a === me);
    rows = mine < 10 ? rows.slice(0, 10) : [...rows.slice(0, 9), rows[mine]];
    return `<div class="colhead big"${pop('wheel')}><span class="t">Playoff odds</span><span class="r small">PROJ \u00b7 ODDS \u2192</span></div><div class="olist">` +
      rows.map(([a, t]) => `<div class="orow${a === me ? ' me' : ''}"${pop(`team:${a}`)}>${logo(t.logo, a)}<span class="ab">${esc(a)}</span><span class="opts m">${t.odds.projPts}</span>` +
        `<span class="obar"><i style="width:${t.odds.playoff}%"></i></span><span class="opct m">${t.odds.playoff >= 99.5 ? '>99' : t.odds.playoff < 0.5 ? '<1' : Math.round(t.odds.playoff)}%</span></div>`).join('') + '</div>';
  }
  PICTURE_PANELS.ratings = (d) => ratingsPanel(d, 10);
  PICTURE_PANELS.odds = oddsPanel;
  LIST_PANELS.ratings = (d, compact) => ratingsPanel(d, compact ? 6 : 9);

  // ======================= wide blocks for the chart slots =======================
  // Each returns { title, note, html } and lays itself out for the slot's width and height
  // (840 x 200 on the full board, narrower on phones, 110 tall in the middle slot).
  const WIDE_TALL = ['wideCard', 'wideOdds', 'wideRatings'];          // need the tall top slot
  const wideStatKeys = {
    wideStats: ['pp', 'pk', 'gfpg', 'gapg', 'sfpg', 'sapg', 'fo', 'shpct', 'svpct', 'ptspct', 'xgPct', 'finishing', 'hdcPct', 'playoffOdds', 'projPts', 'strength'],
    wideEdge: ['topSpeed', 'bursts20', 'bursts22', 'topShot', 'shots90', 'distance', 'hdShots', 'hdPct', 'ozTime', 'dzTime', 'satDiff', 'xgPct', 'finishing', 'hdcPct', 'gdpg', 'strength'],
  };

  function wideCard(d, id, w, h) {
    const c = d.cards?.[id];
    if (!c) return { title: 'Player card', note: '', html: '' };
    const wide = w >= 700;
    const tiles = c.tiles.slice(0, 10).map(([label, p]) => `<div class="wt"><small>${esc(label)}</small><b class="m" style="background:${pctColor(p)}">${pctText(p)}</b></div>`).join('');
    const html = `<div class="wcard${wide ? '' : ' narrow'}"${pop(`card:${id}`)}>` +
      `<div class="wc-id"><span class="pc-face"><img src="${esc(c.headshot)}" alt=""></span><div><b class="wc-n">${esc(c.full)}</b><small>${esc(c.pos)}${c.number != null ? ` · #${c.number}` : ''}${c.age ? ` · ${c.age}` : ''}${c.usage ? ` · ${esc(c.usage)}` : ''}</small>` +
      `<div class="wc-ovr"><small>Overall</small><b class="m" style="background:${pctColor(c.overall)}">${pctText(c.overall)}</b></div></div></div>` +
      `<div class="wc-tiles${c.kind === 'G' ? ' g' : ''}">${tiles}</div>${wide && c.trend?.length ? `<div class="wc-trend">${trendSvg(c.trend)}</div>` : ''}</div>`;
    return { title: `<span${pop(`card:${id}`)}>Player card</span>`, note: `${c.full}: Rinkside overall ${pctText(c.overall)} among NHL ${c.kind === 'G' ? 'goalies' : c.group === 'D' ? 'defencemen' : 'forwards'}`, html };
  }

  function wideOdds(d, w, h) {
    const me = d.team.abbrev, conf = d.teams[me].conf;
    const cols = w >= 700 ? 2 : 1, per = Math.max(1, Math.floor(h / 24)), n = cols * per;
    let rows = Object.entries(d.teams).filter(([, t]) => t.conf === conf).sort((a, b) => b[1].odds.playoff - a[1].odds.playoff || b[1].odds.projPts - a[1].odds.projPts);
    const mine = rows.findIndex(([a]) => a === me);
    rows = mine < n ? rows.slice(0, n) : [...rows.slice(0, n - 1), rows[mine]];
    const row = ([a, t], i) => `<div class="orow${a === me ? ' me' : ''}"${pop(`team:${a}`)}><span class="on m">${i + 1}</span>${logo(t.logo, a)}<span class="ab">${esc(a)}</span><span class="orec">${esc(t.record)}</span><span class="opts m">${t.odds.projPts}</span>` +
      `<span class="obar"><i style="width:${t.odds.playoff}%"></i></span><span class="opct m">${t.odds.playoff >= 99.5 ? '>99' : t.odds.playoff < 0.5 ? '<1' : Math.round(t.odds.playoff)}%</span><span class="odiv m">${Math.round(t.odds.division)}%</span></div>`;
    const html = `<div class="wodds" style="grid-template-columns:repeat(${cols},1fr)">${Array.from({ length: cols }, (_, c) => `<div class="olist">${rows.slice(c * per, (c + 1) * per).map((r, i) => row(r, c * per + i)).join('')}</div>`).join('')}</div>`;
    return { title: `<span${pop('wheel')}>Playoff odds<span class="big">${d.teams[me].odds.playoff}%</span></span>`, note: `${conf} conference · projected points, playoff %, division % · 10,000 simulations`, html };
  }

  function wideRatings(d, w, h) {
    const cols = w >= 700 ? 4 : 2, rows = Math.max(1, Math.floor(h / 48));
    const list = (d.ratings || []).slice(0, cols * rows);
    const html = `<div class="wratings" style="grid-template-columns:repeat(${cols},1fr)">${list.map((r) => {
      const c = d.cards[r.id];
      return `<div class="wr"${pop(`card:${r.id}`)}><span class="face"><img src="${esc(c?.headshot || '')}" alt=""></span><span class="rname"><b>${esc(r.name)}</b><small>${esc(r.pos)}${r.usage ? ` · ${esc(r.usage)}` : ''}</small></span><span class="rp m" style="background:${pctColor(r.overall)}">${r.overall}</span></div>`;
    }).join('')}</div>`;
    return { title: 'Player ratings', note: 'Rinkside overall percentile among NHL players at the same position · tap for the card', html };
  }

  function wideMatchup(d, w, h) {
    const g = d.nextGames[0];
    if (!g) return { title: 'Next game', note: '', html: '<div class="note">No games scheduled</div>' };
    const me = d.team.abbrev, t = d.teams[me], o = d.teams[g.opp] || {}, p = g.winPct ?? 50;
    const metrics = [['Points %', t.pct, o.pct, (v) => pct3(v)], ['xG share', t.xgPct, o.xgPct, f1], ['Power play', t.pp, o.pp, f1], ['Penalty kill', t.pk, o.pk, f1], ['Goals / gm', t.gfpg, o.gfpg, (v) => Number(v).toFixed(2)]]
      .slice(0, h >= 150 ? 5 : 2);
    const bar = ([label, a, b, fmt]) => {
      const sa = +a || 0, sb = +b || 0, share = sa + sb ? (100 * sa) / (sa + sb) : 50;
      return `<div class="mrow"><span class="mv m${sa >= sb ? ' hi' : ''}">${esc(fmt(a))}</span><span class="mbar"><i style="width:${share}%"></i></span><span class="mv m${sb > sa ? ' hi' : ''}">${esc(fmt(b))}</span><span class="ml">${esc(label)}</span></div>`;
    };
    const html = `<div class="wmatch"${pop(`team:${g.opp}`)}><div class="mtop">${logo(t.logo, me)}<span class="mt"><b>${esc(me)}</b><small>${esc(t.record)}</small></span>` +
      `<span class="mwin"><small>${esc(g.dow)} ${esc(g.day)} · ${esc(g.time)} · ${g.home ? 'home' : 'away'}</small><span class="wbar"><i style="width:${p}%"></i></span><span class="wlab"><b class="m">${p}%</b><b class="m">${100 - p}%</b></span></span>` +
      `<span class="mt r"><b>${esc(g.opp)}</b><small>${esc(o.record || '')}</small></span>${logo(o.logo || g.logo, g.opp)}</div><div class="mrows">${metrics.map(bar).join('')}</div></div>`;
    return { title: 'Next game', note: 'win chance from Rinkside’s model · bars compare the two teams', html };
  }

  function wideTiles(d, w, h, which) {
    const per = w >= 700 ? 8 : 4, rows = h >= 150 ? 2 : 1;
    const keys = wideStatKeys[which].filter((k) => d.stats[k]).slice(0, per * rows);
    const html = `<div class="wtiles" style="grid-template-columns:repeat(${per},1fr)">${keys.map((k) => {
      const v = d.stats[k];
      return `<div class="tile"${pop(`stat:${k}`)}><div class="k">${esc(SHORT[k] || v.label)}</div><div class="v">${esc(v.value)}<small>${esc(v.unit.trim() ? ` ${v.unit.trim()}` : '')}</small></div><div class="rk">${v.rank}${suffix(v.rank)} of ${v.of}</div></div>`;
    }).join('')}</div>`;
    return { title: which === 'wideEdge' ? 'EDGE + xG' : 'Team stats', note: 'league rank in each · tap a tile for detail', html };
  }

  function wideChances(d, w, h) {
    const i = lastChances(d);
    if (i == null) return { title: 'Scoring chances', note: '', html: '' };
    const g = d.season.games[i], c = g.chances, me = d.team.abbrev;
    const cols = [['Chances', 'chances', null], ['High', 'hi', 'var(--win)'], ['Mid', 'mid', '#e0b23a'], ['Low', 'low', 'var(--loss)'], ['xG', 'xg', '#5b8fd6'], ['Goals', 'goals', null]];
    const val = (x, k) => (k === 'hi' || k === 'mid' || k === 'low' ? x[k].n : k === 'xg' ? x.xg.toFixed(2) : x[k]);
    const sub = (x, k) => (k === 'hi' || k === 'mid' || k === 'low' ? `xG ${x[k].xg.toFixed(2)}` : '');
    const cell = (x, y, k, tint) => `<div class="cv${+val(x, k) > +val(y, k) ? ' win' : ''}"${tint ? ` style="--tint:${tint}"` : ''}><b class="m">${val(x, k)}</b>${h >= 150 && sub(x, k) ? `<small>${sub(x, k)}</small>` : ''}</div>`;
    const html = `<div class="wch${h >= 150 ? '' : ' short'}"${pop(`chances:${i}`)} style="grid-template-columns:70px repeat(${cols.length},1fr)">` +
      `<div></div>${cols.map(([l]) => `<div class="wl">${l}</div>`).join('')}` +
      `<div class="wtm">${logo(d.teams[me]?.logo, me)}<b>${esc(me)}</b></div>${cols.map(([, k, t]) => cell(c.us, c.them, k, t)).join('')}` +
      `<div class="wtm">${logo(d.teams[g.opp]?.logo, g.opp)}<b>${esc(g.opp)}</b></div>${cols.map(([, k, t]) => cell(c.them, c.us, k, t)).join('')}</div>`;
    return { title: `<span${pop('xginfo')}>Scoring chances<span class="big">${c.us.goals}–${c.them.goals}</span></span>`, note: `last game: ${g.home ? 'vs' : '@'} ${g.opp}, ${g.info.date}`, html };
  }

  function wideLeaders(d, w, h) {
    const keys = ['points', 'goals', 'assists', 'svpct', 'fastest', 'hardest'].filter((k) => d.leaderBoard[k]).slice(0, w >= 700 ? 6 : 3);
    const html = `<div class="wlead" style="grid-template-columns:repeat(${keys.length},1fr)">${keys.map((k) => {
      const l = d.leaderBoard[k];
      return `<div class="wld${h >= 150 ? '' : ' short'}"${pop(cardKey(d, l.id) || `leader:${k}`)}><span class="face"><img src="${esc(l.headshot)}" alt=""></span><small>${esc(l.label.replace(' (EDGE)', ''))}</small><b>${esc(l.name)}</b><span class="m">${esc(l.value)}</span></div>`;
    }).join('')}</div>`;
    return { title: 'Team leaders', note: 'tap a player for the card', html };
  }

  function wideBlock(d, kind, w, h) {
    const [k, arg] = kind.split(':');
    if (k === 'wideCard') return wideCard(d, +arg, w, h);
    if (k === 'wideOdds') return wideOdds(d, w, h);
    if (k === 'wideRun') return wideRunOdds(d, w, h);
    if (k === 'wideRatings') return wideRatings(d, w, h);
    if (k === 'wideMatchup') return wideMatchup(d, w, h);
    if (k === 'wideStats' || k === 'wideEdge') return wideTiles(d, w, h, k);
    if (k === 'wideChances') return wideChances(d, w, h);
    return wideLeaders(d, w, h);
  }

  // ---------- live win probability ----------
  // Goals as Poisson: the pregame win chance sets each team's scoring rate, then the score and
  // the time left decide the rest. A tie after regulation is a coin flip weighted by the same rates.
  const poisson = (l) => { const p = [Math.exp(-l)]; for (let k = 1; k < 15; k++) p.push((p[k - 1] * l) / k); return p; };
  function winFrom(lu, lt, lead) {
    const a = poisson(lu), b = poisson(lt);
    let win = 0, tie = 0;
    for (let i = 0; i < 15; i++) for (let j = 0; j < 15; j++) { const q = a[i] * b[j], m = lead + i - j; if (m > 0) win += q; else if (m === 0) tie += q; }
    return win + tie * (lu / (lu + lt || 1));
  }
  function liveWinPct(L, pre) {
    if (!L || pre == null) return null;
    if (L.state === 'FINAL' || L.state === 'OFF') return L.us > L.them ? 100 : 0;
    // scoring-rate split that reproduces the pregame chance over a full game (about 3 goals a side)
    let lo = 0.2, hi = 5;
    for (let it = 0; it < 40; it++) { const m = (lo + hi) / 2; if (winFrom(3 * Math.sqrt(m), 3 / Math.sqrt(m), 0) < pre / 100) lo = m; else hi = m; }
    const m = (lo + hi) / 2, [mm, ss] = String(L.clock || '20:00').split(':').map(Number);
    const periodNo = { '1st': 1, '2nd': 2, '3rd': 3 }[L.period] || 4;
    const left = periodNo >= 4 ? 0.05 : Math.max(0, ((3 - periodNo) * 20 + (L.intermission ? 0 : mm + ss / 60)) / 60);
    return Math.round(100 * winFrom(3 * Math.sqrt(m) * left, (3 / Math.sqrt(m)) * left, L.us - L.them));
  }

  // ======================= playoff-run wheel =======================
  const RUN = [['playoff', 'Make playoffs'], ['round2', 'Make 2nd round'], ['round3', 'Make conf. final'], ['final', 'Make Final'], ['cup', 'Win Cup']];
  const pctLabel = (v) => (v >= 99.5 ? '>99%' : v >= 10 ? `${Math.round(v)}%` : v >= 0.1 ? `${v.toFixed(1)}%` : '');

  function wheelSvg(d) {
    const me = d.team.abbrev, C = 330, rings = [[205, 262], [162, 205], [121, 162], [82, 121], [44, 82]];
    const divOrder = ['Atlantic', 'Metropolitan', 'Central', 'Pacific'];
    const teams = Object.entries(d.teams).filter(([, t]) => t.odds)
      .sort((a, b) => divOrder.indexOf(a[1].div) - divOrder.indexOf(b[1].div) || b[1].odds.playoff - a[1].odds.playoff);
    const pt = (r, a) => [C + r * Math.sin(a), C - r * Math.cos(a)];
    const sector = (r0, r1, a0, a1) => {
      const large = a1 - a0 > Math.PI ? 1 : 0, [x0, y0] = pt(r1, a0), [x1, y1] = pt(r1, a1), [x2, y2] = pt(r0, a1), [x3, y3] = pt(r0, a0);
      return `M${x0.toFixed(1)} ${y0.toFixed(1)}A${r1} ${r1} 0 ${large} 1 ${x1.toFixed(1)} ${y1.toFixed(1)}L${x2.toFixed(1)} ${y2.toFixed(1)}A${r0} ${r0} 0 ${large} 0 ${x3.toFixed(1)} ${y3.toFixed(1)}Z`;
    };
    let s = '', mine = '', outerMid = {};
    RUN.forEach(([k, label], ri) => {
      const [r0, r1] = rings[ri], total = teams.reduce((a, [, t]) => a + t.odds[k], 0) || 1;
      let a = 0;
      for (const [abbr, t] of teams) {
        const v = t.odds[k], span = (v / total) * 2 * Math.PI;
        if (span <= 0) { if (ri === 0) outerMid[abbr] = a; continue; }   // no slice, but keep its logo in order
        const path = `<path d="${sector(r0, r1, a, a + span)}" fill="${esc(t.color)}" stroke="#0b0b0b" stroke-width="0.8"><title>${esc(t.name)}: ${label.toLowerCase()} ${v}%</title></path>`;
        s += path;
        if (abbr === me) mine += `<path d="${sector(r0, r1, a, a + span)}" fill="none" stroke="#fff" stroke-width="2.4"/>`;
        const mid = a + span / 2, rm = (r0 + r1) / 2;
        if (span * rm >= 30) {
          const [tx, ty] = pt(rm, mid);
          s += `<text x="${tx.toFixed(1)}" y="${(ty + 3.5).toFixed(1)}" text-anchor="middle" class="wv">${pctLabel(v)}</text>`;
        }
        if (ri === 0) outerMid[abbr] = mid;
        a += span;
      }
    });
    // ring separators and labels at the top
    for (const [, r1] of rings) s += `<circle cx="${C}" cy="${C}" r="${r1}" fill="none" stroke="#e8e8e8" stroke-width="1.2" opacity=".85"/>`;
    s += `<circle cx="${C}" cy="${C}" r="42" fill="#141414" stroke="#e8e8e8" stroke-width="1.2"/>`;
    s += `<text x="${C}" y="${C - 3}" text-anchor="middle" class="wh">STANLEY</text><text x="${C}" y="${C + 11}" text-anchor="middle" class="wh">CUP</text>`;
    RUN.forEach(([, label], ri) => { s += `<text x="${C}" y="${C - rings[ri][1] + 14}" text-anchor="middle" class="wr2">${label}</text>`; });
    // logos round the rim, nudged apart so none overlap
    const placed = teams.filter(([a]) => outerMid[a] != null).map(([a, t]) => ({ a, t, ang: outerMid[a] }));
    const minGap = (2 * Math.PI) / Math.max(placed.length, 1) * 0.92;
    for (let pass = 0; pass < 40; pass++) for (let i = 1; i < placed.length; i++) {
      const gap = placed[i].ang - placed[i - 1].ang;
      if (gap < minGap) { const push = (minGap - gap) / 2; placed[i - 1].ang -= push; placed[i].ang += push; }
    }
    for (const p of placed) {
      const [lx0, ly0] = pt(263, outerMid[p.a]), [lx1, ly1] = pt(284, p.ang), [cx, cy] = pt(302, p.ang);
      s += `<line x1="${lx0.toFixed(1)}" y1="${ly0.toFixed(1)}" x2="${lx1.toFixed(1)}" y2="${ly1.toFixed(1)}" stroke="#555" stroke-width="0.8"/>`;
      s += `<image href="${esc(p.t.logo)}" x="${(cx - 17).toFixed(1)}" y="${(cy - 17).toFixed(1)}" width="34" height="34"${p.a === me ? ' class="wme"' : ''}><title>${esc(p.t.name)}</title></image>`;
    }
    return `<svg class="wheel" viewBox="0 0 ${2 * C} ${2 * C}" role="img" aria-label="Playoff run odds wheel">${s}${mine}</svg>`;
  }

  let wheelEl = null;
  function openWheel() {
    closeWheel();
    const d = current, me = d.team.abbrev, o = d.teams[me].odds;
    wheelEl = document.createElement('div');
    wheelEl.className = 'cardwrap';
    wheelEl.innerHTML = `<div class="pcard wheelcard" role="dialog" aria-label="Playoff run odds"><button class="px" aria-label="Close">×</button>` +
      `<div class="pc-head">${logo(d.team.logo, me)}<div class="pc-name">Playoff run odds</div></div>` +
      `<div class="wsum">${RUN.map(([k, label]) => `<div><small>${label}</small><b class="m">${pctLabel(o[k]) || '<0.1%'}</b></div>`).join('')}</div>${wheelSvg(d)}` +
      note(`${d.team.name} outlined. Outer ring: making the playoffs; inner ring: winning the Cup. Each ring is split by every team’s odds. From 10,000 simulated seasons and playoff brackets (best-of-seven series, home ice to the team with more points).`) + '</div>';
    wheelEl.addEventListener('click', (e) => { if (e.target === wheelEl || e.target.closest('.px')) closeWheel(); });
    document.body.appendChild(wheelEl);
  }
  function closeWheel() { wheelEl?.remove(); wheelEl = null; }

  // wide block: the same five numbers per team as a heat table
  function wideRunOdds(d, w, h) {
    const me = d.team.abbrev, conf = d.teams[me].conf;
    const cols = w >= 700 ? 2 : 1, per = Math.max(1, Math.floor((h - 16) / 23)), n = cols * per;
    let rows = Object.entries(d.teams).filter(([, t]) => t.conf === conf && t.odds).sort((a, b) => b[1].odds.cup - a[1].odds.cup || b[1].odds.playoff - a[1].odds.playoff);
    const mine = rows.findIndex(([a]) => a === me);
    rows = mine < n ? rows.slice(0, n) : [...rows.slice(0, n - 1), rows[mine]];
    const max = Object.fromEntries(RUN.map(([k]) => [k, Math.max(...rows.map(([, t]) => t.odds[k]), 1)]));
    const head = `<div class="rrh"><span></span>${RUN.map(([k]) => `<span>${{ playoff: 'Playoffs', round2: 'Rd 2', round3: 'Conf F', final: 'Final', cup: 'Cup' }[k]}</span>`).join('')}</div>`;
    const row = ([a, t]) => `<div class="rrr${a === me ? ' me' : ''}"><span class="rrt">${logo(t.logo, a)}<b>${esc(a)}</b></span>${RUN.map(([k]) => {
      const v = t.odds[k], shade = Math.round(18 + 62 * (v / max[k]));
      return `<span class="rrc m" style="background:color-mix(in srgb, #2f6fd1 ${shade}%, #1b1b1b)">${pctLabel(v) || '0%'}</span>`;
    }).join('')}</div>`;
    const html = `<div class="wrun"${pop('wheel')} style="grid-template-columns:repeat(${cols},1fr)">${Array.from({ length: cols }, (_, c) => `<div>${head}${rows.slice(c * per, (c + 1) * per).map(row).join('')}</div>`).join('')}</div>`;
    return { title: `<span${pop('wheel')}>Playoff run odds<span class="big">${pctLabel(d.teams[me].odds.cup) || '<0.1%'} Cup</span></span>`, note: `${conf} conference · tap for the league wheel`, html };
  }

  // ---------- full board ----------
  let current = null;
  function render(d) {
    current = d;
    MODE = modeFor();
    const G = GEOM[MODE];
    document.body.classList.toggle('stack', MODE === 'stack');
    board.style.width = `${G.W}px`; board.style.height = `${G.H}px`;
    const root = document.documentElement.style;
    if (d.team.primaryColor) root.setProperty('--primary', d.team.primaryColor);
    if (d.team.accentColor) root.setProperty('--accent', d.team.accentColor);
    document.title = `${d.team.name} · Rinkside`;

    const remix = document.getElementById('remix');
    if (remix) {
      const alt = esc(d.team.altLogo || d.team.logo);
      remix.innerHTML = `<svg width="100%" height="100%"><defs><pattern id="remix-bg" width="168" height="168" patternUnits="userSpaceOnUse" patternTransform="rotate(-12)">
        <image href="${alt}" x="8" y="8" width="68" height="68" preserveAspectRatio="xMidYMid meet"/>
        <image href="${alt}" x="92" y="92" width="68" height="68" preserveAspectRatio="xMidYMid meet"/>
      </pattern></defs><rect width="100%" height="100%" fill="url(#remix-bg)"/></svg>`;
    }

    const h = d.header;
    pieces = {
      meta: () => (live && live.state !== 'FUT' ? liveMeta(d) : `<div class="meta"><div>${esc(h.date)}</div><div${pop('splits')}>${esc(h.splits)}</div><div${pop('sos')}>${esc(h.schedule)}</div></div>`),
      chart1: () => chartSlot(d, 'chart1', ...G.chart1),
      chart2: () => chartSlot(d, 'chart2', ...G.chart2),
      upper: () => slotBox('upper', ...G.upper, (LIST_PANELS[pick(d, 'upper')] || LIST_PANELS.next5)(d, false)),
      lower: () => slotBox('lower', ...G.lower, (LIST_PANELS[pick(d, 'lower')] || LIST_PANELS.last5)(d, true)),
    };
    let s = `<header class="abs hdr">
      <svg class="band" viewBox="0 0 210 95" width="210" height="95" preserveAspectRatio="none">
        <polygon points="0,0 196,0 171,95 0,95" fill="var(--primary)"/>
        <polygon points="196,0 204,0 179,95 171,95" fill="var(--accent)"/>
      </svg>
      <div class="band" style="background:none" title="Change team"${I ? ' role="button" tabindex="0"' : ''}><img src="${esc(d.team.logo)}" alt="${esc(d.team.name)}"></div>
      <div class="record"${pop('record')}>${esc(h.record)}</div>
      <div class="summary"><b>${h.points} points</b>, ${esc(h.summary)}</div>
      ${pieces.meta()}
    </header>`;

    s += pieces.chart1();
    s += pieces.chart2();

    for (const k of ['col1.0', 'col1.1', 'col2.0', 'col2.1']) s += slotBox(k, ...G[k], section(d, k));
    s += slotBox('picture', ...G.picture, picture(d, 'picture'), 'ppic');
    const [bx, by] = G.boxes, bw = (G.picture[2] - 8) / 2;
    s += `<div class="abs st" style="left:${bx}px;top:${by}px;width:${G.picture[2]}px;margin:0">${slotBox('boxes.0', 0, 0, bw, 54, statBox(d, 'boxes.0'))}${slotBox('boxes.1', bw + 8, 0, bw, 54, statBox(d, 'boxes.1'))}</div>`;
    const [lx, ly] = G.leaders;
    s += `<div class="abs" style="left:${lx}px;top:${ly}px;width:${G.picture[2]}px"><div class="colhead big"><span class="t">Team leaders</span></div></div>`;
    for (let i = 0; i < 3; i++) s += slotBox(`leaders.${i}`, lx, ly + 36 + i * 55, G.picture[2], 55, leaderRow(d, `leaders.${i}`));
    s += pieces.upper();
    s += pieces.lower();

    s += `<footer class="abs foot" style="left:${G.foot[0]}px;top:${G.foot[1]}px;width:${G.foot[2]}px">
      <span class="k"><i class="sw" style="background:var(--win)"></i>Win</span>
      <span class="k"><i class="sw" style="background:var(--loss)"></i>Loss</span>
      <span class="k"><i class="sw" style="background:var(--otl)"></i>OT/SO loss</span>
      <span class="k"><i class="sw" style="background:var(--future)"></i>Still to play</span>
      <span class="k">Filled dot or house = home, ring or plane = away</span>
      <span class="brand" title="Change team or customize">RINKSIDE</span>
    </footer>`;
    board.innerHTML = s;
    lastPieces = Object.fromEntries(Object.entries(pieces).map(([k, f]) => [k, f()]));
    closePop();
    if (editing) decorateSlots();
    fit();
    if (I) maybeStartLive(d);
  }

  // ---------- live games ----------
  let pieces = {}, lastPieces = {}, liveTimer = null, liveFor = null, core = null;
  const ordinalPeriod = (n, type) => (type === 'OT' ? (n > 4 ? `${n - 3}OT` : 'OT') : type === 'SO' ? 'SO' : ['1st', '2nd', '3rd'][n - 1] || `${n}th`);
  const liveShort = () => `<b class="lv">${live.us}–${live.them}</b> <small>${esc(live.period)}</small>`;
  const isOver = (L) => L.state === 'FINAL' || L.state === 'OFF';

  function liveMeta(d) {
    const L = live, me = d.team.abbrev;
    const status = isOver(L) ? 'Final' : L.state === 'PRE' ? 'Pregame' : L.intermission ? `${L.period} intermission` : `${L.period} · ${L.clock}`;
    const wp = liveWinPct(L, d.nextGames.find((g) => g.id === L.id)?.winPct);
    const extra = [wp != null && !isOver(L) ? `Win ${wp}%` : '', `Shots ${L.sogUs}\u2013${L.sogThem}`, L.chances ? `xG ${L.chances.us.xg.toFixed(2)}\u2013${L.chances.them.xg.toFixed(2)}` : '', L.pp].filter(Boolean).join(' \u00b7 ');
    return `<div class="meta livebox"${pop('live')}><div class="ls"><i class="dot${isOver(L) ? ' off' : ''}"></i>${esc(status)}</div>` +
      `<div class="lsc">${logo(d.teams[me]?.logo, me)}<span class="m">${L.us}</span><span class="dash">–</span><span class="m">${L.them}</span>${logo(d.teams[L.opp]?.logo || L.oppLogo, L.opp)}</div>` +
      `<div class="lx">${esc(extra)}</div></div>`;
  }

  function livePop(d) {
    const L = live;
    if (!L) return '';
    const me = d.team.abbrev;
    let h = `<div class="pk">${isOver(L) ? 'Final' : '<b class="lv">Live</b>'} · ${L.home ? 'vs' : '@'} ${esc(L.opp)}</div>`;
    h += `<div class="pt">${logo(d.teams[me]?.logo, me)}<span class="big m">${L.us}–${L.them}</span>${logo(d.teams[L.opp]?.logo || L.oppLogo, L.opp)}<span class="pst">${esc(isOver(L) ? 'Final' : L.intermission ? `${L.period} int.` : `${L.period} ${L.clock}`)}</span></div>`;
    const wp = liveWinPct(L, d.nextGames.find((g) => g.id === L.id)?.winPct);
    h += rowsHtml([!isOver(L) && wp != null ? ['Win chance (live)', `${wp}%`, true] : null, ['Shots on goal', `${L.sogUs}\u2013${L.sogThem}`, true], L.chances ? ['Expected goals', `${L.chances.us.xg.toFixed(2)}–${L.chances.them.xg.toFixed(2)}`, true] : null,
      L.chances ? ['High-danger chances', `${L.chances.us.hi.n}–${L.chances.them.hi.n}`, true] : null, ['Situation', L.pp || 'Even strength']]);
    h += L.goals.length
      ? `<div class="pgoals">${L.goals.map((g) => `<div><span class="m">${esc(g.when)}</span>${logo(d.teams[g.team]?.logo, g.team)}<span><b>${esc(g.scorer)}</b>${g.assists ? ` <small>(${esc(g.assists)})</small>` : ''}${g.tag ? ` <small class="tag">${esc(g.tag)}</small>` : ''}</span></div>`).join('')}</div>`
      : note('No goals yet.');
    h += `<a class="plink" href="https://www.nhl.com/gamecenter/${L.id}" target="_blank" rel="noopener">Game Center ↗</a>`;
    return h;
  }

  function parseLive(pbp, d) {
    const me = d.team.abbrev, isHome = pbp.homeTeam.abbrev === me;
    const us = isHome ? pbp.homeTeam : pbp.awayTeam, them = isHome ? pbp.awayTeam : pbp.homeTeam;
    const pd = pbp.periodDescriptor || {};
    const names = Object.fromEntries((pbp.rosterSpots || []).map((r) => [r.playerId, `${r.firstName.default[0]}. ${r.lastName.default}`]));
    const abbrevOf = (id) => (id === pbp.homeTeam.id ? pbp.homeTeam.abbrev : pbp.awayTeam.abbrev);
    const lastSit = [...(pbp.plays || [])].reverse().find((p) => p.situationCode)?.situationCode || '1551';
    const [ag, as, hs, hg] = String(lastSit).padStart(4, '0').split('').map(Number);
    const own = isHome ? hs : as, opp = isHome ? as : hs;
    const pp = own > opp ? `${me} power play` : own < opp ? `${them.abbrev} power play`
      : (isHome ? ag : hg) === 0 ? `${them.abbrev} net empty` : (isHome ? hg : ag) === 0 ? `${me} net empty` : '';
    const goals = (pbp.plays || []).filter((p) => p.typeDescKey === 'goal').map((p) => {
      const x = p.details || {}, gp = p.periodDescriptor || {};
      const sc = String(p.situationCode || '1551').padStart(4, '0').split('').map(Number), home = x.eventOwnerTeamId === pbp.homeTeam.id;
      const o = home ? sc[2] : sc[1], t = home ? sc[1] : sc[2], oppG = home ? sc[0] : sc[3];
      return { when: `${ordinalPeriod(gp.number, gp.periodType)} ${p.timeInPeriod}`, team: abbrevOf(x.eventOwnerTeamId), scorer: names[x.scoringPlayerId] || 'Goal',
        assists: [x.assist1PlayerId, x.assist2PlayerId].filter(Boolean).map((a) => names[a]).join(', '),
        tag: oppG === 0 ? 'EN' : o > t ? 'PP' : o < t ? 'SH' : '' };
    });
    let chances = null;
    if (core && d.xgModel) try { chances = core.report(core.reduce(pbp), us.id, d.xgModel); } catch {}
    return {
      id: pbp.id, state: pbp.gameState, home: isHome, opp: them.abbrev, oppLogo: them.darkLogo || them.logo,
      us: us.score ?? 0, them: them.score ?? 0, sogUs: us.sog ?? 0, sogThem: them.sog ?? 0,
      period: pd.number ? ordinalPeriod(pd.number, pd.periodType) : '', clock: pbp.clock?.timeRemaining || '',
      intermission: !!pbp.clock?.inIntermission, pp, goals, chances,
    };
  }

  // redraw only the pieces that changed, keeping any open popup
  function renderLive() {
    if (!current) return;
    for (const [k, f] of Object.entries(pieces)) {
      const html = f();
      if (html === lastPieces[k]) continue;
      lastPieces[k] = html;
      const el = k === 'meta' ? board.querySelector('.hdr .meta') : board.querySelector(`.slot[data-slot="${k}"]`);
      if (el) el.outerHTML = html;
    }
    if (editing) decorateSlots();
    if (popKey) board.querySelector(`[data-pop="${CSS.escape(popKey)}"]`)?.classList.add('is-active');
    if (popKey === 'live' && popEl) {
      popEl.innerHTML = `<button class="px" aria-label="Close">×</button>${livePop(current)}`;
      popEl.querySelector('.px').addEventListener('click', closePop);
    }
  }

  async function pollLive() {
    if (!liveFor || document.hidden || !current) return;
    try {
      core ??= await import('./chances-core.mjs').catch(() => null);
      const res = await fetch(`${index.liveProxy}/v1/gamecenter/${liveFor}/play-by-play`, { cache: 'no-store' });
      if (!res.ok) throw new Error(res.status);
      const L = parseLive(await res.json(), current);
      if (L.state === 'FUT') return;   // not started yet; keep the normal header
      const justEnded = isOver(L) && live && !isOver(live);
      live = L;
      renderLive();
      if (isOver(L)) {
        // game over: stop polling; the regular data refresh picks up the final within minutes
        clearInterval(liveTimer); liveTimer = null; liveFor = null;
        if (justEnded) setTimeout(() => load(), 3 * 60 * 1000);
      }
    } catch { /* keep the last state; try again on the next tick */ }
  }

  function maybeStartLive(d) {
    if (!index?.liveProxy || wallpaper) return;
    if (live && d.season.games.some((x) => x.id === live.id && x.result)) live = null;   // data has caught up with the final
    const g = d.nextGames?.[0];
    if (!g?.id) return;
    const start = Date.parse(g.startUTC), now = Date.now();
    const inWindow = now >= start - 15 * 60 * 1000 && now <= start + 6 * 3600 * 1000;
    if (!inWindow || liveFor === g.id) return;
    liveFor = g.id;
    clearInterval(liveTimer);
    pollLive();
    liveTimer = setInterval(pollLive, 15000);
  }
  document.addEventListener('visibilitychange', () => { if (!document.hidden && liveFor) pollLive(); });


  // ---------- detail popups ----------
  let popEl = null, popKey = null;
  const rowsHtml = (rows) => `<dl class="prows">${rows.filter((r) => r && r[1] !== '' && r[1] != null)
    .map(([k, v, mono]) => `<div><dt>${esc(k)}</dt><dd${mono ? ' class="m"' : ''}>${esc(v)}</dd></div>`).join('')}</dl>`;
  const resChip = (r, last) => {
    const t = r === 'W' ? 'W' : r === 'O' ? (last || 'OT') : 'L';
    return `<span class="res ${t}">${t}</span>`;
  };
  const note = (t) => `<div class="pnote">${esc(t)}</div>`;

  function gamePop(info, kicker) {
    const final = info.status.startsWith('Final'), last = info.status.split('/')[1];
    let h = `<div class="pk">${esc(kicker)}</div><div class="pt">${logo(info.oppLogo, info.oppAbbrev)}<span>${info.home ? 'vs' : '@'} ${esc(info.opp)}</span></div>`;
    if (final) h += `<div class="ps">${resChip(info.result, last)}<span class="psc">${info.us}–${info.them}</span><span class="pst">${esc(info.status)}</span></div>`;
    else if (info.status === 'Live') h += `<div class="ps"><span class="res live">LIVE</span><span class="psc">${info.us ?? 0}–${info.them ?? 0}</span></div>`;
    h += rowsHtml([!final && info.winPct != null ? ['Win chance (model)', `${info.winPct}%`, true] : null, ['Date', info.date], [final ? 'Started' : 'Puck drop', info.time], ['Arena', info.venue], ['TV', info.tv],
      final && info.gwg ? ['Winning goal', info.gwg] : null, final && info.winGoalie ? ['Winning goalie', info.winGoalie] : null]);
    if (info.link) h += `<a class="plink" href="${esc(info.link)}" target="_blank" rel="noopener">Game Center ↗</a>`;
    return h;
  }
  const playedGame = (d, k) => d.season.games.filter((g) => g.result)[k - 1];
  const vsLine = (g) => (g ? `${g.home ? 'vs' : '@'} ${g.opp} · ${g.info.date}` : '');

  function popContent(key) {
    const d = current, [kind, arg] = key.split(':');
    const teamPop = (a, kicker) => {
      const t = d.teams[a];
      return `<div class="pk">${esc(kicker)}</div><div class="pt">${logo(t.logo, a)}<span>${esc(t.name)}</span></div>` +
        rowsHtml([['Record', t.record, true], ['Points', `${t.pts} in ${t.gp} GP`, true], ['Points %', pct3(t.pct), true],
          ['Goals', `${t.gf}–${t.ga} (${sign(t.diff)})`, true], ['Home', t.home, true], ['Road', t.road, true],
          ['Last 10', t.l10, true], ['Streak', t.streak, true], ['Regulation wins', t.rw, true],
          t.odds ? ['Playoff odds (model)', `${t.odds.playoff}%`, true] : null, t.odds ? ['Projected points', t.odds.projPts, true] : null,
          t.odds ? ['Division title odds', `${t.odds.division}%`, true] : null, t.strength != null ? ['Strength rating', (t.strength > 0 ? '+' : '') + t.strength, true] : null]);
    };
    switch (kind) {
      case 'game': return gamePop(d.season.games[+arg].info, `Game ${+arg + 1} of ${d.season.total}`);
      case 'next': return gamePop(d.nextGames[+arg].info, `Next up · game ${+arg + 1} of 5`);
      case 'chances': return `<div class="pk">Scoring chances \u00b7 game ${+arg + 1}</div>${chancesTable(d, d.season.games[+arg], false)}`;
      case 'live': return livePop(d);
      case 'xginfo':
        return `<div class="pk">How this works</div><div class="pt"><span>Scoring chances &amp; xG</span></div>` +
          note('A scoring chance is a shot on goal from inside the offensive zone with the goalie in net. High danger: within 20 ft of the goal line and 19 ft of centre. Mid: within 30 ft. Low: anywhere else in the zone. Shots from 58+ ft out are dumps.') +
          note('Expected goals (xG) is the chance each shot becomes a goal, from Rinkside’s model fitted on every shot on goal in the NHL this season: distance, angle, shot type, rebounds, rush chances and power play. Across the league, xG adds up to actual goals.') +
          note('Tap a column in the Expected goals chart for any game’s report.');
      case 'line': {
        const k = +arg, v = d.playoffLine.history[k], prev = d.playoffLine.history[k - 1], g = playedGame(d, k);
        return `<div class="pk">Playoff line · after game ${k}</div><div class="pt"><span class="big m">${sign(v)}</span><span>${v >= 0 ? 'points clear of the line' : 'points behind the line'}</span></div>` +
          rowsHtml([['Game', vsLine(g)], ['Change', `${sign(v - prev)} on the game`, true],
            ['Season high so far', sign(Math.max(...d.playoffLine.history.slice(1, k + 1))), true], ['Season low so far', sign(Math.min(...d.playoffLine.history.slice(1, k + 1))), true]]);
      }
      case 'gd': {
        const k = +arg, s = goalDiffSeries(d), g = playedGame(d, k);
        const gf = d.season.games.filter((x) => x.result).slice(0, k).reduce((a, x) => a + x.info.us, 0);
        const ga = d.season.games.filter((x) => x.result).slice(0, k).reduce((a, x) => a + x.info.them, 0);
        return `<div class="pk">Goal differential · after game ${k}</div><div class="pt"><span class="big m">${sign(s[k])}</span><span>${gf} for, ${ga} against</span></div>` +
          rowsHtml([['Game', vsLine(g)], ['Per game', `${(gf / k).toFixed(2)} for, ${(ga / k).toFixed(2)} against`, true]]);
      }
      case 'race': {
        const k = +arg, g = playedGame(d, k), r = d.race;
        const rows = r.teams.map((t) => [t, r.pts[t][k]]).sort((a, b) => b[1] - a[1]);
        return `<div class="pk">Division race · after game ${k}</div><div class="pt"><span>${esc(g ? g.info.date : '')}</span></div>` +
          rowsHtml(rows.map(([t, p], i) => [`${i + 1}. ${d.teams[t]?.name || t}`, `${p} pts`, true]));
      }
      case 'team': {
        const rows = [...d.pictures.own.divRows, ...d.pictures.own.wcRows, ...d.pictures.own.outRows, ...(d.pictures.other ? [...d.pictures.other.divRows, ...d.pictures.other.wcRows, ...d.pictures.other.outRows] : [])];
        const r = rows.find((x) => x.abbrev === arg);
        const where = r?.label ? (r.label.startsWith('WC') ? `Wild card ${r.label.slice(2)}` : `${d.teams[arg].div} · ${r.label.slice(1)}${suffix(+r.label.slice(1))}`) : `${d.teams[arg].div} · ${d.teams[arg].divSeq}${suffix(d.teams[arg].divSeq)}`;
        return teamPop(arg, where);
      }
      case 'series': {
        const t = d.teams[arg] || { name: arg }, gs = d.season.games.filter((g) => g.opp === arg);
        const c = (r) => gs.filter((g) => g.result === r).length, left = gs.filter((g) => !g.result).length;
        return `<div class="pk">Season series</div><div class="pt">${logo(t.logo, arg)}<span>vs ${esc(t.name)}</span></div>` +
          `<div class="ps"><span class="psc">${c('W')}-${c('L')}-${c('O')}</span><span class="pst">${left} to play</span></div>` +
          rowsHtml(gs.map((g) => [`${g.info.date} · ${g.home ? 'home' : 'away'}`, g.result ? ({ W: 'Win', L: 'Loss', O: `${g.info.status.split('/')[1] || 'OT'} loss` })[g.result] : g.info.time])) +
          note('Scores are in the season chart above.');
      }
      case 'div': {
        const dv = d.divisions.find((x) => x.name === arg);
        return `<div class="pk">Record vs division</div><div class="pt"><span>${esc(arg)}</span></div><div class="ps"><span class="psc">${esc(dv.record)}</span><span class="pst">W-L-OTL</span></div>` +
          rowsHtml(dv.teams.map((t) => {
            const c = (r) => t.games.filter((g) => g.result === r).length, left = t.games.filter((g) => !g.result).length;
            return [d.teams[t.abbrev]?.name || t.abbrev, `${c('W')}-${c('L')}-${c('O')}${left ? ` (${left} left)` : ''}`, true];
          }));
      }
      case 'stat': {
        const v = d.stats[arg];
        if (v.sim) return `<div class="pk">Rinkside model</div><div class="pt"><span>${esc(v.label)}</span></div><div class="ps"><span class="psc">${esc(v.value)}${esc(v.unit)}</span><span class="pst">${v.rank}${suffix(v.rank)} of ${v.of}</span></div>` +
          note('Team strength blends expected-goals share (50%), points % (30%) and goal differential (20%), shrunk toward average early in the season. Win chances come from a curve fitted on this season\u2019s results (home ice included); playoff odds play out the rest of the schedule 10,000 times.');
        return `<div class="pk">${v.edge ? 'NHL EDGE tracking' : 'Team stat'}</div><div class="pt"><span>${esc(v.label)}</span></div>` +
          `<div class="ps"><span class="psc">${esc(v.value)}${esc(v.unit)}</span><span class="pst">${v.rank}${suffix(v.rank)} of ${v.of}</span></div>` +
          rowsHtml([['League average', v.avg ? `${v.avg}${v.unit}` : '', true], ['League best', v.best || ''], ['Set by', v.by || '']]);
      }
      case 'leader': {
        const l = d.leaderBoard[arg];
        return `<div class="pk">${esc(l.label)} leader</div><div class="pt"><span class="face sm"><img src="${esc(l.headshot)}" alt=""></span><span>${esc(l.full || l.name)}</span></div>` +
          `<div class="pgrid">${(l.stats || []).map(([k, v]) => `<div><b class="m">${esc(v)}</b><span>${esc(k)}</span></div>`).join('')}</div>`;
      }
      case 'form': {
        const L = d.lastGames, c = (r) => L.filter((g) => g.info.result === r).length;
        const gf = L.reduce((a, g) => a + g.info.us, 0), ga = L.reduce((a, g) => a + g.info.them, 0);
        return `<div class="pk">Recent form · last ${L.length}</div><div class="pt"><span>${c('W')}-${c('L')}-${c('O')}</span></div>` +
          rowsHtml([['Goals', `${gf}–${ga} (${sign(gf - ga)})`, true], ['Home', `${L.filter((g) => g.info.home).length} games`, true],
            ['Road', `${L.filter((g) => !g.info.home).length} games`, true], ['Streak', d.teams[d.team.abbrev].streak, true], ['Last 10', d.teams[d.team.abbrev].l10, true]]) +
          note('Tap a game in the season chart for its full details.');
      }
      case 'record': {
        const h0 = d.header, t = h0.info;
        return `<div class="pk">${esc(h0.date)}</div><div class="pt"><span>${esc(d.team.name)}</span></div><div class="ps"><span class="psc">${esc(h0.record)}</span><span class="pst">${h0.points} points</span></div>` +
          rowsHtml([['Points %', t.ptsPct, true], ['On pace for', `${t.pace} points`, true], ['Goals', `${t.gf}–${t.ga} (${sign(t.diff)})`, true],
            ['League rank', `${t.leagueRank}${suffix(t.leagueRank)} of 32`, true], ['Conference rank', `${t.confRank}${suffix(t.confRank)}`, true],
            ['Regulation wins', t.rw, true], ['Reg. + OT wins', t.row, true],
            d.teams[d.team.abbrev]?.odds ? ['Playoff odds (model)', `${d.teams[d.team.abbrev].odds.playoff}%`, true] : null,
            d.teams[d.team.abbrev]?.odds ? ['Projected points', d.teams[d.team.abbrev].odds.projPts, true] : null]);
      }
      case 'splits':
        return `<div class="pk">Splits</div><div class="pt"><span>Home, road and recent form</span></div>` +
          rowsHtml(d.header.info.splits.map(([k, r, gf, ga]) => [k, `${r} · ${gf}–${ga}`, true]));
      case 'sos': {
        const o = d.header.info.sos;
        const tough = [...new Set(d.season.games.filter((g) => !g.result).map((g) => g.opp))].map((a) => [a, d.teams[a]]).filter(([, t]) => t)
          .sort((x, y) => y[1].pct - x[1].pct).slice(0, 3);
        return `<div class="pk">Schedule strength</div><div class="pt"><span>${o.rank}${suffix(o.rank)}-toughest of ${o.of}</span></div>` +
          rowsHtml([['Games left', `${o.left} (${o.homeLeft} home, ${o.roadLeft} road)`, true], ['Opponents’ points %', o.oppPct, true],
            ...tough.map(([, t], i) => [i ? '' : 'Toughest left', `${t.name} ${pct3(t.pct)}`])]) +
          note('Average current points % of every opponent still to play, ranked across the league.');
      }
      case 'season': {
        const ps = d.season.games.filter((g) => g.result);
        let best = 0, worst = 0, w = 0, l = 0, longW = 0, longL = 0;
        for (const g of ps) {
          const m = g.info.us - g.info.them;
          best = Math.max(best, m); worst = Math.min(worst, m);
          if (g.result === 'W') { w++; l = 0; } else { l++; w = 0; }
          longW = Math.max(longW, w); longL = Math.max(longL, l);
        }
        const one = ps.filter((g) => Math.abs(g.info.us - g.info.them) === 1), c = (a, r) => a.filter((g) => g.result === r).length;
        return `<div class="pk">${ps.length} of ${d.season.total} played</div><div class="pt"><span>Season so far</span></div>` +
          rowsHtml([['Longest win streak', longW, true], ['Longest winless run', longL, true], ['One-goal games', `${c(one, 'W')}-${c(one, 'L')}-${c(one, 'O')}`, true],
            ['Biggest win margin', best > 0 ? `+${best}` : '', true], ['Heaviest loss margin', worst < 0 ? sign(worst) : '', true],
            ['Shutouts', `${ps.filter((g) => g.info.them === 0).length} for, ${ps.filter((g) => g.info.us === 0).length} against`, true]]);
      }
      case 'shots': {
        const g = d.season.games[+arg], c = g.chances;
        return `<div class="pk">Shots · ${g.home ? 'vs' : '@'} ${esc(g.opp)} · ${esc(g.info.date)}</div><div class="pt"><span class="big m">${c.us.sog}–${c.them.sog}</span><span>shots on goal</span></div>` +
          rowsHtml([['Shooting %', c.us.sog ? `${((100 * c.us.goals) / c.us.sog).toFixed(1)}%` : '–', true], ['Save %', c.them.sog ? pct3(1 - c.them.goals / c.them.sog) : '–', true],
            ['Shots blocked by them', c.us.blocked, true], ['Shots blocked by us', c.them.blocked, true]]);
      }
      case 'hd': {
        const g = d.season.games[+arg], c = g.chances;
        return `<div class="pk">High danger · ${g.home ? 'vs' : '@'} ${esc(g.opp)} · ${esc(g.info.date)}</div><div class="pt"><span class="big m">${c.us.hi.n}–${c.them.hi.n}</span><span>high-danger chances</span></div>` +
          rowsHtml([['High-danger xG', `${c.us.hi.xg.toFixed(2)}–${c.them.hi.xg.toFixed(2)}`, true], ['High-danger goals', `${c.us.hi.g}–${c.them.hi.g}`, true]]) +
          note('Within 20 ft of the goal line and 19 ft of centre.');
      }
      case 'pace': {
        const k = +arg, { out, perGame } = paceSeries(d), g = playedGame(d, k);
        return `<div class="pk">Playoff pace · after game ${k}</div><div class="pt"><span class="big m">${sign(Math.round(out[k]))}</span><span>points vs pace</span></div>` +
          rowsHtml([['Game', vsLine(g)], ['Pace', `${(perGame * k).toFixed(1)} pts after ${k} games`, true]]);
      }
      case 'rxg': {
        const k = +arg, s = rollingXg(d), g = playedGame(d, k);
        return `<div class="pk">Rolling xG share · after game ${k}</div><div class="pt"><span class="big m">${(50 + s[k]).toFixed(1)}%</span><span>last 5 games</span></div>` +
          rowsHtml([['Game', vsLine(g)], g?.chances ? ['That game’s xG', `${g.chances.us.xg.toFixed(2)}–${g.chances.them.xg.toFixed(2)}`, true] : null]);
      }
      case 'rank': {
        const k = +arg, r = d.rankHistory[k - 1], g = playedGame(d, k);
        return `<div class="pk">Conference rank · after game ${k}</div><div class="pt"><span class="big m">${r}${suffix(r)}</span><span>of ${d.confSize}</span></div>` +
          rowsHtml([['Game', vsLine(g)], ['In a playoff spot', r <= 8 ? 'Yes' : 'No']]) + note('By points, then games played and regulation wins (the official tiebreakers can differ slightly).');
      }
      case 'sched': return gamePop(d.season.games[+arg].info, `Game ${+arg + 1} of ${d.season.total}`);
      case 'scorer': case 'goalie': {
        const x = (kind === 'scorer' ? d.scorers : d.goalies)[+arg];
        return `<div class="pk">${kind === 'scorer' ? 'Top scorers' : 'Goalies'}</div><div class="pt"><span class="face sm"><img src="${esc(x.headshot)}" alt=""></span><span>${esc(x.full)}</span></div>` +
          `<div class="pgrid">${(x.stats || []).map(([k2, v]) => `<div><b class="m">${esc(v)}</b><span>${esc(k2)}</span></div>`).join('')}</div>`;
      }
      case 'cut': {
        const p = d.pictures.own, lastIn = p.wcRows[p.wcRows.length - 1], firstOut = p.outRows[0];
        return `<div class="pk">The playoff cut</div><div class="pt"><span class="big m">${esc(d.playoffLine.label)}</span><span>${esc(d.playoffLine.text)}</span></div>` +
          rowsHtml([lastIn ? ['Last team in', `${lastIn.abbrev} · ${lastIn.pts} pts, ${lastIn.gp} GP`, true] : null,
            firstOut ? ['First team out', `${firstOut.abbrev} · ${firstOut.pts} pts, ${firstOut.gp} GP`, true] : null]) +
          note('Top three in each division plus two wild cards per conference make it. The line plots your points minus the first team out (or minus the last team in, when you’re out).');
      }
    }
    return '';
  }

  function closePop() {
    popEl?.remove(); popEl = null; popKey = null;
    board.querySelectorAll('.is-active').forEach((e) => e.classList.remove('is-active'));
  }
  function placePop(target, html, cls = '') {
    popEl = document.createElement('div');
    popEl.className = `pop ${cls}`;
    popEl.setAttribute('role', 'dialog');
    popEl.innerHTML = `<button class="px" aria-label="Close">×</button>${html}`;
    document.body.appendChild(popEl);
    const r = target.getBoundingClientRect();
    const pw = popEl.offsetWidth, ph = popEl.offsetHeight, gap = 8, m = 10;
    let x = Math.max(m, Math.min(r.left + r.width / 2 - pw / 2, document.documentElement.clientWidth - pw - m));
    let y = r.bottom + gap;
    if (y + ph > innerHeight - m && r.top - gap - ph > m) y = r.top - gap - ph;
    popEl.style.left = `${x + scrollX}px`;
    popEl.style.top = `${Math.max(m, y) + scrollY}px`;
    popEl.querySelector('.px').addEventListener('click', closePop);
  }
  function openPop(target) {
    const key = target.dataset.pop;
    if (key.startsWith('card:')) { closePop(); return openCard(+key.slice(5)); }
    if (key === 'wheel') { closePop(); return openWheel(); }
    if (popKey === key) return closePop();
    closePop();
    const html = popContent(key);
    if (!html) return;
    popKey = key;
    target.classList.add('is-active');
    placePop(target, html);
  }

  // ---------- customize mode ----------
  let editing = false, editBar = null;
  function decorateSlots() {
    board.querySelectorAll('.slot').forEach((el) => {
      el.classList.add('editable');
      if (!el.querySelector('.swap')) el.insertAdjacentHTML('beforeend', `<button class="swap" data-swap="${el.dataset.slot}" aria-label="Change this panel">⇄</button>`);
    });
  }
  function startEditing() {
    if (!current || wallpaper) return;
    editing = true;
    document.body.classList.add('editing');
    closePop(); closePicker();
    decorateSlots();
    editBar = document.createElement('div');
    editBar.className = 'editbar';
    editBar.innerHTML = `<span>Tap any panel to change what it shows</span><button data-act="reset">Reset</button><button data-act="share">Copy link</button><button data-act="done" class="on">Done</button>`;
    editBar.addEventListener('click', (e) => {
      const act = e.target.closest('button')?.dataset.act;
      if (act === 'done') stopEditing();
      if (act === 'reset') { layout = clone(DEFAULT_LAYOUT); saveLayout(); render(current); }
      if (act === 'share') {
        const url = new URL(location.href); url.search = ''; url.searchParams.set('layout', b64.enc(layout));
        const done = () => { e.target.textContent = 'Copied'; setTimeout(() => (e.target.textContent = 'Copy link'), 1500); };
        navigator.clipboard?.writeText(url.href).then(done, () => prompt('Copy this link', url.href));
      }
    });
    document.body.appendChild(editBar);
  }
  function stopEditing() {
    editing = false;
    document.body.classList.remove('editing');
    editBar?.remove(); editBar = null;
    closePop();
    render(current);
  }
  function openSlotMenu(slotEl) {
    const slot = slotEl.dataset.slot, [kind, read, write] = SLOTS[slot];
    const cur = pick(current, slot);
    closePop();
    popKey = `slot:${slot}`;
    slotEl.classList.add('is-active');
    const opts = CATALOG[kind](current, slot);
    placePop(slotEl, `<div class="pk">Change panel</div><div class="opts">${opts.map(([k, label]) =>
      `<button class="opt${k === cur ? ' on' : ''}" data-opt="${esc(k)}">${esc(label)}</button>`).join('')}</div>`, 'menu');
    popEl.addEventListener('click', (e) => {
      const b = e.target.closest('[data-opt]');
      if (!b) return;
      write(layout, b.dataset.opt);
      saveLayout();
      render(current);
    });
  }

  if (I) {
    board.addEventListener('click', (e) => {
      if (editing) {
        const s = e.target.closest('.slot');
        if (s) { e.stopPropagation(); openSlotMenu(s); }
        return;
      }
      const t = e.target.closest('[data-pop]');
      if (t && board.contains(t)) { e.stopPropagation(); openPop(t); }
    });
    document.addEventListener('click', (e) => { if (popEl && !popEl.contains(e.target)) closePop(); });
    addEventListener('resize', closePop);
  }

  // ---------- scaling ----------
  function fit() {
    const { W, H } = GEOM[MODE];
    const vw = document.documentElement.clientWidth || innerWidth;
    const vh = innerHeight;
    let scale, top;
    if (wallpaper) {
      // Same placement as an iPhone lock-screen wallpaper: full width, ~21% down the screen.
      scale = vw / W;
      top = Math.round(vh * 0.2125);
      stage.style.height = `${vh}px`;
    } else if (MODE === 'stack') {
      scale = vw / W;                       // phones: fill the width, scroll down
      top = 8;
      stage.style.height = `${H * scale + top + (editing ? 80 : 16)}px`;
    } else {
      scale = Math.min(vw / W, 1.6);
      top = Math.max(0, Math.round((vh - H * scale) / 2));
      stage.style.height = `${Math.max(vh, H * scale + top + (editing ? 70 : 0))}px`;
    }
    board.style.transform = `translate(${Math.round((vw - W * scale) / 2)}px, ${top}px) scale(${scale})`;
  }
  addEventListener('resize', () => {
    if (current && modeFor() !== MODE) render(current); else fit();
  });

  // ---------- team choice ----------
  const STORE = 'rinkside-team';
  const store = {
    get() { try { return localStorage.getItem(STORE); } catch { return null; } },
    set(v) { try { localStorage.setItem(STORE, v); } catch {} },
  };
  let index = null;   // data/teams.json
  let team = null;

  // The team comes from the path: hockey.mattdicks.org/rangers/, /blues/, /nyr/, /leafs/ ...
  const resolve = (word) => {
    const w = (word || '').toLowerCase();
    if (!w) return null;
    const t = index.teams.find((t) => t.abbrev.toLowerCase() === w || t.slug === w || t.aliases?.includes(w));
    return t ? t.abbrev : null;
  };
  const pathTeam = () => {
    const parts = location.pathname.split('/').filter((p) => p && p !== 'index.html');
    return resolve(parts[parts.length - 1]);
  };
  function pickTeam() {
    const found = pathTeam() || resolve(params.get('team'));
    if (found) { store.set(found); return found; }
    return resolve(store.get()) || index.default;   // the bare domain shows your last team
  }
  function setTeam(abbrev) {
    if (abbrev === team) return closePicker();
    store.set(abbrev);
    const slug = index.teams.find((t) => t.abbrev === abbrev).slug;
    const url = new URL(`${slug}/`, document.baseURI);
    if (params.get('layout')) url.searchParams.set('layout', params.get('layout'));
    location.href = url.href;
  }

  // Team picker: tap the team band (or the RINKSIDE mark, or press "t"). It also starts Customize.
  let picker = null;
  function openPicker() {
    if (!index || wallpaper) return;
    closePicker();
    const order = ['Atlantic', 'Metropolitan', 'Central', 'Pacific'];
    const groups = order.map((d) => [d, index.teams.filter((t) => t.division === d)]).filter(([, ts]) => ts.length);
    picker = document.createElement('div');
    picker.className = 'picker';
    picker.setAttribute('role', 'dialog');
    picker.setAttribute('aria-label', 'Choose a team');
    picker.innerHTML = `<div class="sheet"><div class="ph"><span>Choose a team</span><button class="cust" data-act="customize">Customize board</button><button class="x" aria-label="Close">×</button></div>${groups
      .map(([d, ts]) => `<div class="pg"><div class="pgt">${esc(d)}</div><div class="pgl">${ts
        .map((t) => `<button class="pt${t.abbrev === team ? ' on' : ''}" data-team="${esc(t.abbrev)}">${logo(t.logo)}<span>${esc(t.name)}</span></button>`)
        .join('')}</div></div>`)
      .join('')}</div>`;
    picker.addEventListener('click', (e) => {
      const b = e.target.closest('[data-team]');
      if (b) return setTeam(b.dataset.team);
      if (e.target.closest('[data-act="customize"]')) return startEditing();
      if (e.target === picker || e.target.closest('.x')) closePicker();
    });
    document.body.appendChild(picker);
    picker.querySelector('.pt.on, .pt')?.focus();
  }
  function closePicker() { picker?.remove(); picker = null; }
  if (I) {
    board.addEventListener('click', (e) => { if (!editing && e.target.closest('.hdr .band, .foot .brand')) openPicker(); });
    addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { closePicker(); closePop(); closeCard(); closeWheel(); }
      else if ((e.key === 'Enter' || e.key === ' ') && e.target.closest?.('.hdr .band')) { e.preventDefault(); openPicker(); }
      else if (e.key.toLowerCase() === 't' && !picker && !editing && !e.metaKey && !e.ctrlKey) openPicker();
      else if (e.key.toLowerCase() === 'c' && !picker && !e.metaKey && !e.ctrlKey) (editing ? stopEditing : startEditing)();
    });
  }

  // ---------- load + refresh ----------
  let lastStamp = null;
  async function getJSON(path) {
    const res = await fetch(`${path}?t=${Date.now()}`, { cache: 'no-store' });
    if (!res.ok) throw new Error(`${path}: ${res.status}`);
    return res.json();
  }
  async function load() {
    document.body.dataset.ready = '';
    try {
      if (!index) { index = await getJSON('data/teams.json'); loadLayout(index.layout); }
      if (!team) team = pickTeam();
      const d = await getJSON(`data/${team}.json`);
      if (d.generatedAt !== lastStamp || d.team.abbrev !== board.dataset.team) {
        lastStamp = d.generatedAt;
        board.dataset.team = d.team.abbrev;
        render(d);
      }
      document.body.dataset.ready = '1';
    } catch (err) {
      if (!lastStamp) board.innerHTML = `<div class="msg">Couldn't load the board (${esc(err.message)})</div>`;
      document.body.dataset.ready = 'error';
      fit();
    }
  }
  load();
  if (I) setInterval(() => { if (!editing) load(); }, 10 * 60 * 1000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden && I && !editing) load(); });
})();
