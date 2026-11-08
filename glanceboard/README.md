# Glanceboard

An auto-updating, one-screen dashboard for an NHL team (New York Rangers by default),
recreated from a phone-wallpaper screenshot and hosted on GitHub Pages.

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
Action fetches the data on a schedule, writes `site/data.json`, and deploys the static site.

## Layout

```
glanceboard/
  config.json               team abbreviation + band colours
  scripts/build-data.mjs    NHL API -> site/data.json (Node 18+, no dependencies)
  scripts/render-wallpaper.mjs  site -> site/wallpaper.png (1179x2556) via Playwright
  site/index.html|style.css|app.js   the board
.github/workflows/glanceboard.yml   runs every 30 min, deploys to GitHub Pages
```

## Setup (one time)

1. Merge this into `main`.
2. In the repository, go to **Settings → Pages → Build and deployment → Source** and choose
   **GitHub Actions**.
3. Go to **Actions → Glanceboard → Run workflow** to run the first deploy. After that it
   runs every 30 minutes.

The site is published at `https://<user>.github.io/<repo>/`. The page fetches `data.json`
again every 10 minutes while it is open.

- `.../index.html?wallpaper` shows the board where it sits on the lock screen.
- `.../wallpaper.png` is a ready-made 1179x2556 lock-screen image. An iOS Shortcuts
  automation ("Get contents of URL" → "Set Wallpaper") can set it as your wallpaper.

GitHub turns off scheduled workflows in repositories with no activity for 60 days. If the
board stops updating, re-enable the workflow on the Actions tab.

## Change the team

Edit `config.json` (`team`, `primaryColor`, `accentColor`), e.g. `"team": "BOS"`.

## Run locally

```sh
cd glanceboard
node scripts/build-data.mjs        # writes site/data.json
python3 -m http.server 8080 --directory site   # open http://localhost:8080
npm install && npx playwright install chromium && node scripts/render-wallpaper.mjs  # optional PNG
```
