# Giving every league its own address

When this is set up, each league has its own address:

| League | Board | Address | Example team |
|---|---|---|---|
| NHL | Rinkside | hockey.mattdicks.org | hockey.mattdicks.org/rangers |
| NBA | Courtside | basketball.mattdicks.org | basketball.mattdicks.org/knicks |
| NFL | Sideline | football.mattdicks.org | football.mattdicks.org/giants |
| MLB | Dugout | baseball.mattdicks.org | baseball.mattdicks.org/yankees |
| MLS | Pitchside | soccer.mattdicks.org | soccer.mattdicks.org/nycfc |

- A league's address on its own (`soccer.mattdicks.org`) opens the whole-league page.
- A team's address is the league address plus the team name.
- Abbreviations, full names and cities also work as aliases: `/nyc`, `/newyorkcityfc`, `/seattle`.

Every team and its address is listed on the guide page, at
https://hockey.mattdicks.org/guide/ (and at `/guide/` on every league address).

## How it works

The whole site is still built and hosted in one place: GitHub Pages, at hockey.mattdicks.org.
GitHub Pages allows only one custom domain for each repository, so the other four addresses go
through a small Cloudflare Worker. Your DNS for mattdicks.org is already on Cloudflare.

The Worker is `deploy/subdomains-worker.js`. It gets the right page from hockey.mattdicks.org and
returns it, and the short address stays in the browser:

| You open | The Worker returns |
|---|---|
| `soccer.mattdicks.org/` | `hockey.mattdicks.org/mls/league/` |
| `soccer.mattdicks.org/sounders/` | `hockey.mattdicks.org/mls/sounders/` |
| `soccer.mattdicks.org/sounders` | a redirect to `/sounders/` |
| shared files (`style.css`, `fonts/`, `sports/`, `brand/`, `alt/`, `guide/`, `mls/data/`) | the same path |

The pages work at both addresses. A page that sees it is on its league's own address links to the
short addresses (`/sounders/`, and other leagues at their own subdomains). The old addresses, such
as hockey.mattdicks.org/mls/sounders/, keep working.

The Worker runs on Cloudflare's free plan. The free plan allows 100,000 requests a day.

## Set it up (one time, about 5 minutes)

### Option A: in the Cloudflare dashboard

1. Sign in at https://dash.cloudflare.com.
2. Open **Workers & Pages**, then **Create**, then **Create Worker**.
3. Name the Worker `league-subdomains`, then click **Deploy**. Deploy creates the Worker with a
   placeholder script.
4. Click **Edit code**.
5. Replace all the code with the contents of `rinkside/deploy/subdomains-worker.js`, then click
   **Deploy**.
6. Open the Worker's **Settings**, then **Domains & Routes**, then **Add**, then **Custom domain**.
7. Add `soccer.mattdicks.org`. Do the same for `basketball.mattdicks.org`,
   `football.mattdicks.org` and `baseball.mattdicks.org`.

   Cloudflare creates the DNS records and the HTTPS certificates itself. Don't add DNS records for
   these names by hand.
8. Wait a minute or two. Then open https://soccer.mattdicks.org/sounders/.

### Option B: from a terminal

```
cd rinkside/deploy
npx wrangler login     # opens the browser once to connect to your Cloudflare account
npx wrangler deploy    # uploads the Worker and adds the four custom domains (wrangler.toml)
```

## Check that it works

- https://soccer.mattdicks.org shows the MLS league page with the Pitchside logo.
- https://basketball.mattdicks.org/knicks shows the Knicks board.
- In the team picker on that board, the links point at basketball.mattdicks.org/... addresses.
- Each address shows the right favicon: Courtside, Sideline, Dugout or Pitchside.

## Notes

- **Nothing changes on GitHub.** hockey.mattdicks.org stays on GitHub Pages, and the build is
  the same.
- **Renaming or adding a subdomain:** change `LEAGUES` at the top of
  `deploy/subdomains-worker.js` and `domain` in `sports/leagues.json`, then deploy the Worker again.
- **Team address names:**
  - NBA, NFL and MLB use the team nickname, such as `knicks`, `whitesox` or `commanders`.
  - MLS uses the name fans use, such as `sounders`, `intermiami` or `redbulls`. The MLS names are
    set in `sports/leagues.json` under `slugs`.
  - Abbreviations and full names always work as aliases.
- **Turning it off:** remove the custom domains from the Worker. The hockey.mattdicks.org
  addresses keep working.
