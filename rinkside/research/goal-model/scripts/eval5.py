# Goalie upgrade: does more goalie data help, and does it close the goalie-total gap to MoneyPuck?
# Train 2021-23, early-stop on 2024-25; score 2024-25, 2025-26 (opened once already) and 2026-27 to date.
# Keep rule (fixed before running): removing a group must hurt pooled over the three seasons, game-level bootstrap
# interval above 0 after Holm correction, more than the placebo group; and goalie-total RMSE must not get worse.
import json, sys
import numpy as np, pandas as pd, lightgbm as lgb
from sklearn.metrics import log_loss
exec(open('common.py').read())
reg = json.load(open('prereg.json'))
SGP = reg['models']['new_stat']['features']
GNEW = dict(g_career=['gc_career', 'gc_career_shots', 'gc_last'], g_edge=['ge_sv5', 'ge_close', 'ge_hd', 'ge_md', 'ge_ld'],
            g_side=['g_glove_side', 'g_sv_side_rel'], g_type=['g_sv_type2_rel'], g_rebound=['g_reb_rate'],
            g_workload=['g_starts7', 'g_consec'], g_height=['g_height'], placebo=PLACEBO)
df = pd.read_parquet('shots_feat2.parquet')
for c in CAT: df[c] = df[c].astype('category')
ne = df[df.en == 0].sort_values(['dnum', 'game', 'so']).copy()
tr, va = ne[ne.season.isin(TRAIN)], ne[ne.season == 2024]
ALLG = SGP + [c for v in GNEW.values() for c in v]
FE = {'sgp': SGP, 'sgp+goalie': ALLG}
for k, v in GNEW.items(): FE['-' + k] = [c for c in ALLG if c not in v]
def recal(p, W=35):
    day = pd.DataFrame({'d': ne.dnum.values, 'g': ne.goal.values, 'p': p}).groupby('d')[['g', 'p']].sum()
    c = np.log((day.g.rolling(W, min_periods=10).sum().shift(1) + 20) / (day.p.rolling(W, min_periods=10).sum().shift(1) + 20)).fillna(0)
    z = np.log(p / (1 - p)) + ne.dnum.map(c).values
    return 1 / (1 + np.exp(-z))
rounds = {}
for k, cols in FE.items():
    m = lgb.train(P, lgb.Dataset(tr[cols], tr.goal), 4000, valid_sets=[lgb.Dataset(va[cols], va.goal)], callbacks=[lgb.early_stopping(150, verbose=False)])
    ne['p_' + k] = recal(m.predict(ne[cols], num_iteration=m.best_iteration)); rounds[k] = m.best_iteration; print(k, m.best_iteration, flush=True)
mps = []
for y in [2024, 2025, 2026]:
    m = pd.read_csv(f'mp/shots_{y}.csv', usecols=['season', 'game_id', 'time', 'shooterPlayerId', 'event', 'xGoal', 'isPlayoffGame'])
    m = m[m.isPlayoffGame == 0]; m['game'] = (m.season * 1000000 + m.game_id).astype(int); m['t'] = m.time.astype(int)
    m['shooter'] = m.shooterPlayerId.fillna(0).astype(int); m['mp_goal'] = (m.event == 'GOAL').astype(int); mps.append(m[['game', 't', 'shooter', 'xGoal', 'mp_goal']])
mp = pd.concat(mps).drop_duplicates(['game', 't', 'shooter'], keep=False)
ne['k'] = np.arange(len(ne)); j = ne[['k', 'game', 't', 'shooter', 'goal']].merge(mp, on=['game', 't', 'shooter']); j = j[j.goal == j.mp_goal]
ne['p_moneypuck'] = np.nan; ne.iloc[j.k.values, ne.columns.get_loc('p_moneypuck')] = j.xGoal.values
dev = ne[ne.season.isin([2024, 2025, 2026]) & ne.p_moneypuck.notna()]

def ll(y, q): q = np.clip(q, 1e-6, 1 - 1e-6); return -(y * np.log(q) + (1 - y) * np.log(1 - q))
def boot(d, a, b, B=2000):
    diff = ll(d.goal.values, d['p_' + a].values) - ll(d.goal.values, d['p_' + b].values)
    gs = pd.Series(diff).groupby(d.game.values).agg(['sum', 'size']); s, n = gs['sum'].values, gs['size'].values
    bs = s[np.random.default_rng(5).integers(0, len(s), (B, len(s)))].sum(1) / n[np.random.default_rng(5).integers(0, len(s), (B, len(s)))].sum(1)
    idx = np.random.default_rng(5).integers(0, len(s), (B, len(s))); bs = s[idx].sum(1) / n[idx].sum(1)
    p = 2 * min((bs <= 0).mean(), (bs >= 0).mean())
    return s.sum() / n.sum() * 1e4, np.percentile(bs, 2.5) * 1e4, np.percentile(bs, 97.5) * 1e4, max(p, 1 / B)
def grmse(d, k, mins):
    g = d[d.goalie > 0].groupby(['season', 'goalie']); n = g.size(); keep = n[n >= mins].index
    return float(np.sqrt(((g.goal.sum()[keep] - g['p_' + k].sum()[keep]) ** 2).mean())), int(len(keep))
R = {'rounds': rounds}
names = list(FE) + ['moneypuck']
for title, d in [('2024-25', dev[dev.season == 2024]), ('2025-26 (opened)', dev[dev.season == 2025]), ('2026-27', dev[dev.season == 2026]), ('pooled', dev)]:
    r = {}
    for k in names:
        q = d['p_' + k].values; og = d.ongoal == 1
        r[k] = dict(logloss=float(log_loss(d.goal, np.clip(q, 1e-6, 1 - 1e-6))), ongoal_logloss=float(log_loss(d.goal[og], np.clip(q[og], 1e-6, 1 - 1e-6))),
                    goalie_rmse=grmse(d, k, 150 if title == '2026-27' else 400)[0], pred=float(q.sum()), goals=int(d.goal.sum()))
    R[title] = r
    print(f'\n== {title}  ({len(d)} shots, goalies {grmse(d, "sgp", 150 if title == "2026-27" else 400)[1]})')
    for k in names: print(f"  {k:<14} logloss {r[k]['logloss']:.5f}  on-goal {r[k]['ongoal_logloss']:.5f}  goalie RMSE {r[k]['goalie_rmse']:.2f}  pred {r[k]['pred']:.0f}/{r[k]['goals']}")
T = {g: boot(dev, '-' + g, 'sgp+goalie') for g in GNEW}
order = sorted(T, key=lambda g: T[g][3]); holm = {}
for i, g in enumerate(order): holm[g] = min(1.0, max(T[h][3] * (len(order) - jj) for jj, h in enumerate(order[:i + 1])))
print('\n== value of each new goalie group, pooled 2024-27 (log loss x1e4 lost when removed)')
for g in GNEW: e, lo, hi, p = T[g]; print(f"  {g:<12} {e:+6.2f} [{lo:+6.2f}, {hi:+6.2f}]  p={p:.4f} holm={holm[g]:.4f}")
for a, b in [('sgp+goalie', 'sgp'), ('sgp+goalie', 'moneypuck'), ('sgp', 'moneypuck')]:
    e, lo, hi, p = boot(dev, b, a); print(f"  {a} vs {b}: {e:+6.2f} [{lo:+6.2f}, {hi:+6.2f}]")
R['groups'] = {g: dict(delta=T[g][0], lo=T[g][1], hi=T[g][2], p=T[g][3], holm=holm[g]) for g in GNEW}
json.dump(R, open('results5.json', 'w'), indent=1)
