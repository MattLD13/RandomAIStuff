# Train the candidate models on 2021-23, stop on 2024, and score every model on 2025-26 and 2026-27 (to date).
import json, sys, pickle
import numpy as np, pandas as pd, lightgbm as lgb
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import log_loss, roc_auc_score, brier_score_loss

exec(open('common.py').read())
df = pd.read_parquet('shots_feat.parquet')
for c in CAT: df[c] = df[c].astype('category')
ne = df[df.en == 0].copy()
tr, va = ne[ne.season.isin(TRAIN)], ne[ne.season.isin(VAL)]

def gbm(cols, params=P):
    m = lgb.train(params, lgb.Dataset(tr[cols], tr.goal, categorical_feature=[c for c in cols if c in CAT]), 4000,
                  valid_sets=[lgb.Dataset(va[cols], va.goal, reference=None)], callbacks=[lgb.early_stopping(150, verbose=False)])
    return m

# ---- Rinkside's current xG recipe (chances-core.mjs features, logistic), refitted on the same training shots ----
TYPES = ['snap', 'slap', 'backhand', 'tip-in', 'deflected', 'wrap-around']
def rk_X(d):
    fx = (89 - d.x).clip(lower=0.5); ay = d.y.abs()
    dd = np.hypot(89 - d.x, ay) / 10; ang = np.degrees(np.arctan2(ay, fx)) / 45
    cols = [dd, dd ** 2, ang, d.rebound, d.rush, d.pp, d.sh] + [(d.type.astype(str) == t).astype(int) for t in TYPES] + \
           [(~d.type.astype(str).isin(['wrist'] + TYPES)).astype(int)]
    return np.column_stack(cols)
lr = LogisticRegression(max_iter=2000, C=1e4).fit(rk_X(tr), tr.goal)

models = {}
FEATS = {
    'base': BASE,                                                            # location + context, no identities
    'base+shooter': BASE + SH,
    'base+goalie': BASE + GL,
    'full-no-form': BASE + [c for c in SH + GL if c not in FORM],            # talent, but no streaks / recent form
    'full': BASE + SH + GL,                                                  # the new stat
}
for k, cols in FEATS.items():
    models[k] = gbm(cols); print(k, models[k].best_iteration, file=sys.stderr)

pred = {}
for k, cols in FEATS.items(): ne['p_' + k] = models[k].predict(ne[cols], num_iteration=models[k].best_iteration)
ne['p_rinkside'] = lr.predict_proba(rk_X(ne))[:, 1]

# ---- MoneyPuck xG, joined shot by shot ----
mp = []
for y in [2024, 2025]:
    m = pd.read_csv(f'mp/shots_{y}.csv', usecols=['season', 'game_id', 'period', 'time', 'shooterPlayerId', 'event', 'xGoal', 'isPlayoffGame', 'shotOnEmptyNet'])
    m = m[(m.isPlayoffGame == 0)]
    m['game'] = (m.season * 1000000 + m.game_id).astype(int); m['t'] = m.time.astype(int); m['shooter'] = m.shooterPlayerId.fillna(0).astype(int)
    m['mp_goal'] = (m.event == 'GOAL').astype(int)
    mp.append(m[['game', 't', 'shooter', 'xGoal', 'mp_goal']])
mp = pd.concat(mp).drop_duplicates(['game', 't', 'shooter'], keep=False)
ne['k'] = np.arange(len(ne))
j = ne[['k', 'game', 't', 'shooter', 'goal']].merge(mp, on=['game', 't', 'shooter'], how='inner')
j = j[j.goal == j.mp_goal]
ne['p_moneypuck'] = np.nan
ne.loc[ne.index[j.k.values], 'p_moneypuck'] = j.xGoal.values

def metrics(d, p):
    y = d.goal.values; q = np.clip(d[p].values, 1e-6, 1 - 1e-6)
    base = np.full_like(q, y.mean())
    # calibration: mean |observed - predicted| over 20 equal-count bins, weighted
    o = np.argsort(q); bins = np.array_split(o, 20)
    ece = sum(len(b) * abs(y[b].mean() - q[b].mean()) for b in bins) / len(y)
    return dict(n=len(y), goals=int(y.sum()), pred=round(float(q.sum()), 1), logloss=log_loss(y, q), brier=brier_score_loss(y, q), auc=roc_auc_score(y, q),
                skill=1 - log_loss(y, q) / log_loss(y, base), ece=ece)

