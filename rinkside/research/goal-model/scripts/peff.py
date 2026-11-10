# Player effects, fitted directly: logit P(goal) = logit(base xG) + shooter effect + goalie effect, with a ridge
# (Gaussian prior) penalty on each effect and older shots down-weighted. Refit at the start of every month using only
# shots from before that date; every shot gets the effects from the latest refit before it.
import sys, json
import numpy as np, pandas as pd
from scipy import sparse
from scipy.optimize import minimize
df = pd.read_parquet('shots_feat2.parquet', columns=['season', 'game', 'so', 'dnum', 'date', 'shooter', 'goalie', 'goal', 'en', 'xg_base'])
ne = df[(df.en == 0) & df.xg_base.notna()].sort_values(['dnum', 'game', 'so']).reset_index()
ne['off'] = np.log(ne.xg_base / (1 - ne.xg_base))
LAMS = [float(x) for x in (sys.argv[1:] or ['30', '100', '300'])]
HALF = 365.0          # an old shot counts half after a year
d0 = pd.to_datetime(ne.date)
starts = sorted(set(pd.Timestamp(y, m, 1) for y, m in zip(d0.dt.year, d0.dt.month)))
starts = [s for s in starts if s >= pd.Timestamp(2021, 10, 1)]
out = {lam: (np.zeros(len(ne)), np.zeros(len(ne))) for lam in LAMS}
def fit(tr, lam):
    sid = pd.Index(tr.shooter.unique()); gid = pd.Index(tr.goalie[tr.goalie > 0].unique())
    rows = np.arange(len(tr))
    Xs = sparse.csr_matrix((np.ones(len(tr)), (rows, sid.get_indexer(tr.shooter))), shape=(len(tr), len(sid)))
    gi = gid.get_indexer(tr.goalie); ok = gi >= 0
    Xg = sparse.csr_matrix((np.ones(ok.sum()), (rows[ok], gi[ok])), shape=(len(tr), len(gid)))
    X = sparse.hstack([Xs, Xg]).tocsr(); y = tr.goal.values.astype(float); o = tr.off.values; w = tr.w.values
    def f(b):
        z = o + X @ b; p = 1 / (1 + np.exp(-z))
        ll = -(w * (y * z - np.logaddexp(0, z))).sum() + lam * (b @ b) / 2
        g = X.T @ (w * (p - y)) + lam * b
        return ll, g
    r = minimize(f, np.zeros(X.shape[1]), jac=True, method='L-BFGS-B', options=dict(maxiter=500))
    b = r.x
    return dict(zip(sid, b[:len(sid)])), dict(zip(gid, b[len(sid):]))
dn = ne.dnum.values
for i, st in enumerate(starts):
    a = st.toordinal(); b = starts[i + 1].toordinal() if i + 1 < len(starts) else 10 ** 9
    tgt = np.where((dn >= a) & (dn < b))[0]
    if not len(tgt): continue
    tr = ne[(dn < a) & (dn >= a - 730)].copy()
    if len(tr) < 20000: continue
    tr['w'] = 0.5 ** ((a - tr.dnum) / HALF)
    for lam in LAMS:
        S, G = fit(tr, lam)
        out[lam][0][tgt] = ne.shooter.iloc[tgt].map(S).fillna(0).values
        out[lam][1][tgt] = ne.goalie.iloc[tgt].map(G).fillna(0).values
    print(st.date(), len(tr), flush=True)
res = ne[['game', 'so']].copy()
for lam in LAMS: res[f'sh_eff_{int(lam)}'] = out[lam][0]; res[f'g_eff_{int(lam)}'] = out[lam][1]
res.to_parquet('peff.parquet')
# quick read: how well does "base xG + effects" do on its own, by season (no GBM involved)
from sklearn.metrics import log_loss
m = ne.merge(res, on=['game', 'so'])
for s in [2023, 2024, 2025, 2026]:
    x = m[m.season == s]
    line = f"{s}  base {log_loss(x.goal, x.xg_base):.5f}"
    for lam in LAMS:
        z = x.off + x[f'sh_eff_{int(lam)}'] + x[f'g_eff_{int(lam)}']; line += f"  lam{int(lam)} {log_loss(x.goal, 1 / (1 + np.exp(-z))):.5f}"
    print(line)
