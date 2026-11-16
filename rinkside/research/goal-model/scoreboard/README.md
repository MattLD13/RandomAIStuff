# Prospective scoreboard

Frozen models scored only on games played on or after **2026-11-11** (frozen 2026-11-10 21:10 UTC). Updated 2026-11-16 21:12 UTC.

**Verdict date: 2027-04-16** (end of the 2026-27 regular season). Weekly numbers before then are progress reports, not results: looking every week and stopping when it looks good would be fooling ourselves.

## Shot model: 38 games, 3130 shots, 219 goals

| Model | Log loss | AUC | Predicted goals |
|---|---|---|---|
| sgp | 0.21080 | 0.802 | 220 |
| sgp_monthly | 0.21150 | 0.799 | 218 |
| standard | 0.21263 | 0.796 | 218 |
| sgp_no_change | 0.21283 | 0.795 | 220 |
| moneypuck | 0.21328 | 0.793 | 224 |
| rinkside | 0.22188 | 0.773 | 219 |

SGP vs each model (log loss x 10,000, + = SGP better, 95% game-level bootstrap):

| vs | Gain | 95% interval | Resamples SGP better |
|---|---|---|---|
| sgp_no_change | +20.3 | -1.9 to +43.4 | 96% |
| standard | +18.3 | -12.8 to +49.8 | 88% |
| sgp_monthly | +7.0 | -0.2 to +14.4 | 97% |
| rinkside | +110.8 | +58.3 to +163.4 | 100% |
| moneypuck | +24.8 | -20.1 to +72.6 | 86% |

Excluding the 16 shots MoneyPuck marks with 0 s defender time on ice (a stoppage artifact that leaks the result): SGP vs MoneyPuck +44.6 (+7.5 to +84.5). Indicative only, since that field is related to the outcome.

By strength (log loss):

| | Shots | sgp | sgp_no_change | standard | sgp_monthly | rinkside | moneypuck |
|---|---|---|---|---|---|---|---|
| 5v5 | 2472 | 0.19416 | 0.19691 | 0.19635 | 0.19476 | 0.20575 | 0.19666 |
| other strengths | 658 | 0.27334 | 0.27265 | 0.27379 | 0.27441 | 0.28246 | 0.27572 |

MoneyPuck's xG is known to use outcome-related fields on some shots (e.g. power-play goals); compare at 5v5 for the cleanest read.
Coverage: MoneyPuck 99.2% of shots; our inputs: shift data 100.0%, handedness 100.0%, shot speed 96.2%.

## Chances tonight

| Target | Team-games | RMSE model | RMSE matchup avg | RMSE league avg |
|---|---|---|---|---|
| y_xgf | 76 | 0.801 | 0.828 | 0.897 |
| y_ff | 76 | 7.541 | 7.760 | 8.907 |
| y_hd | 76 | 4.478 | 4.498 | 4.713 |
| y_gf | 76 | 1.720 | 1.763 | 1.754 |

Early weeks are noisy: wait for the intervals to settle before reading much into them.
