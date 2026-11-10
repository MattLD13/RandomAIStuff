# cheap engineered features from existing columns (season fit), with the existing placebo as control. usage: feat.py <folds>
from lib import *
ne = load()
hs = np.where(ne.hand.astype(str) == 'L', 1.0, np.where(ne.hand.astype(str) == 'R', -1.0, np.nan))
ne['y_hand'] = ne.y * hs                                   # lateral position relative to the shooter's stick side
pfx = 89 - ne.prev_x; ne['prev_dnet'] = np.hypot(pfx, ne.prev_y)   # previous event's distance to the net
pa = np.degrees(np.arctan2(ne.prev_y, pfx.clip(lower=0.5))); ca = np.degrees(np.arctan2(ne.y, (89 - ne.x).clip(lower=0.5)))
ne['ang_swing'] = (ca - pa).abs(); ne['ang_swing_rate'] = ne.ang_swing / ne.prev_dt.clip(lower=1)   # goalie's angular move since the previous event (any event)
ne['per_left'] = 1200 - (ne.t % 1200); ne['dnet_change'] = ne.prev_dnet - ne.dist
NEW = ['y_hand', 'prev_dnet', 'ang_swing', 'ang_swing_rate', 'per_left', 'dnet_change']
for t in [int(x) for x in sys.argv[1].split(',')]:
    if not have('v2_newfeat', t):
        tr = ne[(ne.season >= t - 2) & (ne.season < t)]; save('v2_newfeat', t, fit(tr, V2 + NEW).predict(ne[V2 + NEW], num_threads=NT)); print('newfeat', t, flush=True)
