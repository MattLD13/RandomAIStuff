# Weekly prospective scoreboard: the frozen models, scored only on games played on or after the freeze cutoff.
# Nothing here is tuned; the models, features and calibration rule are fixed in frozen/manifest.json.
import json, hashlib, os, sys, datetime, gzip
import numpy as np, pandas as pd, lightgbm as lgb
from sklearn.metrics import log_loss, roc_auc_score, brier_score_loss
exec(open('common.py').read()); exec(open('rk.py').read())
FZ = os.environ.get('FROZEN', '../frozen'); OUT = os.environ.get('SCOREBOARD', '../scoreboard')
man = json.load(open(f'{FZ}/manifest.json'))
for f, h in man['sha256'].items():
    assert hashlib.sha256(open(f'{FZ}/{f}', 'rb').read()).hexdigest() == h, f'frozen file changed: {f}'
cut = os.environ.get('TEST_CUTOFF') or man['cutoff']
DECISION = '2027-04-16'     # TEST_CUTOFF is for local pipeline tests only; the workflow never sets it
df = pd.read_parquet('shots_feat2.parquet')
df['type'] = df['type'].astype(str).replace({'unknown': np.nan, 'None': np.nan, 'nan': np.nan})
for c in CAT: df[c] = df[c].astype('category')
ne = df[df.en == 0].sort_values(['dnum', 'game', 'so']).copy()
def recal(p, W=35):
    day = pd.DataFrame({'d': ne.dnum.values, 'g': ne.goal.values, 'p': p}).groupby('d')[['g', 'p']].sum()
    c = np.log((day.g.rolling(W, min_periods=10).sum().shift(1) + 20) / (day.p.rolling(W, min_periods=10).sum().shift(1) + 20)).fillna(0)
    return 1 / (1 + np.exp(-(np.log(p / (1 - p)) + ne.dnum.map(c).values)))
for name, spec in man['shot_models'].items():
    zs = []
    for fn in spec.get('files', [spec.get('file')]):     # several files = a seed ensemble: average the log-odds
        f = f"{FZ}/{fn}"
        m = lgb.Booster(model_str=gzip.open(f, 'rt').read()) if f.endswith('.gz') else lgb.Booster(model_file=f)
        q = m.predict(ne[spec['features']]); zs.append(np.log(q / (1 - q)))
    p = 1 / (1 + np.exp(-np.mean(zs, 0))); ne['p_' + name] = recal(p) if spec['calibrated'] else p
# retraining rules (frozen recipes, not frozen models): at the start of every month refit on the previous window_days,
# using only shots from before that date, and predict that month. Months before the cutoff use the same rule, so the
# rolling calibration has history to work with.
for name, spec in man.get('refit_policies', {}).items():
    p = np.full(len(ne), np.nan); dt = pd.to_datetime(ne.date)
    first = pd.Timestamp(cut) - pd.DateOffset(days=spec.get('warmup_days', 70))
    months = sorted(set(pd.Timestamp(y, m_, 1) for y, m_ in zip(dt.dt.year, dt.dt.month)))
    months = [x for x in months if x >= first.replace(day=1)]
    for i, st in enumerate(months):
        a_ = st.toordinal(); b_ = months[i + 1].toordinal() if i + 1 < len(months) else 10 ** 9
        tr = ne[(ne.dnum < a_) & (ne.dnum >= a_ - spec['window_days'])]
        msk = ((ne.dnum >= a_) & (ne.dnum < b_)).values
        if not msk.any() or len(tr) < 50000: continue
        w = 0.5 ** ((a_ - tr.dnum.values) / spec['half_life_days']) if spec.get('half_life_days') else None
        zs = []
        for seed in spec.get('seeds', [1]):
            m = lgb.train(dict(P, deterministic=True, num_threads=4, seed=seed, **spec.get('params', {})), lgb.Dataset(tr[spec['features']], tr.goal, weight=w), spec['rounds'])
            q = m.predict(ne.loc[msk, spec['features']]); zs.append(np.log(q / (1 - q)))
        p[msk] = 1 / (1 + np.exp(-np.mean(zs, 0)))
    ok = ~np.isnan(p); p[~ok] = np.nanmean(p[ok]) if ok.any() else 0.07
    ne['p_' + name] = recal(p) if spec.get('calibrated', True) else p
    man['shot_models'][name] = spec      # report it alongside the frozen models
