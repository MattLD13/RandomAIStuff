// Shared by the team boards (board.js) and the league pages (league.js) of Courtside, Sideline, Dugout and Pitchside.
window.SB = (() => {
  const key = document.body.dataset.league;
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const logo = (src, cls = 'logo') => src ? `<img class="${cls}" src="${esc(src)}" alt="" loading="lazy">` : '';
  const ord = (n) => n + (['th', 'st', 'nd', 'rd'][(n % 100 - 20) % 10] || ['th', 'st', 'nd', 'rd'][n % 100] || 'th');
  const ET = { timeZone: 'America/New_York' };
  const fmt = (d, o) => new Intl.DateTimeFormat('en-US', { ...ET, ...o }).format(new Date(d));
  const brandIcon = (brand, size = 18) => `<img class="bicon" src="brand/${esc(String(brand).toLowerCase())}.svg" width="${size}" height="${size}" alt="">`;
  const storage = (name) => ({
    get() { try { return localStorage.getItem(name); } catch { return null; } },
    set(v) { try { v == null ? localStorage.removeItem(name) : localStorage.setItem(name, v); } catch {} },
  });
  const teamStore = storage(`board-team-${key}`);
  const shortDiv = (n) => String(n || '').replace(/^American League/, 'AL').replace(/^National League/, 'NL').replace(/ Conference$/, '');

  // the alternate logo tiled faintly on a tilted grid, exactly as Rinkside
  function remix(src) {
    const el = document.getElementById('remix'); if (!el) return;
    if (!src) { el.innerHTML = ''; return; }
    const a = esc(src);
    el.innerHTML = `<svg width="100%" height="100%"><defs><pattern id="remix-bg" width="168" height="168" patternUnits="userSpaceOnUse" patternTransform="rotate(-12)">
        <image href="${a}" x="8" y="8" width="68" height="68" preserveAspectRatio="xMidYMid meet"/>
        <image href="${a}" x="92" y="92" width="68" height="68" preserveAspectRatio="xMidYMid meet"/>
      </pattern></defs><rect width="100%" height="100%" fill="url(#remix-bg)"/></svg>`;
  }

  // scale the fixed canvas to the window (phones: fill the width and scroll)
  const board = document.getElementById('board'), stage = document.getElementById('stage');
  const modeNow = () => ((document.documentElement.clientWidth || innerWidth) < 700 ? 'stack' : 'board');
  function fit(mode, w) {
    const h = parseFloat(board.style.height);
    const vw = document.documentElement.clientWidth || innerWidth, vh = innerHeight;
    const scale = mode === 'stack' ? vw / w : Math.min(vw / w, 1.6);
    const top = mode === 'stack' ? 8 : Math.max(0, Math.round((vh - h * scale) / 2));
    board.style.width = `${w}px`;
    board.style.transform = `translate(${Math.round((vw - w * scale) / 2)}px, ${top}px) scale(${scale})`;
    stage.style.height = `${Math.max(mode === 'stack' ? 0 : vh, h * scale + top + (document.body.classList.contains('editing') ? 120 : 16))}px`;
  }

  // ---------- picker: every league (with its logo), the whole league, every team by division ----------
  let picker = null;
  function closePicker() { picker?.remove(); picker = null; }
  function openPicker(index, current, extra = '') {
    closePicker();
    const L = index.cfg;
    picker = document.createElement('div');
    picker.className = 'picker';
    picker.setAttribute('role', 'dialog');
    picker.setAttribute('aria-label', 'Choose a team');
    const confs = index.conferences.map((c) => {
      const divs = c.divisions.map((d) => {
        const ts = d.rows.map((r) => index.teams.find((t) => t.abbr === r.abbr)).filter(Boolean).sort((a, b) => a.name.localeCompare(b.name));
        const sep = c.divisions.length > 1 ? `<div class="pdv">${esc(shortDiv(d.name))}</div>` : '';
        return `${sep}<div class="pgl">${ts.map((t) =>
          `<a class="pt${t.abbr === current ? ' on' : ''}" href="${key}/${t.slug}/" data-abbr="${esc(t.abbr)}">${logo(t.logo)}<span>${esc(t.name)}</span></a>`).join('')}</div>`;
      }).join('');
      return `<div class="pg"><div class="pgt">${esc(c.name)}</div>${divs}</div>`;
    }).join('');
    picker.innerHTML = `<div class="sheet"><div class="ph"><span>Choose a team</span>${extra}<button class="x" aria-label="Close">×</button></div>
      <div class="ltabs">${L.leagues.map((l) => `<a class="lt${l.key === key ? ' on' : ''}" href="${l.key === 'nhl' ? './' : `${l.key}/`}">${brandIcon(l.brand, 26)}<b>${esc(l.brand)}</b><span>${esc(l.league)}</span></a>`).join('')}</div>
      <div class="pg"><div class="pgl"><a class="pt whole${current === 'LEAGUE' ? ' on' : ''}" href="${key}/league/">${brandIcon(L.brand, 30)}<span>${esc(L.league)} · whole league</span></a></div></div>
      ${confs}</div>`;
    picker.addEventListener('click', (e) => {
      const a = e.target.closest('a.pt[data-abbr]'); if (a) { teamStore.set(a.dataset.abbr); return; }
      if (e.target === picker || e.target.closest('.x')) closePicker();
    });
    document.body.appendChild(picker);
    picker.querySelector('.pt.on')?.focus();
    return picker;
  }

  const loadIndex = async () => (await fetch(`${key}/data/league.json`, { cache: 'no-cache' })).json();

  return { key, esc, logo, ord, fmt, brandIcon, storage, teamStore, shortDiv, remix, board, stage, modeNow, fit, openPicker, closePicker, get picker() { return picker; }, loadIndex };
})();
