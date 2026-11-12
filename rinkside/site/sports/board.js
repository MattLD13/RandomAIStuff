// The multi-sport board: Courtside (NBA), Sideline (NFL), Dugout (MLB), Pitchside (MLS).
// Same canvas and look as Rinkside; each league's wording, standings columns, playoff format and stats come from
// the team JSON written by scripts/build-sports.mjs. Live scores come straight from ESPN's scoreboard in the browser.
(() => {
  // every league setting arrives with the data (D.cfg, from sports/leagues.json via the builder)
  const key = document.body.dataset.league;
  let L = null;
  const board = document.getElementById('board'), stage = document.getElementById('stage');
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const logo = (src, cls = 'logo') => src ? `<img class="${cls}" src="${esc(src)}" alt="" loading="lazy">` : '';
  const ord = (n) => n + (['th', 'st', 'nd', 'rd'][(n % 100 - 20) % 10] || ['th', 'st', 'nd', 'rd'][n % 100] || 'th');
  const ET = { timeZone: 'America/New_York' };
  const fmt = (d, o) => new Intl.DateTimeFormat('en-US', { ...ET, ...o }).format(new Date(d));
  const STORE = `board-team-${key}`;
  const store = { get() { try { return localStorage.getItem(STORE); } catch { return null; } }, set(v) { try { localStorage.setItem(STORE, v); } catch {} } };

  let index, D, MODE;
  const W = { board: 921, stack: 500 };

  async function start() {
    index = await (await fetch(`${key}/data/league.json`, { cache: 'no-cache' })).json();
    const want = document.body.dataset.team || index.teams.find((t) => t.slug === store.get() || t.abbr === store.get())?.abbr || index.defaultTeam;
    const t = index.teams.find((x) => x.abbr === want) || index.teams[0];
    store.set(t.abbr);
    D = await (await fetch(`${key}/data/${t.abbr}.json`, { cache: 'no-cache' })).json();
    L = D.cfg;
    document.title = `${D.team.short} · ${D.brand}`;
    render();
    live();
  }

  // ---------- pieces ----------
  const record = () => {
    const r = D.record;
    return L.draws ? `${r.w}-${r.t}-${r.l}` : r.t ? `${r.w}-${r.l}-${r.t}` : `${r.w}-${r.l}`;
  };
  const finals = () => D.games.filter((g) => g.state === 'final');
  // The header says what the standings can't: what's next (or how the season ended),
  // home and road, and the record against the better teams.
  const teamName = (abbr) => index.teams.find((t) => t.abbr === abbr)?.name || abbr;
  function summary() {
    const pl = postLine();
    if (pl) return `<b>${esc(pl)}</b>`;
    const g = D.games.find((x) => x.state === 'pre' || x.state === 'live');
    if (g) {
      const tbd = /T0[45]:00Z$/.test(g.date);
      const when = `${fmt(g.date, { weekday: 'short' })}${tbd ? '' : ' ' + fmt(g.date, { hour: 'numeric', minute: '2-digit' }).replace(' ', '').toLowerCase()}`;
      return `Next: <b>${esc(when)} ${g.home ? 'vs' : '@'} ${esc(teamName(g.opp))}</b>${g.tv ? ` on ${esc(g.tv)}` : ''}`;
    }
    const out = D.record.seed > L.lineSeed;
    return `<b>${out ? 'Missed the playoffs' : 'Regular season over'}</b>`;
  }

  function header() {
    const t = D.team, r = D.record;
    const today = fmt(Date.now(), { weekday: 'long', month: 'long', day: 'numeric' });
    const parts = [r.home && `Home ${r.home}`, r.road && `Road ${r.road}`, !L.standCols.includes('L10') && finals().length > 10 && r.last10 && `Last 10 ${r.last10}`].filter(Boolean).join(' · ');
    return `<header class="abs hdr" style="--team:${t.color};--team2:${t.alt}">
      <svg class="band" viewBox="0 0 210 95" width="210" height="95" preserveAspectRatio="none">
        <polygon points="0,0 196,0 171,95 0,95" fill="var(--team)"/>
        <polygon points="196,0 204,0 179,95 171,95" fill="var(--team2)"/>
      </svg>
      <div class="band sb" role="button" tabindex="0" aria-label="Choose a team">${logo(t.logo)}</div>
      <div class="record mono" id="rec">${record()}</div>
      <div class="summary" id="livebox">${summary()}</div>
      <div class="meta"><div>${today}</div><div>${esc(parts)}</div><div>${r.vsGood ? `vs ${esc(L.goodLabel)} ${esc(r.vsGood)}` : ''}</div></div>
    </header>`;
  }

  // the season, game by game: one bar per game, height = margin; NFL is laid out by week so the bye shows
  function seasonChart(x0, y0, w) {
    const gs = D.games.filter((g) => g.state !== 'off');
    const slots = L.byWeek ? Math.max(18, ...gs.map((g) => g.week || 0)) : gs.length;
    const slotOf = (g, i) => L.byWeek && g.week ? g.week - 1 : i;
    const sw = w / Math.max(slots, 1), bw = Math.max(2, Math.min(sw * 0.72, 30));
    const mid = 72, H = 62;
    const cap = L.cap;
    let svg = '';
    // gridlines
    svg += `<line x1="0" x2="${w - 40}" y1="${mid}" y2="${mid}" stroke="#3a3a3a" stroke-dasharray="3 4"/>`;
    for (const v of [cap, Math.round(cap / 2)]) for (const s of [1, -1]) {
      svg += `<text x="${w - 18}" y="${mid - s * v / cap * H + 4}" class="ax">${s > 0 ? '+' : '−'}${v}</text>`;
    }
    gs.forEach((g, i) => {
      const cx = slotOf(g, i) * sw + sw / 2;
      const played = g.state === 'final';
      svg += `<circle cx="${cx}" cy="${mid + H + 12}" r="${Math.min(2.2, sw / 3)}" fill="${played ? '#d8d8d8' : '#444'}"/>`;
      if (!played) return;
      const m = g.us - g.them;
      const h = Math.max(3, Math.min(Math.abs(m), cap) / cap * H);
      const col = g.res === 'W' ? 'var(--win)' : g.res === 'L' ? 'var(--loss)' : 'var(--otl)';
      const y = g.res === 'T' ? mid - 6 : m > 0 ? mid - h : mid;
      const title = `${fmt(g.date, { month: 'short', day: 'numeric' })} ${g.home ? 'vs' : '@'} ${g.opp}: ${g.us}–${g.them}`;
      svg += `<rect x="${cx - bw / 2}" y="${y}" width="${bw}" height="${g.res === 'T' ? 12 : h}" fill="${col}"><title>${esc(title)}</title></rect>`;
    });
    // x labels: weeks for the NFL (and the bye), months for everything else
    if (L.byWeek) {
      const weeks = new Set(gs.map((g) => g.week));
      for (let k = 1; k <= slots; k++) {
        const bye = !weeks.has(k);
        svg += `<text x="${(k - 1) * sw + sw / 2}" y="${mid + H + 32}" class="ax mid${bye ? ' bye' : ''}">${bye ? 'BYE' : k}</text>`;
      }
    } else {
      let last = '', lastX = -99;
      gs.forEach((g, i) => {
        const m = fmt(g.date, { month: 'short' });
        if (m !== last && i * sw - lastX > 40) { svg += `<text x="${i * sw}" y="${mid + H + 32}" class="ax">${m}</text>`; lastX = i * sw; }
        last = m;
      });
    }
    const played = gs.filter((g) => g.state === 'final').length;
    return `<section class="abs" style="left:${x0}px;top:${y0}px;width:${w}px">
      <div class="title">The season, ${L.game} by ${L.game}</div>
      <div class="note right">${played} of ${gs.length} played, bar height = ${L.margin}</div>
      <svg class="chart" width="${w}" height="${mid + H + 36}" viewBox="0 0 ${w} ${mid + H + 36}">${svg}</svg>
    </section>`;
  }

  // how far from the playoff line, through the season
  function lineChart(x0, y0, w) {
    const pts = D.line || [];
    const name = L.lineName;
    const now = pts.length ? pts[pts.length - 1][1] : 0;
    const unit = L.lineUnit === 'points' ? (Math.abs(now) === 1 ? 'point' : 'points') : (Math.abs(now) === 1 ? 'game' : 'games');
    const note = now > 0 ? `${now} ${unit} clear of the first team out` : now < 0 ? `${-now} ${unit} behind the last team in` : 'right on the line';
    const H = 88, mid = 44;
    const gs = D.games.filter((g) => g.state !== 'off');
    const slots = L.byWeek ? Math.max(18, ...gs.map((g) => g.week || 0)) : gs.length;
    const sw = w / Math.max(slots, 1);
    // x from the date: where this team's own schedule had got to by then
    const dates = gs.map((g) => g.date.slice(0, 10));
    const xOf = (d) => {
      let i = 0; while (i < dates.length && dates[i] <= d) i++;
      const g = gs[Math.max(0, i - 1)];
      return ((L.byWeek && g?.week ? g.week : i) - 0.5) * sw;
    };
    const max = Math.max(2, ...pts.map((p) => Math.abs(p[1])));
    const step = max <= 4 ? 1 : max <= 10 ? 2.5 : max <= 20 ? 5 : 10;
    const top = Math.ceil(max / step) * step;
    const y = (v) => mid - v / top * (H / 2 - 4);
    let svg = `<line x1="0" x2="${w - 40}" y1="${mid}" y2="${mid}" stroke="#3a3a3a" stroke-dasharray="3 4"/>`;
    for (const v of [top, top / 2, 0, -top / 2, -top]) svg += `<text x="${w - 18}" y="${y(v) + 4}" class="ax">${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(v)}</text>`;
    if (pts.length) {
      const xy = pts.map(([d, v]) => [Math.min(xOf(d), w - 50), y(v)]);
      const path = xy.map(([a, b], i) => `${i ? 'L' : 'M'}${a.toFixed(1)},${b.toFixed(1)}`).join('');
      const area = `${path}L${xy[xy.length - 1][0].toFixed(1)},${mid}L${xy[0][0].toFixed(1)},${mid}Z`;
      svg += `<clipPath id="above"><rect x="0" y="0" width="${w}" height="${mid}"/></clipPath><clipPath id="below"><rect x="0" y="${mid}" width="${w}" height="${H}"/></clipPath>`;
      svg += `<path d="${area}" fill="var(--win)" opacity=".28" clip-path="url(#above)"/><path d="${area}" fill="var(--loss)" opacity=".28" clip-path="url(#below)"/>`;
      svg += `<path d="${path}" fill="none" stroke="var(--win)" stroke-width="2" clip-path="url(#above)"/><path d="${path}" fill="none" stroke="var(--loss)" stroke-width="2" clip-path="url(#below)"/>`;
      const [lx, ly] = xy[xy.length - 1];
      svg += `<circle cx="${lx}" cy="${ly}" r="5" fill="#fff"/>`;
    }
    return `<section class="abs" style="left:${x0}px;top:${y0}px;width:${w}px">
      <div class="title">${name}<span class="big">${now > 0 ? '+' : now < 0 ? '−' : ''}${Math.abs(now)}</span></div>
      <div class="note right">${note}</div>
      <svg class="chart" width="${w}" height="${H}" viewBox="0 0 ${w} ${H}">${svg}</svg>
    </section>`;
  }

  function standings(x0, y0, w, rowH = 25) {
    const cols = L.standCols;
    const head = (d) => `<div class="sthead"><span class="t">${esc(shortDiv(d.name))}</span>${cols.map((c) => `<span class="c">${c}</span>`).join('')}</div>`;
    const rows = (d) => d.rows.map((r) => `<div class="strow${r.abbr === D.team.abbr ? ' me' : ''}">${logo(r.logo)}<span class="ab">${esc(r.abbr)}</span>${r.clinch ? `<sup>${esc(r.clinch)}</sup>` : ''}${r.cols.map((v) => `<span class="c mono">${esc(v)}</span>`).join('')}</div>`).join('');
    return `<section class="abs sts" style="left:${x0}px;top:${y0}px;width:${w}px;--ncol:${cols.length};--rowh:${rowH}px">${D.divisions.map((d) => `<div class="stdiv">${head(d)}${rows(d)}</div>`).join('')}</section>`;
  }
  const shortDiv = (n) => n.replace(/^American League/, 'AL').replace(/^National League/, 'NL').replace(/ Conference$/, '');

  function picture(x0, y0, w) {
    const n = L.lineSeed;
    const rows = D.picture.filter((r) => r.seed != null).slice(0, Math.min(D.picture.length, n + 2));
    const me = D.picture.find((r) => r.abbr === D.team.abbr);
    if (me && !rows.includes(me)) rows.push(me);
    const val = (r) => r.edge == null ? '' : r.edge > 0 ? `+${r.edge}` : r.edge < 0 ? `−${-r.edge}` : '0';
    let html = `<div class="colhead"><span class="t">Playoff picture</span><span class="r small">${esc(D.team.confShort.toUpperCase())}</span></div>
      <div class="sub first"><span>${esc(L.note)}</span><span class="gp">GP</span><span class="pts">± LINE</span></div>`;
    rows.forEach((r, i) => {
      if (i && rows[i - 1].seed && L.cuts.includes(rows[i - 1].seed) && r.seed > rows[i - 1].seed) html += '<div class="cutline"></div>';
      const gp = r.gp ?? (r.w + r.l + (r.t || 0));
      html += `<div class="prow${r.abbr === D.team.abbr ? ' me' : ''}"><span class="lbl">${r.seed ?? ''}</span>${logo(r.logo)}<span class="ab">${esc(r.abbr)}</span><span class="gp">${gp}</span><span class="pts">${val(r)}</span></div>`;
    });
    return `<section class="abs ppic" style="left:${x0}px;top:${y0}px;width:${w}px">${html}</section>`;
  }

  function statBoxes(x0, y0, w, per) {
    const boxes = D.stats.map((s) => `<div class="box"><div class="k">${esc(s.label)}</div><div class="rk">${ord(s.rank)} of ${s.of}</div><div class="v">${esc(s.value)}</div></div>`).join('');
    return `<section class="abs stgrid" style="left:${x0}px;top:${y0}px;width:${w}px;--per:${per}">${boxes}</section>`;
  }

  function leaders(x0, y0, w) {
    const rows = D.leaders.map((l) => `<div class="lrow"><div class="face">${l.face ? `<img src="${esc(l.face)}" alt="" loading="lazy">` : `<span class="jn">${esc(l.jersey || '')}</span>`}</div>
      <div class="who"><div class="k">${esc(l.label)}</div><div class="n">${esc(l.short || l.name)}</div><div class="s">${esc(l.sub || [l.jersey && `#${l.jersey}`, l.pos].filter(Boolean).join(' · '))}</div></div>
      <div class="v${String(l.value).length > 4 ? ' long' : ''}">${esc(l.value)}</div></div>`).join('');
    return `<section class="abs" style="left:${x0}px;top:${y0}px;width:${w}px"><div class="colhead"><span class="t">Team leaders</span></div><div class="leaders">${rows}</div></section>`;
  }

  function nextFive(x0, y0, w) {
    const up = D.games.filter((g) => g.state === 'pre' || g.state === 'live').slice(0, 5);
    const cards = up.map((g) => {
      const dow = fmt(g.date, { weekday: 'short' }).toUpperCase(), day = fmt(g.date, { day: 'numeric' });
      const tbd = /T05:00Z$|T04:00Z$/.test(g.date);   // ESPN uses local midnight for times not yet set
      const time = tbd ? 'TBD' : fmt(g.date, { hour: 'numeric', minute: '2-digit' }).replace(' ', '').toLowerCase();
      return `<div class="ncard" data-game="${esc(g.id)}"><div class="date"><div class="dow">${dow}</div><div class="day">${day}</div></div>
        <div class="at">${g.home ? 'vs' : '@'}${g.tv ? `<small>${esc(g.tv)}</small>` : ''}</div>${logo(g.oppLogo)}<div class="time">${time}</div></div>`;
    }).join('');
    if (!up.length && D.post?.length) return postseason(x0, y0, w);
    const empty = up.length ? '' : `<div class="note" style="margin-top:12px">No ${L.games} scheduled. ${esc(D.season)} is done.</div>`;
    return `<section class="abs" style="left:${x0}px;top:${y0}px;width:${w}px"><div class="colhead big"><span class="t">${L.byWeek ? 'Next up' : 'Next 5'}</span><span class="r small">EASTERN TIME</span></div><div class="nlist">${cards}${empty}</div></section>`;
  }

  function postseason(x0, y0, w) {
    const ps = D.post.slice(-6);
    const rows = ps.map((g) => `<div class="pgrow"><span class="rd">${esc((g.round || '').replace(' - Game ', ' G'))}</span>${logo(g.oppLogo)}<span class="res ${g.res}">${g.res}</span><span class="sc mono">${g.us}–${g.them}</span></div>`).join('');
    return `<section class="abs" style="left:${x0}px;top:${y0}px;width:${w}px"><div class="colhead big"><span class="t">Postseason</span><span class="r small">${esc(postLine().toUpperCase())}</span></div><div class="pglist">${rows}</div></section>`;
  }
  // "Out in the ALDS", "Won the World Series"
  function postLine() {
    const last = D.post?.[D.post.length - 1]; if (!last || last.state !== 'final') return '';
    const round = (last.round || '').split(' - ')[0];
    const finals = /World Series|NBA Finals|Super Bowl|MLS Cup/i.test(round);
    return last.res === 'W' && finals ? `Won the ${round}` : last.res === 'L' ? `Out in the ${round}` : round;
  }

  function lastFive(x0, y0, w) {
    const f = finals().slice(-5).reverse();
    const rows = f.map((g) => `<div class="lgrow">${logo(g.oppLogo)}<span class="res ${g.res === 'T' ? 'OT' : g.res}">${g.res === 'T' ? (L.draws ? 'D' : 'T') : g.res}</span><span class="sc mono">${g.us}–${g.them}</span><span class="wk">${L.byWeek && g.week ? `Wk ${g.week}` : fmt(g.date, { month: 'short', day: 'numeric' })}</span></div>`).join('');
    return `<section class="abs" style="left:${x0}px;top:${y0}px;width:${w}px"><div class="colhead big"><span class="t">Last 5</span></div><div class="llist">${rows}</div></section>`;
  }

  function foot(x0, y0, w) {
    const upd = fmt(D.updated, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
    return `<footer class="abs foot" style="left:${x0}px;top:${y0}px;width:${w}px"><span>Data: ESPN · updated ${upd} ET</span><span class="brand sb" role="button" tabindex="0">${esc(D.brand.toUpperCase())}</span></footer>`;
  }

  // ---------- layout ----------
  function render() {
    MODE = (document.documentElement.clientWidth || innerWidth) < 700 ? 'stack' : 'board';
    document.documentElement.style.setProperty('--primary', D.team.color);
    document.documentElement.style.setProperty('--accent', D.team.alt);
    board.className = MODE;
    const nDiv = D.divisions.length, nRows = D.divisions.reduce((a, d) => a + d.rows.length, 0);
    const boxRows = Math.ceil(D.stats.length / 4);
    // the standings take what the stat boxes leave above the footer
    const rowH = MODE === 'board' ? Math.min(25, Math.floor((1104 - 485 - boxRows * 62 - 8 - nDiv * 33) / nRows)) : 25;
    const stH = nDiv * 33 + nRows * rowH;
    let html;
    if (MODE === 'board') {
      const pRows = Math.min(D.picture.length, L.lineSeed + 3);
      const picH = 60 + pRows * 26;
      board.style.height = '1145px';
      html = header() + seasonChart(40, 112, 840) + lineChart(40, 352, 840) +
        standings(40, 485, 340, rowH) + statBoxes(40, 485 + stH + 8, 340, 4) +
        picture(400, 485, 230) + leaders(400, 485 + picH + 14, 230) +
        nextFive(650, 485, 230) + lastFive(650, 846, 230) + foot(40, 1118, 840);
    } else {
      const pRows = Math.min(D.picture.length, L.lineSeed + 3);
      const picH = 60 + pRows * 26;
      let y = 112;
      html = header() + seasonChart(16, y, 468) + lineChart(16, y += 240, 468);
      y += 130;
      html += nextFive(16, y, 230) + lastFive(254, y, 230);
      y += 360;
      html += picture(16, y, 230) + leaders(254, y, 230);
      y += Math.max(picH, 230) + 16;
      html += standings(16, y, 468);
      y += stH + 8;
      html += statBoxes(16, y, 468, 4);
      y += Math.ceil(D.stats.length / 4) * 64 + 16;
      html += foot(16, y, 468);
      board.style.height = `${y + 30}px`;
    }
    board.innerHTML = html;
    board.querySelectorAll('.sb').forEach((b) => b.addEventListener('click', openPicker));
    // remix background, exactly as Rinkside: the alternate logo tiled faintly on a tilted grid
    const alt = esc(D.team.altLogo || D.team.logo);
    document.getElementById('remix').innerHTML = `<svg width="100%" height="100%"><defs><pattern id="remix-bg" width="168" height="168" patternUnits="userSpaceOnUse" patternTransform="rotate(-12)">
        <image href="${alt}" x="8" y="8" width="68" height="68" preserveAspectRatio="xMidYMid meet"/>
        <image href="${alt}" x="92" y="92" width="68" height="68" preserveAspectRatio="xMidYMid meet"/>
      </pattern></defs><rect width="100%" height="100%" fill="url(#remix-bg)"/></svg>`;
    fit();
  }
  function fit() {
    const w = W[MODE], h = parseFloat(board.style.height);
    const vw = document.documentElement.clientWidth || innerWidth, vh = innerHeight;
    const scale = MODE === 'stack' ? vw / w : Math.min(vw / w, 1.6);
    const top = MODE === 'stack' ? 8 : Math.max(0, Math.round((vh - h * scale) / 2));
    board.style.width = `${w}px`;
    board.style.transform = `translate(${Math.round((vw - w * scale) / 2)}px, ${top}px) scale(${scale})`;
    stage.style.height = `${Math.max(MODE === 'stack' ? 0 : vh, h * scale + top + 16)}px`;
  }
  addEventListener('resize', () => { const m = (document.documentElement.clientWidth || innerWidth) < 700 ? 'stack' : 'board'; if (D) (m !== MODE ? render() : fit()); });

  // ---------- picker: every league, every team ----------
  let picker = null;
  function openPicker() {
    picker?.remove();
    const groups = [...new Set(index.teams.map((t) => t.conference))].map((c) => [c, index.teams.filter((t) => t.conference === c)]);
    picker = document.createElement('div');
    picker.className = 'picker';
    picker.setAttribute('role', 'dialog');
    picker.innerHTML = `<div class="sheet"><div class="ph"><span>Choose a team</span><button class="x" aria-label="Close">×</button></div>
      <div class="ltabs">${L.leagues.map((l) => `<a class="lt${l.key === key ? ' on' : ''}" href="${l.key === 'nhl' ? './' : `${l.key}/`}"><b>${esc(l.brand)}</b><span>${esc(l.league)}</span></a>`).join('')}</div>
      ${groups.map(([c, ts]) => `<div class="pg"><div class="pgt">${esc(c)}</div><div class="pgl">${ts.map((t) =>
        `<a class="pt${t.abbr === D.team.abbr ? ' on' : ''}" href="${key}/${t.slug}/">${logo(t.logo)}<span>${esc(t.name)}</span></a>`).join('')}</div></div>`).join('')}</div>`;
    picker.addEventListener('click', (e) => {
      const a = e.target.closest('a.pt'); if (a) { const t = index.teams.find((x) => a.getAttribute('href').endsWith(`/${x.slug}/`)); if (t) store.set(t.abbr); return; }
      if (e.target === picker || e.target.closest('.x')) { picker.remove(); picker = null; }
    });
    document.body.appendChild(picker);
  }
  addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && picker) { picker.remove(); picker = null; }
    else if (e.key.toLowerCase() === 't' && !picker && !e.metaKey && !e.ctrlKey) openPicker();
  });

  // ---------- live score from ESPN's scoreboard ----------
  let timer = null;
  async function live() {
    clearTimeout(timer);
    try {
      const sb = await (await fetch(`https://site.api.espn.com/apis/site/v2/sports/${L.espn}/scoreboard`)).json();
      const ev = sb.events?.find((e) => e.competitions[0].competitors.some((c) => c.team.id === D.team.id));
      const box = document.getElementById('livebox');
      if (ev && box) {
        const c = ev.competitions[0], st = c.status.type;
        const me = c.competitors.find((x) => x.team.id === D.team.id), op = c.competitors.find((x) => x.team.id !== D.team.id);
        if (st.state === 'in') {
          box.innerHTML = `<span class="livedot"></span>LIVE ${esc(me.team.abbreviation)} ${esc(me.score)}–${esc(op.score)} ${esc(op.team.abbreviation)} · ${esc(st.shortDetail)}`;
          const card = board.querySelector(`.ncard[data-game="${ev.id}"] .time`);
          if (card) { card.innerHTML = `<span class="lv">${esc(me.score)}–${esc(op.score)}</span>`; card.closest('.ncard').classList.add('live'); }
          timer = setTimeout(live, 30000);
          return;
        }
        if (st.state === 'post' && !D.games.some((g) => g.id === ev.id && g.state === 'final')) {
          box.innerHTML = `<b>Final: ${esc(me.team.abbreviation)} ${esc(me.score)}–${esc(op.score)} ${esc(op.team.abbreviation)}</b>`;
        }
      }
    } catch {}
    timer = setTimeout(live, 5 * 60000);
  }

  start().catch((e) => { board.innerHTML = `<div class="msg">Couldn't load the ${esc(L?.brand || '')} board. ${esc(e.message)}</div>`; });
})();
