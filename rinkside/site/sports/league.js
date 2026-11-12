// The whole-league page for Courtside, Sideline, Dugout and Pitchside (/nba/league/ ...), like Rinkside's /nhl/:
// games with live scores (ESPN's scoreboard, in the browser), standings for both conferences with the playoff cut lines,
// a power ranking and the league leaders.
(() => {
  const { key, esc, logo, ord, fmt, brandIcon, shortDiv, board, openPicker } = SB;
  let index, L, view = 'seeds', day = 0, liveTimer = null;
  const signed = (v) => v == null ? '' : v > 0 ? `+${v}` : v < 0 ? `−${-v}` : '0';
  document.body.classList.add('leaguepage');

  function header() {
    const top = index.power[0];
    const leader = [...index.conferences.flatMap((c) => c.picture)].sort((a, b) => L.draws ? b.pts - a.pts : (b.pct ?? 0) - (a.pct ?? 0))[0];
    const lt = index.teams.find((t) => t.abbr === leader?.abbr);
    const lead = lt ? `${esc(lt.name)} lead the league at ${L.draws ? `${leader.pts} points` : `${leader.w}-${leader.l}${leader.t ? `-${leader.t}` : ''}`}` : '';
    return `<header class="lghdr"><div class="lgband sb" role="button" tabindex="0" title="Choose a team">${brandIcon(L.brand, 64)}</div>
      <div class="lgt"><div class="lgname">${esc(L.league)}</div><div class="lgsum"><b id="gcount"></b>${lead}${top ? ` · best ${esc(L.margin)}: ${esc(top.abbr)} ${signed(top.margin)} per ${esc(L.game)}` : ''}</div></div>
      <div class="lgmeta">${fmt(Date.now(), { weekday: 'long', month: 'long', day: 'numeric' })}<br>${esc(index.season || '')} · tap the logo for a team</div></header>`;
  }

  // ---------- games ----------
  const dayTabs = () => L.byWeek ? [[-1, 'Last week'], [0, 'This week'], [1, 'Next week']]
    : [[-1, 'Yesterday'], [0, 'Today'], [1, 'Tomorrow'], [2, fmt(Date.now() + 2 * 864e5, { weekday: 'short', month: 'short', day: 'numeric' })], [3, fmt(Date.now() + 3 * 864e5, { weekday: 'short', month: 'short', day: 'numeric' })]];
  const ymd = (off) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date(Date.now() + off * 864e5)).replace(/-/g, '');
  async function loadGames() {
    clearTimeout(liveTimer);
    const el = document.getElementById('games'); if (!el) return;
    let url = `https://site.api.espn.com/apis/site/v2/sports/${L.espn}/scoreboard`;
    try {
      if (L.byWeek) {
        if (day) { const cur = await (await fetch(url)).json(); const wk = (cur.week?.number || 1) + day; url += `?week=${Math.max(1, wk)}&seasontype=${cur.season?.type || 2}`; }
      } else url += `?dates=${ymd(day)}`;
      const sb = await (await fetch(url)).json();
      const evs = sb.events || [];
      if (day === 0) document.getElementById('gcount').textContent = evs.length ? `${evs.length} ${evs.length === 1 ? L.game : L.games} ${L.byWeek ? 'this week' : 'today'}, ` : '';
      el.innerHTML = evs.length ? evs.map(gameCard).join('') : `<div class="note">No ${L.games}.</div>`;
      if (evs.some((e) => e.competitions[0].status.type.state === 'in')) liveTimer = setTimeout(loadGames, 30000);
    } catch { el.innerHTML = `<div class="note">Couldn't reach ESPN's scoreboard.</div>`; }
  }
  function gameCard(e) {
    const c = e.competitions[0], st = c.status.type;
    const side = (homeAway) => c.competitors.find((x) => x.homeAway === homeAway);
    const row = (x) => {
      const t = index.teams.find((tt) => tt.id === x.team.id);
      const rec = x.records?.[0]?.summary || '';
      const win = st.state === 'post' && x.winner;
      return `<div class="gr${win ? ' win' : ''}">${logo(t?.logo || x.team.logo)}<span class="ab">${esc(x.team.abbreviation)}</span><span class="rc">${esc(rec)}</span>${st.state !== 'pre' ? `<span class="sc mono">${esc(x.score)}</span>` : ''}</div>`;
    };
    const tv = (c.broadcasts || []).flatMap((b) => b.names || []).slice(0, 1).join('');
    const status = st.state === 'pre' ? `${/T0[45]:00Z$/.test(e.date) ? 'TBD' : fmt(e.date, { hour: 'numeric', minute: '2-digit' })} ET${L.byWeek ? ` · ${fmt(e.date, { weekday: 'short' })}` : ''}`
      : st.state === 'in' ? `<span class="livedot"></span>${esc(st.shortDetail)}` : esc(st.shortDetail);
    return `<div class="gcard${st.state === 'in' ? ' live' : ''}">${row(side('away'))}${row(side('home'))}<div class="gs">${status}${tv ? `<span>${esc(tv)}</span>` : ''}</div></div>`;
  }

  // ---------- standings: seeds with the cut lines, or by division ----------
  function standings() {
    const cols = L.standCols;
    const table = (title, rows, cuts, seeds) => `<div class="lst"><div class="lsth"><span class="t">${esc(title)}</span>${cols.map((c) => `<span class="c">${c}</span>`).join('')}${seeds ? '<span class="c e">± LINE</span>' : ''}</div>${rows.map((r, i) =>
      `${cuts.includes(i) ? '<div class="cutline"></div>' : ''}<a class="lsr" href="${key}/${index.teams.find((t) => t.abbr === r.abbr)?.slug}/"><span class="sd">${seeds ? r.seed ?? '' : ''}</span>${logo(r.logo)}<span class="ab">${esc(r.abbr)}</span>${r.clinch ? `<sup>${esc(r.clinch)}</sup>` : ''}${r.cols.map((v) => `<span class="c mono">${esc(v)}</span>`).join('')}${seeds ? `<span class="c e mono">${signed(r.edge)}</span>` : ''}</a>`).join('')}</div>`;
    const conf = (c) => view === 'seeds'
      ? table(shortDiv(c.name), c.picture, L.cuts, true)
      : c.divisions.map((d) => table(shortDiv(d.name), d.rows, [], false)).join('');
    return `<div class="sechead"><h2>Standings</h2><div class="tabs">${[['seeds', 'Playoff seeds'], ['divs', index.conferences[0].divisions.length > 1 ? 'Divisions' : 'Table']].map(([k, label]) =>
      `<button class="tab${view === k ? ' on' : ''}" data-view="${k}">${label}</button>`).join('')}</div></div>
      ${view === 'seeds' ? `<div class="snote">${esc(L.note)} · dashed lines are the cuts</div>` : ''}
      <div class="lconfs" style="--ncol:${cols.length + (view === 'seeds' ? 1 : 0)}">${index.conferences.map((c) => `<div>${conf(c)}</div>`).join('')}</div>`;
  }

  function power() {
    const max = Math.max(...index.power.map((p) => Math.abs(p.margin)), 1);
    return `<div class="sechead"><h2>Power ranking</h2><span class="small">${esc(L.margin.toUpperCase())} PER ${esc(L.game.toUpperCase())} · RECORD · LAST 10</span></div><div class="lpwr">${index.power.map((p, i) =>
      `<a class="pwrow" href="${key}/${index.teams.find((t) => t.abbr === p.abbr)?.slug}/"><span class="n">${i + 1}</span>${logo(p.logo)}<span class="ab">${esc(p.abbr)}</span>
        <span class="bar"><i style="${p.margin >= 0 ? 'left:50%' : 'right:50%'};width:${Math.abs(p.margin) / max * 50}%;background:${esc(p.color)}"></i></span><span class="v mono">${signed(p.margin)}</span><span class="rec">${esc(p.rec)}</span>
        <span class="frm">${[...p.form].map((r) => `<i class="${r}"></i>`).join('')}</span></a>`).join('')}</div>`;
  }

  function leaders() {
    return `<div class="sechead"><h2>Leaders</h2></div><div class="lldr">${index.leaders.filter((c) => c.rows.length).map((c) => `<div><div class="lk">${esc(c.label)}</div>${c.rows.map((r, i) =>
      `<div class="llr"><span class="n">${i + 1}</span><span class="face">${r.face ? `<img src="${esc(r.face)}" alt="" loading="lazy">` : ''}</span><span class="who"><b>${esc(r.short)}</b><small>${logo(r.teamLogo)}${esc([r.team, r.pos].filter(Boolean).join(' · '))}</small></span><span class="v mono">${esc(r.value)}</span></div>`).join('')}</div>`).join('')}</div>`;
  }

  function render() {
    board.className = 'league';
    board.style.height = 'auto';
    board.innerHTML = header() +
      `<section><div class="sechead"><h2>${L.byWeek ? 'Games' : 'Games'}</h2><div class="tabs">${dayTabs().map(([k, label]) => `<button class="tab${day === k ? ' on' : ''}" data-day="${k}">${esc(label)}</button>`).join('')}</div></div><div class="lgames" id="games"><div class="note">Loading…</div></div></section>` +
      `<section class="lstand">${standings()}</section>` +
      `<div class="lgrid"><section>${power()}</section><section>${leaders()}</section></div>` +
      `<footer class="lgfoot"><span>Data: ESPN · updated ${fmt(index.updated, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })} ET</span><span class="brand sb" role="button" tabindex="0">${brandIcon(L.brand, 16)}${esc(L.brand.toUpperCase())}</span></footer>`;
    loadGames();
  }
  board.addEventListener('click', (e) => {
    const d = e.target.closest('[data-day]'); if (d) { day = +d.dataset.day; board.querySelectorAll('[data-day]').forEach((b) => b.classList.toggle('on', b === d)); loadGames(); return; }
    const v = e.target.closest('[data-view]'); if (v) { view = v.dataset.view; board.querySelector('.lstand').innerHTML = standings(); return; }
    if (e.target.closest('.sb')) openPicker(index, 'LEAGUE');
  });
  addEventListener('keydown', (e) => { if (e.key === 'Escape') SB.closePicker(); else if (e.key.toLowerCase() === 't' && !SB.picker && !e.metaKey && !e.ctrlKey) openPicker(index, 'LEAGUE'); });

  (async () => {
    index = await SB.loadIndex();
    L = index.cfg;
    document.title = `${L.league} · ${L.brand}`;
    render();
  })().catch((e) => { board.innerHTML = `<div class="msg">Couldn't load the league page. ${esc(e.message)}</div>`; });
})();
