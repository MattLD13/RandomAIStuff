# Independent check of the 5-seed claim, with the 'unknown shot type' leak removed (mapped to missing).
import numpy as np, pandas as pd, lightgbm as lgb
exec(open('common.py').read())
V2 = BASE + CTX + CHANGE + SPEED
df = pd.read_parquet('shots_feat2.parquet')
df['type'] = df['type'].astype(str).replace('unknown', np.nan)
for c in CAT: df[c] = df[c].astype('category')
ne = df[(df.en == 0) & (df.season >= 2021)].sort_values(['dnum', 'game', 'so']).reset_index(drop=True)
def recal(p, W=35):
    day = pd.DataFrame({'d': ne.dnum.values, 'g': ne.goal.values, 'p': p}).groupby('d')[['g', 'p']].sum()
    c = np.log((day.g.rolling(W, min_periods=10).sum().shift(1) + 20) / (day.p.rolling(W, min_periods=10).sum().shift(1) + 20)).fillna(0)
    return 1 / (1 + np.exp(-(np.log(p / (1 - p)) + ne.dnum.map(c).values)))
ll = lambda y, q: -(y * np.log(np.clip(q, 1e-6, 1 - 1e-6)) + (1 - y) * np.log(1 - np.clip(q, 1e-6, 1 - 1e-6)))
rows = []
for test in [2025, 2026]:
    tr = ne[(ne.season >= test - 2) & (ne.season < test)]
    zs = []
    for seed in range(1, 6):
        m = lgb.train(dict(P, num_threads=4, seed=seed), lgb.Dataset(tr[V2], tr.goal), 1000); p = m.predict(ne[V2]); zs.append(np.log(p / (1 - p)))
        print(test, 'seed', seed, flush=True)
    one = recal(1 / (1 + np.exp(-zs[0]))); avg = recal(1 / (1 + np.exp(-np.mean(zs, 0))))
    x = ne.season == test
    rows.append(pd.DataFrame({'game': ne.game[x].values, 'e': ll(ne.goal[x].values, one[x.values]) - ll(ne.goal[x].values, avg[x.values]), 'season': test}))
    print(test, 'seed-1 logloss', round(ll(ne.goal[x].values, one[x.values]).mean(), 5), '5-seed', round(ll(ne.goal[x].values, avg[x.values]).mean(), 5), flush=True)
R = pd.concat(rows)
for lab, r in [('2025-26', R[R.season == 2025]), ('2026-27', R[R.season == 2026]), ('pooled', R)]:
    gs = r.groupby('game').e.agg(['sum', 'size']); s, n = gs['sum'].values, gs['size'].values
    idx = np.random.default_rng(6).integers(0, len(s), (2000, len(s))); bs = s[idx].sum(1) / n[idx].sum(1)
    print(lab, f"5 seeds vs 1: {s.sum() / n.sum() * 1e4:+.2f} [{np.percentile(bs, 2.5) * 1e4:+.2f}, {np.percentile(bs, 97.5) * 1e4:+.2f}]")
