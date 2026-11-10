# season-fit variants. usage: run3.py <folds> <names>
from lib import *
ne = load()
def sf(test, nseas=2, cols=None, params=None, rounds=1000, seed=1, sub=None):
    cols = cols or V2; tr = ne[(ne.season >= test - nseas) & (ne.season < test)]
    return fit(tr, cols, params, rounds, seed=seed).predict(ne[cols], num_threads=NT)
CFG = {'v2_w1': dict(nseas=1), 'v2_w3': dict(nseas=3),
       'v2_lr015': dict(params=dict(learning_rate=0.015), rounds=2000), 'v2_ff5': dict(params=dict(feature_fraction=0.5)),
       'v2_et': dict(params=dict(extra_trees=True), rounds=1500), 'v2_catoh': dict(params=dict(max_cat_to_onehot=64)),
       'v2_l2_50': dict(params=dict(lambda_l2=50)), 'v2_bag5': dict(params=dict(bagging_fraction=0.5)),
       'v2_ps': dict(params=dict(path_smooth=100)), 'v2_noplacebo_dummy': {}}
for s in range(2, 9): CFG[f'v2_s{s}'] = dict(seed=s)
for name in sys.argv[2].split(','):
    for t in [int(x) for x in sys.argv[1].split(',')]:
        if have(name, t): continue
        save(name, t, sf(t, **CFG[name])); print(name, t, time.strftime('%H:%M:%S'), flush=True)
