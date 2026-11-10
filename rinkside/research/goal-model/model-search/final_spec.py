# SGP v2.1 (candidate): SGP v2's inputs and LightGBM settings, unchanged, but
#   (1) 5 models with seeds 1-5, averaged in log-odds                      [pre-planned; passes the keep rule on its own]
#   (2) refit on the 1st of every month on the previous 730 days           [the README's earlier lead; see report for caveats]
# then v2's rolling calibration (35 game days, +20 prior, current day excluded).
#
#   python3 final_spec.py                 # (1)+(2), rolling origin, three folds; reuses cached raw predictions in preds/
#   python3 final_spec.py --season-fit    # (1) only: one fit per season on the two previous seasons, 5 seeds
#   python3 final_spec.py --fresh         # refit everything, ignore and don't write the cache (about 20 min on 3 threads)
#
# Protocol: each test season (2024-25, 2025-26, 2026-27) is predicted only from earlier data. With monthly refits, the model
# fitted at month start a (day ordinal) trains on shots with a-730 <= day < a and predicts that calendar month's games.
# Reference = SGP v2 (one fit per season on the two previous seasons, seed 1), same calibration.
import os, sys, json
import numpy as np, pandas as pd, lightgbm as lgb
HERE = os.path.dirname(os.path.abspath(__file__)); V2DIR = os.path.join(HERE, '..', 'v2')
exec(open(os.path.join(V2DIR, 'common.py')).read())
FEATURES = BASE + CTX + CHANGE + SPEED                      # = SGP v2 inputs (46)
PARAMS = dict(P, num_threads=3)                              # 15 leaves, lr 0.03, min_data_in_leaf 300, ff 0.9, bagging 0.8, l2 10
ROUNDS, WINDOW, SEEDS, CAL_W, CAL_K = 1000, 730, [1, 2, 3, 4, 5], 35, 20
FOLDS = [2024, 2025, 2026]; FRESH = '--fresh' in sys.argv; SEASON_FIT = '--season-fit' in sys.argv
df = pd.read_parquet(os.path.join(V2DIR, 'shots_feat2.parquet'), columns=list(dict.fromkeys(FEATURES + ['season', 'game', 'date', 'so', 'dnum', 'goal', 'en'])))
for c in CAT:
    if c in df: df[c] = df[c].astype('category')
ne = df[(df.en == 0) & (df.season >= 2021)].sort_values(['dnum', 'game', 'so']).reset_index(drop=True)
dn = ne.dnum.values; lo = lambda p: np.log(p / (1 - p)); sg = lambda z: 1 / (1 + np.exp(-z))
def recal(p, W=CAL_W, k=CAL_K):
    day = pd.DataFrame({'d': dn, 'g': ne.goal.values, 'p': p}).groupby('d')[['g', 'p']].sum()
    c = np.log((day.g.rolling(W, min_periods=10).sum().shift(1) + k) / (day.p.rolling(W, min_periods=10).sum().shift(1) + k)).fillna(0)
    return sg(lo(p) + ne.dnum.map(c).values)
def cache(name, test, f):
    fn = os.path.join(HERE, 'preds', f'{name}_{test}.npy')
    if not FRESH and os.path.exists(fn): return np.load(fn)
    p = f()
    if not FRESH: os.makedirs(os.path.dirname(fn), exist_ok=True); np.save(fn, p)
    return p
def v2_raw(test, seed=1):
    tr = ne[(ne.season >= test - 2) & (ne.season < test)]
    return lgb.train(dict(PARAMS, seed=seed), lgb.Dataset(tr[FEATURES], tr.goal), ROUNDS).predict(ne[FEATURES], num_threads=3)
def refit_raw(test, seed):
    """raw probabilities: test-season rows from the model in force on that day; earlier rows from the season's first model
    (only used to start the rolling calibration, exactly as v2's season fit does)"""
    p = np.full(len(ne), np.nan); seas = ne.season.values == test; d = pd.to_datetime(ne.date[seas])
    starts = sorted(set(pd.Timestamp(y, mo, 1).toordinal() for y, mo in zip(d.dt.year, d.dt.month)))
    for i, a in enumerate(starts):
        b = starts[i + 1] if i + 1 < len(starts) else 10 ** 9
        mask = seas & (dn >= a) & (dn < b)
        if i == 0: mask = mask | (dn < a)
        tr = ne[(dn < a) & (dn >= a - WINDOW)]
        m = lgb.train(dict(PARAMS, seed=seed), lgb.Dataset(tr[FEATURES], tr.goal), ROUNDS)
        p[mask] = m.predict(ne.loc[mask, FEATURES], num_threads=3)
        print(f'  fold {test} seed {seed} refit {pd.Timestamp.fromordinal(a).date()}: {len(tr)} training shots, {int((mask & seas).sum())} predicted', flush=True)
    return p
def ll(y, q): q = np.clip(q, 1e-6, 1 - 1e-6); return -(y * np.log(q) + (1 - y) * np.log(1 - q))
def boot(d, a, b, B=2000):
    e = ll(d.goal.values, d[a].values) - ll(d.goal.values, d[b].values)
    gs = pd.Series(e).groupby(d.game.values).agg(['sum', 'size']); s, n = gs['sum'].values, gs['size'].values
    idx = np.random.default_rng(6).integers(0, len(s), (B, len(s))); bs = s[idx].sum(1) / n[idx].sum(1)
    return s.sum() / n.sum() * 1e4, np.percentile(bs, 2.5) * 1e4, np.percentile(bs, 97.5) * 1e4
T = ne[['season', 'game', 'goal']].copy(); T['q_v2'] = np.nan; T['q_new'] = np.nan
for test in FOLDS:
    m = (ne.season == test).values
    T.loc[m, 'q_v2'] = recal(cache('v2', test, lambda: v2_raw(test)))[m]
    z = np.mean([lo(cache(('v2' if SEASON_FIT else 'm730') + ('' if s == 1 else f'_s{s}'), test, (lambda: v2_raw(test, s)) if SEASON_FIT else (lambda: refit_raw(test, s)))) for s in SEEDS], axis=0)
    T.loc[m, 'q_new'] = recal(sg(z))[m]
out = {}
for title, x in [('2024-25', T[T.season == 2024]), ('2025-26', T[T.season == 2025]), ('2026-27', T[T.season == 2026]), ('pooled 2025-26 + 2026-27', T[T.season.isin([2025, 2026])])]:
    g, l, h = boot(x, 'q_v2', 'q_new'); a, b = ll(x.goal.values, x.q_v2.values).mean(), ll(x.goal.values, x.q_new.values).mean()
    print(f'{title:<26} shots {len(x):>7}  v2 {a:.5f}  new {b:.5f}  gain x1e4 {g:+6.2f} [{l:+6.2f}, {h:+6.2f}]'); out[title] = dict(n=len(x), v2=a, new=b, gain=g, lo=l, hi=h)
json.dump(out, open(os.path.join(HERE, 'final_spec_result' + ('_seasonfit' if SEASON_FIT else '') + ('_fresh' if FRESH else '') + '.json'), 'w'), indent=1)
T.assign(dnum=dn, so=ne.so.values)[T.season >= 2024].to_parquet(os.path.join(HERE, 'final_spec_preds' + ('_seasonfit' if SEASON_FIT else '') + ('_fresh' if FRESH else '') + '.parquet'))
