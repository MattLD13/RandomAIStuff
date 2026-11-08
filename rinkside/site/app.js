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
    chart: () => [['margins', 'Game by game (goal margin)'], ['playoffLine', 'Playoff line'], ['goalDiff', 'Goal differential'], ['race', 'Division points race']],
    section: () => [...DIVS.map((d) => [`grid:${d}`, `${d}: results vs each team`]), ...DIVS.map((d) => [`table:${d}`, `${d} standings`]),
      ['table:league', 'League top 8'], ['table:conference', 'Your conference top 8']],
    picture: (d) => [['own', 'Playoff picture (your conference)'], ...(d.pictures.other ? [['other', `Playoff picture (${d.pictures.other.conference})`]] : [])],
    box: (d) => Object.entries(d.stats).map(([k, v]) => [k, v.label + (v.edge ? ' (EDGE)' : '')]),
    leader: (d) => Object.entries(d.leaderBoard).map(([k, v]) => [k, v.label]),
    upper: () => [['next5', 'Next 5 (cards)'], ['last5cards', 'Last 5 (cards)']],
    lower: () => [['last5', 'Last 5 (list)'], ['next5rows', 'Next 5 (list)']],
  };
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
    const v = read(layout), ok = CATALOG[kind](d).some(([k]) => k === v);
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
    // one tap target per played game: the only place a game's score opens
    if (I) season.games.forEach((g, i) => {
      if (g.result) s += `<rect class="hit"${pop(`game:${i}`)} x="${(cx(i) - slot / 2).toFixed(2)}" y="2" width="${slot.toFixed(2)}" height="${h - 26}"/>`;
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

  function chartSlot(d, slot, x, top, w, svgTop, h) {
    setChartWidth(w);
    const kind = pick(d, slot);
    const c = kind === 'playoffLine' ? chartPlayoffLine(d, h, slot) : kind === 'goalDiff' ? chartGoalDiff(d, h, slot)
      : kind === 'race' ? chartRace(d, h) : chartMargins(d, h);
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
    const p = d.pictures[pick(d, slot)] || d.pictures.own;
    return `<div class="colhead big"><span class="t">Playoff picture</span></div>` +
      `<div class="sub first"><span>${esc(p.divisionName)}</span><span class="gp">GP</span><span class="pts">PTS</span></div>${pictureRows(p.divRows)}` +
      `<div class="sub"><span>Wild card${p !== d.pictures.own ? ` · ${esc(p.conference)}` : ''}</span></div>${pictureRows(p.wcRows)}<div class="cutline"></div>${pictureRows(p.outRows)}`;
  }
  function statBox(d, slot) {
    const k = pick(d, slot), v = d.stats[k];
    if (!v) return '<div class="box"></div>';
    return `<div class="box"${pop(`stat:${k}`)}><div class="k">${esc(v.label)}</div><div class="rk">${v.rank}${suffix(v.rank)} of ${v.of}</div><div class="v">${esc(v.value)}<small>${esc(v.unit.trim() ? ` ${v.unit.trim()}` : '')}</small></div></div>`;
  }
  function leaderRow(d, slot) {
    const k = pick(d, slot), l = d.leaderBoard[k];
    if (!l) return '<div class="lrow"></div>';
    return `<div class="lrow"${pop(`leader:${k}`)}><div class="face"><img src="${esc(l.headshot)}" alt=""></div><div class="who"><div class="k">${esc(l.label.replace(' (EDGE)', ''))}</div><div class="n">${esc(l.name)}</div><div class="s">${esc(l.sub)}</div></div><div class="v">${esc(l.value)}</div></div>`;
  }

  // ---------- upper / lower lists ----------
  const nextCards = (d) => `<div class="colhead big"><span class="t">Next 5</span><span class="r small">EASTERN TIME</span></div><div class="nlist">${
    d.nextGames.length ? d.nextGames.map((g, i) => `<div class="ncard"${pop(`next:${i}`)}><div class="date"><span class="dow">${esc(g.dow)}</span><span class="day">${esc(g.day)}</span></div><span class="at">${g.home ? 'vs' : '@'}</span>${logo(g.logo, g.opp)}<span class="time">${esc(g.time)}</span></div>`).join('')
      : '<div class="note" style="margin-top:12px">No games scheduled</div>'}</div>`;
  const lastCards = (d) => `<div class="colhead big"><span class="t">Last 5</span><span class="r small">FINAL SCORES</span></div><div class="nlist"${pop('form')}>${
    d.lastGames.map((g) => `<div class="ncard"><div class="date"><span class="dow">${esc(g.dow)}</span><span class="day">${esc(g.day)}</span></div><span class="at">${g.info.home ? 'vs' : '@'}</span>${logo(g.logo, g.opp)}<span class="time"><span class="res ${g.result}">${esc(g.result)}</span> ${esc(g.score.replace('-', '–'))}</span></div>`).join('')}</div>`;
  const lastRows = (d) => `<div class="colhead big"><span class="t">Last 5</span></div><div class="llist"${pop('form')}>${
    d.lastGames.map((g) => `<div class="lgrow">${logo(g.logo, g.opp)}<span class="res ${g.result}">${esc(g.result)}</span><span class="sc">${esc(g.score.replace('-', '–'))}</span></div>`).join('')}</div>`;
  const nextRows = (d) => `<div class="colhead big"><span class="t">Next 5</span><span class="r small">EASTERN TIME</span></div><div class="llist">${
    d.nextGames.map((g, i) => `<div class="lgrow"${pop(`next:${i}`)}>${logo(g.logo, g.opp)}<span class="nd">${esc(g.dow)} ${esc(g.day)}</span><span class="sc nt">${g.home ? 'vs' : '@'} ${esc(g.time)}</span></div>`).join('')}</div>`;

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
    let s = `<header class="abs hdr">
      <svg class="band" viewBox="0 0 210 95" width="210" height="95" preserveAspectRatio="none">
        <polygon points="0,0 196,0 171,95 0,95" fill="var(--primary)"/>
        <polygon points="196,0 204,0 179,95 171,95" fill="var(--accent)"/>
      </svg>
      <div class="band" style="background:none" title="Change team"${I ? ' role="button" tabindex="0"' : ''}><img src="${esc(d.team.logo)}" alt="${esc(d.team.name)}"></div>
      <div class="record"${pop('record')}>${esc(h.record)}</div>
      <div class="summary"><b>${h.points} points</b>, ${esc(h.summary)}</div>
      <div class="meta"><div>${esc(h.date)}</div><div${pop('splits')}>${esc(h.splits)}</div><div${pop('sos')}>${esc(h.schedule)}</div></div>
    </header>`;

    s += chartSlot(d, 'chart1', ...G.chart1);
    s += chartSlot(d, 'chart2', ...G.chart2);

    for (const k of ['col1.0', 'col1.1', 'col2.0', 'col2.1']) s += slotBox(k, ...G[k], section(d, k));
    s += slotBox('picture', ...G.picture, picture(d, 'picture'), 'ppic');
    const [bx, by] = G.boxes, bw = (G.picture[2] - 8) / 2;
    s += `<div class="abs st" style="left:${bx}px;top:${by}px;width:${G.picture[2]}px;margin:0">${slotBox('boxes.0', 0, 0, bw, 54, statBox(d, 'boxes.0'))}${slotBox('boxes.1', bw + 8, 0, bw, 54, statBox(d, 'boxes.1'))}</div>`;
    const [lx, ly] = G.leaders;
    s += `<div class="abs" style="left:${lx}px;top:${ly}px;width:${G.picture[2]}px"><div class="colhead big"><span class="t">Team leaders</span></div></div>`;
    for (let i = 0; i < 3; i++) s += slotBox(`leaders.${i}`, lx, ly + 36 + i * 55, G.picture[2], 55, leaderRow(d, `leaders.${i}`));
    const up = pick(d, 'upper'), lo = pick(d, 'lower');
    s += slotBox('upper', ...G.upper, up === 'last5cards' ? lastCards(d) : nextCards(d));
    s += slotBox('lower', ...G.lower, lo === 'next5rows' ? nextRows(d) : lastRows(d));

    s += `<footer class="abs foot" style="left:${G.foot[0]}px;top:${G.foot[1]}px;width:${G.foot[2]}px">
      <span class="k"><i class="sw" style="background:var(--win)"></i>Win</span>
      <span class="k"><i class="sw" style="background:var(--loss)"></i>Loss</span>
      <span class="k"><i class="sw" style="background:var(--otl)"></i>OT/SO loss</span>
      <span class="k"><i class="sw" style="background:var(--future)"></i>Still to play</span>
      <span class="k">Filled dot or house = home, ring or plane = away</span>
      <span class="brand" title="Change team or customize">RINKSIDE</span>
    </footer>`;
    board.innerHTML = s;
    closePop();
    if (editing) decorateSlots();
    fit();
  }

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
    h += rowsHtml([['Date', info.date], [final ? 'Started' : 'Puck drop', info.time], ['Arena', info.venue], ['TV', info.tv],
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
          ['Last 10', t.l10, true], ['Streak', t.streak, true], ['Regulation wins', t.rw, true]]);
    };
    switch (kind) {
      case 'game': return gamePop(d.season.games[+arg].info, `Game ${+arg + 1} of ${d.season.total}`);
      case 'next': return gamePop(d.nextGames[+arg].info, `Next up · game ${+arg + 1} of 5`);
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
            ['Regulation wins', t.rw, true], ['Reg. + OT wins', t.row, true]]);
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
    const opts = CATALOG[kind](current);
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
      if (e.key === 'Escape') { closePicker(); closePop(); }
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
