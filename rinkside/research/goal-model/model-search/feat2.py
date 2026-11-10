# EDGE shot speed made season-relative: percentile rank of each shooter among all shooters with EDGE data in that (previous) season.
# Motivation: raw EDGE values shift between seasons (2024-25 EDGE avg speed is ~3.4 mph above every other season). usage: feat2.py <folds> [seeds]
from lib import *
ne = load()
E = json.load(open(os.path.join(V2DIR, 'edge.json')))     # key "<edge season>:<player>" -> [avg, top, n90+, n80-90]; shots use edge season = season - 1
tab = pd.DataFrame([(int(k.split(':')[0]) + 1, int(k.split(':')[1]), v[0], v[1], v[2]) for k, v in E.items() if v and v[0] is not None], columns=['season', 'shooter'] + SPEED)
REL = []
for c in SPEED:
    tab[c + '_pct'] = tab.groupby('season')[c].rank(pct=True); REL.append(c + '_pct')   # ranked among all players with EDGE data that season: known before the season starts
ne = ne.merge(tab[['season', 'shooter'] + REL], on=['season', 'shooter'], how='left')
assert (ne.dnum.diff().fillna(0) >= 0).all()
COLS = BASE + CTX + CHANGE + REL
seeds = [int(x) for x in sys.argv[2].split(',')] if len(sys.argv) > 2 else [1]
for s in seeds:
    for t in [int(x) for x in sys.argv[1].split(',')]:
        nm = 'v2_edgepct' + ('' if s == 1 else f'_s{s}')
        if have(nm, t): continue
        tr = ne[(ne.season >= t - 2) & (ne.season < t)]; save(nm, t, fit(tr, COLS, seed=s).predict(ne[COLS], num_threads=NT)); print(nm, t, flush=True)
