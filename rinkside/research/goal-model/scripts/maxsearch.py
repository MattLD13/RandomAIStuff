# Highest goal chance: (1) the real shots the model rates highest, (2) a search over the Shot Lab's controls.
import json, gzip, math, numpy as np, pandas as pd, lightgbm as lgb
exec(open('common.py').read())
man = json.load(open('frozen_v21/manifest.json')); spec = man['shot_models']['sgp']; FEAT = spec['features']
bs = [lgb.Booster(model_str=gzip.open('frozen_v21/' + f, 'rt').read()) for f in spec['files']]
cats = dict(zip([f for f in FEAT if f in CAT], bs[0].dump_model()['pandas_categorical']))
pre = json.load(open('../site/sgp_presets.json')); cal = pre['cal_next']
def pz(X):
    X = X.copy()
    for c in cats: X[c] = pd.Categorical(X[c], categories=cats[c])
    return np.mean([np.log((p := b.predict(X[FEAT])) / (1 - p)) for b in bs], 0)
# (1) real shots
df = pd.read_parquet('shots_feat2.parquet'); df['type'] = df['type'].astype(str).replace({'unknown': np.nan, 'None': np.nan, 'nan': np.nan})
ne = df[(df.en == 0) & (df.season >= 2024)].copy()
ne['p'] = 1 / (1 + np.exp(-(pz(ne) + cal)))
top = ne.sort_values('p', ascending=False).head(8)
print('REAL SHOTS, highest SGP (2024-25 to now):')
print(top[['date', 'game', 'period', 't', 'type', 'dist', 'angle', 'prev_type', 'prev_dt', 'rebound', 'own', 'opp', 'tm_shift_min', 'op_shift_min', 'goal', 'p']].round(3).to_string())
print('share of real shots above 50%:', round((ne.p > .5).mean() * 100, 3), '%  goals among them:', round(ne[ne.p > .5].goal.mean(), 3))
# (2) search the Lab's controls (same derived features as the page)
def derive(s):
    fx = 89 - s['x']; ay = abs(s['y']); f = dict(x=s['x'], y=s['y'], dist=math.hypot(fx, s['y']))
    f['angle'] = math.degrees(math.atan2(ay, fx)) if fx > 0 else 90 + math.degrees(math.atan2(-fx, ay + 1e-9)); f['behind'] = int(fx < 0)
    for k in ['type', 'hand', 'ghand', 'spos', 'prev_type']: f[k] = s[k]
    f['offwing'] = (1 if s['y'] < 0 else 0) if s['hand'] == 'L' else (1 if s['y'] > 0 else 0) if s['hand'] == 'R' else -1
    f['prev_same'] = int(s['prev_same']); f['prev_dt'] = s['prev_dt']; f['prev_x'] = s['px']; f['prev_y'] = s['py']
    f['prev_dist'] = math.hypot(s['x'] - s['px'], s['y'] - s['py']); f['prev_speed'] = f['prev_dist'] / max(s['prev_dt'], 1)
    reb = s['prev_type'] in ('shot-on-goal', 'missed-shot', 'blocked-shot') and s['prev_same'] and s['prev_dt'] <= 3; f['rebound'] = int(reb)
    if reb:
        pang = math.degrees(math.atan2(s['py'], max(89 - s['px'], .5))); cang = math.degrees(math.atan2(s['y'], max(fx, .5)))
        f['reb_angle'] = abs(cang - pang); f['reb_speed'] = f['reb_angle'] / max(s['prev_dt'], 1)
    else: f['reb_angle'] = 0; f['reb_speed'] = 0
    f['rush'] = int(s['prev_dt'] <= 4 and s['px'] < 25); f['cross'] = int(abs(s['py'] - s['y']) > 15 and s['prev_dt'] <= 2 and s['prev_same'])
    for k in ['since_fo', 'flurry', 'own', 'opp', 'sdiff', 'period', 'g_faced', 'lg_env', 'sh_shift', 'tm_shift_mean', 'op_shift_mean', 'op_shift_max', 'n_d_on', 'n_f_on', 'tm_shift_min', 'op_shift_min', 'sh_edge_avg', 'sh_edge_top', 'sh_edge_hard']: f[k] = s[k]
    f['fo_ozone'] = int(s['fo_ozone']); f['skdiff'] = s['own'] - s['opp']; f['pulled'] = int(s['pulled']); f['home'] = int(s['home'])
    f['t'] = (s['period'] - 1) * 1200 + s['elapsed']
    return f
