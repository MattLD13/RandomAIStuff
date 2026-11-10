# Shot Goal Probability (SGP)

A model of the chance that a shot becomes a goal, built and tested on 7,700 NHL regular-season games (2020-21 to 2026-27, 661,682 unblocked shots).

## The current model: SGP v2

**Inputs:**
- the usual expected-goals inputs: where the shot came from, shot type, and what happened just before it;
- **shift context:** how long the shooter, his teammates and the defenders have been on the ice, and **how many seconds since each team's last line change**;
- the league's recent scoring level;
- **the shooter's shot speed** (NHL EDGE, previous season).

It is trained on the **two most recent complete seasons**.

v2 came out of an independent review of v1 (section 11) and a rolling-origin re-test (section 0). Every test season is predicted only from earlier seasons:

| What was tested (on the last-2-seasons base, 2025-26 + 2026-27 pooled) | Effect on log loss × 10⁻⁴ (+ = helps) |
|---|---|
| Train on the last 2 seasons instead of all 5 | **+14** and **+9** with SGP inputs; **+26** and **+19** for standard xG (2025-26, 2026-27) |
| Time since each team's last line change | **+20.3** [+17.3, +23.3] |
| Shift lengths and league scoring level | +4.9 [+2.8, +7.1] |
| Shooter's shot speed | +2.1 [+0.2, +3.9] |
| Shooter and goalie finishing / saving records (hand-built, v1) | −2.3 (hurts) |
| The same, fitted directly as player effects (regularized model) | +0.5 (not significant) |
| Random location noise in training (±1–2 ft) | −1 to −12 (hurts) |

**The finding that matters most:** once the model trains on recent seasons and knows the shift context, **a shooter's or goalie's track record doesn't help predict the next shot**. The one player trait that survives is shot speed. v1's apparent player-skill gains were mostly a training-window effect: older seasons scored shots differently, for example wrist shots fell from 56% to 41% of attempts between 2021-22 and 2026-27.

**Line-change timing** is new and large. Shots taken 1–3 seconds after either team changes score far less often than their location suggests (0.3–0.9× base xG, lowest at 1 second). The effect is a smooth ramp, not a spike, and it holds away from faceoffs. A frozen challenger without it is tracked on the scoreboard in case it turns out to be an artifact.

| 2025-26 log loss (that season has been looked at, so not a clean test) | |
|---|---|
| **SGP v2** | **0.2111** |
| SGP v1 (pre-registered) | 0.2151 |
| Standard xG, last 2 seasons | 0.2140 |
| MoneyPuck | 0.2178 |

**The clean test is still to come:** frozen v2 models scored on games played on or after **2026-11-11**, with a verdict at the end of the regular season (section 9). The rest of this README documents v1 and how we got here.

## 0. v2 tests (rolling origin)

`scripts/eval6.py`:
- **A:** training window, chosen on the 2023-24 and 2024-25 folds and confirmed on 2025-26 and 2026-27.
- **B:** feature groups with a placebo control.
- **C:** player inputs on the lean base.
- **D:** training noise.

Base xG is fitted walk-forward (`model.py`: each season from the two before it). Logs are in `results/v2_*.txt`. The review's minor fixes are all in:
- empty net decided by game state only;
- league level updated once per date;
- season-relative skill doesn't cross seasons;
- the chances table resets before game 1;
- HTML shift-report fallback;
- full handedness lookups.

## v1 (the original model)

A model of the chance that a shot becomes a goal. It starts from the usual expected-goals inputs (where the shot came from, what happened just before it) and then adds what is known about **who is shooting, who is in net, and the state of the shift**.

On the sealed test season (2025-26), it beat MoneyPuck's expected goals, a conventional expected-goals model built the same way, and the xG Rinkside uses today. All five pass/fail tests written down before that test came out as passes.

**An independent review (section 11) corrected two things.**
- **Most of SGP's gain over standard xG comes from training on recent data.** A standard xG trained on only the last two seasons does about as well as SGP. Player skill adds a real but smaller amount: about +3 to +8 × 10⁻⁴ log loss, not +17.
- **MoneyPuck is not a clean benchmark.** Its published xG uses fields that partly reveal the result on some shots.

Two follow-ups are documented here too:
- **A pre-game "chances tonight" model** (section 8). It passed its own sealed test and found that the dressed lineup matters for how many chances a team creates.
- **A weekly scoreboard** that scores the frozen models on games played after 2026-11-11 (section 9).

