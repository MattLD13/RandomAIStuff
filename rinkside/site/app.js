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
  const icon = (home, result, key = '') =>
    `<svg class="icon ${home ? 'home' : 'away'} ${result || ''}"${key}><use href="#i-${home ? 'home' : 'away'}"/></svg>`;
  const at = (x, y, w, html, cls = '') =>
    `<div class="abs ${cls}" style="left:${x}px;top:${y}px;${w ? `width:${w}px;` : ''}">${html}</div>`;
  const I = !wallpaper; // interactive extras (popups) only on the live page
  const pop = (key) => (I ? ` data-pop="${key}"` : '');
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
        s += `<text x="${Math.min(Math.max(cx(i), 13), PLOT_X1 - 13).toFixed(1)}" y="191" fill="#9a9a9a" font-size="13" font-weight="500" text-anchor="middle">${esc(g.month)}</text>`;
      prev = g.month;
    });
    if (I) season.games.forEach((g, i) => {
      s += `<rect class="hit"${pop(`game:${i}`)} x="${(cx(i) - slot / 2).toFixed(2)}" y="2" width="${slot.toFixed(2)}" height="174"/>`;
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
    if (I) for (let k = 1; k < line.history.length; k++)
      s += `<rect class="hit"${pop(`line:${k}`)} x="${(xk(k) - slot / 2).toFixed(2)}" y="2" width="${slot.toFixed(2)}" height="104"/>`;
    return `<svg class="abs" style="left:40px;top:380px" width="840" height="110" viewBox="0 0 840 110">${s}</svg>`;
  }

  // ---------- columns ----------
  function division(d) {
    const rows = d.teams
      .map((t) => `<div class="drow"><span class="dl"${pop(`series:${t.abbrev}`)}>${logo(t.logo, t.abbrev)}</span><div class="icons">${t.games.map((g) => icon(g.home, g.result, pop(`game:${g.gi}`))).join('')}</div></div>`)
      .join('');
    return `<section class="div"><div class="colhead"${pop(`div:${d.name}`)}><span class="t">${esc(d.name)}</span><span class="r">${esc(d.record)}</span></div><div class="drows">${rows}</div></section>`;
  }

  function pictureRows(rows) {
    return rows
      .map((r) => `<div class="prow${r.me ? ' me' : ''}"${pop(`team:${r.abbrev}`)}><span class="lbl">${esc(r.label)}</span>${logo(r.logo, r.abbrev)}<span class="ab">${esc(r.abbrev)}</span><span class="gp">${r.gp}</span><span class="pts">${r.pts}</span></div>`)
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
      const box = (k, v) => `<div class="box"${pop(`st:${k === 'Power play' ? 'pp' : 'pk'}`)}><div class="k">${k}</div><div class="rk">${v.rank}${suffix(v.rank)} of ${v.of}</div><div class="v">${v.pct}<small> %</small></div></div>`;
      s += `<div class="st">${box('Power play', d.specialTeams.pp)}${box('Penalty kill', d.specialTeams.pk)}</div>`;
    }
    s += `<div class="colhead big lhead"><span class="t">Team leaders</span></div><div class="leaders">`;
    s += d.leaders
      .map((l, i) => `<div class="lrow"${pop(`leader:${i}`)}><div class="face"><img src="${esc(l.headshot)}" alt=""></div><div class="who"><div class="k">${esc(l.label)}</div><div class="n">${esc(l.name)}</div><div class="s">${esc(l.sub)}</div></div><div class="v">${esc(l.value)}</div></div>`)
      .join('');
    return s + `</div>`;
  }

  function nextLast(d) {
    let s = `<div class="colhead big"><span class="t">Next 5</span><span class="r small">EASTERN TIME</span></div><div class="nlist">`;
    s += d.nextGames.length
      ? d.nextGames
          .map((g, i) => `<div class="ncard"${pop(`next:${i}`)}><div class="date"><span class="dow">${esc(g.dow)}</span><span class="day">${esc(g.day)}</span></div><span class="at">${g.home ? 'vs' : '@'}</span>${logo(g.logo, g.opp)}<span class="time">${esc(g.time)}</span></div>`)
          .join('')
      : `<div class="note" style="margin-top:12px">No games scheduled</div>`;
    s += `</div><div class="colhead big l5head"><span class="t">Last 5</span></div><div class="llist">`;
    s += d.lastGames
      .map((g, i) => `<div class="lgrow"${pop(`last:${i}`)}>${logo(g.logo, g.opp)}<span class="res ${g.result}">${esc(g.result)}</span><span class="sc">${esc(g.score.replace('-', '\u2013'))}</span></div>`)
      .join('');
    return s + `</div>`;
  }

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

    // Remix background: the team's alternate / throwback logo, tiled faintly behind the board.
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
      <div class="band" style="background:none" title="Change team"${wallpaper ? '' : ' role="button" tabindex="0"'}><img src="${esc(d.team.logo)}" alt="${esc(d.team.name)}"></div>
      <div class="record"${pop('record')}>${esc(h.record)}</div>
      <div class="summary"${pop('record')}><b>${h.points} points</b>, ${esc(h.summary)}</div>
      <div class="meta"><div>${esc(h.date)}</div><div${pop('splits')}>${esc(h.splits)}</div><div${pop('sos')}>${esc(h.schedule)}</div></div>
    </header>`;

    s += at(40, 112, 0, `<span${pop('season')}>The season, game by game</span>`, 'title');
    s += `<div class="abs note" style="right:73px;top:118px">${d.season.played} of ${d.season.total} played, bar height = goal margin</div>`;
    s += seasonChart(d.season);

    s += at(40, 352, 0, `<span${pop('cut')}>Playoff line<span class="big">${esc(d.playoffLine.label)}</span></span>`, 'title');
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
    current = d;
    closePop();
    fit();
  }

  // ---------- detail popups ----------
  let current = null;   // the board's data
  let popEl = null, popKey = null;
  const sign = (n) => (n > 0 ? `+${n}` : n < 0 ? `\u2212${-n}` : '0');
  const dash = (sc) => String(sc).replace('-', '\u2013');
  const resChip = (r, last) => {
    const t = r === 'W' ? 'W' : r === 'O' ? (last || 'OT') : 'L';
    return `<span class="res ${t}">${t}</span>`;
  };
  const rowsHtml = (rows) => `<dl class="prows">${rows.filter((r) => r && r[1] !== '' && r[1] != null)
    .map(([k, v, mono]) => `<div><dt>${esc(k)}</dt><dd${mono ? ' class="m"' : ''}>${esc(v)}</dd></div>`).join('')}</dl>`;

  function gamePop(info, kicker) {
    const final = info.status.startsWith('Final');
    const last = info.status.split('/')[1];
    let h = `<div class="pk">${esc(kicker)}</div>`;
    h += `<div class="pt">${logo(info.oppLogo, info.oppAbbrev)}<span>${info.home ? 'vs' : '@'} ${esc(info.opp)}</span></div>`;
    if (final) h += `<div class="ps">${resChip(info.result, last)}<span class="psc">${info.us}\u2013${info.them}</span><span class="pst">${esc(info.status)}</span></div>`;
    else if (info.status === 'Live') h += `<div class="ps"><span class="res live">LIVE</span><span class="psc">${info.us ?? 0}\u2013${info.them ?? 0}</span></div>`;
    h += rowsHtml([
      ['Date', info.date], [final ? 'Started' : 'Puck drop', info.time], ['Arena', info.venue], ['TV', info.tv],
      final && info.gwg ? ['Winning goal', info.gwg] : null, final && info.winGoalie ? ['Winning goalie', info.winGoalie] : null,
    ]);
    if (info.link) h += `<a class="plink" href="${esc(info.link)}" target="_blank" rel="noopener">Game Center \u2197</a>`;
    return h;
  }

  function popContent(key) {
    const d = current;
    const [kind, arg] = key.split(':');
    if (kind === 'game') {
      const g = d.season.games[+arg];
      return gamePop(g.info, `Game ${+arg + 1} of ${d.season.total}`);
    }
    if (kind === 'line') {
      const k = +arg;
      const played = d.season.games.filter((g) => g.result);
      const g = played[k - 1];
      const v = d.playoffLine.history[k], prev = d.playoffLine.history[k - 1];
      let h = `<div class="pk">Playoff line \u00b7 after game ${k}</div>`;
      h += `<div class="pt"><span class="big m">${sign(v)}</span><span>${v >= 0 ? 'points clear of the line' : 'points behind the line'}</span></div>`;
      if (g) h += `<div class="ps">${resChip(g.result, g.info.status.split('/')[1])}<span class="psc">${g.info.us}\u2013${g.info.them}</span><span class="pst">${g.info.home ? 'vs' : '@'} ${esc(g.info.oppAbbrev)} \u00b7 ${esc(g.info.date)}</span></div>`;
      h += rowsHtml([['Change', `${sign(v - prev)} on the game`, true], ['Season low', sign(Math.min(...d.playoffLine.history.slice(1, k + 1))), true],
        ['Season high', sign(Math.max(...d.playoffLine.history.slice(1, k + 1))), true]]);
      return h;
    }
    if (kind === 'team') {
      const rows = [...d.picture.divRows, ...d.picture.wcRows, ...d.picture.outRows];
      const r = rows.find((x) => x.abbrev === arg);
      const t = r.info;
      const where = r.label ? (r.label.startsWith('WC') ? `Wild card ${r.label.slice(2)}` : `${d.picture.divisionName} \u00b7 ${r.label.slice(1)}${suffix(+r.label.slice(1))}`) : 'Outside the playoffs';
      let h = `<div class="pk">${esc(where)}</div><div class="pt">${logo(r.logo, r.abbrev)}<span>${esc(t.name)}</span></div>`;
      h += rowsHtml([['Record', t.record, true], ['Points', `${r.pts} in ${r.gp} GP`, true], ['Points %', t.ptsPct, true],
        ['Goals', `${t.gf}\u2013${t.ga} (${sign(t.diff)})`, true], ['Home', t.home, true], ['Road', t.road, true],
        ['Last 10', t.l10, true], ['Streak', t.streak, true], ['Regulation wins', t.rw, true]]);
      return h;
    }
    if (kind === 'st') {
      const v = d.specialTeams[arg];
      const name = arg === 'pp' ? 'Power play' : 'Penalty kill';
      let h = `<div class="pk">Special teams</div><div class="pt"><span>${name}</span></div>`;
      h += `<div class="ps"><span class="psc">${v.pct}%</span><span class="pst">${v.rank}${suffix(v.rank)} of ${v.of}</span></div>`;
      h += rowsHtml([['League average', `${v.avg}%`, true], ['League best', v.best],
        ['vs average', `${sign(+(v.pct - v.avg).toFixed(1))} pts`, true]]);
      return h;
    }
    if (kind === 'leader') {
      const l = d.leaders[+arg];
      let h = `<div class="pk">${esc(l.label)} leader</div><div class="pt"><span class="face sm"><img src="${esc(l.headshot)}" alt=""></span><span>${esc(l.full || l.name)}</span></div>`;
      h += `<div class="pgrid">${(l.stats || []).map(([k, v]) => `<div><b class="m">${esc(v)}</b><span>${esc(k)}</span></div>`).join('')}</div>`;
      return h;
    }
    if (kind === 'next') return gamePop(d.nextGames[+arg].info, `Next up \u00b7 game ${+arg + 1} of 5`);
    if (kind === 'last') return gamePop(d.lastGames[+arg].info, +arg === 0 ? 'Most recent game' : `${+arg + 1} games ago`);
    if (kind === 'series') {
      const team = d.league[arg] || { name: arg };
      const gs = d.season.games.filter((g) => g.opp === arg);
      const c = (r) => gs.filter((g) => g.result === r).length;
      let h = `<div class="pk">Season series</div><div class="pt">${logo(team.logo, arg)}<span>vs ${esc(team.name)}</span></div>`;
      h += `<div class="ps"><span class="psc">${c('W')}-${c('L')}-${c('O')}</span><span class="pst">${gs.length - c('W') - c('L') - c('O')} to play</span></div>`;
      h += rowsHtml(gs.map((g) => [`${g.info.date} \u00b7 ${g.home ? 'home' : 'away'}`,
        g.result ? `${g.result === 'O' ? 'OTL' : g.result} ${g.info.us}\u2013${g.info.them}` : g.info.time, true]));
      return h;
    }
    if (kind === 'div') {
      const dv = d.divisions.find((x) => x.name === arg);
      let h = `<div class="pk">Record vs division</div><div class="pt"><span>${esc(arg)}</span></div>`;
      h += `<div class="ps"><span class="psc">${esc(dv.record)}</span><span class="pst">W-L-OTL</span></div>`;
      h += rowsHtml(dv.teams.map((t) => {
        const gs = t.games, c = (r) => gs.filter((g) => g.result === r).length, left = gs.filter((g) => !g.result).length;
        return [d.league[t.abbrev]?.name || t.abbrev, `${c('W')}-${c('L')}-${c('O')}${left ? ` (${left} left)` : ''}`, true];
      }));
      return h;
    }
    if (kind === 'splits') {
      let h = `<div class="pk">Splits</div><div class="pt"><span>Home, road and recent form</span></div>`;
      h += rowsHtml(d.header.info.splits.map(([k, r, gf, ga]) => [k, `${r} \u00b7 ${gf}\u2013${ga}`, true]));
      return h;
    }
    if (kind === 'sos') {
      const o = d.header.info.sos;
      const left = d.season.games.filter((g) => !g.result);
      const tough = [...new Set(left.map((g) => g.opp))].map((a) => [a, d.league[a]]).filter(([, t]) => t)
        .sort((x, y) => y[1].pct - x[1].pct).slice(0, 3);
      let h = `<div class="pk">Schedule strength</div><div class="pt"><span>${o.rank}${suffix(o.rank)}-toughest of ${o.of}</span></div>`;
      h += rowsHtml([['Games left', `${o.left} (${o.homeLeft} home, ${o.roadLeft} road)`, true], ['Opponents\u2019 points %', o.oppPct, true],
        ...tough.map(([a, t], i) => [i ? '' : 'Toughest left', `${t.name} ${t.pct.toFixed(3).replace(/^0/, '')}`])]);
      h += `<div class="pnote">Average current points % of every opponent still to play, ranked across the league.</div>`;
      return h;
    }
    if (kind === 'season') {
      const ps = d.season.games.filter((g) => g.result);
      let best = 0, worst = 0, w = 0, l = 0, longW = 0, longL = 0;
      for (const g of ps) {
        const m = g.info.us - g.info.them;
        best = Math.max(best, m); worst = Math.min(worst, m);
        if (g.result === 'W') { w++; l = 0; } else { l++; w = 0; }   // an OT loss still ends a win streak
        longW = Math.max(longW, w); longL = Math.max(longL, l);
      }
      const one = ps.filter((g) => Math.abs(g.info.us - g.info.them) === 1);
      const c = (arr, r) => arr.filter((g) => g.result === r).length;
      const bw = ps.find((g) => g.info.us - g.info.them === best && best > 0);
      const wl = ps.find((g) => g.info.us - g.info.them === worst && worst < 0);
      let h = `<div class="pk">${ps.length} of ${d.season.total} played</div><div class="pt"><span>Season so far</span></div>`;
      h += rowsHtml([['Longest win streak', longW, true], ['Longest winless run', longL, true],
        ['One-goal games', `${c(one, 'W')}-${c(one, 'L')}-${c(one, 'O')}`, true],
        bw ? ['Biggest win', `${bw.info.us}\u2013${bw.info.them} ${bw.home ? 'vs' : '@'} ${bw.opp}`, true] : null,
        wl ? ['Heaviest loss', `${wl.info.us}\u2013${wl.info.them} ${wl.home ? 'vs' : '@'} ${wl.opp}`, true] : null,
        ['Shutouts', `${ps.filter((g) => g.info.them === 0).length} for, ${ps.filter((g) => g.info.us === 0).length} against`, true]]);
      return h;
    }
    if (kind === 'cut') {
      const wc = d.picture.wcRows, out = d.picture.outRows;
      const lastIn = wc[wc.length - 1], firstOut = out[0];
      let h = `<div class="pk">The playoff cut</div><div class="pt"><span class="big m">${esc(d.playoffLine.label)}</span><span>${esc(d.playoffLine.text)}</span></div>`;
      h += rowsHtml([lastIn ? ['Last team in', `${lastIn.abbrev} \u00b7 ${lastIn.pts} pts, ${lastIn.gp} GP`, true] : null,
        firstOut ? ['First team out', `${firstOut.abbrev} \u00b7 ${firstOut.pts} pts, ${firstOut.gp} GP`, true] : null]);
      h += `<div class="pnote">Top three in each division plus two wild cards per conference make it. The line plots your points minus the first team out (or minus the last team in, when you're out).</div>`;
      return h;
    }
    if (kind === 'record') {
      const h0 = d.header, t = h0.info;
      let h = `<div class="pk">${esc(h0.date)}</div><div class="pt"><span>${esc(d.team.name)}</span></div>`;
      h += `<div class="ps"><span class="psc">${esc(h0.record)}</span><span class="pst">${h0.points} points</span></div>`;
      h += rowsHtml([['Points %', t.ptsPct, true], ['On pace for', `${t.pace} points`, true], ['Goals', `${t.gf}\u2013${t.ga} (${sign(t.diff)})`, true],
        ['League rank', `${t.leagueRank}${suffix(t.leagueRank)} of 32`, true], ['Conference rank', `${t.confRank}${suffix(t.confRank)}`, true],
        ['Regulation wins', t.rw, true], ['Reg. + OT wins', t.row, true]]);
      return h;
    }
    return '';
  }

  function closePop() {
    popEl?.remove(); popEl = null; popKey = null;
    board.querySelectorAll('.is-active').forEach((e) => e.classList.remove('is-active'));
  }

  function openPop(target) {
    const key = target.dataset.pop;
    if (popKey === key) return closePop();
    closePop();
    const html = popContent(key);
    if (!html) return;
    popKey = key;
    target.classList.add('is-active');
    popEl = document.createElement('div');
    popEl.className = 'pop';
    popEl.setAttribute('role', 'dialog');
    popEl.innerHTML = `<button class="px" aria-label="Close">\u00d7</button>${html}`;
    document.body.appendChild(popEl);
    // place it beside the target, inside the viewport
    const r = target.getBoundingClientRect();
    const pw = popEl.offsetWidth, ph = popEl.offsetHeight, gap = 8, m = 10;
    let x = r.left + r.width / 2 - pw / 2;
    x = Math.max(m, Math.min(x, document.documentElement.clientWidth - pw - m));
    let y = r.bottom + gap;
    if (y + ph > innerHeight - m && r.top - gap - ph > m) y = r.top - gap - ph;
    popEl.style.left = `${x + scrollX}px`;
    popEl.style.top = `${Math.max(m, y) + scrollY}px`;
    popEl.querySelector('.px').addEventListener('click', closePop);
  }

  if (I) {
    board.addEventListener('click', (e) => {
      const t = e.target.closest('[data-pop]');
      if (t && board.contains(t)) { e.stopPropagation(); openPop(t); }
    });
    document.addEventListener('click', (e) => { if (popEl && !popEl.contains(e.target)) closePop(); });
    addEventListener('resize', closePop);
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
      if (e.key === 'Escape') { closePicker(); closePop(); }
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
