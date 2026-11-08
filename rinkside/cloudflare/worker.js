// Rinkside subdomain router (Cloudflare Worker).
//
// rangers.mattdicks.org, blues.mattdicks.org, nyr.mattdicks.org, leafs.mattdicks.org ...
// each serve the GitHub Pages site for that team. /wallpaper.png on a team subdomain
// returns that team's lock-screen image. Subdomains that aren't a team pass straight through.
//
// Route: *.mattdicks.org/*   (see README.md)
const ORIGIN = 'https://mattld13.github.io/RandomAIStuff';

let index = null;
let indexAt = 0;

async function teams() {
  if (!index || Date.now() - indexAt > 60 * 60 * 1000) {
    const res = await fetch(`${ORIGIN}/data/teams.json`, { cf: { cacheTtl: 3600 } });
    if (res.ok) {
      index = await res.json();
      indexAt = Date.now();
    }
  }
  return index;
}

function resolve(idx, word) {
  const t = idx?.teams.find((t) => t.abbrev.toLowerCase() === word || t.slug === word || t.aliases?.includes(word));
  return t ? t.abbrev : null;
}

export default {
  async fetch(request) {
    const url = new URL(request.url);
    const team = resolve(await teams(), url.hostname.split('.')[0].toLowerCase());
    if (!team) return fetch(request);

    const path = url.pathname === '/wallpaper.png' ? `/wallpaper/${team}.png` : url.pathname;
    const res = await fetch(ORIGIN + path + url.search, {
      method: request.method,
      headers: { accept: request.headers.get('accept') || '*/*' },
      cf: { cacheTtl: path.startsWith('/data/') ? 0 : 300 },
    });
    const out = new Response(res.body, res);
    out.headers.delete('x-github-request-id');
    return out;
  },
};
