# Hyperparameter search on validation (2024-25) only. Never touches the sealed season.
import sys, itertools, json
import numpy as np, pandas as pd, lightgbm as lgb
from sklearn.metrics import log_loss
exec(open('common.py').read())
df = pd.read_parquet('shots_feat.parquet')
for c in CAT: df[c] = df[c].astype('category')
ne = df[(df.en == 0) & (df.season != 2025)]
cols = BASE + [c for c in SH + GL if c not in FORM]
tr, va = ne[ne.season.isin(TRAIN)], ne[ne.season == 2024]
res = []
for nl, md, l2, ff in itertools.product([15, 31, 63], [100, 300, 1000], [1, 10, 50], [0.6, 0.9]):
    p = dict(P, num_leaves=nl, min_data_in_leaf=md, lambda_l2=l2, feature_fraction=ff, learning_rate=0.05)
    m = lgb.train(p, lgb.Dataset(tr[cols], tr.goal), 3000, valid_sets=[lgb.Dataset(va[cols], va.goal)], callbacks=[lgb.early_stopping(100, verbose=False)])
    ll = log_loss(va.goal, m.predict(va[cols], num_iteration=m.best_iteration))
    res.append((ll, nl, md, l2, ff, m.best_iteration)); print(res[-1], flush=True)
res.sort(); json.dump(res, open('tune.json', 'w')); print('best', res[:5])
