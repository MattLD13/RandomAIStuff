# separate models by strength state (5v5-ish EV vs special teams), 2024 fold, season fit
from lib import *
import lib; lib.NT = 1
ne = load(); t = int(sys.argv[1]) if len(sys.argv) > 1 else 2024
ev = ((ne.pp == 0) & (ne.sh == 0)).values; tr = ((ne.season >= t - 2) & (ne.season < t)).values
p = np.full(len(ne), np.nan)
for g, r in [(ev, 1000), (~ev, 400)]:
    m = lgb.train(dict(P, num_threads=1), lgb.Dataset(ne.loc[tr & g, V2], ne.goal[tr & g]), r); p[g] = m.predict(ne.loc[g, V2], num_threads=1)
save('v2_state', t, p); print('done')
