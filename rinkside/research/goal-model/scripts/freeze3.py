# v2.1 freeze (replaces v2 before any game after the cutoff exists):
#   - 'unknown' shot type (only ever on goals: an outcome leak) is treated as missing
#   - SGP, the no-line-change challenger and standard xG are each an average of 5 seeds (log-odds)
#   - a retraining-rule challenger: refit monthly on the previous 730 days, 5 seeds
#   Rinkside's recipe, the chances models, the base-xG table and seeds are carried over from v2 unchanged.
import json, hashlib, gzip, os, shutil, datetime
import numpy as np, pandas as pd, lightgbm as lgb
exec(open('common.py').read())
OLD, OUT = 'frozen', 'frozen_v21'
shutil.rmtree(OUT, ignore_errors=True); shutil.copytree(OLD, OUT)
for f in os.listdir(OUT):
    if f.startswith(('sgp', 'standard')) and f.endswith('.txt.gz'): os.remove(f'{OUT}/{f}')
CUTOFF = '2026-11-11'; WINDOW = [2024, 2025]; ROUNDS = 1000; SEEDS = [1, 2, 3, 4, 5]
df = pd.read_parquet('shots_feat2.parquet')
df['type'] = df['type'].astype(str).replace({'unknown': np.nan, 'None': np.nan, 'nan': np.nan})
for c in CAT: df[c] = df[c].astype('category')
fit = df[(df.en == 0) & df.season.isin(WINDOW)]
V2 = BASE + CTX + CHANGE + SPEED
models = {'sgp': V2, 'sgp_no_change': BASE + CTX + SPEED, 'standard': BASE}
man = json.load(open(f'{OLD}/manifest.json'))
shot = {}
for name, cols in models.items():
    files = []
    for seed in SEEDS:
        m = lgb.train(dict(P, num_threads=4, seed=seed), lgb.Dataset(fit[cols], fit.goal), ROUNDS)
        fn = f'{name}_s{seed}.txt.gz'; gzip.open(f'{OUT}/{fn}', 'wt').write(m.model_to_string()); files.append(fn)
    shot[name] = dict(files=files, features=cols, calibrated=True); print(name, 'done', flush=True)
man.update(version='2.1', frozen_at=datetime.datetime.now(datetime.timezone.utc).strftime('%Y-%m-%d %H:%M UTC'), cutoff=CUTOFF,
           shot_models=shot,
           refit_policies={'sgp_monthly': dict(features=V2, rounds=ROUNDS, window_days=730, seeds=SEEDS, calibrated=True, warmup_days=70,
                                               note='challenger: refit on the 1st of each month on the previous 730 days, only earlier games')},
           note='v2.1. Scored only on regular-season games on or after the cutoff. Do not edit; a new freeze needs a new cutoff.')
files = sorted(f for f in os.listdir(OUT) if os.path.isfile(f'{OUT}/{f}') and f != 'manifest.json')
man['sha256'] = {f: hashlib.sha256(open(f'{OUT}/{f}', 'rb').read()).hexdigest() for f in files}
json.dump(man, open(f'{OUT}/manifest.json', 'w'), indent=1)
os.system(f'ls -la {OUT}; du -sh {OUT}')
