# Shared harness for fable2 experiments. Mirrors scratchpad/v2/eval7.py (same row set, ordering, recal, ll, boot).
import os, sys, json, time
import numpy as np, pandas as pd, lightgbm as lgb
HERE = os.path.dirname(os.path.abspath(__file__)); V2DIR = os.path.join(HERE, '..', 'v2')
exec(open(os.path.join(V2DIR, 'common.py')).read())
V2 = BASE + CTX + CHANGE + SPEED
NT = 3
def load(extra=()):
    cols = list(dict.fromkeys(V2 + PLACEBO + ['season', 'game', 'date', 'so', 'dnum', 'goal', 'en', 'pp', 'sh', 'shooter', 'goalie', 'team', 'miss_reason', 'ongoal'] + list(extra)))
    df = pd.read_parquet(os.path.join(V2DIR, 'shots_feat2.parquet'), columns=cols)
    for c in CAT:
        if c in df: df[c] = df[c].astype('category')
    ne = df[(df.en == 0) & (df.season >= 2021)].sort_values(['dnum', 'game', 'so']).reset_index(drop=True)
    return ne
def recal(ne, p, W=35, k=20):
    day = pd.DataFrame({'d': ne.dnum.values, 'g': ne.goal.values, 'p': p}).groupby('d')[['g', 'p']].sum()
    c = np.log((day.g.rolling(W, min_periods=10).sum().shift(1) + k) / (day.p.rolling(W, min_periods=10).sum().shift(1) + k)).fillna(0)
    return 1 / (1 + np.exp(-(np.log(p / (1 - p)) + ne.dnum.map(c).values)))
def ll(y, q): q = np.clip(q, 1e-6, 1 - 1e-6); return -(y * np.log(q) + (1 - y) * np.log(1 - q))
def boot_(d, a, b, B=2000):
    e = ll(d.goal.values, d[a].values) - ll(d.goal.values, d[b].values)
    gs = pd.Series(e).groupby(d.game.values).agg(['sum', 'size']); s, n = gs['sum'].values, gs['size'].values
    idx = np.random.default_rng(6).integers(0, len(s), (B, len(s))); bs = s[idx].sum(1) / n[idx].sum(1)
    return s.sum() / n.sum() * 1e4, np.percentile(bs, 2.5) * 1e4, np.percentile(bs, 97.5) * 1e4
def fit(tr, cols, params=None, rounds=1000, weight=None, seed=1):
    return lgb.train(dict(P, num_threads=NT, seed=seed, **(params or {})), lgb.Dataset(tr[cols], tr.goal, weight=weight), rounds)
def season_fit(ne, test, cols=None, params=None, rounds=1000, seed=1):
    cols = cols or V2; tr = ne[(ne.season >= test - 2) & (ne.season < test)]
    return fit(tr, cols, params, rounds, seed=seed).predict(ne[cols], num_threads=NT)
def refit_starts(ne, test, every='M'):
    d = pd.to_datetime(ne.date[ne.season == test])
    if every == 'M': return sorted(set(pd.Timestamp(y, m, 1).toordinal() for y, m in zip(d.dt.year, d.dt.month)))
    a, b = int(ne.dnum[ne.season == test].min()), int(ne.dnum[ne.season == test].max())
    return list(range(a, b + 1, int(every)))
def refit(ne, test, cols=None, every='M', window=730, halflife=None, cur_w=None, params=None, rounds=1000, seed=1, log=None):
    """Refit at each start date on the previous `window` days (strictly before the start). Returns raw p for all rows:
    test-season rows from the model in force; earlier rows from the first model (in-sample, as v2's season fit does)."""
    cols = cols or V2; p = np.full(len(ne), np.nan); st = refit_starts(ne, test, every); dn = ne.dnum.values
    for i, a in enumerate(st):
        b = st[i + 1] if i + 1 < len(st) else 10 ** 9
        trm = (dn < a) & (dn >= a - window); tr = ne[trm]
        w = 0.5 ** ((a - tr.dnum.values) / halflife) if halflife else None
        if cur_w: w = np.where(tr.season.values == test, cur_w, 1.0)   # up-weight shots from the season being predicted
        mask = (dn >= a) & (dn < b) & (ne.season.values == test)
        if i == 0: mask = mask | (dn < a)
        if not mask.any(): continue        # no games in this refit period (e.g. a break)
        m = fit(tr, cols, params, rounds, weight=w, seed=seed)
        p[mask] = m.predict(ne.loc[mask, cols], num_threads=NT)
        if log: print(log, test, a, int(trm.sum()), int(mask.sum()), time.strftime('%H:%M:%S'), flush=True)
    return p
def save(name, test, p): np.save(os.path.join(HERE, 'preds', f'{name}_{test}.npy'), p.astype(np.float64))
def have(name, test): return os.path.exists(os.path.join(HERE, 'preds', f'{name}_{test}.npy'))
def get(name, test): return np.load(os.path.join(HERE, 'preds', f'{name}_{test}.npy'))
FOLDS = [2024, 2025, 2026]
def report(ne, Q, ref='v2', out=None):
    """Q: dict name -> dict test -> calibrated prob array (full length). Prints per-fold + pooled gains vs ref."""
    T = ne[['season', 'game', 'goal']].copy(); rows = {}
    for k in Q:
        q = np.full(len(ne), np.nan)
        for s in FOLDS: m = (ne.season == s).values; q[m] = Q[k][s][m]
        T['q_' + k] = q
    parts = [('2024', T[T.season == 2024]), ('2025', T[T.season == 2025]), ('2026', T[T.season == 2026]), ('pool', T[T.season.isin([2025, 2026])])]
    print(f"{'name':<34}" + ''.join(f"{t:>26}" for t, _ in parts))
    for k in Q:
        s = f'{k:<34}'; rows[k] = {}
        for t, x in parts:
            if k == ref: s += f"{ll(x.goal.values, x['q_' + k].values).mean():>26.5f}"; rows[k][t] = float(ll(x.goal.values, x['q_' + k].values).mean())
            else:
                g, lo, hi = boot_(x, 'q_' + ref, 'q_' + k); s += f"{g:>+9.2f} [{lo:+6.2f},{hi:+6.2f}]"; rows[k][t] = [round(g, 2), round(lo, 2), round(hi, 2)]
        print(s, flush=True)
    if out: json.dump(rows, open(os.path.join(HERE, out), 'w'), indent=1)
    return rows
