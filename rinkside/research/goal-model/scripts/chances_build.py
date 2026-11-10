# "Chances tonight": one row per team per game. Targets are what the team generated in the game; inputs are known
# before puck drop (lineup = the dressed roster, which is public at warmups).
import gzip, json, math, os
from collections import defaultdict
import numpy as np, pandas as pd
CITY = {'ANA': (33.81, -117.88, -8), 'ARI': (33.53, -112.26, -7), 'UTA': (40.77, -111.90, -7), 'BOS': (42.37, -71.06, -5), 'BUF': (42.88, -78.88, -5),
        'CGY': (51.04, -114.05, -7), 'CAR': (35.80, -78.72, -5), 'CHI': (41.88, -87.67, -6), 'COL': (39.75, -105.01, -7), 'CBJ': (39.97, -83.01, -5),
        'DAL': (32.79, -96.81, -6), 'DET': (42.34, -83.06, -5), 'EDM': (53.55, -113.50, -7), 'FLA': (26.16, -80.33, -5), 'LAK': (34.04, -118.27, -8),
        'MIN': (44.95, -93.10, -6), 'MTL': (45.50, -73.57, -5), 'NSH': (36.16, -86.78, -6), 'NJD': (40.73, -74.17, -5), 'NYI': (40.72, -73.59, -5),
        'NYR': (40.75, -73.99, -5), 'OTT': (45.30, -75.93, -5), 'PHI': (39.90, -75.17, -5), 'PIT': (40.44, -79.99, -5), 'SJS': (37.33, -121.90, -8),
        'SEA': (47.62, -122.35, -8), 'STL': (38.63, -90.20, -6), 'TBL': (27.94, -82.45, -5), 'TOR': (43.64, -79.38, -5), 'VAN': (49.28, -123.11, -8),
        'VGK': (36.10, -115.18, -8), 'WSH': (38.90, -77.02, -5), 'WPG': (49.89, -97.14, -6)}
def km(a, b):
    (la1, lo1, _), (la2, lo2, _) = a, b
    p = math.pi / 180
    h = math.sin((la2 - la1) * p / 2) ** 2 + math.cos(la1 * p) * math.cos(la2 * p) * math.sin((lo2 - lo1) * p / 2) ** 2
    return 12742 * math.asin(math.sqrt(h))