GRID = dict(x=list(range(55, 100, 2)), y=list(range(-30, 31, 2)), type=[t for t in cats['type']], prev_type=list(cats['prev_type']), prev_same=[0, 1],
            prev_dt=[0, 1, 2, 3, 4, 6, 10, 20, 40], px=list(range(-60, 100, 8)), py=list(range(-40, 41, 8)), flurry=[0, 1, 2, 3, 4, 5], since_fo=[1, 5, 10, 20, 40, 80, 150, 300],
            fo_ozone=[0, 1], own=[3, 4, 5, 6], opp=[3, 4, 5, 6], pulled=[0, 1], sdiff=[-3, -2, -1, 0, 1, 2, 3], period=[1, 2, 3, 4], elapsed=[0, 60, 300, 600, 900, 1140, 1190],
            home=[0, 1], g_faced=[0, 5, 10, 20, 30, 45], lg_env=[-0.1, -0.05, 0, 0.05, 0.1], sh_shift=[2, 10, 30, 60, 100], tm_shift_mean=[5, 20, 40, 70, 110],
            op_shift_mean=[5, 20, 40, 70, 110, 150], op_shift_max=[10, 40, 80, 140, 200], n_d_on=[0, 1, 2, 3], n_f_on=[1, 2, 3, 4], tm_shift_min=[1, 2, 4, 8, 20, 50, 100],
            op_shift_min=[1, 2, 4, 8, 20, 50, 100], hand=['L', 'R', ''], spos=['C', 'L', 'R', 'D'], ghand=['L', 'R', ''], sh_edge_avg=[45, 52, 57, 62, 70], sh_edge_top=[70, 80, 88, 95, 102], sh_edge_hard=[0, 2, 6, 15, 30])
best = None
for p in pre['presets']:
    f = p['features']
    s = dict(x=f['x'], y=f['y'], type=f['type'] or 'wrist', hand=f['hand'], ghand=f['ghand'], spos=f['spos'], prev_type=f['prev_type'], prev_same=f['prev_same'], prev_dt=f['prev_dt'],
             px=f['prev_x'], py=f['prev_y'], flurry=f['flurry'], since_fo=f['since_fo'], fo_ozone=f['fo_ozone'], own=f['own'], opp=f['opp'], pulled=f['pulled'], sdiff=f['sdiff'],
             period=f['period'], elapsed=f['t'] - (f['period'] - 1) * 1200, home=f['home'], g_faced=f['g_faced'], lg_env=f['lg_env'], sh_shift=f['sh_shift'], tm_shift_mean=f['tm_shift_mean'],
             op_shift_mean=f['op_shift_mean'], op_shift_max=f['op_shift_max'], n_d_on=f['n_d_on'], n_f_on=f['n_f_on'], tm_shift_min=f['tm_shift_min'], op_shift_min=f['op_shift_min'],
             sh_edge_avg=f['sh_edge_avg'] or 57, sh_edge_top=f['sh_edge_top'] or 85, sh_edge_hard=f['sh_edge_hard'] or 2)
    zc = pz(pd.DataFrame([derive(s)]))[0]
    for sweep in range(4):              # coordinate ascent: try every grid value of each control, keep the best
        for k, vals in GRID.items():
            cand = [dict(s, **{k: v}) for v in vals]
            if k == 'elapsed' and s['period'] == 4: cand = [c for c in cand if c['elapsed'] <= 300]
            z = pz(pd.DataFrame([derive(c) for c in cand])); i = int(np.argmax(z))
            if z[i] > zc: zc, s = z[i], cand[i]
    if best is None or zc > best[0]: best = (zc, s)
zc, s = best
print('\nBEST COMBO in the Lab:', round(1 / (1 + math.exp(-(zc + cal))) * 100, 1), '%')
print(json.dumps(s)); f = derive(s); print('distance', round(f['dist'], 1), 'angle', round(f['angle'], 1), 'rebound', f['rebound'], 'rush', f['rush'], 'cross', f['cross'], 'reb_angle', round(f['reb_angle'], 1))
json.dump(dict(state=s, p=float(1 / (1 + math.exp(-(zc + cal))))), open('../site/best_combo.json', 'w'))
