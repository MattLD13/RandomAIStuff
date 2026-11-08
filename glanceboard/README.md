# Glanceboard

An auto-updating, one-screen dashboard for any NHL team (New York Rangers by default),
recreated from a phone-wallpaper screenshot and hosted on GitHub Pages at
**https://mattdicks.org**.

## How the original graphic was made

Every number on the board comes from the NHL's public, keyless APIs. The board is one
fixed-size layout (921 x 1145 design pixels) rendered to an image and placed about a fifth
of the way down an iPhone lock screen. Each panel and where its data comes from:

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

The NHL APIs don't send CORS headers, so a browser can't call them directly. A GitHub
Action fetches the data for all 32 teams on a schedule, writes `site/data/<TEAM>.json`, and
deploys the static site.

## Layout

```
glanceboard/
  config.json               default team + band colours / logo variant for all 32 teams
  scripts/build-data.mjs    NHL API -> site/data/<TEAM>.json + site/data/teams.json (Node 18+, no dependencies)
  scripts/render-wallpaper.mjs  site -> site/wallpaper/<TEAM>.png (1179x2556) via Playwright
  site/index.html|style.css|app.js   the board and the team picker
.github/workflows/glanceboard.yml   runs every 30 min, deploys to GitHub Pages
```

## Setup (one time)

1. Merge this into `main`. Scheduled runs and Pages deploys only happen from `main`.
2. In the repository, go to **Settings → Pages → Build and deployment → Source** and choose
   **GitHub Actions**.
3. Go to **Actions → Glanceboard → Run workflow** to run the first deploy. After that it
   runs every 30 minutes.

GitHub turns off scheduled workflows in repositories with no activity for 60 days. If the
board stops updating, re-enable the workflow on the Actions tab.

## Custom domain: mattdicks.org

The site deploys through GitHub Actions, so GitHub ignores a `CNAME` file. The domain is set
in the repository settings instead.

1. **DNS** (at your domain registrar):

   | Type | Name | Value |
   | --- | --- | --- |
   | A | `@` | `185.199.108.153` |
   | A | `@` | `185.199.109.153` |
   | A | `@` | `185.199.110.153` |
   | A | `@` | `185.199.111.153` |
   | AAAA | `@` | `2606:50c0:8000::153` |
   | AAAA | `@` | `2606:50c0:8001::153` |
   | AAAA | `@` | `2606:50c0:8002::153` |
   | AAAA | `@` | `2606:50c0:8003::153` |
   | CNAME | `www` | `mattld13.github.io` |

   Remove any other A/AAAA records on `@` (for example a registrar parking page).
2. **Verify the domain** (recommended, stops anyone else from claiming it on GitHub):
   GitHub → your profile **Settings → Pages → Add a domain** → `mattdicks.org`, then add the
   TXT record it shows you.
3. **Repository settings → Pages → Custom domain**: enter `mattdicks.org` and save. When
   the DNS check passes (minutes to a few hours), tick **Enforce HTTPS**.

`www.mattdicks.org` then redirects to `mattdicks.org`. All paths in the site are relative,
so it works at the domain root or at `mattld13.github.io/RandomAIStuff/`.

## Choosing a team

- **On the page:** tap the team band (top-left logo) or the GLANCEBOARD mark, or press `t`,
  then pick any of the 32 teams. Your choice is remembered in that browser.
- **By link:** `https://mattdicks.org/?team=BOS` (any three-letter NHL abbreviation).
- **Default for new visitors:** `defaultTeam` in `config.json`.
- **Wallpaper images:** `https://mattdicks.org/wallpaper/BOS.png` for each team, and
  `https://mattdicks.org/wallpaper.png` for the default team. An iOS Shortcuts automation
  ("Get Contents of URL" → "Set Wallpaper") can keep your lock screen current.
- **Lock-screen preview:** `https://mattdicks.org/?wallpaper&team=BOS`.

Team colours and which logo variant sits on the band are in `config.json` → `teams`.

## Run locally

```sh
cd glanceboard
node scripts/build-data.mjs        # writes site/data/ (TEAMS=NYR,BOS to build a subset)
python3 -m http.server 8080 --directory site   # open http://localhost:8080
npm install && npx playwright install chromium && node scripts/render-wallpaper.mjs  # optional PNGs
```
