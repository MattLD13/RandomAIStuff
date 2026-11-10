# The one-time sealed test. Reads prereg.json (written and fingerprinted BEFORE this runs), trains the registered
# model and the comparison models on every season before 2025-26, then scores 2025-26 once.
import sys, json, hashlib, pickle
import numpy as np, pandas as pd, lightgbm as lgb
from sklearn.metrics import log_loss, roc_auc_score, brier_score_loss
exec(open('common.py').read())
exec(open('rk.py').read())
reg_bytes = open('prereg.json', 'rb').read()
reg = json.loads(reg_bytes)
assert hashlib.sha256(reg_bytes).hexdigest() == open('prereg.sha256').read().split()[0], 'pre-registration changed after it was locked'
SEALED = 2025
df = pd.read_parquet('shots_feat2.parquet')
for c in CAT: df[c] = df[c].astype('category')
ne = df[df.en == 0].copy()
fit_on = ne[ne.season.isin(reg['train_seasons'])]
models = {}
for name, spec in reg['models'].items():
    p = dict(P, **reg.get('params', {}))
    m = lgb.train(p, lgb.Dataset(fit_on[spec['features']], fit_on.goal), spec['rounds'])
    models[name] = m
ne = ne.sort_values(['dnum', 'game', 'so'])
def recal(p, W=reg['calibration']['window_days']):
    day = pd.DataFrame({'d': ne.dnum.values, 'g': ne.goal.values, 'p': p}).groupby('d')[['g', 'p']].sum()
    c = np.log((day.g.rolling(W, min_periods=10).sum().shift(1) + 20) / (day.p.rolling(W, min_periods=10).sum().shift(1) + 20)).fillna(0)
    z = np.log(p / (1 - p)) + ne.dnum.map(c).values
    return 1 / (1 + np.exp(-z))
for name, spec in reg['models'].items():
    p = models[name].predict(ne[spec['features']])
    ne['p_' + name] = recal(p) if spec.get('calibrated') else p
ne['p_rinkside'] = recal(rk_fit_predict(fit_on, ne))
d = ne[ne.season == SEALED].copy()
# MoneyPuck, shot by shot
m = pd.read_csv('mp/shots_2025.csv', usecols=['season', 'game_id', 'time', 'shooterPlayerId', 'event', 'xGoal', 'isPlayoffGame'])
m = m[m.isPlayoffGame == 0]; m['game'] = (m.season * 1000000 + m.game_id).astype(int); m['t'] = m.time.astype(int)
m['shooter'] = m.shooterPlayerId.fillna(0).astype(int); m['mp_goal'] = (m.event == 'GOAL').astype(int)
m = m[['game', 't', 'shooter', 'xGoal', 'mp_goal']].drop_duplicates(['game', 't', 'shooter'], keep=False)
d['k'] = np.arange(len(d))
j = d[['k', 'game', 't', 'shooter', 'goal']].merge(m, on=['game', 't', 'shooter']); j = j[j.goal == j.mp_goal]
d['p_moneypuck'] = np.nan; d.iloc[j.k.values, d.columns.get_loc('p_moneypuck')] = j.xGoal.values
NEW = reg['new_stat']; ALLM = list(reg['models']) + ['rinkside', 'moneypuck']

def ll_terms(y, q): q = np.clip(q, 1e-6, 1 - 1e-6); return -(y * np.log(q) + (1 - y) * np.log(1 - q))
def boot(x, a, b, B=4000, seed=11):
    diff = ll_terms(x.goal.values, x['p_' + a].values) - ll_terms(x.goal.values, x['p_' + b].values)
    gs = pd.Series(diff).groupby(x.game.values).agg(['sum', 'size']); s, n = gs['sum'].values, gs['size'].values
    idx = np.random.default_rng(seed).integers(0, len(s), (B, len(s))); bs = s[idx].sum(1) / n[idx].sum(1)
    return dict(delta_x1e4=float(s.sum() / n.sum() * 1e4), lo=float(np.percentile(bs, 2.5) * 1e4), hi=float(np.percentile(bs, 97.5) * 1e4),
                share_of_resamples_new_better=float((bs > 0).mean()))