R = {}
MODELS = ['rinkside', 'base', 'base+shooter', 'base+goalie', 'full-no-form', 'full']
for name, d in [('2025-26 (test)', ne[ne.season == 2025]), ('2026-27 to date (test)', ne[ne.season == 2026]),
                ('2024-25 (validation)', ne[ne.season == 2024])]:
    R[name] = {m: metrics(d, 'p_' + m) for m in MODELS}
for name, d in [('2025-26, shots MoneyPuck also has', ne[(ne.season == 2025) & ne.p_moneypuck.notna()]),
                ('2024-25, shots MoneyPuck also has', ne[(ne.season == 2024) & ne.p_moneypuck.notna()])]:
    R[name] = {m: metrics(d, 'p_' + m) for m in MODELS + ['moneypuck']}
# shots on goal only (what a goalie actually has to stop)
d = ne[(ne.season == 2025) & (ne.ongoal == 1) & ne.p_moneypuck.notna()]
R['2025-26, shots on goal only'] = {m: metrics(d, 'p_' + m) for m in MODELS + ['moneypuck']}

# ---- player level: does each model's season expected goals match what players actually scored? ----
def player_err(d, key, minshots):
    out = {}
    g = d.groupby(key)
    n = g.size(); keep = n[n >= minshots].index
    act = g.goal.sum()[keep]
    for m in MODELS + ['moneypuck']:
        e = g['p_' + m].sum()[keep]
        out[m] = dict(rmse=float(np.sqrt(((act - e) ** 2).mean())), mae=float((act - e).abs().mean()), corr=float(np.corrcoef(act, e)[0, 1]), players=int(len(keep)))
    return out
d25 = ne[(ne.season == 2025) & ne.p_moneypuck.notna()]
R['shooters 2025-26 (60+ shots): season goals vs predicted'] = player_err(d25, 'shooter', 60)
R['goalies 2025-26 (400+ shots): goals against vs predicted'] = player_err(d25[d25.goalie > 0], 'goalie', 400)

# ---- split halves: does a player's first-half xG predict his second-half goals? ----
def halves(d, key, minshots):
    d = d.copy(); d['half'] = (d.groupby(key).game.rank(method='dense') % 2)
    a = d[d.half == 1].groupby(key); b = d[d.half == 0].groupby(key)
    n = pd.concat([a.size(), b.size()], axis=1).min(axis=1); keep = n[n >= minshots].index
    gb = b.goal.sum()[keep]; nb = b.size()[keep]; na = a.size()[keep]
    out = {'goals (first half)': float(np.corrcoef(a.goal.sum()[keep] / na, gb / nb)[0, 1])}
    for m in MODELS + ['moneypuck']:
        out[m] = float(np.corrcoef(a['p_' + m].sum()[keep] / na, gb / nb)[0, 1])
    out['players'] = int(len(keep))
    return out
R['split-half 2025-26: per-shot goal rate in odd games vs per-shot expected in even games (shooters 40+ each half)'] = halves(d25, 'shooter', 40)

# calibration table for the report
cal = {}
d = ne[ne.season == 2025]
for m in ['rinkside', 'base', 'full']:
    q = d['p_' + m].values; y = d.goal.values; o = np.argsort(q); bins = np.array_split(o, 15)
    cal[m] = [(float(q[b].mean()), float(y[b].mean())) for b in bins]
R['_calibration_2025'] = cal
imp = models['full'].feature_importance('gain'); names = models['full'].feature_name()
R['_importance_full'] = sorted([(n, float(v)) for n, v in zip(names, imp / imp.sum())], key=lambda t: -t[1])
json.dump(R, open('results.json', 'w'), indent=1)
pickle.dump({k: m.model_to_string() for k, m in models.items()}, open('models.pkl', 'wb'))
ne[['season', 'game', 'date', 't', 'team', 'shooter', 'goalie', 'goal', 'ongoal', 'dist', 'type'] + ['p_' + m for m in MODELS + ['moneypuck']]].to_parquet('preds.parquet')

for name, r in R.items():
    if name.startswith('_'): continue
    print('\n==', name)
    for m, v in r.items():
        print(f'  {m:<22}', '  '.join(f'{k}={v[k]:.4f}' if isinstance(v[k], float) else f'{k}={v[k]}' for k in v) if isinstance(v, dict) else f'{v}')
print('\ntop features:', [(n, round(v, 3)) for n, v in R['_importance_full'][:25]])