rk = json.load(open(f"{FZ}/{man['rinkside_file']}"))
z = rk_X(ne) @ np.array(rk['coef']) + rk['intercept']; ne['p_rinkside'] = recal(1 / (1 + np.exp(-z)))
d = ne[ne.date >= cut].copy()
models = list(man['shot_models']) + ['rinkside']
# MoneyPuck: each shot's xGoal is snapshotted the first time it appears (later revisions don't overwrite it),
# so a failed or revised weekly download can't change past numbers. Compared on the shots it covers; coverage reported.
mpf, snap = f"mp/shots_{man['season']}.csv", 'mp_snapshot.parquet'
S = pd.read_parquet(snap) if os.path.exists(snap) else pd.DataFrame(columns=['game', 't', 'shooter', 'xGoal', 'mp_goal', 'mp_min_toi'])
if os.path.exists(mpf):
    m = pd.read_csv(mpf, usecols=['season', 'game_id', 'time', 'shooterPlayerId', 'event', 'xGoal', 'isPlayoffGame', 'defendingTeamMinTimeOnIce'])
    m = m[m.isPlayoffGame == 0]; m['game'] = (m.season * 1000000 + m.game_id).astype(int); m['t'] = m.time.astype(int)
    m['shooter'] = m.shooterPlayerId.fillna(0).astype(int); m['mp_goal'] = (m.event == 'GOAL').astype(int); m['mp_min_toi'] = m.defendingTeamMinTimeOnIce
    m = m[['game', 't', 'shooter', 'xGoal', 'mp_goal', 'mp_min_toi']].drop_duplicates(['game', 't', 'shooter'], keep=False)
    known = set(zip(S.game, S.t, S.shooter)) if len(S) else set()
    S = pd.concat([S, m[[k not in known for k in zip(m.game, m.t, m.shooter)]]], ignore_index=True)
    S.to_parquet(snap)
d['k'] = np.arange(len(d)); d['p_moneypuck'] = np.nan
if len(S):
    j = d[['k', 'game', 't', 'shooter', 'goal']].merge(S, on=['game', 't', 'shooter']); j = j[j.goal == j.mp_goal]
    d.iloc[j.k.values, d.columns.get_loc('p_moneypuck')] = j.xGoal.values.astype(float)
    d['mp_min_toi'] = np.nan; d.iloc[j.k.values, d.columns.get_loc('mp_min_toi')] = j.mp_min_toi.values.astype(float)
mp_cov = float(d.p_moneypuck.notna().mean()) if len(d) else 0.0
if mp_cov > 0: models.append('moneypuck')
def ll(y, q): q = np.clip(q, 1e-6, 1 - 1e-6); return -(y * np.log(q) + (1 - y) * np.log(1 - q))
def boot(x, a, b, B=2000):
    e = ll(x.goal.values, x['p_' + a].values) - ll(x.goal.values, x['p_' + b].values)
    gs = pd.Series(e).groupby(x.game.values).agg(['sum', 'size']); s, n = gs['sum'].values, gs['size'].values
    idx = np.random.default_rng(1).integers(0, len(s), (B, len(s))); bs = s[idx].sum(1) / n[idx].sum(1)
    return dict(gain_x1e4=round(float(s.sum() / n.sum() * 1e4), 2), lo=round(float(np.percentile(bs, 2.5) * 1e4), 2), hi=round(float(np.percentile(bs, 97.5) * 1e4), 2),
                share_better=round(float((bs > 0).mean()), 4))
