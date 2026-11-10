# Round 2: which feature groups really help? Leave-one-group-out, game-level bootstrap, Holm correction, placebo control.
# Development seasons only (2024-25 validation, 2026-27 to date). The sealed season 2025-26 is never scored here.
import sys, json, pickle
import numpy as np, pandas as pd, lightgbm as lgb
from sklearn.metrics import log_loss
exec(open('common.py').read())
SEALED = 2025
df = pd.read_parquet('shots_feat2.parquet')
for c in CAT: df[c] = df[c].astype('category')
ne = df[(df.en == 0) & (df.season != SEALED)].copy()
tr, va = ne[ne.season.isin(TRAIN)], ne[ne.season == 2024]
ALL = BASE + [c for g in GROUPS.values() for c in g]
FEATS = {'standard': BASE, 'all': ALL}
for gname, cols in GROUPS.items(): FEATS['-' + gname] = [c for c in ALL if c not in cols]
models = {}
for k, cols in FEATS.items():
    m = lgb.train(P, lgb.Dataset(tr[cols], tr.goal), 4000, valid_sets=[lgb.Dataset(va[cols], va.goal)], callbacks=[lgb.early_stopping(150, verbose=False)])
    models[k] = m; ne['p_' + k] = m.predict(ne[cols], num_iteration=m.best_iteration)
    print(k, m.best_iteration, flush=True)
# rinkside current recipe for reference
exec(open('rk.py').read())
ne['p_rinkside'] = rk_fit_predict(tr, ne)

def ll_terms(y, q): q = np.clip(q, 1e-6, 1 - 1e-6); return -(y * np.log(q) + (1 - y) * np.log(1 - q))
def boot(d, a, b, B=2000, seed=7):
    """mean log-loss difference (a - b) per shot, 95% CI from resampling whole games"""
    diff = ll_terms(d.goal.values, d['p_' + a].values) - ll_terms(d.goal.values, d['p_' + b].values)
    gsum = pd.Series(diff).groupby(d.game.values).agg(['sum', 'size'])
    s, n = gsum['sum'].values, gsum['size'].values
    rng = np.random.default_rng(seed); idx = rng.integers(0, len(s), (B, len(s)))
    bs = s[idx].sum(1) / n[idx].sum(1)
    est = s.sum() / n.sum()
    p = 2 * min((bs <= 0).mean(), (bs >= 0).mean())
    return est, np.percentile(bs, 2.5), np.percentile(bs, 97.5), max(p, 1 / B)

R = {}
for name, d in [('2024-25 validation', ne[ne.season == 2024]), ('2026-27 dev', ne[ne.season == 2026])]:
    r = {}
    base_ll = log_loss(d.goal, np.full(len(d), d.goal.mean()))
    for k in ['rinkside'] + list(FEATS):
        q = np.clip(d['p_' + k].values, 1e-6, 1 - 1e-6)
        r[k] = dict(logloss=float(log_loss(d.goal, q)), skill=float(1 - log_loss(d.goal, q) / base_ll), pred=float(q.sum()), goals=int(d.goal.sum()))
    # value of each group = how much worse the model gets without it (positive = the group helps)
    tests = {}
    for gname in GROUPS:
        est, lo, hi, p = boot(d, '-' + gname, 'all')
        tests[gname] = dict(delta=est * 1e4, lo=lo * 1e4, hi=hi * 1e4, p=p)     # in 1/10000 log-loss units
    est, lo, hi, p = boot(d, 'standard', 'all'); tests['ALL vs standard'] = dict(delta=est * 1e4, lo=lo * 1e4, hi=hi * 1e4, p=p)
    est, lo, hi, p = boot(d, 'rinkside', 'all'); tests['ALL vs rinkside'] = dict(delta=est * 1e4, lo=lo * 1e4, hi=hi * 1e4, p=p)
    R[name] = dict(models=r, tests=tests)
# Holm correction across the groups, per season
for name in R:
    t = R[name]['tests']; gs = sorted(GROUPS, key=lambda g: t[g]['p'])
    for i, g in enumerate(gs): t[g]['p_holm'] = min(1.0, max(t[h]['p'] * (len(gs) - j) for j, h in enumerate(gs[:i + 1])))
json.dump(R, open('results3.json', 'w'), indent=1)
pickle.dump({k: (FEATS[k], m.model_to_string(), m.best_iteration) for k, m in models.items()}, open('models3.pkl', 'wb'))
for name, r in R.items():
    print('\n==', name)
    for k, v in r['models'].items(): print(f"  {k:<14} logloss {v['logloss']:.5f}  skill {v['skill']:.4f}  pred {v['pred']:.0f} / {v['goals']}")
    print('  group value (log-loss x1e4 lost when removed; + = helps)')
    for g, v in r['tests'].items(): print(f"  {g:<16} {v['delta']:+7.2f}  [{v['lo']:+7.2f}, {v['hi']:+7.2f}]  p={v['p']:.4f}  holm={v.get('p_holm', float('nan')):.4f}")
