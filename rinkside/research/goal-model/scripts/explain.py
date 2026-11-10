# Explain shots: standard xG (base model) vs the new stat, and which factors moved it.
#   python3 explain.py <playerId|name fragment> [season] [n]
import sys, pickle, json
import numpy as np, pandas as pd, lightgbm as lgb
exec(open('common.py').read())
models = {k: lgb.Booster(model_str=s) for k, s in pickle.load(open('models.pkl', 'rb')).items()}
df = pd.read_parquet('shots_feat.parquet')
for c in CAT: df[c] = df[c].astype('category')
names = {}
GROUPS = {
    'Shooter skill (career/season finishing)': ['sh_n', 'sh_fin_a2', 'sh_fin_a10', 'sh_fin_season', 'sh_avgdist', 'sh_ongoal'],
    'Shooter streak / recent form': ['sh_recent100', 'sh_recent_games', 'sh_dry_shots', 'sh_dry_games', 'sh_goals_last5'],
    'Goalie skill': ['g_n', 'g_sv_a5', 'g_sv_a20', 'g_sv_season', 'g_age_days'],
    'Goalie form / fatigue': ['g_recent300', 'g_shutout_streak_shots', 'g_rest', 'g_b2b', 'g_faced'],
    'Home / away': ['home'],
    'Location (distance, angle, side)': ['dist', 'angle', 'x', 'y', 'behind', 'offwing', 'hand', 'ghand'],
    'Play before the shot (rebound, rush, pass)': ['prev_type', 'prev_same', 'prev_dt', 'prev_dist', 'prev_speed', 'prev_x', 'prev_y', 'rebound', 'reb_angle', 'reb_speed', 'rush', 'cross', 'flurry', 'since_fo', 'fo_ozone'],
    'Shot type': ['type'],
    'Game state (strength, score, time)': ['own', 'opp', 'skdiff', 'pulled', 'sdiff', 'period', 't', 'spos'],
}
def explain(rows):
    fb, ff = models['base'], models['full']
    pb = fb.predict(rows[BASE]); pf = ff.predict(rows[BASE + SH + GL])
    cf = ff.predict(rows[BASE + SH + GL], pred_contrib=True); cb = fb.predict(rows[BASE], pred_contrib=True)
    fn = ff.feature_name(); bn = fb.feature_name()
    out = []
    for i in range(len(rows)):
        # change in log-odds per group, full model minus base model (identity features only exist in the full one)
        d = {}
        for g, cols in GROUPS.items():
            a = sum(cf[i][fn.index(c)] for c in cols if c in fn); b = sum(cb[i][bn.index(c)] for c in cols if c in bn)
            d[g] = a - b
        out.append((pb[i], pf[i], d))
    return out
if __name__ == '__main__':
    who = sys.argv[1]; season = int(sys.argv[2]) if len(sys.argv) > 2 else 2026; n = int(sys.argv[3]) if len(sys.argv) > 3 else 8
    sel = df[(df.season == season) & (df.en == 0) & (df.shooter == int(who))].sort_values(['date', 't'])
    rows = sel.tail(n)
    for (pb, pf, d), (_, r) in zip(explain(rows), rows.iterrows()):
        print(f"{r.date} P{int(r.period)} {int(r.t % 1200 // 60)}:{int(r.t % 60):02d} {r.type:<9} {r.dist:5.1f} ft {r.angle:4.0f}°  {'GOAL' if r.goal else '    '}  "
              f"standard {pb:.3f}  new {pf:.3f}  ×{pf / pb:.2f}  dry {int(r.sh_dry_shots)} shots/{int(r.sh_dry_games)} gms  {'home' if r.home else 'away'}")
        for g, v in sorted(d.items(), key=lambda t: -abs(t[1]))[:4]:
            if abs(v) > 0.02: print(f"      {g:<45} {'+' if v > 0 else '−'}{abs(v):.2f} log-odds")
