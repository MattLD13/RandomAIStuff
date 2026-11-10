# v2 evaluation, rolling origin: every test season is predicted by models trained only on seasons before it.
#   A. training window (all / last 3 / last 2 / 0.7^age weights): chosen on the 2023-24 and 2024-25 folds, then
#      confirmed on 2025-26 and 2026-27
#   B. feature groups on that recent base, leave-one-group-out, placebo control, pooled over 2025-26 + 2026-27
#   C. hand-built skill features vs fitted player effects (peff.py)
import sys, json
import numpy as np, pandas as pd, lightgbm as lgb
exec(open('common.py').read())
PART = sys.argv[1] if len(sys.argv) > 1 else 'A'
df = pd.read_parquet('shots_feat2.parquet')
for c in CAT: df[c] = df[c].astype('category')
ne = df[(df.en == 0) & (df.season >= 2021)].sort_values(['dnum', 'game', 'so']).reset_index(drop=True)
pe = pd.read_parquet('peff.parquet') if PART == 'C' else None
if pe is not None: ne = ne.merge(pe, on=['game', 'so'], how='left')
R_ = lambda cols: [c + '_rel' if c + '_rel' in df.columns else c for c in cols]
SKILL = R_(SHOOT) + SPEED + R_(GOAL)
SGP1 = BASE + SKILL + CTX
PP = dict(P, num_threads=4)
def recal(p, W=35):
    day = pd.DataFrame({'d': ne.dnum.values, 'g': ne.goal.values, 'p': p}).groupby('d')[['g', 'p']].sum()
    c = np.log((day.g.rolling(W, min_periods=10).sum().shift(1) + 20) / (day.p.rolling(W, min_periods=10).sum().shift(1) + 20)).fillna(0)
    return 1 / (1 + np.exp(-(np.log(p / (1 - p)) + ne.dnum.map(c).values)))
def jitter(d, sd, seed):
    # training-only location noise (scorekeeper coordinates are only good to a foot or two): x, y moved, distance / angle recomputed
    d = d.copy(); r = np.random.default_rng(seed)
    d['x'] = d.x + r.normal(0, sd, len(d)); d['y'] = d.y + r.normal(0, sd, len(d))
    fx = 89 - d.x; d['dist'] = np.hypot(fx, d.y)
    d['angle'] = np.where(fx > 0, np.degrees(np.arctan2(d.y.abs(), fx)), 90 + np.degrees(np.arctan2(-fx, d.y.abs() + 1e-9)))
    d['behind'] = (fx < 0).astype(int)
    return d
def train(cols, test, window, rounds=1000, noise=0.0):
    prior = ne[(ne.season < test)]
    if window == 'last2': prior = prior[prior.season >= test - 2]
    elif window == 'last3': prior = prior[prior.season >= test - 3]
    w = 0.7 ** (test - 1 - prior.season.values) if window == 'w07' else None
    if noise: prior = jitter(prior, noise, int(test * 10 + noise))
    m = lgb.train(PP, lgb.Dataset(prior[cols], prior.goal, weight=w), rounds)
    return recal(m.predict(ne[cols]))
def ll(y, q): q = np.clip(q, 1e-6, 1 - 1e-6); return -(y * np.log(q) + (1 - y) * np.log(1 - q))
def boot(d, a, b, B=2000):
    e = ll(d.goal.values, d[a].values) - ll(d.goal.values, d[b].values)
    gs = pd.Series(e).groupby(d.game.values).agg(['sum', 'size']); s, n = gs['sum'].values, gs['size'].values
    idx = np.random.default_rng(4).integers(0, len(s), (B, len(s))); bs = s[idx].sum(1) / n[idx].sum(1)
    return s.sum() / n.sum() * 1e4, np.percentile(bs, 2.5) * 1e4, np.percentile(bs, 97.5) * 1e4, max(2 * min((bs <= 0).mean(), (bs >= 0).mean()), 1 / B)
out = {}
if PART == 'A':
    for test in [2023, 2024, 2025, 2026]:
        for name, cols in [('std', BASE), ('sgp', SGP1)]:
            for win in ['all', 'last3', 'last2', 'w07']:
                if test - 2021 < 3 and win == 'last3': continue
                k = f'{name}_{win}'; ne[f'p_{test}_{k}'] = train(cols, test, win)
                x = ne[ne.season == test]; out.setdefault(test, {})[k] = float(ll(x.goal.values, x[f'p_{test}_{k}'].values).mean())
                print(test, k, round(out[test][k], 5), flush=True)
    json.dump(out, open('eval6_A.json', 'w'), indent=1)
else:
    WIN = json.load(open('window.json'))['window']
    if PART == 'D':   # random location noise in training: does it stop over-fitting?
        for test in [2024, 2025, 2026]:
            for nz in [0.0, 1.0, 2.0]:
                ne[f'p_{test}_n{nz}'] = train(SGP1, test, WIN, noise=nz); x = ne[ne.season == test]
                print(test, 'noise', nz, round(float(ll(x.goal.values, x[f'p_{test}_n{nz}'].values).mean()), 5), flush=True)
            x = ne[ne.season == test]
            for nz in [1.0, 2.0]:
                e, lo, hi, p = boot(x, f'p_{test}_n{nz}', f'p_{test}_n0.0'); print(f'  {test} no-noise vs noise {nz}: {e:+.2f} [{lo:+.2f}, {hi:+.2f}] (+ = noise hurts)', flush=True)
        sys.exit(0)
    if PART == 'B':
        FULL = BASE + SKILL + CTX + CHANGE + CHANGE_LAG + PLACEBO
        groups = dict(shooter=R_(SHOOT), speed=SPEED, goalie=R_(GOAL), context=CTX, change=CHANGE, change_lag=CHANGE_LAG, placebo=PLACEBO)
        sets = {'standard': BASE, 'full': FULL} | {f'-{g}': [c for c in FULL if c not in v] for g, v in groups.items()}
    else:   # C: on the lean base (location/context + shift context + line-change timing): do player inputs add anything?
        lam = json.load(open('window.json')).get('lam', 30)
        EFF = [f'sh_eff_{lam}', f'g_eff_{lam}']
        LEAN = BASE + CTX + CHANGE
        sets = {'lean': LEAN, 'lean+effects': LEAN + EFF, 'lean+handbuilt': LEAN + SKILL, 'lean+speed': LEAN + SPEED, 'lean_no_change': BASE + CTX}
    for test in [2025, 2026]:
        for k, cols in sets.items(): ne[f'p_{test}_{k}'] = train(cols, test, WIN); print(test, k, flush=True)
    T = ne[ne.season.isin([2025, 2026])].copy()
    for k in sets: T['q_' + k] = np.where(T.season == 2025, T[f'p_2025_{k}'], T[f'p_2026_{k}'])
    ref = 'full' if PART == 'B' else 'lean'
    res = {}
    for t in [2025, 2026, 'pooled']:
        x = T if t == 'pooled' else T[T.season == t]
        print(f'\n== {t}  ({len(x)} shots)')
        for k in sets: print(f"  {k:<16} logloss {ll(x.goal.values, x['q_' + k].values).mean():.5f}")
        for k in sets:
            if k == ref: continue
            e, lo, hi, p = boot(x, 'q_' + k, 'q_' + ref); res[f'{t}:{k}'] = [e, lo, hi, p]
            print(f"  {ref} vs {k:<14} {e:+6.2f} [{lo:+6.2f}, {hi:+6.2f}] p={p:.4f}")
    json.dump(res, open(f'eval6_{PART}.json', 'w'), indent=1)
