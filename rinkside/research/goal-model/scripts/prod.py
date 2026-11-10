# Production fit: the registered new stat and the standard xG, retrained on every completed season (2021-2025),
# plus per-shot explanations: multiplier vs standard xG and which factor groups moved it.
#   python3 prod.py                -> trains, saves models_prod.pkl, prints examples
import json, pickle, sys
import numpy as np, pandas as pd, lightgbm as lgb
exec(open('common.py').read())
reg = json.load(open('prereg.json'))
df = pd.read_parquet('shots_feat2.parquet')
for c in CAT: df[c] = df[c].astype('category')
ne = df[df.en == 0].sort_values(['dnum', 'game', 'so']).copy()
fit = ne[ne.season.isin([2021, 2022, 2023, 2024, 2025])]
M = {}
for name in ['new_stat', 'standard']:
    spec = reg['models'][name]
    M[name] = (spec['features'], lgb.train(P, lgb.Dataset(fit[spec['features']], fit.goal), round(spec['rounds'] * 1.2)))
def recal(p, W=35):
    day = pd.DataFrame({'d': ne.dnum.values, 'g': ne.goal.values, 'p': p}).groupby('d')[['g', 'p']].sum()
    c = np.log((day.g.rolling(W, min_periods=10).sum().shift(1) + 20) / (day.p.rolling(W, min_periods=10).sum().shift(1) + 20)).fillna(0)
    return ne.dnum.map(c).values
for name, (cols, m) in M.items():
    raw = m.predict(ne[cols]); ne['c_' + name] = recal(raw)
    ne['p_' + name] = 1 / (1 + np.exp(-(np.log(raw / (1 - raw)) + ne['c_' + name])))
pickle.dump({k: (cols, m.model_to_string()) for k, (cols, m) in M.items()}, open('models_prod.pkl', 'wb'))

GROUPS_X = {
    'shooter skill': [c for c in M['new_stat'][0] if c.startswith('sh_') and c not in ('sh_shift',) and not c.startswith('sh_edge')],
    'shot speed': SPEED,
    'goalie': [c for c in M['new_stat'][0] if c.startswith('g_') and c != 'g_faced'],
    'shift length / league level': CTX,
}
def explain(rows):
    fn = M['new_stat'][1].feature_name(); cn = M['new_stat'][1].predict(rows[M['new_stat'][0]], pred_contrib=True)
    out = []
    for i in range(len(rows)):
        out.append({g: float(sum(cn[i][fn.index(c)] for c in cols if c in fn)) for g, cols in GROUPS_X.items()})
    return out
cur = ne[ne.season == 2026].copy(); cur['mult'] = cur.p_new_stat / cur.p_standard
summary = dict(shots=len(cur), mult_p10=float(cur.mult.quantile(.1)), mult_p50=float(cur.mult.median()), mult_p90=float(cur.mult.quantile(.9)))
print(json.dumps(summary))
who = int(sys.argv[1]) if len(sys.argv) > 1 else 8481604     # Dorofeyev
rows = cur[cur.shooter == who].tail(12)
for (_, r), e in zip(rows.iterrows(), explain(rows)):
    tops = ', '.join(f"{k} {'+' if v > 0 else '−'}{abs(v):.2f}" for k, v in sorted(e.items(), key=lambda t: -abs(t[1])) if abs(v) >= 0.03)
    print(f"{r.date} P{int(r.period)} {r.type:<9} {r.dist:4.0f} ft {r.angle:3.0f}°  {'GOAL' if r.goal else '    '} standard {r.p_standard:.3f}  new {r.p_new_stat:.3f}  x{r.mult:.2f}  [{tops}]")
cur[['date', 'game', 'period', 't', 'shooter', 'goalie', 'goal', 'dist', 'angle', 'type', 'p_standard', 'p_new_stat', 'mult']].to_parquet('current_season_scored.parquet')
