from lib import *
ne = load()
for t in FOLDS:
    if not have('v2', t): save('v2', t, season_fit(ne, t)); print('v2', t, time.strftime('%H:%M:%S'), flush=True)
for t in FOLDS:
    if not have('m730', t): save('m730', t, refit(ne, t, log='m730'))
for t in FOLDS:
    if not have('placebo', t): save('placebo', t, season_fit(ne, t, cols=V2 + PLACEBO)); print('placebo', t, flush=True)
