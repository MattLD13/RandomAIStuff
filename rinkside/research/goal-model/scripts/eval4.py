# Round 2b (development seasons only): league-relative skill features + rolling calibration layer.
import sys, json, pickle
import numpy as np, pandas as pd, lightgbm as lgb
from sklearn.metrics import log_loss
exec(open('common.py').read())
exec(open('rk.py').read())
SEALED = 2025
df = pd.read_parquet('shots_feat2.parquet')
for c in CAT: df[c] = df[c].astype('category')
ne = df[df.en == 0].copy()
ne = ne.sort_values(['dnum', 'game', 'so'])
tr, va = ne[ne.season.isin(TRAIN)], ne[ne.season == 2024]
R_ = lambda cols: [c + '_rel' if c + '_rel' in df.columns else c for c in cols]
SHOOT_R, GOAL_R = R_(SHOOT), R_(GOAL)
CAND = {
    'standard': BASE,
    'strict(+speed)': BASE + SPEED,
    'skill': BASE + SHOOT_R + SPEED + GOAL_R,
    'skill+context': BASE + SHOOT_R + SPEED + GOAL_R + CTX,
    'all': BASE + SHOOT_R + SPEED + GOAL_R + CTX + MATES + MOM + TRAVEL + ARENA + FORM2 + REVENGE,
}
best = {}
for k, cols in CAND.items():
    m = lgb.train(P, lgb.Dataset(tr[cols], tr.goal), 4000, valid_sets=[lgb.Dataset(va[cols], va.goal)], callbacks=[lgb.early_stopping(150, verbose=False)])
    ne['p_' + k] = m.predict(ne[cols], num_iteration=m.best_iteration); best[k] = m.best_iteration; print(k, m.best_iteration, flush=True)
ne['p_rinkside'] = rk_fit_predict(tr, ne)
# rolling calibration: shift each day's log-odds by log(goals / predicted) over the previous 35 game days
def recal(p, W=35):
    day = pd.DataFrame({'d': ne.dnum.values, 'g': ne.goal.values, 'p': p}).groupby('d')[['g', 'p']].sum()
    c = np.log((day.g.rolling(W, min_periods=10).sum().shift(1) + 20) / (day.p.rolling(W, min_periods=10).sum().shift(1) + 20)).fillna(0)
    z = np.log(p / (1 - p)) + ne.dnum.map(c).values
    return 1 / (1 + np.exp(-z))
for k in list(CAND) + ['rinkside']: ne['p_' + k + '|cal'] = recal(ne['p_' + k].values)
mp = []
m = pd.read_csv('mp/shots_2024.csv', usecols=['season', 'game_id', 'time', 'shooterPlayerId', 'event', 'xGoal', 'isPlayoffGame'])
m = m[m.isPlayoffGame == 0]; m['game'] = (m.season * 1000000 + m.game_id).astype(int); m['t'] = m.time.astype(int)
m['shooter'] = m.shooterPlayerId.fillna(0).astype(int); m['mp_goal'] = (m.event == 'GOAL').astype(int)
m = m[['game', 't', 'shooter', 'xGoal', 'mp_goal']].drop_duplicates(['game', 't', 'shooter'], keep=False)
ne['k'] = np.arange(len(ne)); j = ne[['k', 'game', 't', 'shooter', 'goal']].merge(m, on=['game', 't', 'shooter']); j = j[j.goal == j.mp_goal]
ne['p_moneypuck'] = np.nan; ne.iloc[j.k.values, ne.columns.get_loc('p_moneypuck')] = j.xGoal.values

def ll_terms(y, q): q = np.clip(q, 1e-6, 1 - 1e-6); return -(y * np.log(q) + (1 - y) * np.log(1 - q))
def boot(d, a, b, B=2000):
    diff = ll_terms(d.goal.values, d['p_' + a].values) - ll_terms(d.goal.values, d['p_' + b].values)
    gs = pd.Series(diff).groupby(d.game.values).agg(['sum', 'size']); s, n = gs['sum'].values, gs['size'].values
    idx = np.random.default_rng(3).integers(0, len(s), (B, len(s))); bs = s[idx].sum(1) / n[idx].sum(1)
    return f"{s.sum() / n.sum() * 1e4:+6.2f} [{np.percentile(bs, 2.5) * 1e4:+6.2f}, {np.percentile(bs, 97.5) * 1e4:+6.2f}]"
names = [k for k in list(CAND) + ['rinkside']] + [k + '|cal' for k in list(CAND) + ['rinkside']]
out = {}
for title, d in [('2024-25 validation', ne[ne.season == 2024]), ('2026-27 dev', ne[ne.season == 2026]), ('2024-25 with MoneyPuck', ne[(ne.season == 2024) & ne.p_moneypuck.notna()])]:
    print('\n==', title)
    ks = names + (['moneypuck'] if 'Money' in title else [])
    for k in ks:
        q = np.clip(d['p_' + k].values, 1e-6, 1 - 1e-6)
        print(f"  {k:<22} logloss {log_loss(d.goal, q):.5f}  pred {q.sum():7.0f} / {d.goal.sum()}" + (f"   vs standard|cal {boot(d, 'standard|cal', k)}" if k != 'standard|cal' else ''))
json.dump(best, open('best_rounds.json', 'w'))
ne[ne.season != SEALED][['season', 'game', 'goal', 'shooter', 'goalie'] + ['p_' + k for k in names + ['moneypuck']]].to_parquet('preds4.parquet')
