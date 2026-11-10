# Residual corrector: small GBM on the current season to date, init_score = base model log-odds; refit every `every` days.
# usage: resid.py <base> <folds> ; writes preds/<base>_r<cfg>_<fold>.npy
from lib import *
ne = load(); base = sys.argv[1]; folds = [int(x) for x in sys.argv[2].split(',')]
lo = lambda p: np.log(p / (1 - p)); dn = ne.dnum.values
CFG = {'A': dict(every=14, rounds=150, leaves=7, lr=0.03, mdl=200), 'B': dict(every=14, rounds=400, leaves=7, lr=0.03, mdl=200),
       'C': dict(every=7, rounds=150, leaves=7, lr=0.03, mdl=200), 'D': dict(every=14, rounds=150, leaves=4, lr=0.05, mdl=400)}
for cn in sys.argv[3].split(','):
    c = CFG[cn]
    for t in folds:
        name = f'{base}_r{cn}'
        if have(name, t): continue
        p = get(base, t).copy(); z = lo(p); seas = (ne.season == t).values
        a0, a1 = dn[seas].min(), dn[seas].max()
        for a in range(a0 + c['every'], a1 + 1, c['every']):
            trm = seas & (dn < a)
            if trm.sum() < 5000: continue
            m = lgb.train(dict(objective='binary', learning_rate=c['lr'], num_leaves=c['leaves'], min_data_in_leaf=c['mdl'], feature_fraction=0.9, bagging_fraction=0.8,
                               bagging_freq=1, lambda_l2=10.0, verbose=-1, seed=1, num_threads=1),
                          lgb.Dataset(ne.loc[trm, V2], ne.goal[trm], init_score=z[trm]), c['rounds'])
            mask = seas & (dn >= a) & (dn < a + c["every"])
            if not mask.any(): continue
            p[mask] = 1 / (1 + np.exp(-(z[mask] + m.predict(ne.loc[mask, V2], raw_score=True, num_threads=1))))
        save(name, t, p); print(name, t, time.strftime('%H:%M:%S'), flush=True)
