# how much does type='unknown' (only ever present on goals) contribute? fold 2025, v2 season fit with unknown -> missing
from lib import *
import lib; lib.NT = 1
ne = load(); t = 2025; u = (ne.type.astype(str) == 'unknown').values
ne2 = ne.copy(); ne2['type'] = ne2.type.astype(str).where(~u, np.nan).astype('category')
tr = ne2[(ne2.season >= t - 2) & (ne2.season < t)]
p2 = lgb.train(dict(P, num_threads=1), lgb.Dataset(tr[V2], tr.goal), 1000).predict(ne2[V2], num_threads=1)
m = (ne.season == t).values; a = recal(ne, get('v2', t)); b = recal(ne, p2)
print('unknown-type shots in 2025-26:', int((u & m).sum()), 'goals', int(ne.goal[u & m].sum()), 'mean p v2', a[u & m].mean().round(3), 'mean p without the flag', b[u & m].mean().round(3))
print('log loss v2', ll(ne.goal[m].values, a[m]).mean().round(5), 'without flag', ll(ne.goal[m].values, b[m]).mean().round(5), 'diff x1e4', ((ll(ne.goal[m].values, b[m]).mean() - ll(ne.goal[m].values, a[m]).mean()) * 1e4).round(2))
print('  of which on the unknown-type shots themselves x1e4:', ((ll(ne.goal[m].values, b[m]) - ll(ne.goal[m].values, a[m]))[u[m]].sum() / m.sum() * 1e4).round(2))
