# Calibration variants on cached raw predictions. Candidate layers are followed by the standard recal (W=35,k=20) unless noted.
from lib import *
ne = load(); base = sys.argv[1] if len(sys.argv) > 1 else 'v2'
lo = lambda p: np.log(p / (1 - p)); sg = lambda z: 1 / (1 + np.exp(-z))
def grp_shift(p, g, W=35, k=20, minp=10):
    """per-group rolling shift: log((goals_g+k)/(pred_g+k)) over the previous W game days, current day excluded"""
    d = pd.DataFrame({'d': ne.dnum.values, 'grp': g, 'g': ne.goal.values, 'p': p})
    G = d.pivot_table(index='d', columns='grp', values='g', aggfunc='sum', fill_value=0); Pp = d.pivot_table(index='d', columns='grp', values='p', aggfunc='sum', fill_value=0)
    c = np.log((G.rolling(W, min_periods=minp).sum().shift(1) + k) / (Pp.rolling(W, min_periods=minp).sum().shift(1) + k)).fillna(0)
    s = c.stack().rename('c').reset_index(); m = d.merge(s, on=['d', 'grp'], how='left')
    return sg(lo(p) + m.c.values)
st = np.where(ne.pp == 1, 'PP', np.where(ne.sh == 1, 'SH', 'EV'))
ty = ne.type.astype(str).values; ty5 = np.where(np.isin(ty, ['wrist', 'snap', 'slap', 'backhand', 'tip-in']), ty, 'other')
reb = ne.rebound.values.astype(str); pt = ne.prev_type.astype(str).values
Q = {}
for t in FOLDS:
    p = get(base, t)
    V = {base: recal(ne, p), 'W20': recal(ne, p, 20), 'W60': recal(ne, p, 60), 'W100': recal(ne, p, 100), 'k5': recal(ne, p, 35, 5), 'k60': recal(ne, p, 35, 60), 'nocal': p}
    for nm, g in [('state', st), ('type5', ty5), ('reb', reb), ('prevtype', pt)]:
        for W, k in [(35, 20), (70, 20), (70, 50)]:
            V[f'{nm}_W{W}k{k}>std'] = recal(ne, grp_shift(p, g, W, k))
    V['type5>prevtype(70,20)>std'] = recal(ne, grp_shift(grp_shift(p, ty5, 70, 20), pt, 70, 20))
    for k_, v in V.items(): Q.setdefault(k_, {})[t] = v
if base != 'v2': Q = {'v2': {t: recal(ne, get('v2', t)) for t in FOLDS}, **Q}
report(ne, Q)