def metrics(x, p):
    y = x.goal.values; q = np.clip(x['p_' + p].values, 1e-6, 1 - 1e-6); o = np.argsort(q); bins = np.array_split(o, 20)
    return dict(n=len(y), goals=int(y.sum()), predicted=round(float(q.sum()), 1), logloss=float(log_loss(y, q)), brier=float(brier_score_loss(y, q)),
                auc=float(roc_auc_score(y, q)), skill=float(1 - log_loss(y, q) / log_loss(y, np.full_like(q, y.mean()))),
                calib_err=float(sum(len(b) * abs(y[b].mean() - q[b].mean()) for b in bins) / len(y)))
R = {}
both = d[d.p_moneypuck.notna()]
R['all unblocked shots MoneyPuck also has'] = {k: metrics(both, k) for k in ALLM}
R['shots on goal only'] = {k: metrics(both[both.ongoal == 1], k) for k in ALLM}
R['5v5 only'] = {k: metrics(both[(both.own == 5) & (both.opp == 5)], k) for k in ALLM}
R['paired bootstrap (log-loss x1e4, + = new stat better)'] = {f'{NEW} vs {k}': boot(both, k, NEW) for k in ALLM if k != NEW}
def players(x, key, mins):
    g = x.groupby(key); n = g.size(); keep = n[n >= mins].index; act = g.goal.sum()[keep]
    return {k: dict(rmse=float(np.sqrt(((act - g['p_' + k].sum()[keep]) ** 2).mean())), corr=float(np.corrcoef(act, g['p_' + k].sum()[keep])[0, 1])) for k in ALLM} | {'players': int(len(keep))}
R['shooters 60+ shots: season goals vs predicted'] = players(both, 'shooter', 60)
R['goalies 400+ shots: goals against vs predicted'] = players(both[both.goalie > 0], 'goalie', 400)
def halves(x, key, mins):
    x = x.copy(); x['h'] = x.groupby(key).game.rank(method='dense') % 2
    a, b = x[x.h == 1].groupby(key), x[x.h == 0].groupby(key)
    n = pd.concat([a.size(), b.size()], axis=1).min(axis=1); keep = n[n >= mins].index
    tgt = b.goal.sum()[keep] / b.size()[keep]
    return {'actual goals/shot (odd games)': float(np.corrcoef(a.goal.sum()[keep] / a.size()[keep], tgt)[0, 1])} | \
           {k: float(np.corrcoef(a['p_' + k].sum()[keep] / a.size()[keep], tgt)[0, 1]) for k in ALLM} | {'players': int(len(keep))}
R['split-half: odd-game prediction vs even-game goals/shot (shooters 40+ each half)'] = halves(both, 'shooter', 40)
q = d['p_' + NEW].values; y = d.goal.values; o = np.argsort(q)
R['_calibration'] = {k: [(float(d['p_' + k].values[b].mean()), float(y[b].mean())) for b in np.array_split(np.argsort(d['p_' + k].values), 15)] for k in [NEW, 'standard', 'rinkside']} | \
                    {'moneypuck': [(float(both.p_moneypuck.values[b].mean()), float(both.goal.values[b].mean())) for b in np.array_split(np.argsort(both.p_moneypuck.values), 15)]}
crit = {}
b = R['paired bootstrap (log-loss x1e4, + = new stat better)']
crit['1. beats MoneyPuck (95% CI above 0)'] = b[f'{NEW} vs moneypuck']['lo'] > 0
crit['2. beats standard xG (95% CI above 0)'] = b[f'{NEW} vs standard']['lo'] > 0
crit['3. beats current Rinkside xG (95% CI above 0)'] = b[f'{NEW} vs rinkside']['lo'] > 0
a = R['all unblocked shots MoneyPuck also has'][NEW]; crit['4. season total within 3% of actual goals'] = abs(a['predicted'] / a['goals'] - 1) <= 0.03
h = R['split-half: odd-game prediction vs even-game goals/shot (shooters 40+ each half)']
crit['5. split-half prediction >= MoneyPuck and standard'] = h[NEW] >= max(h['moneypuck'], h['standard'])
R['_criteria'] = crit
json.dump(R, open('results_sealed.json', 'w'), indent=1, default=bool)
print('\nPRE-REGISTERED CRITERIA'); [print(' ', 'PASS' if v else 'FAIL', k) for k, v in crit.items()]
d[['season', 'game', 'date', 't', 'team', 'shooter', 'goalie', 'goal', 'ongoal', 'dist', 'type'] + ['p_' + k for k in ALLM]].to_parquet('preds_sealed.parquet')
for name, r in R.items():
    if name.startswith('_'): continue
    print('\n==', name)
    for k, v in r.items(): print(f'  {k:<26}', v)