sh = pd.read_parquet('shots_feat2.parquet', columns=['season', 'game', 'dnum', 'team', 'home_team', 'goal', 'ongoal', 'en', 'xg_base', 'area', 'period', 't'])
sh = sh[sh.en == 0]
# per team-game targets (regulation + OT, empty-net shots excluded)
tg = sh.groupby(['game', 'team']).agg(xgf=('xg_base', 'sum'), ff=('goal', 'size'), sog=('ongoal', 'sum'), hd=('area', lambda a: int((a == 0).sum())), gf=('goal', 'sum')).reset_index()
games = sh.groupby('game').agg(season=('season', 'first'), dnum=('dnum', 'first'), home=('home_team', 'first')).reset_index().sort_values(['dnum', 'game'])
TG = {(r.game, r.team): r for r in tg.itertuples()}
DEC = 0.93                                         # per-game decay for team rates (~14-game memory)
team = defaultdict(lambda: dict(n=0., xgf=0., xga=0., ff=0., fa=0., hd=0., hda=0., gf=0., ga=0., sn=0, sxgf=0., sxga=0., pts=0., gp=0))
P = defaultdict(lambda: dict(toi=0., xgf=0., xga=0.))   # player on-ice, decayed per game
last = {}
rng = np.random.default_rng(99)
rows = []
for g in games.itertuples():
    raw = json.loads(gzip.open(f'raw/{g.season}/{g.game}.json.gz').read())
    home, away = raw['home'], raw['away']; ha = raw['homeAbbrev']; city = CITY.get(ha)
    ros = defaultdict(list)
    for pid, tid, pc, num in raw['roster']:
        if pc != 'G': ros[tid].append(pid)
    sf = f'shifts/{g.season}/{g.game}.json.gz'
    shf = np.array(json.loads(gzip.open(sf).read()) if os.path.exists(sf) else [], dtype=float).reshape(-1, 5)
    def lineup(tid):
        r = [(P[p]['toi'], P[p]['xgf'] / P[p]['toi'] * 3600, P[p]['xga'] / P[p]['toi'] * 3600) for p in ros[tid] if P[p]['toi'] > 1800]
        if len(r) < 8: return [np.nan] * 3
        w = np.array([a for a, _, _ in r]); f = np.array([b for _, b, _ in r]); a_ = np.array([c for _, _, c in r])
        return [float((w * f).sum() / w.sum()), float((w * a_).sum() / w.sum()), float(len(r))]
    for us, them in ((home, away), (away, home)):
        a, b = team[us], team[them]
        rate = lambda o, k: o[k] / o['n'] if o['n'] > 2 else np.nan
        tr_ = []
        for tm in (us, them):
            if tm in last and city:
                d0, c0 = last[tm]; tr_ += [g.dnum - d0, int(g.dnum - d0 == 1), km(c0, city), abs(c0[2] - city[2])]
            else: tr_ += [np.nan, 0, np.nan, np.nan]
        t = TG.get((g.game, us))
        rows.append(dict(game=g.game, season=g.season, dnum=g.dnum, team=us, opp=them, is_home=int(us == home),
            # targets
            y_xgf=t.xgf if t else 0.0, y_ff=t.ff if t else 0, y_sog=t.sog if t else 0, y_hd=t.hd if t else 0, y_gf=t.gf if t else 0,
            # team form (decayed) and season-to-date
            o_xgf=rate(a, 'xgf'), o_ff=rate(a, 'ff'), o_hd=rate(a, 'hd'), o_xga=rate(a, 'xga'), o_gf=rate(a, 'gf'),
            d_xga=rate(b, 'xga'), d_fa=rate(b, 'fa'), d_hda=rate(b, 'hda'), d_xgf=rate(b, 'xgf'), d_ga=rate(b, 'ga'),
            o_season_xgf=a['sxgf'] / a['sn'] if a['sn'] else np.nan, d_season_xga=b['sxga'] / b['sn'] if b['sn'] else np.nan,
            o_pts=a['pts'] / a['gp'] if a['gp'] else np.nan, d_pts=b['pts'] / b['gp'] if b['gp'] else np.nan,
            # lineups
            **dict(zip(['lu_xgf60', 'lu_xga60', 'lu_n'], lineup(us))), **dict(zip(['ol_xgf60', 'ol_xga60', 'ol_n'], lineup(them))),
            # travel / rest
            **dict(zip(['rest', 'b2b', 'travel_km', 'tz', 'opp_rest', 'opp_b2b', 'opp_travel_km', 'opp_tz'], tr_)),
            placebo1=rng.normal(), placebo2=rng.random()))
    # ---- update after the game ----
    res = {tm: TG.get((g.game, tm)) for tm in (home, away)}
    for us, them in ((home, away), (away, home)):
        o = team[us]
        if o.get('season') != g.season: o.update(sn=0, sxgf=0., sxga=0., pts=0., gp=0, season=g.season)
        for k in ('n', 'xgf', 'xga', 'ff', 'fa', 'hd', 'hda', 'gf', 'ga'): o[k] *= DEC
        u, v = res[us], res[them]
        o['n'] += 1; o['xgf'] += u.xgf if u else 0; o['xga'] += v.xgf if v else 0; o['ff'] += u.ff if u else 0; o['fa'] += v.ff if v else 0
        o['hd'] += u.hd if u else 0; o['hda'] += v.hd if v else 0; o['gf'] += u.gf if u else 0; o['ga'] += v.gf if v else 0
        o['sn'] += 1; o['sxgf'] += u.xgf if u else 0; o['sxga'] += v.xgf if v else 0; o['gp'] += 1
        o['pts'] += 2 if (u.gf if u else 0) > (v.gf if v else 0) else 0      # rough: regulation/OT goals only (shootouts not in data)
    if len(shf) > 200:
        on = shf
        for p in set(int(x) for x in on[:, 0]):
            for k in P[p]: P[p][k] *= 0.985
        for p, tm, per, st, en_ in on: P[int(p)]['toi'] += max(0, en_ - st)
        gs = sh[sh.game == g.game]
        for t_, per, tm, xb in zip(gs.t, gs.period, gs.team, gs.xg_base):
            tp = t_ - (per - 1) * 1200
            x = on[(on[:, 2] == per) & (on[:, 3] < tp) & (on[:, 4] >= tp)]
            for p, tmm, *_ in x:
                if tmm == tm: P[int(p)]['xgf'] += xb
                else: P[int(p)]['xga'] += xb
    if city:
        for tm in (home, away): last[tm] = (g.dnum, city)
out = pd.DataFrame(rows)
out.to_parquet('teamgames.parquet')
print(out.shape); print(out[out.season != 2025].describe().T[['count', 'mean']].round(3).to_string())
