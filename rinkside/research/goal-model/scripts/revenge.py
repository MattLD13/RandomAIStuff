# "Revenge game" features: is the shooter facing a team he used to play for?
#   career seasons before this one (player pages) + earlier games this season / since 2020 (game rosters)
import gzip, json, os
from collections import defaultdict
import pandas as pd
df = pd.read_parquet('shots_feat2.parquet')
teams = {t['fullName']: t['id'] for t in json.load(open('teams.json'))['data']}
alias = {'Montréal Canadiens': 'Montreal Canadiens', 'Utah Hockey Club': 'Utah Hockey Club'}
careers = json.load(open('careers.json'))
past = defaultdict(set)   # (player) -> set of (season, teamId) from career pages
for pid, rows in careers.items():
    for season, common, full in rows:
        tid = teams.get(full) or teams.get(alias.get(full, ''))
        if tid: past[int(pid)].add((season // 10000, tid))
cur = {}                  # player -> team in his latest game
seen = defaultdict(set)   # player -> teams he has dressed for (from game rosters, earlier games only)
met = defaultdict(int)    # (player, oldTeam) -> games against that old team since leaving
out = {}
for gid, g in df.groupby('game', sort=False):
    season = int(g.season.iat[0]); home, away = int(g.home_team.iat[0]), None
    raw = json.loads(gzip.open(f'raw/{season}/{gid}.json.gz').read())
    home, away = raw['home'], raw['away']
    team_of = {p: t for p, t, *_ in raw['roster']}
    for i, s, team in zip(g.index, g.shooter, g.team):
        opp = away if team == home else home
        old = opp in seen[s] or any(se < season and t == opp for se, t in past[s])
        old = old and opp != team
        out[i] = (int(old), int(old and met[(s, opp)] == 0), int(old and team != home))
    for p, t in team_of.items():
        opp = away if t == home else home
        if opp in seen[p] or any(se < season and tt == opp for se, tt in past[p]): met[(p, opp)] += 1
        seen[p].add(t)
idx = list(out); v = list(out.values())
df.loc[idx, 'vs_old_team'] = [a for a, b, c in v]; df.loc[idx, 'old_team_first'] = [b for a, b, c in v]; df.loc[idx, 'old_team_away'] = [c for a, b, c in v]
df.to_parquet('shots_feat2.parquet')
ne = df[df.en == 0]
print(ne.groupby('vs_old_team').agg(shots=('goal', 'size'), goals=('goal', 'sum'), xg=('xg_base', 'sum')).assign(ratio=lambda d: d.goals / d.xg))
print(ne.groupby('old_team_first').agg(shots=('goal', 'size'), goals=('goal', 'sum'), xg=('xg_base', 'sum')).assign(ratio=lambda d: d.goals / d.xg))
