# Round 2 history features, strictly from earlier games (except shift timing, which is known when the shot happens).
#   shooter: decayed finishing overall / in this area of the ice / with this shot type, accuracy, distance habit,
#            prior-season EDGE shot speed, shot rate per 60
#   goalie:  decayed goals-saved overall and in this area, rest, age
#   on ice:  teammates' playmaking (primary assists / 60, on-ice xGF / 60), opponents' on-ice xGA / 60,
#            how long the shooter / his teammates / the defenders have been on this shift
#   league:  trailing goals / base-xG ratio (scoring environment)
import gzip, json, math, os, sys
from collections import defaultdict, deque
import numpy as np, pandas as pd

df = pd.read_parquet('shots_feat.parquet')
edge = json.load(open('edge.json')) if os.path.exists('edge.json') else {}
born = {int(k): v for k, v in json.load(open('players.json')).items()}

def area(fx, ay, x):
    if x < 25 or fx > 58: return 3          # outside the zone / long range
    if -3 <= fx <= 20 and ay <= 19: return 0  # inner slot
    if fx <= 30 and ay <= 30: return 1        # home plate
    return 2                                  # perimeter
df['area'] = [area(89 - x, abs(y), x) for x, y in zip(df.x, df.y)]
TYPEK = {t: i for i, t in enumerate(['wrist', 'snap', 'slap', 'backhand', 'tip-in', 'deflected', 'wrap-around'])}

LS, LG, LP = 0.998, 0.9993, 0.985     # decay per shot (shooter), per shot faced (goalie), per game (on-ice rates)
F = ['sh_neff', 'sh_fin_d', 'sh_fin_area', 'sh_fin_type', 'sh_acc_d', 'sh_dist_d', 'sh_rate60',
     'sh_edge_avg', 'sh_edge_top', 'sh_edge_hard',
     'g_neff', 'g_sv_d', 'g_sv_area',
     'tm_a1_60_max', 'tm_a1_60_mean', 'tm_xgf60_mean', 'sh_xgf60', 'op_xga60_mean', 'op_xga60_min', 'n_d_on', 'n_f_on',
     'sh_shift', 'tm_shift_mean', 'op_shift_mean', 'op_shift_max',
     'tm_shift_min', 'op_shift_min', 'tm_shift_min_lag2', 'op_shift_min_lag2',
     'lg_env']
S = defaultdict(lambda: dict(n=0., g=0., x=0., og=0., d=0., ag=[0.] * 4, ax=[0.] * 4, tg=[0.] * 8, tx=[0.] * 8))
G = defaultdict(lambda: dict(n=0., g=0., x=0., ag=[0.] * 4, ax=[0.] * 4))
O = defaultdict(lambda: dict(toi=0., a1=0., xgf=0., xga=0., sh=0.))   # per-player on-ice, decayed per game
lg_hist = deque(); lg_g = 0.; lg_x = 0.; LGW = 15000; cur_day = None; env_day = 0.0

out = np.full((len(df), len(F)), np.nan)
pos = {}
def r60(v, toi): return v / toi * 3600 if toi > 600 else np.nan

