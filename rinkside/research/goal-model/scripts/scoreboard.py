# Weekly prospective scoreboard: the frozen models, scored only on games played on or after the freeze cutoff.
# Nothing here is tuned; the models, features and calibration rule are fixed in frozen/manifest.json.
import json, hashlib, os, sys, datetime
import numpy as np, pandas as pd, lightgbm as lgb
from sklearn.metrics import log_loss, roc_auc_score, brier_score_loss
exec(open('common.py').read()); exec(open('rk.py').read())
FZ = os.environ.get('FROZEN', '../frozen'); OUT = os.environ.get('SCOREBOARD', '../scoreboard')
man = json.load(open(f'{FZ}/manifest.json'))
for f, h in man['sha256'].items():
    assert hashlib.sha256(open(f'{FZ}/{f}', 'rb').read()).hexdigest() == h, f'frozen file changed: {f}'
cut = man['cutoff']
df = pd.read_parquet('shots_feat2.parquet')
for c in CAT: df[c] = df[c].astype('category')
ne = df[df.en == 0].sort_values(['dnum', 'game', 'so']).copy()
def recal(p, W=35):
    day = pd.DataFrame({'d': ne.dnum.values, 'g': ne.goal.values, 'p': p}).groupby('d')[['g', 'p']].sum()
    c = np.log((day.g.rolling(W, min_periods=10).sum().shift(1) + 20) / (day.p.rolling(W, min_periods=10).sum().shift(1) + 20)).fillna(0)
    return 1 / (1 + np.exp(-(np.log(p / (1 - p)) + ne.dnum.map(c).values)))
for name, spec in man['shot_models'].items():
    m = lgb.Booster(model_file=f"{FZ}/{spec['file']}")
    p = m.predict(ne[spec['features']]); ne['p_' + name] = recal(p) if spec['calibrated'] else p
rk = json.load(open(f"{FZ}/{man['rinkside_file']}"))
z = rk_X(ne) @ np.array(rk['coef']) + rk['intercept']; ne['p_rinkside'] = recal(1 / (1 + np.exp(-z)))
d = ne[ne.date >= cut].copy()
models = list(man['shot_models']) + ['rinkside']
# MoneyPuck (published xGoal for the current season, when available)
mpf = f"mp/shots_{man['season']}.csv"
if os.path.exists(mpf):
    m = pd.read_csv(mpf, usecols=['season', 'game_id', 'time', 'shooterPlayerId', 'event', 'xGoal', 'isPlayoffGame'])
    m = m[m.isPlayoffGame == 0]; m['game'] = (m.season * 1000000 + m.game_id).astype(int); m['t'] = m.time.astype(int)
    m['shooter'] = m.shooterPlayerId.fillna(0).astype(int); m['mp_goal'] = (m.event == 'GOAL').astype(int)
    m = m[['game', 't', 'shooter', 'xGoal', 'mp_goal']].drop_duplicates(['game', 't', 'shooter'], keep=False)
    d['k'] = np.arange(len(d)); j = d[['k', 'game', 't', 'shooter', 'goal']].merge(m, on=['game', 't', 'shooter']); j = j[j.goal == j.mp_goal]
    d['p_moneypuck'] = np.nan; d.iloc[j.k.values, d.columns.get_loc('p_moneypuck')] = j.xGoal.values
    if d.p_moneypuck.notna().mean() > 0.9: models.append('moneypuck')
def ll(y, q): q = np.clip(q, 1e-6, 1 - 1e-6); return -(y * np.log(q) + (1 - y) * np.log(1 - q))
def boot(x, a, b, B=2000):
    e = ll(x.goal.values, x['p_' + a].values) - ll(x.goal.values, x['p_' + b].values)
    gs = pd.Series(e).groupby(x.game.values).agg(['sum', 'size']); s, n = gs['sum'].values, gs['size'].values
    idx = np.random.default_rng(1).integers(0, len(s), (B, len(s))); bs = s[idx].sum(1) / n[idx].sum(1)
    return dict(gain_x1e4=round(float(s.sum() / n.sum() * 1e4), 2), lo=round(float(np.percentile(bs, 2.5) * 1e4), 2), hi=round(float(np.percentile(bs, 97.5) * 1e4), 2),
                share_better=round(float((bs > 0).mean()), 4))
R = dict(updated=datetime.datetime.utcnow().strftime('%Y-%m-%d %H:%M UTC'), cutoff=cut, frozen=man['frozen_at'])
if len(d):
    x = d[d.p_moneypuck.notna()] if 'moneypuck' in models else d
    R['shots'] = dict(games=int(x.game.nunique()), shots=int(len(x)), goals=int(x.goal.sum()))
    R['models'] = {k: dict(logloss=round(float(log_loss(x.goal, np.clip(x['p_' + k], 1e-6, 1 - 1e-6))), 5), auc=round(float(roc_auc_score(x.goal, x['p_' + k])), 4),
                           brier=round(float(brier_score_loss(x.goal, x['p_' + k])), 5), predicted=round(float(x['p_' + k].sum()), 1)) for k in models}
    R['sgp_vs'] = {k: boot(x, k, 'sgp') for k in models if k != 'sgp'}
    g = x[x.goalie > 0].groupby('goalie'); n = g.size(); keep = n[n >= 150].index
    if len(keep) >= 10:
        R['goalies_150plus'] = {k: round(float(np.sqrt(((g.goal.sum()[keep] - g['p_' + k].sum()[keep]) ** 2).mean())), 3) for k in models} | {'goalies': int(len(keep))}