## Contents
1. [What it does](#1-what-it-does)
2. [How it works](#2-how-it-works)
3. [What we tested and threw out](#3-what-we-tested-and-threw-out)
4. [How we kept ourselves honest](#4-how-we-kept-ourselves-honest)
5. [Results on the sealed season](#5-results-on-the-sealed-season)
6. [Limitations](#6-limitations)
7. [More goalie data: tested, not added](#7-more-goalie-data-tested-not-added)
8. [Chances tonight: a team-game model](#8-chances-tonight-a-team-game-model)
9. [The weekly prospective scoreboard](#9-the-weekly-prospective-scoreboard)
10. [Files and how to reproduce](#10-files-and-how-to-reproduce)
11. [Independent review](#11-independent-review)
12. [Sources](#12-sources)

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

Shift data comes from the NHL shift charts. For 107 games the API has none: 57 in 2024-25, 50 in 2026-27, none in the sealed season. For the numbers in sections 3–8 those inputs were blank, which affected 18% of 2026-27 shots. The downloader now falls back to the NHL's HTML time-on-ice reports, which recovered all 107 games for the weekly scoreboard.

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

**A consistency note** (from the review): revenge (+1.2, +3.0) was dropped while context (+1.6, +4.8) was kept, though neither passed the per-group rule. Context made the final model only through the candidate comparison. Treat both as unconfirmed.

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
2025-26 was set aside as the control for every decision from round 2 onward. **Correction:** `prereg.json` says the test ran "before any model was scored on 2025-26", and an earlier version of this section said "no model was scored on it". Both are wrong as written. Round 1, before the seal existed, scored five models on 2025-26 against MoneyPuck (`results/round1.json`; all lost to MoneyPuck, the best at 0.2186 vs 0.21784). The registered model was built after that and scored on 2025-26 once.
- **Development seasons:** all choices used 2024-25 (validation and early stopping) and 2026-27 to date.
- **Still used as history:** 2025-26 shots fed the player histories for 2026-27, as they would live. No model was scored on them.
- **Disclosures:**
  - Round 1, before the seal was set up, evaluated models on 2025-26 (see the correction above). The two decisions taken from round 1 (fix the drift; drop streaks) both show up in 2024-25 on its own.
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
| 5. Split-half ≥ MoneyPuck and standard | PASS (but near-automatic: SGP's predictions include the shooter's own earlier goals, and the other models' don't; the same applies to the shooter RMSE row above) |

**How big is the gain?** A 1.3% log-loss improvement over MoneyPuck sounds small, but goals are rare and mostly luck. On this dataset the whole gap between "no model at all" and a good xG model is only about 13%. SGP's +27.7 is about a tenth of MoneyPuck's total skill. The player tests show the practical effect most clearly: SGP's season predictions for shooters are 17% closer than MoneyPuck's, and it predicts a player's future scoring rate better than his own past goals do.

## 6. Limitations

- **Goalie season totals:** on the sealed 2025-26 season MoneyPuck was slightly closer (RMSE 11.5 vs 11.7). Pooled over 2024-25 to 2026-27, SGP is closer (10.6 vs 11.3). More goalie data did not help (section 7).
- **2026-27 so far:** MoneyPuck's published current-season xG is ahead of SGP (log loss 0.2210 vs 0.2224 on 23,369 shots; 95% interval of the gap −3 to +31 × 10⁻⁴). The independent review traced more than all of that lead to a few shots MoneyPuck marks with 0 seconds of defender ice time. Those 156–174 shots score 25–29% of the time, against about 1% one second later: a stoppage artifact that partly reveals the result. Without them SGP leads (section 11). That exclusion uses an outcome-related field, so it is indicative; the weekly scoreboard reports both.
- **History starts in 2020-21:** a veteran's record before then is unknown, so he starts near average and the model learns him over his first few hundred shots of our data.
- **Shot speed:** previous season only, from 2021-22 on. Missing for rookies and for 2021-22 itself.
- **Shots on goal only:** SGP is built for all unblocked attempts. If you want "this shot is on net, will it go in?", that would need its own model.
- **Not in the public data:** passes before a shot (except on goals), screens, where the goalie was standing, puck height, and the speed of each individual shot.
- **One sealed season:** 2025-26 is one season. The development seasons point the same way, but more seasons would tighten the intervals.
- **MoneyPuck comparison:** we compare against the xGoal values MoneyPuck publishes, and those use outcome-related fields (section 11). In the 2021–2025 files, 5v4 shots where MoneyPuck's penalty-length field is 0 score 81% of the time and MoneyPuck predicts about 0.51. So its 5v4 numbers are inflated, and at 5v5 SGP's lead is much larger (0.1968 vs 0.2131 on 2025-26). "Beats MoneyPuck" is therefore true but not a like-for-like model comparison.

## 7. More goalie data: tested, not added

The one place SGP trailed MoneyPuck on the sealed season was goalie season totals, so we tried adding much more goalie information. Every input used only data from before the shot.

| Group | What it is |
|---|---|
| Career | Even-strength save % above league average, 2010-11 to last season (NHL stats API), decayed by season and shrunk; last season alone |
| EDGE | Last season's 5v5, close-game, high-, mid- and long-range save % above league average |
| Glove / blocker | Which side the shot is on, and his decayed record on that side |
| Shot type | Decayed record against this shot type |
| Rebound control | Share of his saves followed by another attempt within 3 seconds |
| Workload | Starts in the last 7 days, consecutive starts |
| Height | Inches |

These were tested like the rest: leave-one-group-out with a placebo group, pooled over 2024-25, 2025-26 and 2026-27 (244,276 shots). The keep rule was fixed before the run.

| | Log loss | Goalie season-total error (RMSE) |
|---|---|---|
| **SGP as is** | **0.21520** | **10.63** |
| SGP + all new goalie data | 0.21549 (worse: −2.95 × 10⁻⁴, interval −4.3 to −1.6) | 12.02 |
| MoneyPuck | 0.21614 | 11.25 |

None of the seven groups beat the placebo. Most made the model slightly worse, and goalie totals got worse too. So **nothing was added**.

What SGP already uses (a decayed, league-relative save record, by area and by season, plus rest and age) captures what can be learned about a goalie from public data. The rest looks like noise, consistent with the research finding no goalie hot hand. Scripts: `goalie_data.mjs`, `goalie2.py`, `eval5.py`; results in `results/goalie_dev.txt`.

## 8. Chances tonight: a team-game model

A separate model predicts, before puck drop, what each team will generate in a game:
- expected goals (the main target);
- unblocked shot attempts;
- inner-slot chances;
- goals.

One row per team per game (15,426 rows). This is where linemates, travel and rest had a fair chance to matter, because they affect how many chances a team creates rather than whether a given shot goes in.

**Inputs** (all known before the game; the lineup is the dressed roster):
- **Recent form:** decayed per-game offense and defense of both teams.
- **Season to date.**
- **Points.**
- **Lineup:** the dressed skaters' earlier on-ice expected goals for and against per 60 minutes, weighted by their ice time.
- **Travel and rest:** rest days, back-to-back, km travelled and time zones crossed, for both teams.
- **Home or away.**

**Model:** LightGBM with 7-leaf trees, trained 2021-22 to 2024-25. Same protocol: leave-one-group-out with a placebo on 2024-25 and 2026-27, then a pre-registered, one-time test on 2025-26 team-games (`chances_prereg.json`, committed in `50f90a4` before the run). Team-level chance counts had never been looked at on any season, so 2025-26 was still unseen for this model.

**Sealed 2025-26, team expected goals per game** (2,624 team-games; standard deviation 0.90):

| Model | RMSE | R² |
|---|---|---|
| **Chances model** | **0.846** | **0.107** |
| Linear (team offense, opponent defense, home) | 0.854 | 0.090 |
| Matchup average | 0.858 | 0.083 |
| League average | 0.901 | −0.013 |

Pre-registered results:

| Criterion or question | Result |
|---|---|
| Beats the matchup average (95% game-level interval above 0) | **PASS**: MSE gain +0.019 [+0.010, +0.029] |
| Beats the linear baseline | **PASS**: +0.014 [+0.006, +0.022] |
| H1, lineup quality helps | **Confirmed**: +0.011 [+0.006, +0.016] |
| H2, travel and rest help | **Not confirmed** for expected goals: +0.002 [−0.001, +0.005] |

Secondary, not pass/fail:
- **Travel and rest** did help predict **shot attempts**: +0.24 [+0.03, +0.45]. Tired or travelling teams seem to give up or take *more* shots, not better ones.
- **Lineup** also helped inner-slot chances (+0.12 [+0.01, +0.24]).

The honest bottom line: a single game is mostly noise. Even the best model explains about 11% of the game-to-game variation in a team's expected goals, and 2% for goals. The model is better than simple averages, and it shows that **who dresses matters for how many chances a team creates**, even though it doesn't matter for whether a given shot goes in.

Scripts: `chances_build.py`, `chances_eval.py`; results in `results/chances_dev.txt`, `results/chances_sealed.txt`.

## 9. The weekly prospective scoreboard

The cleanest test of all is games that hadn't been played when the models were frozen.

- **Frozen** (`frozen/`, fingerprinted in `frozen/manifest.json`; **v2**, replacing the v1 freeze before any game was scored against it):
  - SGP v2, the challenger without line-change timing (`sgp_no_change`), and standard xG, all trained on 2024-25 and 2025-26;
  - Rinkside's current xG recipe, refitted on the same seasons;
  - the four chances models;
  - the walk-forward base xG table, plus the model that scores new games this season.
- **Cutoff:** games on or after **2026-11-11** count. Nothing is tuned after that. A new freeze would need a new cutoff.
- **Every Monday** (`.github/workflows/goal-model-scoreboard.yml`), GitHub Actions:
  1. downloads the week's games (cached, so only new games are fetched);
  2. rebuilds the features;
  3. downloads MoneyPuck's current-season shot file;
  4. scores the frozen models on games after the cutoff (`scripts/scoreboard.py`);
  5. commits `scoreboard/README.md`, `scoreboard/latest.json` and a running `scoreboard/history.csv`.
- **Safeguards** (added after the review):
  - MoneyPuck values are snapshotted the first time each shot appears, so later revisions or a failed download can't change past numbers.
  - Results are also shown at 5v5 vs other strengths, and without MoneyPuck's 0-second time-on-ice shots (marked indicative).
  - Input coverage is printed (shift data, handedness, shot speed).
  - One history row per day.
  - **One verdict date: 2027-04-16**, the end of the regular season. Weekly numbers before then are progress reports: looking every week and stopping when it looks good would be fooling ourselves.
- **What it reports:**
  - **Shot models:** log loss, AUC and predicted vs actual goals for SGP, standard xG, Rinkside's xG and MoneyPuck, with game-level bootstrap intervals for SGP vs each.
  - **Goalie totals:** once goalies have enough shots.
  - **Chances:** RMSE against the matchup and league averages.

The first few weeks will be noisy; a season's worth of games will settle the 2026-27 question in section 6.

## 10. Files and how to reproduce

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
| 12 | `scripts/goalie_data.mjs` → `goalie2.py` → `eval5.py` | More goalie data and its test (section 7) |
| 13 | `scripts/chances_build.py` → `chances_eval.py [--unseal]` | Chances-tonight table, development tests, one-time sealed test (section 8) |
| 14 | `scripts/freeze.py` | Writes `frozen/` and its manifest (run once; a new freeze needs a new cutoff) |
| 15 | `scripts/run.sh` → `scoreboard.py` | The weekly pipeline the GitHub workflow runs (section 9) |

`scripts/common.py` holds the feature lists and model settings. `scripts/rk.py` is Rinkside's current xG recipe, refitted for comparison.

`eval.py`, `eval2.py`, `tune.py` and `explain.py` are the round-1 and early round-2 versions, kept for the record.

Downloaded data and model files are not committed. They are about 300 MB and can be rebuilt with steps 1–3, which take roughly 20 minutes at the NHL API's rate limits. MoneyPuck shot files for the comparison: `https://peter-tanner.com/moneypuck/downloads/shots_<year>.zip`.

## 11. Independent review

A separate reviewer was given this README, the scripts, the results and the data, and asked to find leakage, overstated claims, protocol problems and the best improvements. Its scripts are kept outside the repo. Every finding below was re-checked by hand before it went in here; the "Checked" column says how.

| Finding | Checked | Consequence |
|---|---|---|
| **Training window dominates.** Standard xG (no player inputs) trained on only 2023-24 and 2024-25 scores **0.21451** on 2025-26, beating registered SGP's **0.21505**. Scorekeeping drifts: wrist shots fell from 56% to 41% of attempts between 2021-22 and 2026-27, snap shots rose from 13% to 28%. | Re-ran it independently: 0.21451 vs 0.21505 on the same 110,327 shots | Most of the "+17.4 vs standard xG" in section 5 is a training-window effect. Against a standard xG trained on the same recent seasons, player skill adds **+3.5 [−0.4, +7.2]** (last 2 seasons) or **+8.4 [+4.7, +12.1]** (last 3) on 2025-26, and +5 to +6 (not significant) on 2026-27. The variant lengths were chosen after 2025-26 was open, so these numbers are post hoc. |
| **"Shot speed is the strongest group" is confounded.** EDGE speed is blank for all of 2021-22, and `sh_neff`, `g_neff` and `lg_env` all grow over the seasons, so these inputs can act as "which era is this" flags. | Reasoning plus the drift above; not separately measured | Treat the per-group values in section 3 as era-confounded until they're redone on a recency-matched base. |
| **MoneyPuck 2021–25 power-play leak.** 5v4 shots where MoneyPuck's penalty-length field is 0: 839 shots in 2025-26, 80.7% goals, MoneyPuck xG 0.51 (other 5v4 shots: 5.4% goals). | Reproduced from `mp/shots_2025.csv` | MoneyPuck's 5v4 numbers are inflated. At 5v5 on 2025-26: SGP 0.19676 vs MoneyPuck 0.21308. |
| **MoneyPuck 2026-27 time-on-ice artifact.** Shots with 0 s minimum defender ice time: 174 shots, 28.7% goals, MoneyPuck 0.154. At 1 s: 1.2% goals. | Reproduced from `mp/shots_2026.csv` | MoneyPuck's 2026-27 lead comes from these shots. The scoreboard now also reports the comparison without them, marked indicative. |
| **Shift-data gaps.** 50 games in 2026-27 (18% of shots) and 57 in 2024-25 had no shift chart; none in 2025-26. | Counted | Fixed: the HTML time-on-ice fallback recovered all 107 games. Results in sections 3–8 still have the gaps. |
| **Handedness** was missing for 3.4% of 2026-27 shots (`rosters.mjs` read every 25th game). | Counted | Fixed: all games are read, and missing players are looked up individually. |
| **Seal wording** in `prereg.json` and section 4.1 was false. | `results/round1.json` | Corrected in 4.1. `prereg.json` is fingerprinted and left as it was. |
| **Scoreboard bugs:** 2026-27 has 1,344 games, not 1,312 (game 2026021344 exists); empty shift charts were cached forever; MoneyPuck values were re-downloaded and overwritten weekly; `history.csv` got duplicate rows on re-runs. | API checked for the game count; the rest by reading the code | All four fixed (`run.sh`, `shifts.mjs`, `scoreboard.py`). The scoreboard also has a fixed verdict date (**2027-04-16**), a 5v5 vs special-teams split, and input-coverage lines. |
| Stage-1 settings in `model.py` didn't match the stored base xG (31 leaves, feature fraction 0.8). | Code; the refit with 31 leaves reproduces the stored values exactly | Fixed. |
| Minor: `lg_env` updates game by game within a date; the empty-net filter for goals with no goalie listed depends on the outcome; season-relative skill crosses the season boundary; the chances table shows last season's averages for game 1. | Code reading | Small effects. Left as is and noted here. |

**Checked and found fine** by the reviewer:
- The calibration step excludes the current day.
- Trailing means and history updates use earlier games only.
- Shift membership has no spike at zero.
- EDGE uses the prior season only.
- The MoneyPuck join is one-to-one.
- The bootstrap is paired, resamples whole games, and is stable when clustered by shooter, goalie, team, date or week.
- The sealed numbers reproduce exactly.

**What this means for the claims:**
- SGP still beat MoneyPuck and standard xG on the sealed season under the registered protocol.
- The win over MoneyPuck is partly a win over MoneyPuck's leak at 5v4; at 5v5 it's a clear win.
- The player-skill layer is real but small. The biggest single improvement available is simply **training on recent seasons**.

**Next steps the review suggested**, all done in v2 (see the top of this README):
- Train on the last 2–3 seasons or with recency weights, and freeze that as a challenger with its own cutoff.
- Redo the group tests on a recency-matched base, then simplify (a 44-feature model is within −2 to −3 of the full one).
- Add time since the last line change (strict, lagged, so it can't pick up the stoppage artifact).
- Make the weekly pipeline incremental (it rebuilds all games each week).

## 12. Sources

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
