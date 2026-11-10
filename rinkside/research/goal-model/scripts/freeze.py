# Freeze everything the weekly scoreboard needs, with fingerprints and a cutoff date. After this, nothing is tuned:
# the scoreboard only scores these files on games played on or after the cutoff.
import json, hashlib, gzip, pickle, os, datetime
import numpy as np, pandas as pd, lightgbm as lgb
from sklearn.linear_model import LogisticRegression
exec(open('common.py').read()); exec(open('rk.py').read())
OUT = 'frozen'; os.makedirs(OUT, exist_ok=True)
CUTOFF = '2026-11-11'
df = pd.read_parquet('shots_feat2.parquet')
for c in CAT: df[c] = df[c].astype('category')
ne = df[df.en == 0]
# 1. stage-1 base xG: refit exactly as model.py did (31-leaf settings of that run) and check it matches the stored values
P1 = dict(P, num_leaves=31, feature_fraction=0.8)
tr = ne[ne.season.isin([2020, 2021, 2022, 2023])]
s1 = lgb.train(P1, lgb.Dataset(tr[BASE], tr.goal), 700)
chk = ne[ne.season >= 2024]; diff = np.abs(s1.predict(chk[BASE]) - chk.xg_base.values)
print('stage-1 refit vs stored xg_base (2024+): max diff', diff.max(), 'mean', diff.mean())
s1.save_model(f'{OUT}/stage1.txt')
pd.DataFrame({'game': ne.game.values, 'so': ne.so.values, 'xg_base': ne.xg_base.values.astype('float64')}).to_parquet(f'{OUT}/xg_base.parquet')
# 2. shot models: the production SGP and standard xG (trained 2021-2025 in prod.py)
M = pickle.load(open('models_prod.pkl', 'rb'))
shot = {}
for name in ['new_stat', 'standard']:
    cols, s = M[name]; fn = f"{'sgp' if name == 'new_stat' else 'standard'}.txt.gz"
    gzip.open(f'{OUT}/{fn}', 'wt').write(s); shot['sgp' if name == 'new_stat' else 'standard'] = dict(file=fn, features=cols, calibrated=True)
# 3. Rinkside's current recipe, refitted on the same seasons
fit = ne[ne.season.isin([2021, 2022, 2023, 2024, 2025])]
lr = LogisticRegression(max_iter=2000, C=1e4).fit(rk_X(fit), fit.goal)
json.dump({'coef': lr.coef_[0].tolist(), 'intercept': float(lr.intercept_[0])}, open(f'{OUT}/rinkside_lr.json', 'w'))
# 4. chances-tonight models, registered features and rounds, trained on 2021-2025
reg = json.load(open('chances_prereg.json'))
t = pd.read_parquet('teamgames.parquet'); tf = t[t.season.isin([2021, 2022, 2023, 2024, 2025])]
PRM = dict(learning_rate=0.02, num_leaves=7, min_data_in_leaf=200, feature_fraction=0.8, bagging_fraction=0.8, bagging_freq=1, lambda_l2=10, verbose=-1, seed=1, num_threads=4)
OBJ = {'y_xgf': 'regression', 'y_ff': 'poisson', 'y_hd': 'poisson', 'y_gf': 'poisson'}
KEY = {'y_xgf': ('o_xgf', 'd_xga'), 'y_ff': ('o_ff', 'd_fa'), 'y_hd': ('o_hd', 'd_hda'), 'y_gf': ('o_gf', 'd_ga')}
ch = {}
for y, spec in reg['targets'].items():
    m = lgb.train(dict(PRM, objective=OBJ[y]), lgb.Dataset(tf[spec['features']], tf[y]), round(spec['rounds'] * 1.2))
    fn = f'chances_{y}.txt'; m.save_model(f'{OUT}/{fn}')
    lm = float(tf[y].mean()); he = float((tf[tf.is_home == 1][y].mean() - tf[tf.is_home == 0][y].mean()) / 2)
    ch[y] = dict(file=fn, features=spec['features'], matchup=list(KEY[y]), league_mean=lm, home_edge=he)
files = sorted(os.listdir(OUT))
man = dict(frozen_at=datetime.datetime.utcnow().strftime('%Y-%m-%d %H:%M UTC'), cutoff=CUTOFF, season=2026,
           note='Scored only on regular-season games played on or after the cutoff. Do not edit these files; a new freeze needs a new cutoff.',
           shot_models=shot, rinkside_file='rinkside_lr.json', chances=ch,
           sha256={f: hashlib.sha256(open(f'{OUT}/{f}', 'rb').read()).hexdigest() for f in files})
json.dump(man, open(f'{OUT}/manifest.json', 'w'), indent=1)
os.system(f'ls -la {OUT}')
