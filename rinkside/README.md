# Rinkside

An auto-updating, one-screen dashboard for every NHL team, recreated from a phone-wallpaper
screenshot. Each team has its own subdomain:

- https://rangers.mattdicks.org
- https://blues.mattdicks.org
- …and the other 30 teams (list below)

Data refreshes every 30 minutes from the NHL's public APIs. GitHub Actions builds the data and
GitHub Pages hosts the site. A small Cloudflare Worker routes each subdomain to the team's board.

## How the original graphic was made

Every number on the board comes from the NHL's public, keyless APIs. The board is one
fixed-size layout (921 x 1145 design pixels) rendered to an image and placed about a fifth
of the way down an iPhone lock screen. Type is Barlow Semi Condensed for words and IBM Plex
Mono for numbers. The home/away icons are Material-style house and plane shapes.

| Panel | Source | How it is computed |
| --- | --- | --- |
| Record, points, division rank, streak, Home/Road/Last 10 | `api-web.nhle.com/v1/standings/now` | read directly |
| Schedule left: Nth-toughest of 32 | `club-schedule-season/{team}` for all 32 teams + standings | average current points % of each team's remaining opponents, ranked (1 = toughest) |
| The season, game by game | team schedule | one slot per regular-season game; bar = goal margin (capped at ±5), green W / red L / tan OT-SO loss; dot row = filled home / ring away |
| Playoff line | all 32 schedules | standings rebuilt after each game; margin = our points − first team out (or − last team in when out) under the wildcard format. Today's value uses the official standings |
| Division grids | team schedule + standings | each opponent in standings order; house = home, plane = away, coloured by result |
| Playoff picture | standings (`divisionSequence`, `wildcardSequence`) | top 3 in our division, WC1/WC2, then the next 3 teams |
| Power play / Penalty kill rank | `api.nhle.com/stats/rest/en/team/summary` | ranked across the league |
| Team leaders | `club-stats/{team}/{season}/2` | most points, most shots, best save % (min. games = team GP / 6) |
| Next 5 / Last 5 | team schedule | times in Eastern time; scores shown winner-first |

The NHL APIs don't send CORS headers, so a browser can't call them directly. The GitHub
Action fetches the data for all 32 teams, writes `site/data/<TEAM>.json`, renders a
lock-screen PNG per team, and deploys the static site.

## Layout

```
rinkside/
  config.json                  default team; per-team colours, logo variant, subdomain + aliases
  scripts/build-data.mjs       NHL API -> site/data/<TEAM>.json + site/data/teams.json (Node 18+, no deps)
  scripts/render-wallpaper.mjs site -> site/wallpaper/<TEAM>.png (1179x2556) via Playwright
  site/                        the board (index.html, style.css, app.js) and the team picker
  cloudflare/worker.js         routes <team>.mattdicks.org to the Pages site
  cloudflare/wrangler.toml     Worker config (route *.mattdicks.org/*)
.github/workflows/rinkside.yml runs every 30 min and on every push to main, deploys to GitHub Pages
```

## Setup

### 1. GitHub Pages

1. **Settings → General → Default branch:** set it to `main`. GitHub runs scheduled workflows
   only from the default branch, and the Pages environment deploys only from it.
2. **Settings → Pages → Build and deployment → Source:** choose **GitHub Actions**. Leave
   **Custom domain** empty. The Worker fetches the site from
   `mattld13.github.io/RandomAIStuff`, and that address redirects away once a custom domain
   is set.
3. **Actions → Rinkside → Run workflow** (or push to `main`). After that it runs every
   30 minutes. Check that https://mattld13.github.io/RandomAIStuff/ loads.

GitHub turns off scheduled workflows in repositories with no activity for 60 days. If the
board stops updating, re-enable the workflow on the Actions tab.

### 2. Subdomains (Cloudflare, free plan)

GitHub Pages allows only one custom domain per site, so 32 team subdomains need a router in
front of it. `mattdicks.org` has to use Cloudflare DNS: in the Cloudflare dashboard,
**Add a site** and switch your registrar's nameservers to Cloudflare's.

1. **DNS → Add record:** type `AAAA`, name `*`, IPv6 `100::`, **Proxied** (orange cloud).
   This placeholder record lets the wildcard reach the Worker. Your existing records (the
   root domain, `www`, and so on) take priority and aren't affected.
2. **Deploy the Worker**, either way:
   - Dashboard: **Workers & Pages → Create → Worker**, name it `rinkside`, paste
     `cloudflare/worker.js`, and deploy. Then open **Settings → Domains & Routes → Add →
     Route** and enter `*.mattdicks.org/*` for zone `mattdicks.org`.
   - CLI: `cd rinkside/cloudflare && npx wrangler deploy` (the route is in `wrangler.toml`).

The Worker only answers for team subdomains. Any other subdomain passes through to whatever
it normally serves.

## Team subdomains

| | | | |
| --- | --- | --- | --- |
| ducks | bruins | sabres | hurricanes (canes) |
| bluejackets (jackets) | flames | blackhawks (hawks) | avalanche (avs) |
| stars | redwings (wings) | oilers | panthers (cats) |
| kings | wild | canadiens (habs) | devils |
| predators (preds) | islanders (isles) | rangers | senators (sens) |
| flyers | penguins (pens) | kraken | sharks |
| blues | lightning (bolts) | mapleleafs (leafs) | mammoth (utah) |
| canucks | goldenknights (knights, vegas) | jets | capitals (caps) |

The three-letter abbreviation works too (`nyr.mattdicks.org`). Names in brackets are aliases.
Change them in `config.json`.

Each team subdomain also serves:

- `/wallpaper.png`: that team's 1179x2556 lock-screen image. An iOS Shortcuts automation
  ("Get Contents of URL" → "Set Wallpaper") can keep your lock screen current.
- `/?wallpaper`: a preview of the board in its lock-screen position.

On the board, tap the team logo (top-left) or the RINKSIDE mark, or press `t`, to switch
teams. On a team subdomain this goes to the other team's subdomain. Without a subdomain
(e.g. on github.io), the choice is stored in the browser and in `?team=BOS`.

## Run locally

```sh
cd rinkside
node scripts/build-data.mjs        # writes site/data/ (TEAMS=NYR,BOS to build a subset)
python3 -m http.server 8080 --directory site   # open http://localhost:8080/?team=STL
npm install && npx playwright install chromium && node scripts/render-wallpaper.mjs  # optional PNGs
```
