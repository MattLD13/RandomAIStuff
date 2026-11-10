# Streak features, strictly from earlier games: how long since the shooter last scored, and since the goalie last
# allowed a goal. Added to shots_feat.parquet.
import numpy as np, pandas as pd
from collections import defaultdict
df = pd.read_parquet('shots_feat.parquet')
S = ['sh_dry_shots', 'sh_dry_games', 'sh_goals_last5', 'g_shutout_streak_shots']
st = defaultdict(lambda: dict(shots=0, games=0, last5=[]))
gs = defaultdict(int)
out = np.zeros((len(df), len(S)))
for gid, g in df.groupby('game', sort=False):
    for i, s, gl in zip(g.index, g.shooter, g.goalie):
        a = st[s]; out[i] = [a['shots'], a['games'], sum(a['last5']), gs[gl]]
    scored = defaultdict(int); shot = set()
    for s, gl, goal, en in zip(g.shooter, g.goalie, g.goal, g.en):
        if en: continue
        shot.add(s); scored[s] += goal
        a = st[s]; a['shots'] = 0 if goal else a['shots'] + 1
        if gl: gs[gl] = 0 if goal else gs[gl] + 1
    for s in shot:
        a = st[s]; a['games'] = 0 if scored[s] else a['games'] + 1
        a['last5'] = (a['last5'] + [scored[s]])[-5:]
for j, c in enumerate(S): df[c] = out[:, j]
df.to_parquet('shots_feat.parquet')
print(df[S].describe().T[['mean', '50%', 'max']])