R = dict(updated=datetime.datetime.utcnow().strftime('%Y-%m-%d %H:%M UTC'), cutoff=cut, frozen=man['frozen_at'])
if len(d):
    x = d[d.p_moneypuck.notna()] if 'moneypuck' in models else d
    R['shots'] = dict(games=int(x.game.nunique()), shots=int(len(x)), goals=int(x.goal.sum()), moneypuck_coverage=round(mp_cov, 4))
    R['input_coverage'] = dict(shift_data=round(float(d.sh_shift.notna().mean()), 4), handedness=round(float((d.hand.astype(str) != '').mean()), 4),
                               shot_speed=round(float(d.sh_edge_avg.notna().mean()), 4))
    st = {'5v5': (x.own == 5) & (x.opp == 5), 'other strengths': ~((x.own == 5) & (x.opp == 5))}
    R['by_strength'] = {lab: {k: round(float(ll(x.goal.values[msk.values], x['p_' + k].values[msk.values]).mean()), 5) for k in models} | {'shots': int(msk.sum())}
                        for lab, msk in st.items()}
    R['models'] = {k: dict(logloss=round(float(log_loss(x.goal, np.clip(x['p_' + k], 1e-6, 1 - 1e-6))), 5), auc=round(float(roc_auc_score(x.goal, x['p_' + k])), 4),
                           brier=round(float(brier_score_loss(x.goal, x['p_' + k])), 5), predicted=round(float(x['p_' + k].sum()), 1)) for k in models}
    R['sgp_vs'] = {k: boot(x, k, 'sgp') for k in models if k != 'sgp'}
    if 'moneypuck' in models:
        xc = x[x.mp_min_toi != 0]
        R['sgp_vs_moneypuck_excl_toi0'] = boot(xc, 'moneypuck', 'sgp') | {'excluded_shots': int((x.mp_min_toi == 0).sum())}
    g = x[x.goalie > 0].groupby('goalie'); n = g.size(); keep = n[n >= 150].index
    if len(keep) >= 10:
        R['goalies_150plus'] = {k: round(float(np.sqrt(((g.goal.sum()[keep] - g['p_' + k].sum()[keep]) ** 2).mean())), 3) for k in models} | {'goalies': int(len(keep))}
# chances tonight
if os.path.exists('teamgames.parquet') and 'chances' in man:
    t = pd.read_parquet('teamgames.parquet'); t = t[t.dnum >= datetime.date.fromisoformat(cut).toordinal()]
    if len(t):
        C = {}
        for y, spec in man['chances'].items():
            m = lgb.Booster(model_file=f"{FZ}/{spec['file']}"); pm = m.predict(t[spec['features']])
            key = spec['matchup']; base = ((t[key[0]] + t[key[1]]) / 2).fillna(spec['league_mean']) + t.is_home.map({1: spec['home_edge'], 0: -spec['home_edge']})
            e_m, e_b, e_l = (pm - t[y]) ** 2, (base - t[y]) ** 2, (spec['league_mean'] - t[y]) ** 2
            gs = pd.DataFrame({'g': t.game.values, 'a': (e_b - e_m).values, 'b': (e_l - e_m).values}).groupby('g').agg(['sum', 'size'])
            def bt(col):
                s, n = gs[(col, 'sum')].values, gs[(col, 'size')].values; idx = np.random.default_rng(2).integers(0, len(s), (2000, len(s))); bs = s[idx].sum(1) / n[idx].sum(1)
                return [round(float(s.sum() / n.sum()), 4), round(float(np.percentile(bs, 2.5)), 4), round(float(np.percentile(bs, 97.5)), 4)]
            C[y] = dict(team_games=int(len(t)), rmse_model=round(float(np.sqrt(e_m.mean())), 4), rmse_matchup=round(float(np.sqrt(e_b.mean())), 4),
                        rmse_league_avg=round(float(np.sqrt(e_l.mean())), 4), mse_gain_vs_matchup=bt('a'), mse_gain_vs_league_avg=bt('b'))
        R['chances'] = C
