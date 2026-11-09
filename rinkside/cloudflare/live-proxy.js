// Rinkside live relay (Cloudflare Worker).
//
// The NHL's API doesn't send CORS headers, so a browser page can't read it directly. This worker
// passes a few live-game endpoints through with CORS headers and a short edge cache, so the board
// can poll a game in progress every 15 seconds. Only these paths are allowed:
//   /v1/gamecenter/<gameId>/play-by-play | landing | boxscore | right-rail   (api-web.nhle.com)
//   /v1/score/now                                                            (api-web.nhle.com)
//   /shifts/<gameId>     the game's shift chart (api.nhle.com/stats), for live Box WAR
//   /toi/<gameId>/H|V    the home / visitor time-on-ice report (nhl.com), when the shift chart is empty
// Deploy: Cloudflare dashboard → Workers & Pages → Create → Worker → paste this file → Deploy.
// Then put the worker's URL in rinkside/config.json as "liveProxy".
const ALLOWED = [/^\/v1\/gamecenter\/\d{10}\/(play-by-play|landing|boxscore|right-rail)$/, /^\/v1\/score\/now$/];
const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, OPTIONS',
  'access-control-max-age': '86400',
};

// the upstream address for a request path, or null when it isn't one we relay
function upstreamFor(path) {
  if (ALLOWED.some((re) => re.test(path))) return { url: `https://api-web.nhle.com${path}`, ttl: 8 };
  let m = path.match(/^\/shifts\/(\d{10})$/);
  if (m) return { url: `https://api.nhle.com/stats/rest/en/shiftcharts?cayenneExp=gameId=${m[1]}`, ttl: 20 };
  m = path.match(/^\/toi\/(\d{10})\/(H|V)$/);
  if (m) {
    const id = m[1], y = +id.slice(0, 4);
    return { url: `https://www.nhl.com/scores/htmlreports/${y}${y + 1}/T${m[2]}${id.slice(4)}.HTM`, ttl: 30 };
  }
  return null;
}

export default {
  async fetch(request) {
    if (request.method === 'OPTIONS') return new Response(null, { headers: CORS });
    if (request.method !== 'GET') return new Response('Method not allowed', { status: 405, headers: CORS });
    const up = upstreamFor(new URL(request.url).pathname);
    if (!up) return new Response('Not found', { status: 404, headers: CORS });
    const upstream = await fetch(up.url, {
      headers: { 'user-agent': 'rinkside-live' },
      redirect: 'follow',
      cf: { cacheTtl: up.ttl, cacheEverything: true },   // every viewer shares one NHL request
    });
    const res = new Response(upstream.body, { status: upstream.status, headers: upstream.headers });
    for (const [k, v] of Object.entries(CORS)) res.headers.set(k, v);
    res.headers.set('cache-control', `public, max-age=${Math.max(5, up.ttl - 3)}`);
    return res;
  },
};
