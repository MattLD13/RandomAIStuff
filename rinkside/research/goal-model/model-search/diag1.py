from lib import *
ne = load(); 
for t in FOLDS:
    p = get('v2', t); q = recal(ne, p); m = (ne.season == t).values
    print(t, 'raw', ll(ne.goal[m].values, p[m]).mean().round(5), 'recal', ll(ne.goal[m].values, q[m]).mean().round(5))
    x = ne[m].copy(); x['p'] = p[m]; x['q'] = q[m]; x['mo'] = pd.to_datetime(x.date).dt.strftime('%Y-%m')
    x['st'] = np.where(x.pp == 1, 'PP', np.where(x.sh == 1, 'SH', 'EV'))
    if t == 2024:
        for by in ['mo', 'type', 'st', 'period', 'rebound', 'rush']:
            g = x.groupby(by, observed=True).agg(n=('goal', 'size'), goals=('goal', 'sum'), q=('q', 'sum'), p=('p', 'sum'))
            g['ratio_q'] = g.goals / g.q; g['ratio_p'] = g.goals / g.p; print(g.round(3))
        x['db'] = pd.cut(x.q, [0, .01, .02, .04, .08, .15, .3, 1]); g = x.groupby('db', observed=True).agg(n=('goal', 'size'), goals=('goal', 'sum'), q=('q', 'sum')); g['r'] = g.goals / g.q; print(g.round(3))
# type share by season-month
ne['mo'] = pd.to_datetime(ne.date).dt.strftime('%Y-%m')
print(pd.crosstab(ne.mo, ne.type, normalize='index').round(3).to_string())
print(ne.groupby('mo')[['tm_shift_min','op_shift_min','sh_shift','sh_edge_avg','lg_env','since_fo','prev_dt','dist']].agg(lambda s: s.isna().mean()).round(3).to_string())
print(ne.groupby('mo')[['tm_shift_min','op_shift_min','sh_shift','sh_edge_avg','lg_env','since_fo','prev_dt','dist','goal']].mean().round(3).to_string())
