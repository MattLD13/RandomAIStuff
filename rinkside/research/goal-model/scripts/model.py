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


P1 = dict(P, num_leaves=31, feature_fraction=0.8)   # the settings the stored / frozen base xG was fitted with
def fit(X, y, Xv=None, yv=None, rounds=3000):
    dtr = lgb.Dataset(X, y, categorical_feature=[c for c in X.columns if c in CAT])
    if Xv is not None:
        dv = lgb.Dataset(Xv, yv, reference=dtr)
        m = lgb.train(P1, dtr, rounds, valid_sets=[dv], callbacks=[lgb.early_stopping(100, verbose=False)])
    else:
        m = lgb.train(P1, dtr, rounds)
    return m

ne = df[df.en == 0]   # empty-net shots are modelled separately (nearly every on-target one scores)

# ---------- stage 1: base model (no player identity) used to measure shooters and goalies ----------
# cross-fitted: each training season is predicted by a model that never saw it
import os
FROZEN = os.environ.get('FROZEN')          # weekly scoreboard: use the frozen base xG instead of refitting it
df['xg_base'] = np.nan
if FROZEN:
    xb = pd.read_parquet(f'{FROZEN}/xg_base.parquet')                 # game, so, xg_base for every shot frozen at cutoff
    key = pd.MultiIndex.from_frame(df[['game', 'so']]); look = pd.Series(xb.xg_base.values, index=pd.MultiIndex.from_frame(xb[['game', 'so']]))
    df['xg_base'] = look.reindex(key).values
    s1 = lgb.Booster(model_file=f'{FROZEN}/stage1.txt')
    miss = df.index[df.xg_base.isna() & (df.en == 0)]
    if len(miss): df.loc[miss, 'xg_base'] = s1.predict(df.loc[miss, BASE])
    df.loc[df.en == 1, 'xg_base'] = np.nan
else:
    # walk-forward (review fix): each season's base xG comes from a model trained on the two seasons before it only.
    # 2020-21 has no earlier season here, so it is cross-fitted by halves (it only seeds player histories).
    seasons = sorted(ne.season.unique())
    for s in seasons:
        idx = ne.index[ne.season == s]
        prior = [x for x in seasons if s - 2 <= x < s]
        if prior:
            tr = ne[ne.season.isin(prior)]; m = fit(tr[BASE], tr.goal, rounds=700)
            df.loc[idx, 'xg_base'] = m.predict(ne.loc[idx, BASE])
            if s == seasons[-1]: m.save_model('stage1_latest.txt')     # used for new games of the current season
        else:
            odd = ne.loc[idx, 'game'] % 2 == 1
            for half in (True, False):
                tr = ne.loc[idx[(odd != half).values]]; m = fit(tr[BASE], tr.goal, rounds=700)
                tgt = idx[(odd == half).values]; df.loc[tgt, 'xg_base'] = m.predict(ne.loc[tgt, BASE])
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