# chances tonight
if os.path.exists('teamgames.parquet') and 'chances' in man:
    t = pd.read_parquet('teamgames.parquet'); t = t[t.dnum >= datetime.date.fromisoformat(cut).toordinal()]
    if len(t):
        C = {}
        for y, spec in man['chances'].items():
            m = lgb.Booster(model_file=f"{FZ}/{spec['file']}"); pm = m.predict(t[spec['features']])
            key = spec['matchup']; base = ((t[key[0]] + t[key[1]]) / 2).fillna(spec['league_mean']) + t.is_home.map({1: spec['home_edge'], 0: -spec['home_edge']})
            e_m, e_b, e_l = (pm - t[y]) ** 2, (base - t[y]) ** 2, (spec['league_mean'] - t[y]) ** 2
            gs = pd.DataFrame({'g': t.game.values, 'a': (e_b - e_m).values, 'b': (e_l - e_m).values}).groupby('g').agg(['sum', 'size'])
            def bt(col):
                s, n = gs[(col, 'sum')].values, gs[(col, 'size')].values; idx = np.random.default_rng(2).integers(0, len(s), (2000, len(s))); bs = s[idx].sum(1) / n[idx].sum(1)
                return [round(float(s.sum() / n.sum()), 4), round(float(np.percentile(bs, 2.5)), 4), round(float(np.percentile(bs, 97.5)), 4)]
            C[y] = dict(team_games=int(len(t)), rmse_model=round(float(np.sqrt(e_m.mean())), 4), rmse_matchup=round(float(np.sqrt(e_b.mean())), 4),
                        rmse_league_avg=round(float(np.sqrt(e_l.mean())), 4), mse_gain_vs_matchup=bt('a'), mse_gain_vs_league_avg=bt('b'))
        R['chances'] = C
os.makedirs(OUT, exist_ok=True)
json.dump(R, open(f'{OUT}/latest.json', 'w'), indent=1)
# a short readable page
L = [f"# Prospective scoreboard", "", f"Frozen models scored only on games played on or after **{cut}** (frozen {man['frozen_at']}). Updated {R['updated']}.", ""]
if 'shots' in R:
    s = R['shots']; L += [f"## Shot model: {s['games']} games, {s['shots']} shots, {s['goals']} goals", "", "| Model | Log loss | AUC | Predicted goals |", "|---|---|---|---|"]
    for k, v in sorted(R['models'].items(), key=lambda kv: kv[1]['logloss']): L.append(f"| {k} | {v['logloss']:.5f} | {v['auc']:.3f} | {v['predicted']:.0f} |")
    L += ["", "SGP vs each model (log loss x 10,000, + = SGP better, 95% game-level bootstrap):", "", "| vs | Gain | 95% interval | Resamples SGP better |", "|---|---|---|---|"]
    for k, v in R['sgp_vs'].items(): L.append(f"| {k} | {v['gain_x1e4']:+.1f} | {v['lo']:+.1f} to {v['hi']:+.1f} | {v['share_better']:.0%} |")
    if 'goalies_150plus' in R:
        gg = R['goalies_150plus']; L += ["", f"Goalie goals-against error (RMSE, {gg['goalies']} goalies with 150+ shots): " + ', '.join(f"{k} {v:.2f}" for k, v in gg.items() if k != 'goalies')]
if 'chances' in R:
    L += ["", "## Chances tonight", "", "| Target | Team-games | RMSE model | RMSE matchup avg | RMSE league avg |", "|---|---|---|---|---|"]
    for y, v in R['chances'].items(): L.append(f"| {y} | {v['team_games']} | {v['rmse_model']:.3f} | {v['rmse_matchup']:.3f} | {v['rmse_league_avg']:.3f} |")
L += ["", "Early weeks are noisy: wait for the intervals to settle before reading much into them."]
open(f'{OUT}/README.md', 'w').write('\n'.join(L) + '\n')
hist = f'{OUT}/history.csv'; new = not os.path.exists(hist)
with open(hist, 'a') as h:
    if new: h.write('updated,games,shots,goals,sgp_logloss,moneypuck_logloss,standard_logloss,rinkside_logloss\n')
    if 'models' in R:
        M = R['models']; h.write(','.join(str(v) for v in [R['updated'], R['shots']['games'], R['shots']['shots'], R['shots']['goals'],
            M['sgp']['logloss'], M.get('moneypuck', {}).get('logloss', ''), M['standard']['logloss'], M['rinkside']['logloss']]) + '\n')
print('\n'.join(L))