for gid, g in df.groupby('game', sort=False):
    season = int(g.season.iat[0])
    raw = json.loads(gzip.open(f'raw/{season}/{gid}.json.gz').read())
    for pid, tid, pc, num in raw['roster']: pos[pid] = pc
    sf = f'shifts/{season}/{gid}.json.gz'
    sh = np.array(json.loads(gzip.open(sf).read()) if os.path.exists(sf) else [], dtype=float).reshape(-1, 5)
    have_shifts = len(sh) > 200
    # ---------- snapshot ----------
    dn_ = int(g.dnum.iat[0])
    if dn_ != cur_day: cur_day = dn_; env_day = math.log((lg_g + 50) / (lg_x + 50)) if lg_x else 0.0   # once per date (review fix)
    env = env_day
    for i, s_id, gl, t, per, team, ar, typ in zip(g.index, g.shooter, g.goalie, g.t, g.period, g.team, g.area, g.type):
        a = S[s_id]; b = G[gl]; tk = TYPEK.get(str(typ), 7)
        e = edge.get(f'{season - 1}:{s_id}')
        row = [a['n'], math.log((a['g'] + 4) / (a['x'] + 4)), math.log((a['ag'][ar] + 2) / (a['ax'][ar] + 2)),
               math.log((a['tg'][tk] + 2) / (a['tx'][tk] + 2)), a['og'] / a['n'] if a['n'] > 1 else np.nan, a['d'] / a['n'] if a['n'] > 1 else np.nan,
               r60(O[s_id]['sh'], O[s_id]['toi']),
               e[0] if e else np.nan, e[1] if e else np.nan, e[2] if e else np.nan,
               b['n'], math.log((b['g'] + 8) / (b['x'] + 8)), math.log((b['ag'][ar] + 3) / (b['ax'][ar] + 3))]
        if have_shifts:
            tp = t - (per - 1) * 1200
            on = sh[(sh[:, 2] == per) & (sh[:, 3] < tp) & (sh[:, 4] >= tp)]
            mates = [(int(p), tp - st) for p, tm, _, st, _ in on if tm == team and p != s_id and p != gl and pos.get(int(p)) != 'G']
            opps = [(int(p), tp - st) for p, tm, _, st, _ in on if tm != team and pos.get(int(p)) != 'G']
            me = [tp - st for p, tm, _, st, _ in on if p == s_id]
            a1 = [r60(O[p]['a1'], O[p]['toi']) for p, _ in mates]; a1 = [v for v in a1 if v == v]
            xf = [r60(O[p]['xgf'], O[p]['toi']) for p, _ in mates]; xf = [v for v in xf if v == v]
            xa = [r60(O[p]['xga'], O[p]['toi']) for p, _ in opps]; xa = [v for v in xa if v == v]
            row += [max(a1) if a1 else np.nan, np.mean(a1) if a1 else np.nan, np.mean(xf) if xf else np.nan, r60(O[s_id]['xgf'], O[s_id]['toi']),
                    np.mean(xa) if xa else np.nan, min(xa) if xa else np.nan,
                    sum(1 for p, _ in mates if pos.get(p) == 'D') + (pos.get(s_id) == 'D'), sum(1 for p, _ in mates if pos.get(p) in ('C', 'L', 'R')) + (pos.get(s_id) in ('C', 'L', 'R')),
                    me[0] if me else np.nan, np.mean([d for _, d in mates]) if mates else np.nan,
                    np.mean([d for _, d in opps]) if opps else np.nan, max([d for _, d in opps]) if opps else np.nan]
            # time since each team's last change = shortest shift on the ice (shooter included); the same 2 s earlier as a control
            own_d = [d for _, d in mates] + me
            on2 = sh[(sh[:, 2] == per) & (sh[:, 3] < tp - 2) & (sh[:, 4] >= tp - 2)]
            own2 = [tp - 2 - st for p, tm, _, st, _ in on2 if tm == team and pos.get(int(p)) != 'G']
            opp2 = [tp - 2 - st for p, tm, _, st, _ in on2 if tm != team and pos.get(int(p)) != 'G']
            row += [min(own_d) if own_d else np.nan, min(d for _, d in opps) if opps else np.nan,
                    min(own2) if own2 else np.nan, min(opp2) if opp2 else np.nan]
        else:
            row += [np.nan] * 16
        row.append(env)
        out[i] = row
    # ---------- update after the game ----------
    for s_id, gl, goal, xb, en, dist, og, ar, typ in zip(g.shooter, g.goalie, g.goal, g.xg_base, g.en, g.dist, g.ongoal, g.area, g.type):
        if en or xb != xb: continue
        tk = TYPEK.get(str(typ), 7)
        a = S[s_id]
        for k in ('n', 'g', 'x', 'og', 'd'): a[k] *= LS
        a['ag'] = [v * LS for v in a['ag']]; a['ax'] = [v * LS for v in a['ax']]; a['tg'] = [v * LS for v in a['tg']]; a['tx'] = [v * LS for v in a['tx']]
        a['n'] += 1; a['g'] += goal; a['x'] += xb; a['og'] += og; a['d'] += dist; a['ag'][ar] += goal; a['ax'][ar] += xb; a['tg'][tk] += goal; a['tx'][tk] += xb
        if gl:
            b = G[gl]
            for k in ('n', 'g', 'x'): b[k] *= LG
            b['ag'] = [v * LG for v in b['ag']]; b['ax'] = [v * LG for v in b['ax']]
            b['n'] += 1; b['g'] += goal; b['x'] += xb; b['ag'][ar] += goal; b['ax'][ar] += xb
        lg_hist.append((goal, xb)); lg_g += goal; lg_x += xb
        while len(lg_hist) > LGW: og_, ox_ = lg_hist.popleft(); lg_g -= og_; lg_x -= ox_
    if have_shifts:
        played = set(int(p) for p in sh[:, 0])
        for p in played:
            o = O[p]
            for k in o: o[k] *= LP
        for p, tm, per, st, en_ in sh: O[int(p)]['toi'] += max(0, en_ - st)
        for t, per, team, xb, en, s_id in zip(g.t, g.period, g.team, g.xg_base, g.en, g.shooter):
            if en or xb != xb: continue
            tp = t - (per - 1) * 1200
            on = sh[(sh[:, 2] == per) & (sh[:, 3] < tp) & (sh[:, 4] >= tp)]
            for p, tm, *_ in on:
                if tm == team: O[int(p)]['xgf'] += xb
                else: O[int(p)]['xga'] += xb
            O[s_id]['sh'] += 1
        for e in raw['plays']:
            if e[7] == 'goal' and e[8].get('assist1PlayerId'): O[e[8]['assist1PlayerId']]['a1'] += 1
    if gid % 500 == 0: print(gid, file=sys.stderr)

for j, c in enumerate(F): df[c] = out[:, j]
df.to_parquet('shots_feat2.parquet')
print(df[F].describe().T[['count', 'mean', '50%']])
