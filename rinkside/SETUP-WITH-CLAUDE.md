# Set up hockey.mattdicks.org with Claude

Open the Claude desktop app, start a chat with **Claude in Chrome** (or computer use)
turned on, make sure you're signed in to GitHub and to wherever mattdicks.org's DNS is
managed (Cloudflare for mattdicks.org), and paste this:

---

Please set up my Rinkside hockey site so it's live at https://hockey.mattdicks.org. Work in
my browser and ask me before anything that needs a password or a payment. Do these in order:

1. On GitHub, open https://github.com/MattLD13/RandomAIStuff/settings. Under General →
   Default branch, switch the default branch to `main` and confirm.
2. Open https://github.com/MattLD13/RandomAIStuff/settings/pages. Under Build and
   deployment → Source, choose "GitHub Actions". Don't set a custom domain yet.
3. Open https://github.com/MattLD13/RandomAIStuff/actions/workflows/rinkside.yml, click
   "Run workflow" on branch `main`, and wait for both jobs to go green. Then check that
   https://mattld13.github.io/RandomAIStuff/rangers/ shows a Rangers dashboard.
4. mattdicks.org was bought through Cloudflare, so its DNS is in the Cloudflare dashboard
   (https://dash.cloudflare.com). Open mattdicks.org → DNS → Records → Add record:
   type CNAME, name `hockey`, target `mattld13.github.io`, proxy status "DNS only" (grey
   cloud, not orange), TTL Auto. Save it. Don't change any other records.
5. Back on https://github.com/MattLD13/RandomAIStuff/settings/pages, enter
   `hockey.mattdicks.org` under Custom domain and click Save. Wait for the DNS check to pass.
   Once HTTPS is available, tick "Enforce HTTPS" (this can take up to an hour; come back to it).
6. Check that https://hockey.mattdicks.org/rangers and https://hockey.mattdicks.org/blues
   both load, and tell me what you did and anything that's still pending.