os.makedirs(OUT, exist_ok=True)
json.dump(R, open(f'{OUT}/latest.json', 'w'), indent=1)
# a short readable page
L = [f"# Prospective scoreboard", "", f"Frozen models scored only on games played on or after **{cut}** (frozen {man['frozen_at']}). Updated {R['updated']}.", "",
     f"**Verdict date: {DECISION}** (end of the 2026-27 regular season). Weekly numbers before then are progress reports, not results: looking every week and stopping when it looks good would be fooling ourselves.", ""]
if 'shots' in R:
    s = R['shots']; L += [f"## Shot model: {s['games']} games, {s['shots']} shots, {s['goals']} goals", "", "| Model | Log loss | AUC | Predicted goals |", "|---|---|---|---|"]
    for k, v in sorted(R['models'].items(), key=lambda kv: kv[1]['logloss']): L.append(f"| {k} | {v['logloss']:.5f} | {v['auc']:.3f} | {v['predicted']:.0f} |")
    L += ["", "SGP vs each model (log loss x 10,000, + = SGP better, 95% game-level bootstrap):", "", "| vs | Gain | 95% interval | Resamples SGP better |", "|---|---|---|---|"]
    for k, v in R['sgp_vs'].items(): L.append(f"| {k} | {v['gain_x1e4']:+.1f} | {v['lo']:+.1f} to {v['hi']:+.1f} | {v['share_better']:.0%} |")
    if 'sgp_vs_moneypuck_excl_toi0' in R:
        v = R['sgp_vs_moneypuck_excl_toi0']; L += ["", f"Excluding the {v['excluded_shots']} shots MoneyPuck marks with 0 s defender time on ice (a stoppage artifact that leaks the result): SGP vs MoneyPuck {v['gain_x1e4']:+.1f} ({v['lo']:+.1f} to {v['hi']:+.1f}). Indicative only, since that field is related to the outcome."]
    L += ["", "By strength (log loss):", "", "| | Shots | " + " | ".join(models) + " |", "|---|---|" + "---|" * len(models)]
    for lab, v in R['by_strength'].items(): L.append(f"| {lab} | {v['shots']} | " + " | ".join(f"{v[k]:.5f}" for k in models) + " |")
    L += ["", "MoneyPuck's xG is known to use outcome-related fields on some shots (e.g. power-play goals); compare at 5v5 for the cleanest read.",
          f"Coverage: MoneyPuck {R['shots']['moneypuck_coverage']:.1%} of shots; our inputs: shift data {R['input_coverage']['shift_data']:.1%}, handedness {R['input_coverage']['handedness']:.1%}, shot speed {R['input_coverage']['shot_speed']:.1%}."]
    if 'goalies_150plus' in R:
        gg = R['goalies_150plus']; L += ["", f"Goalie goals-against error (RMSE, {gg['goalies']} goalies with 150+ shots): " + ', '.join(f"{k} {v:.2f}" for k, v in gg.items() if k != 'goalies')]
if 'chances' in R:
    L += ["", "## Chances tonight", "", "| Target | Team-games | RMSE model | RMSE matchup avg | RMSE league avg |", "|---|---|---|---|---|"]
    for y, v in R['chances'].items(): L.append(f"| {y} | {v['team_games']} | {v['rmse_model']:.3f} | {v['rmse_matchup']:.3f} | {v['rmse_league_avg']:.3f} |")
L += ["", "Early weeks are noisy: wait for the intervals to settle before reading much into them."]
open(f'{OUT}/README.md', 'w').write('\n'.join(L) + '\n')
hist = f'{OUT}/history.csv'
H = pd.read_csv(hist) if os.path.exists(hist) else pd.DataFrame()
if 'models' in R:
    M = R['models']; row = dict(date=R['updated'][:10], games=R['shots']['games'], shots=R['shots']['shots'], goals=R['shots']['goals'],
        **{f'{k}_logloss': v['logloss'] for k, v in M.items()}, **{f'{k}_5v5': v for k, v in R['by_strength']['5v5'].items() if k != 'shots'})
    H = pd.concat([H[H.date != row['date']] if len(H) else H, pd.DataFrame([row])], ignore_index=True)
    H.to_csv(hist, index=False)
print('\n'.join(L))
