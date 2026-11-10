from lib import *
from sklearn.metrics import roc_auc_score
ne = load(); ne['mo'] = pd.to_datetime(ne.date).dt.strftime('%Y-%m')
for a, b in [(2022, 2023), (2023, 2024), (2024, 2025), (2025, 2026)]:
    x = ne[ne.season.isin([a, b])]; y = (x.season == b).astype(int).values; r = np.random.default_rng(0).random(len(x)) < 0.5
    cols = [c for c in V2 if c not in ['lg_env']+SPEED+['spos','hand','ghand','offwing']]
    m = lgb.train(dict(P, num_threads=1), lgb.Dataset(x[r][cols], y[r]), 200)
    print(a, b, 'AUC', round(roc_auc_score(y[~r], m.predict(x[~r][cols])), 4))
    imp = pd.Series(m.feature_importance('gain'), cols).sort_values(ascending=False); print((imp / imp.sum()).head(8).round(3).to_dict())
pd.set_option('display.width', 250)
print(pd.crosstab(ne.mo, ne.prev_type, normalize='index').round(3).to_string())
g = ne.groupby('mo').agg(n=('goal','size'), goal=('goal','mean'), reb=('rebound','mean'), rush=('rush','mean'), prev_dt0=('prev_dt', lambda s: (s==0).mean()), prev_dt_le2=('prev_dt', lambda s: (s<=2).mean()), fo_ozone=('fo_ozone','mean'), flurry=('flurry','mean'), cross=('cross','mean'), tm0=('tm_shift_min', lambda s:(s<=2).mean()), op0=('op_shift_min', lambda s:(s<=2).mean()), ongoal=('ongoal','mean'))
print(g.round(4).to_string())
x = ne.assign(z=(ne.prev_dt<=2)); print(x.groupby(['season','z']).goal.agg(['size','mean']).unstack().round(4))
x = ne.assign(z=(ne.prev_dt==0)); print(x.groupby(['season','z']).goal.agg(['size','mean']).unstack().round(4))
