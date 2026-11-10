#!/usr/bin/env bash
# Weekly scoreboard pipeline. Run from rinkside/research/goal-model. Data lives in work/ (cached between runs).
set -euo pipefail
export SEASON=${SEASON:-2026}          # current season key (2026 = 2026-27)
mkdir -p work && cp scripts/* work/ && cp prereg.json work/
for f in frozen/seed/*.json; do [ -f "work/$(basename $f)" ] || cp "$f" work/; done   # lookups as they were at the freeze
cd work
export FROZEN=../frozen SCOREBOARD=../scoreboard

# 1. downloads (each script skips what it already has)
node fetch.mjs 2020 868 6
for s in $(seq 2021 $((SEASON - 1))); do node fetch.mjs $s 1312 6; done
node fetch.mjs $SEASON 1400 6      # 2026-27 has 1,344 games; unplayed or missing ids are skipped
node rosters.mjs
node shifts.mjs
python3 build.py
python3 - <<'PY'
import pandas as pd
d = pd.read_parquet('shots.parquet', columns=['season', 'shooter', 'goalie'])
S = int(__import__('os').environ['SEASON'])
d[(d.season >= 2021) & (d.season < S) & (d.shooter > 0)][['season', 'shooter']].drop_duplicates().to_csv('edge_pairs.csv', index=False)
d[(d.season >= 2021) & (d.season < S) & (d.goalie > 0)][['season', 'goalie']].drop_duplicates().to_csv('gedge_pairs.csv', index=False)
open('shooters.txt', 'w').write('\n'.join(map(str, sorted(set(d.shooter[d.shooter > 0])))))
PY
node edge.mjs
node careers.mjs
[ -f teams.json ] || curl -sS "https://api.nhle.com/stats/rest/en/team" -o teams.json
LAST_SEASON=$((SEASON - 1)) node goalie_data.mjs
mkdir -p mp && curl -sS -A "Mozilla/5.0" -o mp/shots_$SEASON.zip "https://peter-tanner.com/moneypuck/downloads/shots_$SEASON.zip" && (cd mp && unzip -o -q shots_$SEASON.zip) || echo "MoneyPuck file not available this week"

# 2. features (base xG frozen; every history feature uses earlier games only)
python3 model.py
python3 streak.py
python3 history2.py
python3 revenge.py
python3 context3.py
python3 goalie2.py
python3 relfeat.py
python3 chances_build.py

# 3. score the frozen models on games after the cutoff
python3 scoreboard.py
