# Build history features, train the models, and score everything on held-out seasons.
#   seasons: 2020 = 2020-21 (history warm-up only), 2021-2023 train, 2024 validation, 2025 + 2026 test
import json, math, sys, pickle
from collections import deque, defaultdict
from datetime import date as D
import numpy as np, pandas as pd, lightgbm as lgb
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import log_loss, roc_auc_score, brier_score_loss

df = pd.read_parquet('shots.parquet')
df = df[(df.opp >= 3) & ((df.own >= 3) | (df.pulled == 1))]                 # no penalty shots
df = df.sort_values(['date', 'game', 'so']).reset_index(drop=True)
df['dnum'] = pd.to_datetime(df.date).map(lambda d: d.toordinal())
exec(open('common.py').read())

for c in CAT: df[c] = df[c].astype('category')
df['offwing'] = np.where(df.hand == 'L', (df.y < 0).astype(int), np.where(df.hand == 'R', (df.y > 0).astype(int), -1))
df['skdiff'] = df.own - df.opp
df['pp'] = (df.own > df.opp).astype(int); df['sh'] = (df.own < df.opp).astype(int)


def fit(X, y, Xv=None, yv=None, rounds=3000):
    dtr = lgb.Dataset(X, y, categorical_feature=[c for c in X.columns if c in CAT])
    if Xv is not None:
        dv = lgb.Dataset(Xv, yv, reference=dtr)
        m = lgb.train(P, dtr, rounds, valid_sets=[dv], callbacks=[lgb.early_stopping(100, verbose=False)])
    else:
        m = lgb.train(P, dtr, rounds)
    return m

ne = df[df.en == 0]   # empty-net shots are modelled separately (nearly every on-target one scores)

# ---------- stage 1: base model (no player identity) used to measure shooters and goalies ----------
# cross-fitted: each training season is predicted by a model that never saw it
df['xg_base'] = np.nan
hist_seasons = [2020] + TRAIN
for s in hist_seasons:
    tr = ne[ne.season.isin(hist_seasons) & (ne.season != s)]
    m = fit(tr[BASE], tr.goal, rounds=700)
    idx = ne.index[ne.season == s]
    df.loc[idx, 'xg_base'] = m.predict(ne.loc[idx, BASE])
tr = ne[ne.season.isin(hist_seasons)]
m_hist = fit(tr[BASE], tr.goal, rounds=700)
idx = ne.index[~ne.season.isin(hist_seasons)]
df.loc[idx, 'xg_base'] = m_hist.predict(ne.loc[idx, BASE])
print('stage 1 done', file=sys.stderr)

# ---------- stage 2: shooter and goalie history, strictly from earlier games ----------
H = ['sh_n', 'sh_fin_a2', 'sh_fin_a10', 'sh_fin_season', 'sh_recent100', 'sh_recent_games', 'sh_avgdist', 'sh_ongoal',
     'g_n', 'g_sv_a5', 'g_sv_a20', 'g_sv_season', 'g_recent300', 'g_rest', 'g_b2b', 'g_age_days']
sh = defaultdict(lambda: dict(n=0, g=0.0, x=0.0, sn=0, sg=0.0, sx=0.0, season=None, rec=deque(maxlen=100), games=deque(maxlen=10), dsum=0.0, og=0))
gl = defaultdict(lambda: dict(n=0, g=0.0, x=0.0, sg=0.0, sx=0.0, season=None, rec=deque(maxlen=300), last=None))
born = {int(k): v[2] for k, v in json.load(open('players.json')).items() if v[2]}
out = np.full((len(df), len(H)), np.nan)
lg = lambda a, b: math.log((a) / (b))
for gid, gdf in df.groupby('game', sort=False):
    season = gdf.season.iat[0]; dn = gdf.dnum.iat[0]
    # snapshot
    for i, s_id, g_id in zip(gdf.index, gdf.shooter, gdf.goalie):
        a = sh[s_id]; b = gl[g_id]
        if a['season'] != season: a['sn'] = 0; a['sg'] = 0.0; a['sx'] = 0.0; a['season'] = season
        if b['season'] != season: b['sg'] = 0.0; b['sx'] = 0.0; b['season'] = season
        rr = list(a['rec'])
        bd = born.get(int(g_id)) if g_id else None
        out[i] = [a['n'], lg(a['g'] + 2, a['x'] + 2), lg(a['g'] + 10, a['x'] + 10),
                  lg(a['sg'] + 2, a['sx'] + 2), sum(rr) if rr else 0.0, sum(a['games']) if a['games'] else 0.0,
                  a['dsum'] / a['n'] if a['n'] else np.nan, a['og'] / a['n'] if a['n'] else np.nan,
                  b['n'], lg(b['g'] + 5, b['x'] + 5), lg(b['g'] + 20, b['x'] + 20), lg(b['sg'] + 5, b['sx'] + 5),
                  sum(b['rec']) if b['rec'] else 0.0, (dn - b['last']) if b['last'] else 30, int(b['last'] is not None and dn - b['last'] == 1),
                  (dn - D.fromisoformat(bd).toordinal()) if bd else np.nan]
    # update after the game
    gsum = defaultdict(float)
    for s_id, g_id, goal, xb, en, dist, og in zip(gdf.shooter, gdf.goalie, gdf.goal, gdf.xg_base, gdf.en, gdf.dist, gdf.ongoal):
        if en or np.isnan(xb): continue
        a = sh[s_id]; a['n'] += 1; a['g'] += goal; a['x'] += xb; a['sn'] += 1; a['sg'] += goal; a['sx'] += xb
        a['rec'].append(goal - xb); a['dsum'] += dist; a['og'] += og; gsum[s_id] += goal - xb
        if g_id:
            b = gl[g_id]; b['n'] += 1; b['g'] += goal; b['x'] += xb; b['sg'] += goal; b['sx'] += xb; b['rec'].append(goal - xb); b['last'] = dn
    for s_id, v in gsum.items(): sh[s_id]['games'].append(v)
for j, c in enumerate(H): df[c] = out[:, j]
print('stage 2 done', file=sys.stderr)
df.to_parquet('shots_feat.parquet')
