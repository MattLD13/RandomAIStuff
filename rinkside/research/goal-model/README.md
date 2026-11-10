# Shot Goal Probability (SGP)

A model of the chance that a shot becomes a goal. It starts from the usual expected-goals inputs (where the shot came from, what happened just before it) and then adds what is known about **who is shooting, who is in net, and the state of the shift**. It was built and tested on 7,700 NHL regular-season games (2020-21 to 2026-27, 661,682 unblocked shots).

On a season it never saw during development (2025-26, sealed until the end), it beat MoneyPuck's expected goals, a conventional expected-goals model built the same way, and the xG Rinkside uses today. All five pass/fail tests that were written down before that season was opened came out as passes.

## Contents
1. [What it does](#1-what-it-does)
2. [How it works](#2-how-it-works)
3. [What we tested and threw out](#3-what-we-tested-and-threw-out)
4. [How we kept ourselves honest](#4-how-we-kept-ourselves-honest)
5. [Results on the sealed season](#5-results-on-the-sealed-season)
6. [Limitations](#6-limitations)
7. [Files and how to reproduce](#7-files-and-how-to-reproduce)
8. [Sources](#8-sources)

## 1. What it does

For every unblocked shot attempt (shot on goal, goal or missed shot, not into an empty net), SGP gives the probability that it is a goal. It also gives a **multiplier against standard xG**:

```
multiplier = SGP / standard xG
```

`standard xG` is the same model with every player-specific input removed. A multiplier of 1.30 means "a normal shooter against a normal goalie scores this shot 10% of the time, but this shooter against this goalie scores it 13% of the time." In 2026-27 so far, 80% of shots sit between 0.68× and 1.45× (10th to 90th percentile), with a median of 1.03×.

Example: Pavel Dorofeyev, NYR @ EDM, 2026-11-09, 2nd period, wrist shot from 7 ft at an 8° angle:

| | Chance of a goal |
|---|---|
| Standard xG | 16.9% |
| SGP | 21.7% (×1.29) |
| Main reasons | his finishing record (+0.17 log-odds), shift and league context (+0.12) |

His recent scoring is not part of it either way. Streaks were tested and do not predict goals (see section 3), so SGP neither marks a player down for a dry spell nor up for a hot week.

## 2. How it works

SGP is a gradient-boosted tree model (LightGBM, 59 inputs, 15-leaf trees, learning rate 0.03), followed by a calibration step. The sealed-test fit used 1,415 rounds; the production refit, which has one more season of data, uses 20% more. The inputs fall into six groups. Every input uses only information available before the shot. Shooter and goalie histories use earlier games only.

### 2.1 The shot itself (the "standard xG" inputs, 34)
- **Location:** distance, angle, x and y (turned so every team attacks the same end), and whether the shot is from behind the goal line.
- **Shot type:** wrist, snap, slap, backhand, tip-in, deflection, wrap-around, bat, poke, between the legs.
- **The play before the shot:**
  - the type of the previous event, whether the same team made it, and the time and distance since it;
  - puck speed between the two events;
  - for a rebound, how far the angle changed and how fast;
  - rush (the previous event was outside the zone, within 4 seconds);
  - quick east-west movement;
  - other attempts by the same team in the last 10 seconds;
  - time since the faceoff, and whether that faceoff was in the offensive zone.
- **Game state:** skaters for each team, extra attacker, score difference, period, game time, home or away.
- **Handedness:** shooter and goalie, and whether the shooter is on his off wing.
- **The goalie's workload so far this game:** shots he has already faced.

### 2.2 Shooter skill (8)
These measure how a shooter finishes compared with standard xG, with older shots counting less. Each shot's weight falls by 0.2% for every later shot he takes, so roughly his last 500 shots matter most.
- **Overall finishing:** `log((goals + 4) / (xG + 4))`. The `+4` pulls small samples toward average, so a player needs many shots before the model trusts a hot or cold record.
- **Finishing from this area:** inner slot, home plate, perimeter, or long range.
- **Finishing with this shot type.**
- **Finishing this season.**
- **Habits:** share of attempts that hit the net, average shot distance, attempts per 60 minutes.
- **Relative to the league:** every finishing number has the league-wide average of the previous 30 game days subtracted. Without this, small drifts in league scoring made the whole league look like bad finishers in later seasons (see 4.4).

### 2.3 Shot speed (3)
From NHL EDGE, the player's **previous** season: average shot speed, top shot speed, and number of 90+ mph attempts. EDGE does not publish the speed of individual shots, so this is a season-level property of the player. Using the previous season keeps future information out.

This was the strongest group on its own. It passed the significance test in both development seasons (section 3).

### 2.4 Goalie (7)
Built like shooter skill, but measuring saves. Weights fall by 0.07% per shot faced, so roughly the last 1,400 shots matter most.
- **Overall saving:** decayed goals against vs xG, relative to the league.
- **Saving from this area of the ice.**
- **Saving this season.**
- **Condition:** days of rest, back-to-back, age.

### 2.5 Shift and league context (7)
- **Shift lengths:** how long the shooter has been on the ice this shift, and how long his teammates and the defenders have been on (average and longest). The idea is that tired defenders give up better chances.
- **Personnel:** number of defensemen and forwards on the ice for the shooting team.
- **League scoring level:** goals vs base xG across the league over the last 15,000 shots.

Shift data comes from the NHL shift charts. 107 games (1.4%) have none, and those inputs are left blank there.

### 2.6 Calibration
After the model, every prediction's log-odds is shifted by

```
log( (goals + 20) / (predicted + 20) )   over the previous 35 game days
```

This keeps season totals honest when league-wide scoring or scorekeeping drifts. On the sealed season, the totals came out within 1.1% of actual goals.

### 2.7 Training
- **For the sealed test:** trained on 2021-22 to 2024-25. 2020-21 only seeds the player histories.
- **For production:** `prod.py` refits on 2021-22 to 2025-26.
- **Base xG used in player histories:** cross-fitted, so each training season's base xG comes from a model that never saw that season.

## 3. What we tested and threw out

Each idea was added as a group, and the test measured how much worse the full model got when that group was removed. A group of **pure random numbers** was included as a control. Numbers are the loss in log loss × 10,000 (bigger = the group matters more), with 95% game-level bootstrap intervals.

| Group | Idea / research behind it | 2024-25 | 2026-27 | Verdict |
|---|---|---|---|---|
| Shot speed | Harder shots beat goalies | **+3.8** [2.2, 5.4] | **+8.5** [4.6, 12.8] | **Kept**, passed after correction |
| Goalie skill | Goalies differ in saving | **+3.8** [2.1, 5.6] | +4.9 [0.0, 9.5] | **Kept** |
| Shooter skill | Finishing talent exists but is noisy | +2.3 [0.3, 4.1] | +3.5 [−1.8, 8.7] | **Kept** |
| Shift / league context | Fatigue; scoring environment | +1.6 [−0.4, 3.4] | +4.8 [0.2, 8.9] | **Kept** |
| Linemates | Better passers set up better shots | −0.2 | +1.6 | Dropped: no better than noise |
| Momentum | Goals change the next minutes | −0.8 | +1.9 | Dropped: no better than noise |
| Travel / rest | Jet lag and travel hurt (Charest et al.) | −0.9 | −0.7 | Dropped: no better than noise |
| Arena bias | Scorekeepers log distance differently by rink | +0.8 | +0.2 | Dropped: no better than noise |
| Streaks / hot hand | Recent form, shots since last goal, goals in last 5 | −0.5 | +4.4 | Dropped: sign flips |
| Revenge game | Facing an old team | +1.2 | +3.0 | Dropped: not confirmed |
| *Placebo (random noise)* | *the control* | *+0.4* | *+1.8* | — |

**Two separate decisions.**
- *Which groups pass on their own:* only **shot speed** passed the strict per-group rule (helps in both development seasons, interval above zero after Holm correction).
- *Which model goes into the sealed test:* that was chosen by comparing whole candidate models on both development seasons (`results/dev_candidates.txt`). The model with shooter skill, shot speed, goalie skill and context was best in both seasons (+20.0 and +23.4 vs standard xG). Both it and the speed-only model were registered and scored on the sealed season, and the larger model won there too (+8.5, interval +4.7 to +12.1).

How this lines up with the research:
- **Streaks:** published NHL work finds no hot hand. One study found a slightly *negative* effect after scoring (Vesper), and playoff goalies show none (Morrison et al.). Our data agrees: hot and cold streaks don't predict the next shot once real skill is accounted for.
- **Momentum:** the finding that "scoring first" helps the team that conceded slightly also fits: no usable momentum effect.
- **Travel:** travel and jet lag effects were small and inconsistent in the literature, and add nothing at the level of a single shot.
- **Arena bias:** scorekeeper bias is real, but it has been shrinking in recent seasons, and the model already sees enough location detail.
- **Skipped without testing:** pressure, timeouts and contract years. The published evidence finds no average effect, and testing everything that *might* matter is how you end up fooling yourself.

Adding all the dropped groups back made the model **worse** on both development seasons, in log loss and in season totals. Removing them was not just tidiness.

## 4. How we kept ourselves honest

### 4.1 A sealed season
2025-26 was set aside as the control. No model was scored on it, and no setting was chosen from it, until the end.
- **Development seasons:** all choices used 2024-25 (validation and early stopping) and 2026-27 to date.
- **Still used as history:** 2025-26 shots fed the player histories for 2026-27, as they would live. No model was scored on them.
- **Disclosures:**
  - Round 1, before the seal was set up, printed summary numbers for 2025-26 once. The two decisions taken from round 1 (fix the drift; drop streaks) both show up in 2024-25 on its own.
  - Some quick descriptive tables (goals vs xG for back-to-backs and so on) once pooled all seasons, including 2025-26. No model was scored and nothing was chosen from them.

### 4.2 Pre-registration
Before the sealed season was opened, the following were written to `prereg.json`:
- the exact features of the final model;
- training seasons and number of rounds;
- the calibration rule;
- five pass/fail criteria.

The file was fingerprinted (SHA-256 `f7350036…4b54`, in `prereg.sha256`) and committed to git (commit `f227eaa`) **before** `final.py` ran. `final.py` refuses to run if the file has changed.

### 4.3 Tests against fooling ourselves
- **Game-level bootstrap:** every comparison resamples whole games (2,000–4,000 times), because shots in the same game aren't independent.
- **Leave-one-group-out:** each group's value is measured by retraining without it, not by "feature importance," which rewards any input the trees happen to split on.
- **Holm correction** across the 11 groups.
- **A placebo group:** random noise. A real group has to beat it.
- **Two development seasons:** a group had to help in both.
- **Calibration checked separately from ranking:** predicted season totals vs actual, and calibration error over 20 bins.

### 4.4 Mistakes the tests caught
- **Talent drift.** Raw shooter and goalie history kept growing across seasons, so test seasons had longer histories than the model had trained on. Predicted goals were 5–13% too high. Fix: weights that fade with time, league-relative skill, and the calibration step.
- **Streaks.** They looked plausible and appeared to help in one development season, but the effect flipped sign in the other.

## 5. Results on the sealed season

2025-26 regular season: 110,317 unblocked non-empty-net shots that MoneyPuck also has (99.3% of ours), 7,559 goals.

| Model | Log loss | Skill vs base rate | AUC | Brier | Predicted / actual | Calibration error |
|---|---|---|---|---|---|---|
| **SGP** | **0.21506** | **13.90%** | **0.779** | **0.05853** | 7,645 / 7,559 | **0.0023** |
| Shot-speed-only model | 0.21592 | 13.56% | 0.775 | 0.05864 | 7,629 | 0.0027 |
| Standard xG (same pipeline) | 0.21681 | 13.21% | 0.771 | 0.05879 | 7,585 | 0.0032 |
| MoneyPuck xGoal | 0.21784 | 12.79% | 0.769 | 0.05864 | 7,529 | 0.0148 |
| Rinkside xG today | 0.22698 | 9.13% | 0.739 | 0.06119 | 7,563 | 0.0094 |

**SGP vs each model:** log loss × 10,000, game-level bootstrap. Positive means SGP is better.

| SGP vs | Difference | 95% interval | Resamples where SGP is better |
|---|---|---|---|
| MoneyPuck | +27.7 | +15.0 to +40.2 | 99.98% |
| Standard xG | +17.4 | +12.9 to +21.9 | 100% |
| Shot-speed-only | +8.5 | +4.7 to +12.1 | 100% |
| Rinkside xG today | +119.2 | +110.8 to +127.5 | 100% |

**Subsets:**

| Subset | SGP | MoneyPuck | Standard xG |
|---|---|---|---|
| 5v5, log loss | 0.19676 | 0.21308 | 0.19871 |
| Shots on goal only, log loss | 0.29414 | 0.29942 | 0.29703 |

**Players:**

| Test | SGP | MoneyPuck | Standard xG | Other |
|---|---|---|---|---|
| Shooters (60+ shots), season goals vs predicted: RMSE | **3.32** | 4.01 | 3.72 | |
| Goalies (400+ shots), goals against vs predicted: RMSE | 11.72 | **11.46** | 12.20 | |
| Split-half: odd-game prediction vs even-game goals per shot (519 shooters) | **0.639** | 0.564 | 0.608 | 0.452 using actual odd-game goals |

**Pre-registered criteria:**

| Criterion | Result |
|---|---|
| 1. Beats MoneyPuck, interval above 0 | PASS |
| 2. Beats standard xG, interval above 0 | PASS |
| 3. Beats Rinkside xG today, interval above 0 | PASS |
| 4. Season total within 3% | PASS (+1.1%) |
| 5. Split-half ≥ MoneyPuck and standard | PASS |

**How big is the gain?** A 1.3% log-loss improvement over MoneyPuck sounds small, but goals are rare and mostly luck. On this dataset the whole gap between "no model at all" and a good xG model is only about 13%. SGP's +27.7 is about a tenth of MoneyPuck's total skill. The player tests show the practical effect most clearly: SGP's season predictions for shooters are 17% closer than MoneyPuck's, and it predicts a player's future scoring rate better than his own past goals do.

## 6. Limitations

- **Goalie season totals:** MoneyPuck is slightly closer (RMSE 11.5 vs 11.7). SGP's goalie inputs help shot by shot, but don't beat MoneyPuck on goalie totals.
- **History starts in 2020-21:** a veteran's record before then is unknown, so he starts near average and the model learns him over his first few hundred shots of our data.
- **Shot speed:** previous season only, from 2021-22 on. Missing for rookies and for 2021-22 itself.
- **Shots on goal only:** SGP is built for all unblocked attempts. If you want "this shot is on net, will it go in?", that would need its own model.
- **Not in the public data:** passes before a shot (except on goals), screens, where the goalie was standing, puck height, and the speed of each individual shot.
- **One sealed season:** 2025-26 is one season. The development seasons point the same way, but more seasons would tighten the intervals.
- **MoneyPuck comparison:** we compare against the xGoal values MoneyPuck publishes. Its models may be fitted in-season, which if anything would favor MoneyPuck.

## 7. Files and how to reproduce

Copy `scripts/` and `prereg.json` / `prereg.sha256` into one working folder and run everything from there: the scripts read each other (`common.py`, `rk.py`) and write `raw/`, `shifts/` and several parquet files next to themselves. Python needs `pandas`, `pyarrow`, `lightgbm` and `scikit-learn`; the downloaders need Node 18+.

| Step | Script | What it does |
|---|---|---|
| 1 | `scripts/fetch.mjs <season> <games>` | NHL play-by-play per game (only the fields the model needs, gzipped) |
| 2 | `scripts/rosters.mjs`, `scripts/careers.mjs` | Handedness, positions, birth dates; career team history |
| 3 | `scripts/shifts.mjs`, `scripts/edge.mjs` | Shift charts; previous-season EDGE shot speeds |
| 4 | `scripts/build.py` | One row per unblocked shot, with location and play context |
| 5 | `scripts/model.py` → `scripts/streak.py` | Cross-fitted base xG; round-1 history and streak features |
| 6 | `scripts/history2.py` → `revenge.py` → `context3.py` → `relfeat.py` | Round-2 features (decayed skill, area and type finishing, speed, shifts, linemates, revenge, momentum, travel, arena, placebo, league-relative) |
| 7 | `scripts/eval3.py` | Leave-one-group-out tests with bootstrap, Holm and placebo (development seasons only) |
| 8 | `scripts/eval4.py` | Candidate models with and without calibration (development seasons only) |
| 9 | `prereg.json`, `prereg.sha256` | The locked pre-registration |
| 10 | `scripts/final.py` | The one-time sealed test (`results/sealed.json`, `results/sealed.txt`) |
| 11 | `scripts/prod.py [playerId]` | Production refit on 2021-26, multipliers and explanations for the current season |

`scripts/common.py` holds the feature lists and model settings. `scripts/rk.py` is Rinkside's current xG recipe, refitted for comparison.

`eval.py`, `eval2.py`, `tune.py` and `explain.py` are the round-1 and early round-2 versions, kept for the record.

Downloaded data and model files are not committed. They are about 300 MB and can be rebuilt with steps 1–3, which take roughly 20 minutes at the NHL API's rate limits. MoneyPuck shot files for the comparison: `https://peter-tanner.com/moneypuck/downloads/shots_<year>.zip`.

## 8. Sources

Research consulted for feature ideas, and the checks above:
- Noel, *Expected by Whom? A Skill-Adjusted Expected Goals Model for NHL Shooters and Goaltenders* (2025), [arXiv:2511.07703](https://arxiv.org/abs/2511.07703). The closest published model. It reports 1–5% log-loss gains from skill on 5v5 shots on goal, without shrinkage, calibration checks or a MoneyPuck comparison.
- Morrison et al., *Do NHL goalies get hot in the playoffs?* (2021), [arXiv:2102.09689](https://arxiv.org/abs/2102.09689): no goalie hot hand.
- *Putting the "Hot Hand" on Ice*, [Chance](https://chance.amstat.org/?p=9557), and Vesper (2015): slightly negative skater hot hand.
- *"This is fine": blowouts and subsequent game performance in the NHL*, [PMC10800907](https://www.ncbi.nlm.nih.gov/pmc/articles/PMC10800907/).
- Charest et al., travel and circadian effects in the NHL, *J Sci Med Sport* (2022), [record](https://lida.sport-iat.de/twm/Record/4082003).
- Goalie rest and back-to-backs: [Hockey-Graphs, Goaltender Performance vs Rest](https://hockey-graphs.com/2014/12/01/goaltender-performance-vs-rest/), and [McMaster load-management cohort study](https://experts.mcmaster.ca/display/publication3464413).
- Scorekeeper and rink bias: [HockeyViz, scorer bias](https://www.hockeyviz.com/txt/scorerBias), [Puck Over the Glass](https://puckovertheglass.substack.com/p/something-strange-is-going-on-with), and [hockeystats.com xG methodology](https://hockeystats.com/methodology/expected-goals).
- Performance under pressure and shootouts: [Goaltenders Under Pressure](https://www.scapps.org/jems/index.php/1/article/view/3982), and [Performance Under Pressure, NHL](https://econpapers.repec.org/RePEc:jsf:intjsf:v:7:y:2012:i:3:p:213-231).
- Contract years: [IZA DP 16836](https://docs.iza.org/dp16836.pdf), and [Henke](https://www.uoguelph.ca/economics/sites/uoguelph.ca.economics/files/public/images/Franz%20Henke%20Abstract.pdf).
- Timeouts: [Stop the Clock: Are Timeout Effects Real?](https://arxiv.org/abs/2009.06750).
- Data: NHL play-by-play, shift charts, rosters and EDGE (api-web.nhle.com, api.nhle.com). MoneyPuck shot data ([moneypuck.com/data.htm](https://moneypuck.com/data.htm)) for comparison only.
