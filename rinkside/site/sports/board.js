// The team board for Courtside (NBA), Sideline (NFL), Dugout (MLB) and Pitchside (MLS).
// Same canvas and look as Rinkside. Every panel sits in a slot, and Customize (as on Rinkside) changes what each slot
// shows: tap the team band or press "c". League settings come with the data (cfg); helpers are in common.js.
(() => {
  const { key, esc, logo, ord, fmt, brandIcon, storage, teamStore, shortDiv, remix, board, modeNow, fit, openPicker, closePicker } = SB;
  let index, D, L, MODE;
  const W = { board: 921, stack: 500 };
  const finals = () => D.games.filter((g) => g.state === 'final');
  // games still to play, playoffs included; results for the lists, playoffs included (the charts stay regular season)
  const upcoming = () => [...D.games, ...(D.post || [])].filter((g) => g.state === 'pre' || g.state === 'live').sort((a, b) => a.date.localeCompare(b.date));
  const results = () => [...finals(), ...(D.post || []).filter((g) => g.state === 'final')].sort((a, b) => a.date.localeCompare(b.date));
  const oppText = (g) => /^TBD/i.test(g.opp) ? 'TBD' : g.opp;
  const timeText = (g) => (/T0[45]:00Z$/.test(g.date) ? 'TBD' : fmt(g.date, { hour: 'numeric', minute: '2-digit' }).replace(' ', '').toLowerCase());
  const sched = () => D.games.filter((g) => g.state !== 'off');
  const myConf = () => index.conferences.find((c) => c.name === D.team.conference);
  const otherConf = () => index.conferences.find((c) => c.name !== D.team.conference) || myConf();
  const teamName = (abbr) => index.teams.find((t) => t.abbr === abbr)?.name || abbr;
  const signed = (v, d = 1) => v == null ? '' : v > 0 ? `+${+v.toFixed(d)}` : v < 0 ? `−${+(-v).toFixed(d)}` : '0';

  // ---------- layout: what each slot shows ----------
  const PRESETS = [
    ['classic', 'Classic', {}],
    ['race', 'Playoff race', { chart1: 'line', chart2: 'rank', col1: 'conference', pic: 'picture', upper: 'next5', lower: 'splits' }],
    ['stats', 'Stats', { chart1: 'diff', chart2: 'form', col1: 'power', pic: 'teamStats', upper: 'last5', lower: 'splits' }],
    ['schedule', 'Schedule', { chart1: 'season', chart2: 'form', col1: 'divisions', pic: 'next10', upper: 'next5', lower: 'last5' }],
  ];
  const defaults = () => ({ chart1: 'season', chart2: 'line', col1: 'divisions', pic: 'picture', upper: 'next5', lower: 'last5',
    boxes: [...L.boxes], leaders: [...L.leaderRows] });
  const layoutStore = storage(`board-layout-${key}`);
  const b64 = { enc: (o) => btoa(unescape(encodeURIComponent(JSON.stringify(o)))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''),
    dec: (s) => JSON.parse(decodeURIComponent(escape(atob(s.replace(/-/g, '+').replace(/_/g, '/'))))) };
  let layout;
  function loadLayout() {
    let saved = null;
    const q = new URLSearchParams(location.search).get('layout');
    try { saved = q ? b64.dec(q) : JSON.parse(layoutStore.get() || 'null'); } catch {}
    layout = { ...defaults(), ...(saved || {}) };
    if (q) saveLayout();
  }
  const saveLayout = () => layoutStore.set(JSON.stringify(layout));

  // ---------- header ----------
  const record = () => { const r = D.record; return L.draws ? `${r.w}-${r.t}-${r.l}` : r.t ? `${r.w}-${r.l}-${r.t}` : `${r.w}-${r.l}`; };
  function postLine() {
    const last = D.post?.[D.post.length - 1]; if (!last || last.state !== 'final') return '';
    const round = (last.round || '').split(' - ')[0];
    return last.res === 'W' && /World Series|NBA Finals|Super Bowl|MLS Cup/i.test(round) ? `Won the ${round}` : last.res === 'L' ? `Out in the ${round}` : round;
  }
  function summary() {
    const g = upcoming()[0];
    if (g) {
      const tbd = /T0[45]:00Z$/.test(g.date);
      const when = `${fmt(g.date, { weekday: 'short' })}${tbd ? '' : ' ' + timeText(g)}`;
      const opp = oppText(g) === 'TBD' ? 'opponent TBD' : `${g.home ? 'vs' : '@'} ${teamName(g.opp)}`;
      return `${g.round ? `${esc(g.round)}: ` : 'Next: '}<b>${esc(when)} ${esc(opp)}</b>${g.tv ? ` on ${esc(g.tv)}` : ''}`;
    }
    const pl = postLine(); if (pl) return `<b>${esc(pl)}</b>`;
    const ns = D.nextSeason?.games?.[0];
    const over = D.record.seed > L.lineSeed ? 'Missed the playoffs' : 'Season over';
    if (ns) return `<b>${over}</b> · Opening Day ${esc(fmt(ns.date, { month: 'short', day: 'numeric' }))} ${ns.home ? 'vs' : '@'} ${esc(teamName(ns.opp))}`;
    return `<b>${over}</b>`;
  }
  function header() {
    const t = D.team, r = D.record;
    const today = fmt(Date.now(), { weekday: 'long', month: 'long', day: 'numeric' });
    const parts = [r.home && `Home ${r.home}`, r.road && `Road ${r.road}`, !L.standCols.includes('L10') && finals().length > 10 && r.last10 && `Last 10 ${r.last10}`].filter(Boolean).join(' · ');
    return `<header class="abs hdr" style="--team:${t.color};--team2:${t.alt}">
      <svg class="band" viewBox="0 0 210 95" width="210" height="95" preserveAspectRatio="none">
        <polygon points="0,0 196,0 171,95 0,95" fill="var(--team)"/><polygon points="196,0 204,0 179,95 171,95" fill="var(--team2)"/>
      </svg>
      <div class="band sb" role="button" tabindex="0" aria-label="Choose a team">${logo(t.logo)}</div>
      <div class="record mono">${record()}</div>
      <div class="summary" id="livebox">${summary()}</div>
      <div class="meta"><div>${today}</div><div>${esc(parts)}</div><div>${r.vsGood ? `vs ${esc(L.goodLabel)} ${esc(r.vsGood)}` : ''}</div></div>
    </header>`;
  }

  // ---------- charts ----------
  // x position of a game (NFL by week, so the bye shows) and of a date (where this team's schedule had got to)
  function xAxis(w) {
    w -= 46;   // leave the right edge for the axis labels
    const gs = sched();
    const slots = L.byWeek ? Math.max(18, ...gs.map((g) => g.week || 0)) : gs.length;
    const sw = w / Math.max(slots, 1);
    const xGame = (g, i) => ((L.byWeek && g.week ? g.week - 1 : i) + 0.5) * sw;
    const dates = gs.map((g) => g.date.slice(0, 10));
    const xDate = (d) => { let i = 0; while (i < dates.length && dates[i] <= d) i++; const g = gs[Math.max(0, i - 1)]; return Math.max(0, ((L.byWeek && g?.week ? g.week : i) - 0.5) * sw); };
    let labels = '';
    if (L.byWeek) {
      const weeks = new Set(gs.map((g) => g.week));
      for (let k = 1; k <= slots; k++) { const bye = !weeks.has(k); labels += `<text x="${(k - 0.5) * sw}" y="{Y}" class="ax mid${bye ? ' bye' : ''}">${bye ? 'BYE' : k}</text>`; }
    } else {
      let last = '', lastX = -99;
      gs.forEach((g, i) => { const m = fmt(g.date, { month: 'short' }); if (m !== last && i * sw - lastX > 40) { labels += `<text x="${i * sw}" y="{Y}" class="ax">${m}</text>`; lastX = i * sw; } last = m; });
    }
    return { gs, sw, xGame, xDate, labels };
  }
  const CHARTS = {
    season: ['Game by game', (w, h) => {
      const { gs, sw, xGame, labels } = xAxis(w);
      const bw = Math.max(2, Math.min(sw * 0.72, 30)), H = (h - 40) / 2, mid = H + 6, cap = L.cap;
      let svg = `<line x1="0" x2="${w - 40}" y1="${mid}" y2="${mid}" stroke="#3a3a3a" stroke-dasharray="3 4"/>`;
      for (const v of [cap, Math.round(cap / 2)]) for (const s of [1, -1]) svg += `<text x="${w - 18}" y="${mid - s * v / cap * H + 4}" class="ax">${s > 0 ? '+' : '−'}${v}</text>`;
      gs.forEach((g, i) => {
        const cx = xGame(g, i), played = g.state === 'final';
        svg += `<circle cx="${cx}" cy="${mid + H + 12}" r="${Math.min(2.2, sw / 3)}" fill="${played ? '#d8d8d8' : '#444'}"/>`;
        if (!played) return;
        const m = g.us - g.them, bh = Math.max(3, Math.min(Math.abs(m), cap) / cap * H);
        const col = g.res === 'W' ? 'var(--win)' : g.res === 'L' ? 'var(--loss)' : 'var(--otl)';
        svg += `<rect x="${cx - bw / 2}" y="${g.res === 'T' ? mid - 6 : m > 0 ? mid - bh : mid}" width="${bw}" height="${g.res === 'T' ? 12 : bh}" fill="${col}"><title>${esc(`${fmt(g.date, { month: 'short', day: 'numeric' })} ${g.home ? 'vs' : '@'} ${g.opp}: ${g.us}–${g.them}`)}</title></rect>`;
      });
      svg += labels.replaceAll('{Y}', mid + H + 32);
      const played = gs.filter((g) => g.state === 'final').length;
      return { title: `The season, ${L.game} by ${L.game}`, note: `${played} of ${gs.length} played, bar height = ${L.margin}`, svg };
    }],
    line: [L => L.lineName, (w, h) => {
      const pts = (D.line || []).map(([d, v]) => [d, v]);
      const now = pts.length ? pts[pts.length - 1][1] : 0;
      const unit = L.lineUnit === 'points' ? (Math.abs(now) === 1 ? 'point' : 'points') : (Math.abs(now) === 1 ? 'game' : 'games');
      const note = now > 0 ? `${now} ${unit} clear of the first team out` : now < 0 ? `${-now} ${unit} behind the last team in` : 'right on the line';
      return { title: `${L.lineName}<span class="big">${signed(now)}</span>`, note, svg: zeroLine(w, h, pts, true) };
    }],
    diff: ['Running margin', (w, h) => {
      let run = 0; const pts = finals().map((g) => [g.date.slice(0, 10), (run += g.us - g.them)]);
      return { title: `Running ${L.margin.replace(' margin', '')} differential<span class="big">${signed(run, 0)}</span>`, note: `total ${L.margin} over the season`, svg: zeroLine(w, h, pts, true) };
    }],
    form: ['Rolling form', (w, h) => {
      const f = finals(), N = Math.min(10, Math.max(3, Math.floor(f.length / 2) || 3));
      const val = (g) => L.draws ? (g.res === 'W' ? 3 : g.res === 'T' ? 1 : 0) : (g.res === 'W' ? 1 : g.res === 'T' ? 0.5 : 0);
      const pts = f.map((g, i) => { const win = f.slice(Math.max(0, i - N + 1), i + 1); return [g.date.slice(0, 10), win.reduce((a, x) => a + val(x), 0) / win.length - (L.draws ? 1.5 : 0.5)]; }).slice(N - 1);
      const now = pts.length ? pts[pts.length - 1][1] + (L.draws ? 1.5 : 0.5) : null;
      const label = now == null ? '' : L.draws ? now.toFixed(2) : now.toFixed(3).replace(/^0/, '');
      return { title: `Form, last ${N}<span class="big">${label}</span>`, note: L.draws ? `points per ${L.game}, above or below 1.5` : 'win %, above or below .500', svg: zeroLine(w, h, pts, true, L.draws ? (v) => (v + 1.5).toFixed(1) : (v) => (v + 0.5).toFixed(2).replace(/^0/, '')) };
    }],
    rank: ['Conference rank', (w, h) => {
      const pts = (D.line || []).filter((p) => p[2]).map(([d, , r]) => [d, r]);
      const n = myConf().picture.length, now = pts.length ? pts[pts.length - 1][1] : null;
      const { xDate } = xAxis(w), y = (r) => 9 + (r - 1) / Math.max(1, n - 1) * (h - 18);
      let svg = `<line x1="0" x2="${w - 40}" y1="${y(L.lineSeed + 0.5)}" y2="${y(L.lineSeed + 0.5)}" stroke="#8a8a8a" stroke-dasharray="4 3"/>`;
      for (const r of [1, Math.ceil(n / 2), n]) svg += `<text x="${w - 18}" y="${y(r) + 4}" class="ax">${ord(r)}</text>`;
      if (pts.length) {
        const path = pts.map(([d, r], i) => `${i ? 'L' : 'M'}${Math.min(xDate(d), w - 50).toFixed(1)},${y(r).toFixed(1)}`).join('');
        svg += `<path d="${path}" fill="none" stroke="var(--team-hi)" stroke-width="2.2"/><circle cx="${Math.min(xDate(pts[pts.length - 1][0]), w - 50)}" cy="${y(now)}" r="5" fill="#fff"/>`;
      }
      return { title: `${esc(shortDiv(D.team.conference))} rank<span class="big">${now ? ord(now) : ''}</span>`, note: `dashed line = ${L.lineName.toLowerCase()}`, svg };
    }],
  };
  // a line around zero: green above, red below
  function zeroLine(w, h, pts, fill, tick = (v) => signed(v)) {
    const { xDate } = xAxis(w), mid = h / 2;
    const max = Math.max(1e-9, ...pts.map((p) => Math.abs(p[1])));
    const step = [0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10, 25, 50, 100, 250].find((s) => max / s <= 4) || 500;
    const top = Math.ceil(max / step) * step;
    const y = (v) => mid - v / top * (mid - 9);
    let svg = `<line x1="0" x2="${w - 40}" y1="${mid}" y2="${mid}" stroke="#3a3a3a" stroke-dasharray="3 4"/>`;
    for (const v of [top, top / 2, 0, -top / 2, -top]) svg += `<text x="${w - 18}" y="${y(v) + 4}" class="ax">${tick(v)}</text>`;
    if (!pts.length) return svg;
    const xy = pts.map(([d, v]) => [Math.min(xDate(d), w - 50), y(v)]);
    const path = xy.map(([a, b], i) => `${i ? 'L' : 'M'}${a.toFixed(1)},${b.toFixed(1)}`).join('');
    const id = Math.random().toString(36).slice(2, 7);
    const area = `${path}L${xy[xy.length - 1][0].toFixed(1)},${mid}L${xy[0][0].toFixed(1)},${mid}Z`;
    svg += `<clipPath id="a${id}"><rect x="0" y="0" width="${w}" height="${mid}"/></clipPath><clipPath id="b${id}"><rect x="0" y="${mid}" width="${w}" height="${h}"/></clipPath>`;
    if (fill) svg += `<path d="${area}" fill="var(--win)" opacity=".28" clip-path="url(#a${id})"/><path d="${area}" fill="var(--loss)" opacity=".28" clip-path="url(#b${id})"/>`;
    svg += `<path d="${path}" fill="none" stroke="var(--win)" stroke-width="2" clip-path="url(#a${id})"/><path d="${path}" fill="none" stroke="var(--loss)" stroke-width="2" clip-path="url(#b${id})"/>`;
    svg += `<circle cx="${xy[xy.length - 1][0]}" cy="${xy[xy.length - 1][1]}" r="5" fill="#fff"/>`;
    return svg;
  }
  function chartPanel(kind, w, h) {
    const c = (CHARTS[kind] || CHARTS.season)[1](w, h);
    return `<div class="title">${c.title}</div><div class="note right">${esc(c.note)}</div><svg class="chart" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">${c.svg}</svg>`;
  }

  // ---------- tables (left column) ----------
  function stTable(groups, w, h) {
    const cols = L.standCols, nRows = groups.reduce((a, g) => a + g.rows.length, 0);
    const rowH = Math.max(18, Math.min(25, Math.floor((h - groups.length * 34 - 2) / nRows)));
    const head = (g) => `<div class="sthead"><span class="t">${esc(shortDiv(g.name))}</span>${cols.map((c) => `<span class="c">${c}</span>`).join('')}</div>`;
    const row = (r, i, g) => `${g.cut?.includes(i) ? '<div class="cutline"></div>' : ''}<div class="strow${r.abbr === D.team.abbr ? ' me' : ''}">${logo(r.logo)}<span class="ab">${esc(r.abbr)}</span>${r.clinch ? `<sup>${esc(r.clinch)}</sup>` : ''}${r.cols.map((v) => `<span class="c mono">${esc(v)}</span>`).join('')}</div>`;
    return `<div class="sts${cols.length >= 7 ? ' dense' : ''}" style="--ncol:${cols.length};--rowh:${rowH}px">${groups.map((g) => `<div class="stdiv">${head(g)}${g.rows.map((r, i) => row(r, i, g)).join('')}</div>`).join('')}</div>`;
  }
  const byDivision = (conf, mineFirst) => {
    const ds = [...conf.divisions];
    if (mineFirst) ds.sort((a, b) => (b.name === D.team.division) - (a.name === D.team.division));
    return ds;
  };
  const TABLES = {
    divisions: ['Your conference, by division', (w, h) => stTable(byDivision(myConf(), true), w, h)],
    conference: ['Your conference, one table', (w, h) => stTable([{ name: myConf().name, rows: myConf().picture, cut: L.cuts }], w, h)],
    other: ['The other conference', (w, h) => stTable(byDivision(otherConf(), false), w, h)],
    power: ['Power ranking', (w, h) => powerList(w, h, 30)],
  };
  // strength bars grow from 50 (average); two columns when the whole league won't fit in one
  function powerList(w, h, n) {
    const all = index.power, rows = all.slice(0, n);
    const dev = Math.max(...all.map((p) => Math.abs(p.strength - 50)), 1);
    const bar = (p) => `<span class="bar"><i style="${p.strength >= 50 ? 'left:50%' : 'right:50%'};width:${Math.abs(p.strength - 50) / dev * 50}%;background:${esc(p.color)}"></i></span>`;
    const head = `<div class="colhead"><span class="t">Power ranking</span><span class="r small">STRENGTH · ${esc(L.margin.toUpperCase())}</span></div>`;
    const oneCol = (h - 34) / rows.length >= 19;
    if (oneCol) {
      const rowH = Math.min(25, Math.floor((h - 34) / rows.length));
      return head + `<div class="pwr" style="--rowh:${rowH}px">${rows.map((p, i) => `<div class="pwrow${p.abbr === D.team.abbr ? ' me' : ''}" title="${esc(p.rec)}"><span class="n">${i + 1}</span>${logo(p.logo)}<span class="ab">${esc(p.abbr)}</span>
        ${bar(p)}<span class="v mono">${p.strength.toFixed(1)}</span><span class="rec">${signed(p.margin)}</span></div>`).join('')}</div>`;
    }
    const half = Math.ceil(rows.length / 2), rowH = Math.min(25, Math.floor((h - 34) / half));
    const col = (list, off) => `<div>${list.map((p, i) => `<div class="pwrow c2${p.abbr === D.team.abbr ? ' me' : ''}" title="${esc(`${p.rec}, ${signed(p.margin)} per ${L.game}`)}"><span class="n">${off + i + 1}</span>${logo(p.logo)}<span class="ab">${esc(p.abbr)}</span>${bar(p)}<span class="v mono">${p.strength.toFixed(1)}</span></div>`).join('')}</div>`;
    return head + `<div class="pwr two" style="--rowh:${rowH}px">${col(rows.slice(0, half), 0)}${col(rows.slice(half), half)}</div>`;
  }

  // ---------- middle column ----------
  function pictureOf(conf, w, h, mineToo) {
    const n = L.lineSeed;
    const fit = Math.floor((h - 78) / 26);
    const me = conf.picture.find((r) => r.abbr === D.team.abbr);
    let rows = conf.picture.filter((r) => r.seed != null).slice(0, Math.min(conf.picture.length, n + 2, fit));
    if (mineToo && me && !rows.includes(me)) rows = [...rows.slice(0, fit - 1), me];
    let html = `<div class="colhead"><span class="t">Playoff picture</span><span class="r small">${esc(conf.short.toUpperCase())}</span></div>
      <div class="pnote">${esc(L.note)}</div><div class="sub"><span>SEED</span><span class="gp">GP</span><span class="pts">± LINE</span></div>`;
    rows.forEach((r, i) => {
      if (i && L.cuts.includes(rows[i - 1].seed) && r.seed > rows[i - 1].seed) html += '<div class="cutline"></div>';
      html += `<div class="prow${r.abbr === D.team.abbr ? ' me' : ''}"><span class="lbl">${r.seed ?? ''}</span>${logo(r.logo)}<span class="ab">${esc(r.abbr)}</span><span class="gp">${r.gp ?? (r.w + r.l + (r.t || 0))}</span><span class="pts">${r.edge == null ? '' : signed(r.edge)}</span></div>`;
    });
    return `<div class="ppic">${html}</div>`;
  }
  function gameRows(gs, n) {
    return gs.slice(0, n).map((g) => {
      const right = g.state === 'final' ? `<span class="res ${g.res === 'T' ? 'OT' : g.res}">${g.res === 'T' ? (L.draws ? 'D' : 'T') : g.res}</span><span class="sc mono">${g.us}–${g.them}</span>`
        : `<span class="tm">${/T0[45]:00Z$/.test(g.date) ? 'TBD' : fmt(g.date, { hour: 'numeric', minute: '2-digit' }).replace(' ', '').toLowerCase()}</span>`;
      return `<div class="gl"><span class="dt">${L.byWeek && g.week ? `Wk ${g.week}` : fmt(g.date, { month: 'short', day: 'numeric' })}</span><span class="ha">${g.home ? 'vs' : '@'}</span>${oppText(g) === 'TBD' ? '' : logo(g.oppLogo)}<span class="ab">${esc(oppText(g))}</span>${right}</div>`;
    }).join('');
  }
  const MIDDLE = {
    picture: ['Playoff picture (yours)', (w, h) => pictureOf(myConf(), w, h, true)],
    otherPicture: ['Playoff picture (other conference)', (w, h) => pictureOf(otherConf(), w, h, false)],
    teamStats: ['Team stats with ranks', (w, h) => {
      const n = Math.floor((h - 34) / 24);
      return `<div class="colhead"><span class="t">Team stats</span><span class="r small">RANK</span></div><div class="tstats">${D.stats.slice(0, n).map((s) =>
        `<div class="ts"><span class="k">${esc(s.label)}</span><span class="v mono">${esc(s.value)}</span><span class="rk${s.rank <= 5 ? ' top' : s.rank > s.of - 5 ? ' low' : ''}">${ord(s.rank)}</span></div>`).join('')}</div>`;
    }],
    next10: ['Next 10', (w, h) => `<div class="colhead"><span class="t">Next 10</span><span class="r small">EASTERN TIME</span></div><div class="glist">${gameRows(upcoming(), Math.min(10, Math.floor((h - 34) / 30))) || `<div class="note">No ${L.games} scheduled.</div>`}</div>`],
    last10: ['Last 10 results', (w, h) => `<div class="colhead"><span class="t">Last 10</span></div><div class="glist">${gameRows(results().slice(-10).reverse(), Math.min(10, Math.floor((h - 34) / 30)))}</div>`],
    power: ['Power ranking', (w, h) => powerList(w, h, Math.floor((h - 34) / 24))],
  };

  // ---------- right column ----------
  const card = (g) => `<div class="ncard" data-game="${esc(g.id)}"><div class="date"><div class="dow">${fmt(g.date, { weekday: 'short' }).toUpperCase()}</div><div class="day">${fmt(g.date, { day: 'numeric' })}</div></div>
      <div class="at">${g.home ? 'vs' : '@'}${g.tv ? `<small>${esc(g.tv)}</small>` : ''}</div>${oppText(g) === 'TBD' ? '<span class="tbd">TBD</span>' : logo(g.oppLogo)}<div class="time">${timeText(g)}</div></div>`;
  // Next 5: what's coming (playoffs included); after the season, the playoff run or next season's opening games
  function nextPanel(n) {
    const up = upcoming().slice(0, n);
    if (up.length) {
      const title = up[0].round ? 'Playoffs' : L.byWeek ? 'Next up' : `Next ${Math.min(n, up.length) === 1 ? 'game' : 5}`;
      return `<div class="colhead big"><span class="t">${title}</span><span class="r small">${esc((up[0].round || 'EASTERN TIME').toUpperCase())}</span></div><div class="nlist">${up.map(card).join('')}</div>`;
    }
    if (D.post?.length) return postPanel();
    if (D.nextSeason?.games?.length) return `<div class="colhead big"><span class="t">Opening Day</span><span class="r small">${esc(D.nextSeason.name)} SEASON</span></div><div class="nlist">${D.nextSeason.games.slice(0, n).map(card).join('')}</div>`;
    return `<div class="colhead big"><span class="t">Next 5</span></div><div class="note" style="margin-top:12px">No ${L.games} scheduled yet.</div>`;
  }
  const postPanel = () => `<div class="colhead big"><span class="t">Postseason</span><span class="r small">${esc(postLine().toUpperCase())}</span></div><div class="pglist">${(D.post || []).slice(-6).map((g) =>
    `<div class="pgrow"><span class="rd">${esc((g.round || '').replace(' - Game ', ' G').replace(/^Round /, 'Rd '))}</span>${oppText(g) === 'TBD' ? '<span class="tbd">TBD</span>' : logo(g.oppLogo)}${g.state === 'final'
      ? `<span class="res ${g.res}">${g.res === 'T' ? 'D' : g.res}</span><span class="sc mono">${g.us}–${g.them}</span>` : `<span class="when">${esc(fmt(g.date, { month: 'short', day: 'numeric' }))} · ${timeText(g)}</span>`}</div>`).join('') || '<div class="note">No postseason games.</div>'}</div>`;
  const lastRows = (n, regular = false) => (regular ? finals() : results()).slice(-n).reverse().map((g) => `<div class="lgrow">${logo(g.oppLogo)}<span class="res ${g.res === 'T' ? 'OT' : g.res}">${g.res === 'T' ? (L.draws ? 'D' : 'T') : g.res}</span><span class="sc mono">${g.us}–${g.them}</span><span class="wk">${g.round ? esc(g.round.replace(/ - Game (\d+)/, ' G$1')) : L.byWeek && g.week ? `Wk ${g.week}` : fmt(g.date, { month: 'short', day: 'numeric' })}</span></div>`).join('');
  const unitCap = () => { const u = L.margin.replace(' margin', '') + 's'; return u[0].toUpperCase() + u.slice(1); };
  function splits() {
    const f = finals(), r = D.record;
    const close = f.filter((g) => Math.abs(g.us - g.them) <= ({ basketball: 5, football: 8, baseball: 1, soccer: 1 }[L.sport] || 1));
    const rec = (gs) => { const c = (x) => gs.filter((g) => g.res === x).length; return L.draws ? `${c('W')}-${c('T')}-${c('L')}` : c('T') ? `${c('W')}-${c('L')}-${c('T')}` : `${c('W')}-${c('L')}`; };
    const pf = f.reduce((a, g) => a + g.us, 0), pa = f.reduce((a, g) => a + g.them, 0), n = f.length || 1;
    const rows = [['Home', r.home], ['Road', r.road], [`vs ${L.goodLabel}`, r.vsGood], [`Close ${L.games}`, rec(close)], ['Last 10', rec(f.slice(-10))],
      [`${unitCap()} for / ${L.game}`, (pf / n).toFixed(1)], [`${unitCap()} against / ${L.game}`, (pa / n).toFixed(1)]];
    return `<div class="colhead big"><span class="t">Splits</span></div><div class="splits">${rows.map(([k, v]) => `<div><span>${esc(k)}</span><b class="mono">${esc(v || '–')}</b></div>`).join('')}</div>`;
  }
  const RIGHT = {
    next5: ['Next 5', () => nextPanel(5)],
    // when the postseason panel is showing, Last 5 is the regular season's end, so the two don't repeat
    last5: ['Last 5', () => { const reg = !upcoming().length && D.post?.length && layout.upper === 'next5';
      return `<div class="colhead big"><span class="t">Last 5</span>${reg ? '<span class="r small">REGULAR SEASON</span>' : ''}</div><div class="llist">${lastRows(5, reg)}</div>`; }],
    post: ['Postseason', postPanel],
    splits: ['Splits', splits],
    nextList: ['Next games (list)', (w, h) => `<div class="colhead big"><span class="t">Coming up</span></div><div class="glist">${gameRows(upcoming(), Math.floor((h - 34) / 30)) || '<div class="note">Nothing scheduled.</div>'}</div>`],
  };

  // ---------- stat boxes and leader rows ----------
  const statBy = (k) => D.stats.find((s) => s.key === k);
  const box = (k) => { const s = statBy(k); return s ? `<div class="box"><div class="k${s.label.length > 10 ? ' sm' : ''}">${esc(s.label)}</div><div class="rk">${ord(s.rank)} of ${s.of}</div><div class="v">${esc(s.value)}</div></div>` : `<div class="box"><div class="k">${esc(k)}</div><div class="rk">no data</div></div>`; };
  const shownLeaders = () => {
    const have = (k) => D.leaders.some((x) => x.key === k);
    const spare = L.leaders.map(([k]) => k).filter((k) => have(k) && !layout.leaders.includes(k));
    return layout.leaders.map((k) => (have(k) ? k : spare.shift() || k));
  };
  const leaderRow = (k) => {
    const l = D.leaders.find((x) => x.key === k);
    if (!l) return `<div class="lrow"><div class="who"><div class="k">${esc(L.leaders.find((x) => x[0] === k)?.[1] || k)}</div><div class="s">no data yet</div></div></div>`;
    return `<div class="lrow"><div class="face">${l.face ? `<img src="${esc(l.face)}" alt="" loading="lazy">` : `<span class="jn">${esc(l.jersey || '')}</span>`}</div>
      <div class="who"><div class="k">${esc(l.label)}</div><div class="n${(l.short || l.name || '').length > 17 ? ' xs' : (l.short || l.name || '').length > 15 ? ' sm' : ''}">${esc(l.short || l.name)}</div><div class="s">${esc(l.sub || [l.jersey && `#${l.jersey}`, l.pos].filter(Boolean).join(' · '))}</div></div>
      <div class="v${String(l.value).length > 5 ? ' xlong' : String(l.value).length > 4 ? ' long' : ''}">${esc(l.value)}</div></div>`;
  };

  // ---------- slots ----------
  // [x, y, w, h] per mode; the stack (phone) layout puts the same slots one under another
  function geometry() {
    const boxRows = Math.ceil(layout.boxes.length / 4);
    if (MODE === 'board') {
      const boxesY = 1104 - boxRows * 62;
      return { chart1: [40, 112, 840, 196], chart2: [40, 350, 840, 126], col1: [40, 485, 340, boxesY - 485 - 10], boxes: [40, boxesY, 340, boxRows * 62],
        pic: [400, 485, 230, 400], leaders: [400, 895, 230, 200], upper: [650, 485, 230, 350], lower: [650, 846, 230, 255], foot: [40, 1118, 840], H: 1145 };
    }
    let y = 112; const g = {};
    g.chart1 = [16, y, 468, 196]; y += 240;
    g.chart2 = [16, y, 468, 120]; y += 158;
    g.upper = [16, y, 230, 350]; g.lower = [254, y, 230, 350]; y += 362;
    // phones: each slot as tall as what it shows
    const picRows = { picture: Math.min(myConf().picture.length, L.lineSeed + 3), otherPicture: Math.min(otherConf().picture.length, L.lineSeed + 2) }[layout.pic];
    const picH = picRows ? 64 + picRows * 26 : { teamStats: 34 + D.stats.length * 24, power: 34 + 12 * 24 }[layout.pic] || 340;
    g.pic = [16, y, 230, picH]; g.leaders = [254, y, 230, 200]; y += Math.max(picH, 210) + 14;
    const divs = (c) => c.divisions.length * 33 + c.picture.length * 25;
    const colH = { divisions: divs(myConf()), other: divs(otherConf()), conference: 33 + myConf().picture.length * 25, power: 34 + index.power.length * 25 }[layout.col1] || divs(myConf());
    g.col1 = [16, y, 468, colH]; y += colH + 12;
    g.boxes = [16, y, 468, boxRows * 62]; y += boxRows * 62 + 16;
    g.foot = [16, y, 468]; g.H = y + 30;
    return g;
  }
  const slot = (name, [x, y, w, h], inner, cls = '') => `<section class="abs slot ${cls}" data-slot="${name}" style="left:${x}px;top:${y}px;width:${w}px;${h ? `height:${h}px;` : ''}"><button class="swap" aria-label="Change">⇄</button>${inner}</section>`;

  function render() {
    MODE = modeNow();
    document.body.classList.toggle('stack', MODE === 'stack');
    document.documentElement.style.setProperty('--primary', D.team.color);
    document.documentElement.style.setProperty('--accent', D.team.alt);
    board.className = MODE;
    const G = geometry();
    board.style.height = `${G.H}px`;
    const [cw1, ch1] = [G.chart1[2], G.chart1[3] - 34], [cw2, ch2] = [G.chart2[2], G.chart2[3] - 32];
    let html = header();
    html += slot('chart1', G.chart1, chartPanel(layout.chart1, cw1, ch1));
    html += slot('chart2', G.chart2, chartPanel(layout.chart2, cw2, ch2));
    html += slot('col1', G.col1, (TABLES[layout.col1] || TABLES.divisions)[1](G.col1[2], G.col1[3]));
    html += `<section class="abs stgrid" style="left:${G.boxes[0]}px;top:${G.boxes[1]}px;width:${G.boxes[2]}px;--per:4">${layout.boxes.map((k, i) =>
      `<div class="slot boxslot" data-slot="box${i}"><button class="swap" aria-label="Change">⇄</button>${box(k)}</div>`).join('')}</section>`;
    html += slot('pic', G.pic, (MIDDLE[layout.pic] || MIDDLE.picture)[1](G.pic[2], G.pic[3]));
    html += `<section class="abs" style="left:${G.leaders[0]}px;top:${G.leaders[1]}px;width:${G.leaders[2]}px"><div class="colhead"><span class="t">Team leaders</span></div><div class="leaders">${shownLeaders().map((k, i) =>
      `<div class="slot leadslot" data-slot="lead${i}"><button class="swap" aria-label="Change">⇄</button>${leaderRow(k)}</div>`).join('')}</div></section>`;
    html += slot('upper', G.upper, (RIGHT[layout.upper] || RIGHT.next5)[1](G.upper[2], G.upper[3]));
    html += slot('lower', G.lower, (RIGHT[layout.lower] || RIGHT.last5)[1](G.lower[2], G.lower[3]));
    const upd = fmt(D.updated, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
    html += `<footer class="abs foot" style="left:${G.foot[0]}px;top:${G.foot[1]}px;width:${G.foot[2]}px"><span>Data: ESPN · updated ${upd} ET</span><span class="brand sb" role="button" tabindex="0">${brandIcon(D.brand, 16)}${esc(D.brand.toUpperCase())}</span></footer>`;
    board.innerHTML = html;
    if (editing) board.querySelectorAll('.slot').forEach((s) => s.classList.add('editable'));
    remix(D.team.altLogo || D.team.logo);
    fit(MODE, W[MODE]);
  }
  addEventListener('resize', () => { if (!D) return; closePop(); modeNow() !== MODE ? render() : fit(MODE, W[MODE]); });

  // ---------- Customize ----------
  let editing = false, editBar = null, popEl = null;
  const OPTIONS = (name) => {
    if (name === 'chart1' || name === 'chart2') return Object.entries(CHARTS).map(([k, [label]]) => [k, typeof label === 'function' ? label(L) : label]);
    if (name === 'col1') return Object.entries(TABLES).map(([k, [label]]) => [k, label]);
    if (name === 'pic') return Object.entries(MIDDLE).map(([k, [label]]) => [k, label]);
    if (name === 'upper' || name === 'lower') return Object.entries(RIGHT).map(([k, [label]]) => [k, label]);
    if (name.startsWith('box')) return L.stats.filter(([k]) => statBy(k)).map(([k, label]) => [k, `${label} · ${ord(statBy(k).rank)}`]);
    if (name.startsWith('lead')) return L.leaders.filter(([k]) => D.leaders.some((x) => x.key === k)).map(([k, label]) => [k, label]);
    return [];
  };
  const current = (name) => name.startsWith('box') ? layout.boxes[+name.slice(3)] : name.startsWith('lead') ? layout.leaders[+name.slice(4)] : layout[name];
  function setSlot(name, v) {
    if (name.startsWith('box')) layout.boxes[+name.slice(3)] = v;
    else if (name.startsWith('lead')) layout.leaders[+name.slice(4)] = v;
    else layout[name] = v;
    saveLayout(); render(); presetButtons();
  }
  function closePop() { popEl?.remove(); popEl = null; board.querySelectorAll('.is-active').forEach((x) => x.classList.remove('is-active')); }
  function openSlotMenu(el) {
    closePop();
    const name = el.dataset.slot, cur = current(name);
    el.classList.add('is-active');
    popEl = document.createElement('div');
    popEl.className = 'pop menu';
    popEl.innerHTML = `<button class="px" aria-label="Close">×</button><div class="pk">Change panel</div><div class="opts">${OPTIONS(name).map(([k, label]) =>
      `<button class="opt${k === cur ? ' on' : ''}" data-opt="${esc(k)}">${esc(label)}</button>`).join('')}</div>`;
    document.body.appendChild(popEl);
    const r = el.getBoundingClientRect(), pw = popEl.offsetWidth;
    popEl.style.left = `${Math.max(10, Math.min(scrollX + r.left, scrollX + innerWidth - pw - 10))}px`;
    popEl.style.top = `${scrollY + r.top + Math.min(r.height, 60) + 6}px`;
    popEl.addEventListener('click', (e) => {
      e.stopPropagation();
      if (e.target.closest('.px')) return closePop();
      const b = e.target.closest('[data-opt]'); if (!b) return;
      closePop(); setSlot(name, b.dataset.opt);
    });
  }
  function presetButtons() {
    if (!editBar) return;
    const d = defaults();
    editBar.querySelectorAll('[data-preset]').forEach((b) => {
      const p = PRESETS.find((x) => x[0] === b.dataset.preset)[2];
      const want = { ...d, ...p, boxes: layout.boxes, leaders: layout.leaders };
      b.classList.toggle('on', ['chart1', 'chart2', 'col1', 'pic', 'upper', 'lower'].every((k) => want[k] === layout[k]));
    });
  }
  function startEditing() {
    if (editing) return;
    editing = true; closePicker();
    document.body.classList.add('editing');
    board.querySelectorAll('.slot').forEach((s) => s.classList.add('editable'));
    editBar = document.createElement('div');
    editBar.className = 'editbar';
    editBar.innerHTML = `<div class="ebp">${PRESETS.map(([k, label]) => `<button data-preset="${k}">${esc(label)}</button>`).join('')}</div>` +
      `<div class="ebr"><span>Pick a preset, or tap any panel to change it</span><button data-act="reset">Reset</button><button data-act="share">Copy link</button><button data-act="done" class="on">Done</button></div>`;
    editBar.addEventListener('click', (e) => {
      const pre = e.target.closest('[data-preset]')?.dataset.preset;
      if (pre) { const p = PRESETS.find((x) => x[0] === pre)[2]; layout = { ...defaults(), ...p, boxes: layout.boxes, leaders: layout.leaders }; saveLayout(); render(); presetButtons(); return; }
      const act = e.target.closest('button')?.dataset.act;
      if (act === 'done') stopEditing();
      if (act === 'reset') { layout = defaults(); layoutStore.set(null); render(); presetButtons(); }
      if (act === 'share') {
        const url = new URL(location.href); url.search = ''; url.searchParams.set('layout', b64.enc(layout));
        const done = () => { e.target.textContent = 'Copied'; setTimeout(() => (e.target.textContent = 'Copy link'), 1500); };
        navigator.clipboard?.writeText(url.href).then(done, () => prompt('Copy this link', url.href));
      }
    });
    document.body.appendChild(editBar);
    presetButtons();
    fit(MODE, W[MODE]);
  }
  function stopEditing() {
    editing = false; closePop();
    document.body.classList.remove('editing');
    editBar?.remove(); editBar = null;
    render();
  }
  board.addEventListener('click', (e) => {
    if (editing) { const s = e.target.closest('.slot'); if (s) { e.stopPropagation(); openSlotMenu(s); } return; }
    if (e.target.closest('.sb')) pick();
  });
  document.addEventListener('click', (e) => { if (popEl && !popEl.contains(e.target) && !e.target.closest('.slot')) closePop(); });
  const pick = () => {
    const p = openPicker(index, D.team.abbr, '<button class="cust" data-act="customize">Customize board</button>');
    p.querySelector('.cust').addEventListener('click', startEditing);
  };
  addEventListener('keydown', (e) => {
    if (e.metaKey || e.ctrlKey || e.target.closest?.('input, textarea')) return;
    if (e.key === 'Escape') { if (popEl) closePop(); else if (SB.picker) closePicker(); else if (editing) stopEditing(); }
    else if (e.key.toLowerCase() === 't' && !SB.picker) pick();
    else if (e.key.toLowerCase() === 'c' && !SB.picker) (editing ? stopEditing : startEditing)();
    else if ((e.key === 'Enter' || e.key === ' ') && e.target.closest?.('.sb')) { e.preventDefault(); pick(); }
  });

  // ---------- live score from ESPN's scoreboard ----------
  let timer = null;
  async function live() {
    clearTimeout(timer);
    try {
      const sb = await (await fetch(`https://site.api.espn.com/apis/site/v2/sports/${L.espn}/scoreboard`)).json();
      const ev = sb.events?.find((e) => e.competitions[0].competitors.some((c) => c.team.id === D.team.id));
      const boxEl = document.getElementById('livebox');
      if (ev && boxEl) {
        const c = ev.competitions[0], st = c.status.type;
        const me = c.competitors.find((x) => x.team.id === D.team.id), op = c.competitors.find((x) => x.team.id !== D.team.id);
        if (st.state === 'in') {
          boxEl.innerHTML = `<span class="livedot"></span>LIVE ${esc(me.team.abbreviation)} ${esc(me.score)}–${esc(op.score)} ${esc(op.team.abbreviation)} · ${esc(st.shortDetail)}`;
          const card = board.querySelector(`.ncard[data-game="${ev.id}"] .time`);
          if (card) { card.innerHTML = `<span class="lv">${esc(me.score)}–${esc(op.score)}</span>`; card.closest('.ncard').classList.add('live'); }
          timer = setTimeout(live, 30000);
          return;
        }
        if (st.state === 'post' && !D.games.some((g) => g.id === ev.id && g.state === 'final')) {
          boxEl.innerHTML = `<b>Final: ${esc(me.team.abbreviation)} ${esc(me.score)}–${esc(op.score)} ${esc(op.team.abbreviation)}</b>`;
        }
      }
    } catch {}
    timer = setTimeout(live, 5 * 60000);
  }

  (async () => {
    index = await SB.loadIndex();
    const want = document.body.dataset.team || index.teams.find((t) => t.slug === teamStore.get() || t.abbr === teamStore.get())?.abbr || index.defaultTeam;
    const t = index.teams.find((x) => x.abbr === want) || index.teams[0];
    teamStore.set(t.abbr);
    D = await (await fetch(`${key}/data/${t.abbr}.json`, { cache: 'no-cache' })).json();
    L = D.cfg;
    loadLayout();
    document.title = `${D.team.name} · ${D.brand}`;
    render();
    live();
  })().catch((e) => { board.innerHTML = `<div class="msg">Couldn't load this board. ${esc(e.message)}</div>`; });
})();
