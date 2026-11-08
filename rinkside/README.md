# Rinkside

An auto-updating, one-screen dashboard for every NHL team, recreated from a phone-wallpaper
screenshot. Each team has its own page:

- https://hockey.mattdicks.org/rangers
- https://hockey.mattdicks.org/blues
- …and the other 30 teams (list below)

Data refreshes every 30 minutes from the NHL's public APIs. GitHub Actions builds it and
GitHub Pages hosts it.

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
Action fetches the data for all 32 teams, writes `site/data/<TEAM>.json`, generates a
folder per team name (`site/rangers/index.html`, `site/nyr/`, `site/leafs/`…), renders a
lock-screen PNG per team, and deploys the static site.

## Layout

```
rinkside/
  config.json                  default team; per-team colours, logo variant, URL name + aliases
  scripts/build-data.mjs       NHL API -> site/data/*.json + one site/<name>/ page per team name (Node 18+, no deps)
  scripts/render-wallpaper.mjs site -> site/<name>/wallpaper.png (1179x2556) via Playwright
  site/                        the board (index.html, style.css, app.js) and the team picker
  SETUP-WITH-CLAUDE.md         a prompt that has Claude (desktop) do the setup below for you
.github/workflows/rinkside.yml runs every 30 min and on every push to main, deploys to GitHub Pages
```

## Setup

`SETUP-WITH-CLAUDE.md` has a prompt you can paste into the Claude desktop app (with Claude in
Chrome or computer use) to do all of this in your browser. Doing it by hand:

1. **GitHub → repo Settings → General → Default branch:** `main`. GitHub runs scheduled
   workflows only from the default branch, and Pages deploys only from it.
2. **GitHub → repo Settings → Pages → Source:** **GitHub Actions**.
3. **Actions → Rinkside → Run workflow.** When it finishes,
   https://mattld13.github.io/RandomAIStuff/rangers/ should load.
4. **DNS** (wherever mattdicks.org's DNS is managed): add a `CNAME` record, name `hockey`,
   target `mattld13.github.io`. If you use Cloudflare, set it to **DNS only** (grey cloud).
5. **GitHub → repo Settings → Pages → Custom domain:** `hockey.mattdicks.org` → Save. Once
   the DNS check passes and the certificate is issued (minutes to an hour), tick
   **Enforce HTTPS**.
6. Optional: **GitHub → your profile Settings → Pages → Add a domain** to verify
   `mattdicks.org` with a TXT record, so nobody else can claim it on GitHub.

The deploy is done by GitHub Actions, so GitHub ignores a `CNAME` file. The custom domain
lives only in the Pages settings.

GitHub turns off scheduled workflows in repositories with no activity for 60 days. If the
board stops updating, re-enable the workflow on the Actions tab.

## Team pages

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

`hockey.mattdicks.org/<name>` works for every name above, aliases in brackets, and the
three-letter abbreviation (`/nyr`). Names are set in `config.json`.

- `hockey.mattdicks.org/` shows the last team you opened (the Rangers the first time).
- `hockey.mattdicks.org/rangers/wallpaper.png` is that team's 1179x2556 lock-screen image
  (main names only, not aliases). An iOS Shortcuts automation ("Get Contents of URL" → "Set
  Wallpaper") can keep your lock screen current.
- `hockey.mattdicks.org/rangers/?wallpaper` previews the board in its lock-screen position.
- On the board, tap the team logo (top-left) or the RINKSIDE mark, or press `t`, to switch
  teams.

## Run locally

```sh
cd rinkside
node scripts/build-data.mjs        # writes site/data/ (TEAMS=NYR,BOS to build a subset)
python3 -m http.server 8080 --directory site   # open http://localhost:8080/blues/
npm install && npx playwright install chromium && node scripts/render-wallpaper.mjs  # optional PNGs
```
