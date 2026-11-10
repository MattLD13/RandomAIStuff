# v3 candidates vs frozen-v2 recipe, rolling origin (each test season trained on the two before it).
#   features: zone entry / rush (ENTRY), line-change detail (CHANGE2), placebo control
#   tuning: chosen on the 2024-25 fold only, confirmed on 2025-26 + 2026-27
#   policy: refit at the start of every month on the previous 730 days vs one fit per season
# Keep rule (fixed before running): pooled 2025-26 + 2026-27 gain over v2 with 95% game-level CI above 0,
# positive on 2024-25, and larger than the placebo's.
import sys, json
import numpy as np, pandas as pd, lightgbm as lgb
exec(open('common.py').read())
ENTRY = ['t_since_out_oz', 't_since_own_dz', 'n_ev_since_entry', 'prev2_type_code', 'prev2_dt']
CHANGE2 = ['tm_fresh5', 'op_fresh5', 'op_d_shift_min', 'op_f_shift_min']
V2 = BASE + CTX + CHANGE + SPEED
df = pd.read_parquet('shots_feat2.parquet')
for c in CAT: df[c] = df[c].astype('category')
ne = df[(df.en == 0) & (df.season >= 2021)].sort_values(['dnum', 'game', 'so']).reset_index(drop=True)
def recal(p, W=35):
    day = pd.DataFrame({'d': ne.dnum.values, 'g': ne.goal.values, 'p': p}).groupby('d')[['g', 'p']].sum()
    c = np.log((day.g.rolling(W, min_periods=10).sum().shift(1) + 20) / (day.p.rolling(W, min_periods=10).sum().shift(1) + 20)).fillna(0)
    return 1 / (1 + np.exp(-(np.log(p / (1 - p)) + ne.dnum.map(c).values)))
def ll(y, q): q = np.clip(q, 1e-6, 1 - 1e-6); return -(y * np.log(q) + (1 - y) * np.log(1 - q))
def boot(d, a, b, B=2000):
    e = ll(d.goal.values, d[a].values) - ll(d.goal.values, d[b].values)
    gs = pd.Series(e).groupby(d.game.values).agg(['sum', 'size']); s, n = gs['sum'].values, gs['size'].values
    idx = np.random.default_rng(6).integers(0, len(s), (B, len(s))); bs = s[idx].sum(1) / n[idx].sum(1)
    return f"{s.sum() / n.sum() * 1e4:+6.2f} [{np.percentile(bs, 2.5) * 1e4:+6.2f}, {np.percentile(bs, 97.5) * 1e4:+6.2f}]"
def fit_pred(cols, tr, params=None, rounds=1000):
    m = lgb.train(dict(P, num_threads=4, **(params or {})), lgb.Dataset(tr[cols], tr.goal), rounds)
    return m.predict(ne[cols])
SETS = {'v2': V2, 'v2+entry': V2 + ENTRY, 'v2+change2': V2 + CHANGE2, 'v3': V2 + ENTRY + CHANGE2, 'v2+placebo': V2 + PLACEBO}
TUNE = {'t15_300_1000': (dict(), 1000), 't31_300_1000': (dict(num_leaves=31), 1000), 't15_1000_1000': (dict(min_data_in_leaf=1000), 1000),
        't15_300_1600': (dict(), 1600), 't7_300_2000': (dict(num_leaves=7), 2000)}
part = sys.argv[1] if len(sys.argv) > 1 else 'features'
P_ = {}
for test in [2024, 2025, 2026]:
    tr = ne[(ne.season >= test - 2) & (ne.season < test)]
    if part == 'features':
        for k, cols in SETS.items(): P_[(test, k)] = recal(fit_pred(cols, tr)); print(test, k, flush=True)
    elif part == 'tune':
        cols = V2 + ENTRY + CHANGE2 if json.load(open('v3_choice.json')).get('features') == 'v3' else V2
        for k, (pp, r) in TUNE.items(): P_[(test, k)] = recal(fit_pred(cols, tr, pp, r)); print(test, k, flush=True)
    elif part == 'monthly':
        ch = json.load(open('v3_choice.json')); cols = SETS[ch['features']]; pp, r = TUNE[ch['tune']]
        P_[(test, 'season_fit')] = recal(fit_pred(cols, tr, pp, r))
        p = np.full(len(ne), np.nan); dates = pd.to_datetime(ne.date)
        months = sorted(set(pd.Timestamp(y, m_, 1) for y, m_ in zip(dates[ne.season == test].dt.year, dates[ne.season == test].dt.month)))
        for i, st in enumerate(months):
            a = st.toordinal(); b = months[i + 1].toordinal() if i + 1 < len(months) else 10 ** 9
            trm = ne[(ne.dnum < a) & (ne.dnum >= a - 730)]
            mask = (ne.dnum >= a) & (ne.dnum < b) & (ne.season == test)
            m = lgb.train(dict(P, num_threads=4, **pp), lgb.Dataset(trm[cols], trm.goal), r)
            p[mask.values] = m.predict(ne.loc[mask, cols]); print(test, st.date(), len(trm), flush=True)
        p[np.isnan(p)] = 0.07
        P_[(test, 'monthly')] = recal(p)
names = sorted(set(k for _, k in P_))
T = ne[ne.season.isin([2024, 2025, 2026])].copy()
for k in names: T['q_' + k] = np.select([T.season == s for s in [2024, 2025, 2026]], [P_[(s, k)][T.index[T.season == s]] if False else P_[(s, k)][T.index] for s in [2024, 2025, 2026]])
ref = {'features': 'v2', 'tune': 't15_300_1000', 'monthly': 'season_fit'}[part]
for title, x in [('2024-25 (fold used for tuning choices)', T[T.season == 2024]), ('2025-26', T[T.season == 2025]), ('2026-27', T[T.season == 2026]),
                 ('pooled 2025-26 + 2026-27', T[T.season.isin([2025, 2026])])]:
    print(f'\n== {title} ({len(x)} shots)')
    for k in names: print(f"  {k:<16} logloss {ll(x.goal.values, x['q_' + k].values).mean():.5f}" + ('' if k == ref else f"   gain vs {ref}: {boot(x, 'q_' + ref, 'q_' + k)}"))
