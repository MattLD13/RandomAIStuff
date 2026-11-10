# v2 freeze: models trained on the two most recent complete seasons (the window chosen by rolling-origin tests),
# walk-forward base xG, review fixes. Replaces the v1 freeze before any game was scored against it.
#   python3 freeze2.py '<json {model name: [features]}>'   (shot models besides 'standard')
import json, hashlib, gzip, os, sys, datetime, shutil
import numpy as np, pandas as pd, lightgbm as lgb
from sklearn.linear_model import LogisticRegression
exec(open('common.py').read()); exec(open('rk.py').read())
OUT = 'frozen'; shutil.rmtree(OUT, ignore_errors=True); os.makedirs(OUT + '/seed')
CUTOFF = '2026-11-11'; WINDOW = [2024, 2025]; ROUNDS = 1000
SHOT = json.loads(sys.argv[1])
df = pd.read_parquet('shots_feat2.parquet')
for c in CAT: df[c] = df[c].astype('category')
ne = df[df.en == 0]
fit = ne[ne.season.isin(WINDOW)]
# base xG: the frozen table (walk-forward values for every shot so far) + the model for new games of this season
pd.DataFrame({'game': ne.game.values, 'so': ne.so.values, 'xg_base': ne.xg_base.values.astype('float64')}).to_parquet(f'{OUT}/xg_base.parquet')
shutil.copy('stage1_latest.txt', f'{OUT}/stage1.txt')
shot = {}
for name, cols in list(SHOT.items()) + [('standard', BASE)]:
    m = lgb.train(dict(P, num_threads=4), lgb.Dataset(fit[cols], fit.goal), ROUNDS)
    gzip.open(f'{OUT}/{name}.txt.gz', 'wt').write(m.model_to_string()); shot[name] = dict(file=f'{name}.txt.gz', features=cols, calibrated=True)
lr = LogisticRegression(max_iter=2000, C=1e4).fit(rk_X(fit), fit.goal)
json.dump({'coef': lr.coef_[0].tolist(), 'intercept': float(lr.intercept_[0])}, open(f'{OUT}/rinkside_lr.json', 'w'))
reg = json.load(open('chances_prereg.json'))
t = pd.read_parquet('teamgames.parquet'); tf = t[t.season.isin([2021, 2022, 2023, 2024, 2025])]
PRM = dict(learning_rate=0.02, num_leaves=7, min_data_in_leaf=200, feature_fraction=0.8, bagging_fraction=0.8, bagging_freq=1, lambda_l2=10, verbose=-1, seed=1, num_threads=4)
OBJ = {'y_xgf': 'regression', 'y_ff': 'poisson', 'y_hd': 'poisson', 'y_gf': 'poisson'}
KEY = {'y_xgf': ('o_xgf', 'd_xga'), 'y_ff': ('o_ff', 'd_fa'), 'y_hd': ('o_hd', 'd_hda'), 'y_gf': ('o_gf', 'd_ga')}
ch = {}
for y, spec in reg['targets'].items():
    m = lgb.train(dict(PRM, objective=OBJ[y]), lgb.Dataset(tf[spec['features']], tf[y]), round(spec['rounds'] * 1.2))
    fn = f'chances_{y}.txt'; m.save_model(f'{OUT}/{fn}')
    ch[y] = dict(file=fn, features=spec['features'], matchup=list(KEY[y]), league_mean=float(tf[y].mean()),
                 home_edge=float((tf[tf.is_home == 1][y].mean() - tf[tf.is_home == 0][y].mean()) / 2))
for f in ['players.json', 'careers.json', 'edge.json', 'goalie_data.json', 'teams.json']: shutil.copy(f, f'{OUT}/seed/{f}')
files = sorted(f for f in os.listdir(OUT) if os.path.isfile(f'{OUT}/{f}'))
man = dict(version=2, frozen_at=datetime.datetime.now(datetime.timezone.utc).strftime('%Y-%m-%d %H:%M UTC'), cutoff=CUTOFF, season=2026,
           training_window=WINDOW, note='Scored only on regular-season games on or after the cutoff. Do not edit; a new freeze needs a new cutoff.',
           shot_models=shot, rinkside_file='rinkside_lr.json', chances=ch,
           sha256={f: hashlib.sha256(open(f'{OUT}/{f}', 'rb').read()).hexdigest() for f in files})
json.dump(man, open(f'{OUT}/manifest.json', 'w'), indent=1)
os.system(f'ls -la {OUT}; du -sh {OUT}')
