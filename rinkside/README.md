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
of the way down an iPhone lock screen. Each element's font was identified by rendering about
90 candidates and scoring them pixel by pixel against the screenshot:

- **Headings, names, times, scores:** Barlow Condensed Bold (0.98 correlation).
- **Small text:** Barlow Semi Condensed.
- **Numbers:** a sporty chamfered numeral. No public font matched, so
  `fonts/build-font.py` draws one, **Rinkside Mono**. Every glyph is a centre line widened
  by a single stroke width (4px at the reference's 30px digit height), with 45° chamfered
  corners, flat-cut terminals, no serifs and no curves. Run it with `--stroke` or
  `--chamfer` to tune.

The home/away icons are Material-style house and plane shapes.

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
  site/alt/                    optional alternate-logo images of your own (see config "altLogo")
  site/fonts/RinksideMono.woff2  the numeral font (built by fonts/build-font.py, committed)
  fonts/build-font.py          draws Rinkside Mono (pip install fonttools brotli shapely)
  scripts/chances.mjs          league play-by-play -> xG model + scoring chances (cached in .cache/)
  site/chances-core.mjs        per-shot xG / danger logic, shared by the build and the browser (live games)
  cloudflare/live-proxy.js     Cloudflare Worker that relays live-game data with CORS headers
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
4. **DNS** (Cloudflare dashboard → mattdicks.org → DNS → Records → Add record): type
   `CNAME`, name `hockey`, target `mattld13.github.io`, proxy status **DNS only** (grey
   cloud). GitHub needs the grey cloud to issue the HTTPS certificate.
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

## Tap for details

On the live page, each piece of information opens from exactly one place, in a small popup in
the board's style:

| Tap | Shows |
| --- | --- |
| A played game's column in the season chart | That game: score, arena, TV, winning goal and goalie, Game Center link (the only place scores open) |
| Next 5 | Puck drop, arena, TV |
| Last 5 | Recent form: record, goals, streak |
| A division-grid row | The season series vs that team (results, dates) |
| A division heading | Record vs every team in that division |
| Playoff-line / goal-diff / race chart columns | The value after that game |
| Playoff picture or standings-table row | That team's record, points %, goals, home/road, last 10, streak |
| A stat box | Value, league rank, league average |
| A leader row | The player's full stat line |
| The record, the splits line, "Schedule left" | Pace and ranks, home/road/last-10 detail, strength of schedule |
| The section titles | Season summary; the playoff cut |

Tap outside or press Esc to close. Lock-screen wallpapers (`?wallpaper` and the PNGs) have
no popups.

## Customize the board

Tap the team logo (or RINKSIDE, or press `c`) and choose **Customize board**. Every panel
gets a ⇄ button; tap a panel to pick what it shows. Choices are saved in your browser.
**Copy link** shares the layout (`?layout=…`), and that link also works on
`?wallpaper` pages. **Reset** goes back to the original layout.

| Slot | Options |
| --- | --- |
| Top and middle charts | Game by game (goal margin), playoff line, goal differential, division points race |
| The four grid sections | Any division's results grid, any division's standings, league top 8, conference top 8 |
| Playoff picture | Your conference, or the other conference |
| The two stat boxes (22 options) | Power play, penalty kill, goals for/against per game, shots for/against per game, faceoffs, shooting %, team save %, points %, goal diff per game, plus NHL EDGE: top skating speed, bursts over 20/22 mph, hardest shot, shots over 90 mph, distance skated, high-danger shots and shooting %, offensive/defensive-zone time, shot-attempt differential |
| The three leader rows (15 options) | Points, goals, assists, shots, +/-, power-play goals, game-winners, ice time, PIM, save %, GAA, goalie wins, shutouts, plus EDGE fastest skater and hardest shot |
| Upper / lower lists | Next 5 or Last 5, as cards or as a list |

To change the default for everyone (and the published wallpapers), add `"layout"` to
`config.json` with the slots you want to change, e.g.
`"layout": { "chart2": "goalDiff", "boxes": ["pp", "topSpeed"] }`.

NHL EDGE is the league's puck- and player-tracking data (`api-web.nhle.com/v1/edge/...`):
skating and shot speeds, distance skated, zone time and shot locations, each with a league
rank. Individual players' EDGE pages (percentiles for speed, shot speed, distance and zone
time) are also available if you want more panels later.

## Scoring chances and expected goals

`scripts/chances.mjs` reads the NHL play-by-play for every finished game (cached in `.cache/`,
also between GitHub Action runs, so each build only downloads new games):

