// Cloudflare Worker: gives each league its own address while the site stays on GitHub Pages.
//
//   soccer.mattdicks.org/            -> hockey.mattdicks.org/mls/league/   (the whole league)
//   soccer.mattdicks.org/sounders/   -> hockey.mattdicks.org/mls/sounders/ (a team's board)
//   basketball. / football. / baseball.mattdicks.org work the same way (nba, nfl, mlb).
//
// The address in the browser stays short; the Worker fetches the page from GitHub Pages behind the scenes.
// Shared files (style.css, fonts/, sports/, brand/, alt/, guide/ and each league's data) pass straight through.
// Set-up steps: docs/subdomains.md.

const ORIGIN = 'https://hockey.mattdicks.org';
const LEAGUES = {
  'basketball.mattdicks.org': 'nba',
  'football.mattdicks.org': 'nfl',
  'baseball.mattdicks.org': 'mlb',
  'soccer.mattdicks.org': 'mls',
};
const SHARED = /^\/(style\.css|app\.js|fonts\/|sports\/|brand\/|alt\/|guide\/|data\/|favicon|(nhl|nba|nfl|mlb|mls)\/)/;

export default {
  async fetch(request) {
    const url = new URL(request.url);
    const key = LEAGUES[url.hostname];
    if (!key) return fetch(request);

    let path = url.pathname;
    if (!SHARED.test(path)) {
      const parts = path.split('/').filter(Boolean);
      if (parts.length === 0) path = `/${key}/league/`;
      else if (parts.length === 1) {
        if (!path.endsWith('/')) return Response.redirect(`${url.origin}/${parts[0].toLowerCase()}/${url.search}`, 301);
        path = `/${key}/${parts[0].toLowerCase()}/`;
      }
    }

    const headers = new Headers();
    for (const h of ['accept', 'accept-encoding', 'accept-language', 'user-agent', 'if-none-match', 'if-modified-since']) {
      const v = request.headers.get(h);
      if (v) headers.set(h, v);
    }
    const res = await fetch(ORIGIN + path + url.search, { method: request.method, headers, redirect: 'manual' });

    // a redirect from GitHub Pages (e.g. a missing trailing slash) comes back onto this subdomain
    const loc = res.headers.get('location');
    if (loc && res.status >= 300 && res.status < 400) {
      const to = new URL(loc, ORIGIN);
      let p = to.pathname;
      if (p.startsWith(`/${key}/`)) p = p.slice(key.length + 1);
      if (p === '/league/') p = '/';
      return Response.redirect(`${url.origin}${p}${to.search}`, res.status);
    }
    return res;
  },
};
