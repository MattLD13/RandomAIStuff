// Rinkside renderer: reads data.json (built by scripts/build-data.mjs) and draws the board.
(() => {
  const W = 921, H = 1145;
  const params = new URLSearchParams(location.search);
  const wallpaper = params.has('wallpaper');
  const board = document.getElementById('board');
  const stage = document.getElementById('stage');
  const SVGNS = 'http://www.w3.org/2000/svg';

  // ---------- tiny DOM helpers ----------
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const logo = (src, alt = '') => `<img class="logo" src="${esc(src)}" alt="${esc(alt)}" loading="eager" decoding="async">`;
  const icon = (home, result) =>
    `<svg class="icon ${home ? 'home' : 'away'} ${result || ''}"><use href="#i-${home ? 'home' : 'away'}"/></svg>`;
  const at = (x, y, w, html, cls = '') =>
    `<div class="abs ${cls}" style="left:${x}px;top:${y}px;${w ? `width:${w}px;` : ''}">${html}</div>`;
  const color = (r) => (r === 'W' ? 'var(--win)' : r === 'L' ? 'var(--loss)' : r === 'O' ? 'var(--otl)' : 'var(--future)');

  // ---------- charts ----------
  const PLOT_X0 = 2, PLOT_X1 = 808; // inside 840px-wide svg placed at x=40

  function seasonChart(season) {
    const n = Math.max(season.total, 1);
    const slot = (PLOT_X1 - PLOT_X0) / n;
    const zero = 81, unit = 15, cap = 5;
    const cx = (i) => PLOT_X0 + (i + 0.5) * slot;
    let s = '';
    // guides
    for (const v of [3, 2, 1, -1, -2, -3]) {
      s += `<text x="826" y="${zero - v * unit + 3.5}" fill="#8d8d8d" font-size="10" font-weight="500" text-anchor="middle">${v > 0 ? '+' : '−'}${Math.abs(v)}</text>`;
    }
    for (const v of [4, 3, 2, 1, -1, -2, -3, -4])
      s += `<line x1="${PLOT_X0}" x2="${PLOT_X1}" y1="${zero - v * unit}" y2="${zero - v * unit}" stroke="#262626" stroke-dasharray="1 4.8"/>`;
    // dashed baseline for games still to play: one short tick per remaining game
    for (let i = season.played; i < n; i++)
      s += `<rect x="${(cx(i) - slot * 0.32).toFixed(2)}" y="${zero - 1.5}" width="${(slot * 0.64).toFixed(2)}" height="3" fill="#4d4d4d"/>`;
    // bars
    const bw = Math.min(7.2, slot * 0.75);
    season.games.forEach((g, i) => {
      if (!g.result) return;
      const m = Math.max(-cap, Math.min(cap, g.margin || (g.result === 'W' ? 1 : -1)));
      const h = Math.abs(m) * unit;
      const y = m > 0 ? zero - h : zero;
      s += `<rect x="${(cx(i) - bw / 2).toFixed(2)}" y="${y}" width="${bw.toFixed(2)}" height="${h}" fill="${color(g.result)}"/>`;
    });
    // home/away dots
    season.games.forEach((g, i) => {
      const c = g.result ? '#c4c4c4' : '#8a8a8a';
      s += g.home
        ? `<circle cx="${cx(i).toFixed(2)}" cy="168" r="2.6" fill="${c}"/>`
        : `<circle cx="${cx(i).toFixed(2)}" cy="168" r="2.1" fill="none" stroke="${c}" stroke-width="1"/>`;
    });
    // month labels centred on the first game of each month (skip stub months like a late-Sept opener)
    const count = {};
    season.games.forEach((g) => (count[g.month] = (count[g.month] || 0) + 1));
    let prev = null;
    season.games.forEach((g, i) => {
      if (g.month !== prev && count[g.month] >= 3)
        s += `<text x="${cx(i).toFixed(1)}" y="191" fill="#9a9a9a" font-size="13" font-weight="500" text-anchor="middle">${esc(g.month)}</text>`;
      prev = g.month;
    });
    return `<svg class="abs" style="left:40px;top:145px" width="840" height="200" viewBox="0 0 840 200">${s}</svg>`;
  }

  function playoffChart(line, season) {
    const n = Math.max(season.total, 1);
    const slot = (PLOT_X1 - PLOT_X0) / n;
    const zero = 53, unit = 4.2, cap = 10;
    const xk = (k) => PLOT_X0 + Math.max(0, k - 0.5) * slot;
    const yv = (v) => zero - Math.max(-cap - 1, Math.min(cap + 1, v)) * unit;
    let s = '';
    for (const v of [10, 5, 0, -5, -10])
      s += `<text x="826" y="${yv(v) + 3.5}" fill="#8d8d8d" font-size="10" font-weight="500" text-anchor="middle">${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(v)}</text>`;
    for (const v of [10, 5, -5, -10])
      s += `<line x1="${PLOT_X0}" x2="${PLOT_X1}" y1="${yv(v)}" y2="${yv(v)}" stroke="#1f1f1f" stroke-dasharray="1 3"/>`;
    s += `<line x1="${PLOT_X0}" x2="${PLOT_X1}" y1="${zero}" y2="${zero}" stroke="#6a6a6a" stroke-width="1.2" stroke-dasharray="4 3"/>`;
    const pts = line.history.map((v, k) => [xk(k), yv(v)]);
    if (pts.length > 1) {
      const path = pts.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(2)} ${y.toFixed(2)}`).join('');
      const area = `${path}L${pts[pts.length - 1][0].toFixed(2)} ${zero}L${pts[0][0].toFixed(2)} ${zero}Z`;
      s += `<defs><clipPath id="cp-up"><rect x="0" y="0" width="840" height="${zero}"/></clipPath>
              <clipPath id="cp-dn"><rect x="0" y="${zero}" width="840" height="200"/></clipPath></defs>`;
      s += `<g clip-path="url(#cp-up)"><path d="${area}" fill="#173f1d"/><path d="${path}" fill="none" stroke="#2f8a3a" stroke-width="1.6" stroke-linejoin="round"/></g>`;
      s += `<g clip-path="url(#cp-dn)"><path d="${area}" fill="#4a1018"/><path d="${path}" fill="none" stroke="#c42a3c" stroke-width="1.6" stroke-linejoin="round"/></g>`;
    }
    const [lx, ly] = pts[pts.length - 1] || [xk(0), zero];
    s += `<circle cx="${lx}" cy="${ly}" r="4.4" fill="#fff"/>`;
    return `<svg class="abs" style="left:40px;top:380px" width="840" height="110" viewBox="0 0 840 110">${s}</svg>`;
  }

  // ---------- columns ----------
  function division(d) {
    const rows = d.teams
      .map((t) => `<div class="drow">${logo(t.logo, t.abbrev)}<div class="icons">${t.games.map((g) => icon(g.home, g.result)).join('')}</div></div>`)
      .join('');
    return `<section class="div"><div class="colhead"><span class="t">${esc(d.name)}</span><span class="r">${esc(d.record)}</span></div><div class="drows">${rows}</div></section>`;
  }

  function pictureRows(rows) {
    return rows
      .map((r) => `<div class="prow${r.me ? ' me' : ''}"><span class="lbl">${esc(r.label)}</span>${logo(r.logo, r.abbrev)}<span class="ab">${esc(r.abbrev)}</span><span class="gp">${r.gp}</span><span class="pts">${r.pts}</span></div>`)
      .join('');
  }

  function picture(d) {
    const p = d.picture;
    let s = `<div class="colhead big"><span class="t">Playoff picture</span></div>`;
    s += `<div class="sub first"><span>${esc(p.divisionName)}</span><span class="gp">GP</span><span class="pts">PTS</span></div>`;
    s += pictureRows(p.divRows);
    s += `<div class="sub"><span>Wild card</span></div>`;
    s += pictureRows(p.wcRows);
    s += `<div class="cutline"></div>`;
    s += pictureRows(p.outRows);
    if (d.specialTeams) {
      const box = (k, v) => `<div class="box"><div class="k">${k}</div><div class="rk">· ${v.rank}${suffix(v.rank)} of ${v.of}</div><div class="v">${v.pct}<small> %</small></div></div>`;
      s += `<div class="st">${box('Power play', d.specialTeams.pp)}${box('Penalty kill', d.specialTeams.pk)}</div>`;
    }
    s += `<div class="colhead big lhead"><span class="t">Team leaders</span></div><div class="leaders">`;
    s += d.leaders
      .map((l) => `<div class="lrow"><div class="face"><img src="${esc(l.headshot)}" alt=""></div><div class="who"><div class="k">${esc(l.label)}</div><div class="n">${esc(l.name)}</div><div class="s">${esc(l.sub)}</div></div><div class="v">${esc(l.value)}</div></div>`)
      .join('');
    return s + `</div>`;
  }

  function nextLast(d) {
    let s = `<div class="colhead big"><span class="t">Next 5</span><span class="r small">EASTERN TIME</span></div><div class="nlist">`;
    s += d.nextGames.length
      ? d.nextGames
          .map((g) => `<div class="ncard"><div class="date"><span class="dow">${esc(g.dow)}</span><span class="day">${esc(g.day)}</span></div><span class="at">${g.home ? 'vs' : '@'}</span>${logo(g.logo, g.opp)}<span class="time">${esc(g.time)}</span></div>`)
          .join('')
      : `<div class="note" style="margin-top:12px">No games scheduled</div>`;
    s += `</div><div class="colhead big l5head"><span class="t">Last 5</span></div><div class="llist">`;
    s += d.lastGames
      .map((g) => `<div class="lgrow">${logo(g.logo, g.opp)}<span class="res ${g.result}">${esc(g.result)}</span><span class="sc">${esc(g.score.replace('-', '\u2013'))}</span></div>`)
      .join('');
    return s + `</div>`;
  }

  // Mix two #rrggbb colours: t = share of b.
  const mix = (a, b, t) => {
    const p = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
    const [x, y] = [p(a), p(b)];
    return '#' + x.map((v, i) => Math.round(v + (y[i] - v) * t).toString(16).padStart(2, '0')).join('');
  };

  const suffix = (n) => {
    const s = ['th', 'st', 'nd', 'rd'], v = n % 100;
    return s[(v - 20) % 10] || s[v] || s[0];
  };

  // ---------- full board ----------
  function render(d) {
    const root = document.documentElement.style;
    if (d.team.primaryColor) root.setProperty('--primary', d.team.primaryColor);
    if (d.team.accentColor) root.setProperty('--accent', d.team.accentColor);
    document.title = `${d.team.name} · Rinkside`;

    // Hometown remix: the team's motif as a faint texture behind the whole board.
    const M = window.RinksideMotifs;
    const remix = document.getElementById('remix');
    if (M && remix) {
      remix.innerHTML = `<svg width="100%" height="100%"><defs>${M.pattern('remix-bg', d.team.motif, {
        scale: 1.5, rotate: -12, color: mix(d.team.primaryColor, '#ffffff', 0.35),
      })}</defs><rect width="100%" height="100%" fill="url(#remix-bg)"/></svg>`;
    }

    const h = d.header;
    let s = `<header class="abs hdr">
      <svg class="band" viewBox="0 0 210 95" width="210" height="95" preserveAspectRatio="none">
        <defs>${M ? M.pattern('remix-band', d.team.motif, { scale: 0.85, rotate: -8 }) : ''}</defs>
        <polygon points="0,0 196,0 171,95 0,95" fill="var(--primary)"/>
        <polygon points="0,0 196,0 171,95 0,95" fill="url(#remix-band)" opacity="0.16"/>
        <polygon points="196,0 204,0 179,95 171,95" fill="var(--accent)"/>
      </svg>
      <div class="band" style="background:none" title="Change team"${wallpaper ? '' : ' role="button" tabindex="0"'}><img src="${esc(d.team.logo)}" alt="${esc(d.team.name)}"></div>
      <div class="record">${esc(h.record)}</div>
      <div class="summary"><b>${h.points} points</b>, ${esc(h.summary)}</div>
      <div class="meta"><div>${esc(h.date)}</div><div>${esc(h.splits)}</div><div>${esc(h.schedule)}</div></div>
    </header>`;

    s += at(40, 112, 0, 'The season, game by game', 'title');
    s += `<div class="abs note" style="right:73px;top:118px">${d.season.played} of ${d.season.total} played, bar height = goal margin</div>`;
    s += seasonChart(d.season);

    s += at(40, 352, 0, `Playoff line<span class="big">${esc(d.playoffLine.label)}</span>`, 'title');
    s += `<div class="abs note" style="right:73px;top:358px">${esc(d.playoffLine.text)}</div>`;
    s += playoffChart(d.playoffLine, d.season);

    const [atl, pac, met, cen] = ['Atlantic', 'Pacific', 'Metropolitan', 'Central'].map((n) => d.divisions.find((x) => x.name === n));
    s += at(40, 485, 162, [atl, met].filter(Boolean).map(division).join(''), 'col');
    s += at(220, 485, 162, [pac, cen].filter(Boolean).map(division).join(''), 'col');
    s += at(402, 485, 228, picture(d), 'col ppic');
    s += at(650, 485, 230, nextLast(d), 'col');

    s += `<footer class="abs foot">
      <span class="k"><i class="sw" style="background:var(--win)"></i>Win</span>
      <span class="k"><i class="sw" style="background:var(--loss)"></i>Loss</span>
      <span class="k"><i class="sw" style="background:var(--otl)"></i>OT/SO loss</span>
      <span class="k"><i class="sw" style="background:var(--future)"></i>Still to play</span>
      <span class="k">Filled dot or house = home, ring or plane = away</span>
      <span class="brand" title="Change team">RINKSIDE</span>
    </footer>`;
    board.innerHTML = s;
    fit();
  }

  // ---------- scaling ----------
  function fit() {
    const vw = document.documentElement.clientWidth || innerWidth;
    const vh = innerHeight;
    let scale, top;
    if (wallpaper) {
      // Same placement as an iPhone lock-screen wallpaper: full width, ~21% down the screen.
      scale = vw / W;
      top = Math.round(vh * 0.2125);
      stage.style.height = `${vh}px`;
    } else {
      scale = Math.min(vw / W, 1.6);
      top = Math.max(0, Math.round((vh - H * scale) / 2));
      stage.style.height = `${Math.max(vh, H * scale + top)}px`;
    }
    board.style.transform = `translate(${Math.round((vw - W * scale) / 2)}px, ${top}px) scale(${scale})`;
  }
  addEventListener('resize', fit);

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
    location.href = new URL(`${slug}/`, document.baseURI).href;
  }

  // Team picker: tap the team band (or the RINKSIDE mark, or press "t").
  let picker = null;
  function openPicker() {
    if (!index || wallpaper) return;
    closePicker();
    const order = ['Atlantic', 'Metropolitan', 'Central', 'Pacific'];
    const groups = order
      .map((d) => [d, index.teams.filter((t) => t.division === d)])
      .filter(([, ts]) => ts.length);
    picker = document.createElement('div');
    picker.className = 'picker';
    picker.setAttribute('role', 'dialog');
    picker.setAttribute('aria-label', 'Choose a team');
    picker.innerHTML = `<div class="sheet"><div class="ph"><span>Choose a team</span><button class="x" aria-label="Close">×</button></div>${groups
      .map(([d, ts]) => `<div class="pg"><div class="pgt">${esc(d)}</div><div class="pgl">${ts
        .map((t) => `<button class="pt${t.abbrev === team ? ' on' : ''}" data-team="${esc(t.abbrev)}">${logo(t.logo)}<span>${esc(t.name)}</span></button>`)
        .join('')}</div></div>`)
      .join('')}</div>`;
    picker.addEventListener('click', (e) => {
      const b = e.target.closest('[data-team]');
      if (b) return setTeam(b.dataset.team);
      if (e.target === picker || e.target.closest('.x')) closePicker();
    });
    document.body.appendChild(picker);
    picker.querySelector('.pt.on, .pt')?.focus();
  }
  function closePicker() { picker?.remove(); picker = null; }
  if (!wallpaper) {
    board.addEventListener('click', (e) => { if (e.target.closest('.hdr .band, .foot .brand')) openPicker(); });
    addEventListener('keydown', (e) => {
      if (e.key === 'Escape') closePicker();
      else if ((e.key === 'Enter' || e.key === ' ') && e.target.closest?.('.hdr .band')) { e.preventDefault(); openPicker(); }
      else if (e.key.toLowerCase() === 't' && !picker && !e.metaKey && !e.ctrlKey) openPicker();
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
      if (!index) index = await getJSON('data/teams.json');
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
  if (!wallpaper) setInterval(load, 10 * 60 * 1000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden && !wallpaper) load(); });
})();
