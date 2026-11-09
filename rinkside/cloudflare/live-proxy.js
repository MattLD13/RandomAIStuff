// Rinkside live relay (Cloudflare Worker).
//
// The NHL's API doesn't send CORS headers, so a browser page can't read it directly. This worker
// passes a few live-game endpoints through with CORS headers and a short edge cache, so the board
// can poll a game in progress every 15 seconds. Only these paths are allowed:
//   /v1/gamecenter/<gameId>/play-by-play | landing | boxscore
//   /v1/score/now
// Deploy: Cloudflare dashboard → Workers & Pages → Create → Worker → paste this file → Deploy.
// Then put the worker's URL in rinkside/config.json as "liveProxy".
const ALLOWED = [/^\/v1\/gamecenter\/\d{10}\/(play-by-play|landing|boxscore)$/, /^\/v1\/score\/now$/];
const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, OPTIONS',
  'access-control-max-age': '86400',
};

export default {
  async fetch(request) {
    if (request.method === 'OPTIONS') return new Response(null, { headers: CORS });
    if (request.method !== 'GET') return new Response('Method not allowed', { status: 405, headers: CORS });
    const url = new URL(request.url);
    if (!ALLOWED.some((re) => re.test(url.pathname))) return new Response('Not found', { status: 404, headers: CORS });
    const upstream = await fetch(`https://api-web.nhle.com${url.pathname}`, {
      headers: { 'user-agent': 'rinkside-live' },
      redirect: 'follow',
      cf: { cacheTtl: 8, cacheEverything: true },   // every viewer shares one NHL request per ~8s
    });
    const res = new Response(upstream.body, { status: upstream.status, headers: upstream.headers });
    for (const [k, v] of Object.entries(CORS)) res.headers.set(k, v);
    res.headers.set('cache-control', 'public, max-age=5');
    return res;
  },
};