- **Expected goals (xG):** a logistic-regression model fitted on every shot on goal in the
  league this season, using distance, angle, shot type, rebound (a shot within 3 s of the
  team's last attempt), rush (within 4 s of play at the other end) and power play /
  shorthanded. Across the league, xG adds up to actual goals.
- **Scoring chances:** shots on goal from the offensive zone with the goalie in net.
  - **High danger:** within 20 ft of the goal line and 19 ft of centre.
  - **Mid danger:** within 30 ft out and 30 ft wide.
  - **Low danger:** the rest of the zone.
  - **Dumps:** shots from more than 58 ft out, or from outside the zone.

  Boundaries were calibrated against a published scoring-chances report for NYR @ SEA on
  2026-11-07 (the Rangers' 24 chances, 8 high-danger and 2 dumps match exactly). xG values
  differ from that report's, since every xG model is different.

New options in Customize:
- **Scoring chances (last game):** a report panel for the upper or lower list slot.
- **Expected goals by game:** a chart. Tap a game for its full report.
- **Stat boxes:** xG share, finishing (goals minus xG) and high-danger chance share, each
  ranked across the league.

## Live games

When the team's game is on, the page polls the NHL every 15 seconds and shows it live:
- **Header:** a live strip with period, clock, score, shots, xG and power-play status.
  Tap it for goals with scorers, assists and PP/SH/EN tags.
- **Season and xG charts:** a dashed "LIVE" bar.
- **Next 5:** the game's card shows the score.
- **Scoring-chances panel:** switches to the game in progress. The browser runs the same xG
  model as the build (`site/chances-core.mjs`), so live xG matches the final numbers.

When the game ends, polling stops and the regular 30-minute refresh brings in the final.

The NHL API doesn't send CORS headers, so browsers can't read it directly. A small
**Cloudflare Worker** (`cloudflare/live-proxy.js`) relays only the live-game endpoints, with
CORS headers and an 8-second shared cache. The free plan is plenty.

**One-time setup:**

1. **Create the Worker:** Cloudflare dashboard → **Workers & Pages** → **Create** →
   **Create Worker**. Name it `rinkside-live`, **Deploy**, then **Edit code**. Replace the
   code with `rinkside/cloudflare/live-proxy.js` and **Deploy** again. (CLI alternative:
   `cd rinkside/cloudflare && npx wrangler deploy`.)
2. **Test it:** open its address (like `https://rinkside-live.<you>.workers.dev`) followed by
   `/v1/score/now`. It should return JSON.
3. **Point the site at it:** set `"liveProxy": "https://rinkside-live.<you>.workers.dev"` in
   `rinkside/config.json` and push.

Without `liveProxy`, the site works as before, refreshing every 30 minutes.

## Screen sizes

- **Phones (under 700px wide):** the board reflows into a two-column phone layout at
  readable text sizes and scrolls vertically.
- **Tablets and computers:** the full board, scaled to the window (up to 1.6×).
- **Rotating a phone** switches between the two.
- **Wallpapers** always use the original lock-screen layout.

**Adding your own alternate logos without a computer:** on github.com, open
`rinkside/site/alt/`, choose **Add file → Upload files**, drop in images named like
`NYR.png`, and commit. The site rebuilds with them within a couple of minutes.

## Remix background

Behind each board, the team's alternate logo is tiled faintly, like the NHL's remix and
reverse-retro jerseys. The logo is set by `"altLogo"` in `config.json`, and it can be:

- an NHL logo file name, such as `TBL_alt.svg` or `NYI_19951996-19961997_dark.svg`. The
  NHL's records API lists every logo: https://records.nhl.com/site/api/logo
- a file you add to `site/alt/`, such as `"alt/NYR.png"` (see `site/alt/README.md`)
- any image URL.

The defaults are the official current alternates where the NHL publishes one (Tampa Bay,
Toronto, Calgary, Nashville, Utah, Dallas) and a fan-favourite throwback for the rest, such as
the Islanders fisherman, the Canucks flying skate and the Penguins 1967 roundel. Seattle,
Vegas and Winnipeg have only ever had one logo, so they use it.

## Run locally

```sh
cd rinkside
node scripts/build-data.mjs        # writes site/data/ (TEAMS=NYR,BOS to build a subset)
python3 -m http.server 8080 --directory site   # open http://localhost:8080/blues/
npm install && npx playwright install chromium && node scripts/render-wallpaper.mjs  # optional PNGs
```
