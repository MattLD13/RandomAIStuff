# "Chances tonight" development run: 2021-23 train, 2024-25 early stopping + validation, 2026-27 dev test.
# 2025-26 is sealed for this model and never scored here.
#   python3 chances_eval.py           development
#   python3 chances_eval.py --unseal  one-time sealed test (reads chances_prereg.json, checks its fingerprint)
import sys, json, hashlib
import numpy as np, pandas as pd, lightgbm as lgb
from sklearn.linear_model import Ridge
SEALED = 2025; UNSEAL = '--unseal' in sys.argv
d = pd.read_parquet('teamgames.parquet').sort_values(['dnum', 'game'])
d = d[d.season >= 2021]
G = dict(form=['o_xgf', 'o_ff', 'o_hd', 'o_xga', 'o_gf', 'd_xga', 'd_fa', 'd_hda', 'd_xgf', 'd_ga'],
         season=['o_season_xgf', 'd_season_xga'], strength=['o_pts', 'd_pts'],
         lineup=['lu_xgf60', 'lu_xga60', 'lu_n', 'ol_xgf60', 'ol_xga60', 'ol_n'],
         travel=['rest', 'b2b', 'travel_km', 'tz', 'opp_rest', 'opp_b2b', 'opp_travel_km', 'opp_tz'],
         home=['is_home'], placebo=['placebo1', 'placebo2'])
ALL = [c for v in G.values() for c in v]
TARGETS = {'y_xgf': 'regression', 'y_ff': 'poisson', 'y_hd': 'poisson', 'y_gf': 'poisson'}
PRM = dict(learning_rate=0.02, num_leaves=7, min_data_in_leaf=200, feature_fraction=0.8, bagging_fraction=0.8, bagging_freq=1, lambda_l2=10, verbose=-1, seed=1, num_threads=2)
if UNSEAL:
    b = open('chances_prereg.json', 'rb').read(); assert hashlib.sha256(b).hexdigest() == open('chances_prereg.sha256').read().split()[0]
    REG = json.loads(b)
tr = d[d.season.isin([2021, 2022, 2023])]; va = d[d.season == 2024]
def fitpred(cols, y, obj, rounds=None, fit_on=None):
    fit_on = tr if fit_on is None else fit_on
    p = dict(PRM, objective=obj)
    if rounds is None:
        m = lgb.train(p, lgb.Dataset(fit_on[cols], fit_on[y]), 5000, valid_sets=[lgb.Dataset(va[cols], va[y])], callbacks=[lgb.early_stopping(200, verbose=False)])
        return m.predict(d[cols], num_iteration=m.best_iteration), m.best_iteration
    m = lgb.train(p, lgb.Dataset(fit_on[cols], fit_on[y]), rounds); return m.predict(d[cols]), rounds
def matchup(y):
    # simple baseline: average of the team's recent offense and the opponent's recent defense, plus the home edge in training
    key = {'y_xgf': ('o_xgf', 'd_xga'), 'y_ff': ('o_ff', 'd_fa'), 'y_hd': ('o_hd', 'd_hda'), 'y_gf': ('o_gf', 'd_ga')}[y]
    base = (d[key[0]] + d[key[1]]) / 2
    lm = tr[y].mean(); base = base.fillna(lm)
    h = tr.groupby('is_home')[y].mean(); return base + d.is_home.map(h - lm).values
def boot(sub, a, b, B=2000):
    e = (sub[a] - sub.y) ** 2 - (sub[b] - sub.y) ** 2
    gs = e.groupby(sub.game.values).agg(['sum', 'size']); s, n = gs['sum'].values, gs['size'].values
    idx = np.random.default_rng(8).integers(0, len(s), (B, len(s))); bs = s[idx].sum(1) / n[idx].sum(1)
    return float(s.sum() / n.sum()), float(np.percentile(bs, 2.5)), float(np.percentile(bs, 97.5)), max(float(2 * min((bs <= 0).mean(), (bs >= 0).mean())), 1 / B)
R = {}
for y, obj in TARGETS.items():
    P_ = {}
    lm_mean = tr[y].mean()
    P_['league_avg'] = np.full(len(d), lm_mean)
    P_['matchup'] = matchup(y).values
    rc = ['o_xgf', 'd_xga', 'o_ff', 'd_fa', 'is_home']; rr = Ridge(1.0).fit(tr[rc].fillna(tr[rc].mean()), tr[y]); P_['linear'] = rr.predict(d[rc].fillna(tr[rc].mean()))
    rounds = {}
    if not UNSEAL:
        P_['model_all'], rounds['all'] = fitpred(ALL, y, obj)
        for g, cols in G.items(): P_['-' + g], rounds['-' + g] = fitpred([c for c in ALL if c not in cols], y, obj)
        evals = [('2024-25 validation', d.season == 2024), ('2026-27 dev', d.season == 2026)]
    else:
        spec = REG['targets'][y]; fit_all = d[d.season.isin([2021, 2022, 2023, 2024])]
        rr = Ridge(1.0).fit(fit_all[rc].fillna(fit_all[rc].mean()), fit_all[y]); P_['linear'] = rr.predict(d[rc].fillna(fit_all[rc].mean()))
        P_['model'], _ = fitpred(spec['features'], y, obj, rounds=spec['rounds'], fit_on=fit_all)
        for alt in ('no_lineup', 'no_travel'):
            P_[alt], _ = fitpred(spec[alt]['features'], y, obj, rounds=spec[alt]['rounds'], fit_on=fit_all)
        evals = [('SEALED 2025-26', d.season == SEALED)]
    R[y] = {'rounds': rounds}
    for title, mask in evals:
        sub = d.loc[mask, ['game', y]].rename(columns={y: 'y'}).copy()
        for k, v in P_.items(): sub[k] = v[mask.values]
        var = sub.y.var()
        r = {k: dict(rmse=float(np.sqrt(((sub[k] - sub.y) ** 2).mean())), r2=float(1 - ((sub[k] - sub.y) ** 2).mean() / var)) for k in P_}
        best = 'model' if UNSEAL else 'model_all'
        tests = {f'{best} vs {k}': boot(sub, k, best) for k in ['league_avg', 'matchup', 'linear']}
        if not UNSEAL:
            for g in G: tests['group ' + g] = boot(sub, '-' + g, 'model_all')
        else:
            tests['H: lineup helps'] = boot(sub, 'no_lineup', 'model'); tests['H: travel/rest helps'] = boot(sub, 'no_travel', 'model')
        R[y][title] = dict(models=r, tests=tests)
        print(f'\n== {y}  {title}  (n={len(sub)}, sd={np.sqrt(var):.3f})')
        for k, v in r.items(): print(f"  {k:<12} RMSE {v['rmse']:.4f}  R2 {v['r2']:+.4f}")
        for k, (e, lo, hi, p) in tests.items(): print(f"  {k:<24} MSE gain {e:+.5f} [{lo:+.5f}, {hi:+.5f}] p={p:.4f}")
json.dump(R, open('chances_sealed.json' if UNSEAL else 'chances_dev.json', 'w'), indent=1)
