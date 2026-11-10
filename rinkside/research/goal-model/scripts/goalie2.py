# More goalie data, all known before the shot:
#   career:  decayed even-strength save% above league average, seasons 2010-11 .. last season (NHL stats API); last season alone
#   EDGE:    last season's 5v5 / close-game / high-, mid-, long-range save% above league average
#   shots:   glove vs blocker side record (decayed) and which side this shot is on, record vs this shot type,
#            rebound control (share of saves followed by another attempt within 3 s), starts in last 7 days, consecutive starts
#   body:    goalie height
import json, math
from collections import defaultdict, deque
import numpy as np, pandas as pd
df = pd.read_parquet('shots_feat2.parquet')
gd = json.load(open('goalie_data.json')); players = json.load(open('players.json'))

# ---- career priors from season summaries ----
lg = {}
per = defaultdict(dict)    # goalie -> season -> (ev shots, ev goals)
for y, rows in gd['seasons'].items():
    y = int(y); S = sum(r[5] or 0 for r in rows); Gs = sum(r[6] or 0 for r in rows); lg[y] = Gs / S if S else 0.08
    for pid, gp, gs, sa, ga, evs, evg, pps, ppg in rows:
        if evs: per[pid][y] = (evs, evg)
def career(pid, season):
    num = den = 0.0
    for y, (s, g) in per.get(pid, {}).items():
        if y >= season: continue
        w = 0.75 ** (season - 1 - y)            # last season counts fully, two seasons ago 0.75, ...
        num += w * (lg[y] * s - g); den += w * s
    return (num / (den + 1500) * 100, den) if den else (np.nan, 0.0)   # saves above average per 100 shots, shrunk
def last(pid, season):
    v = per.get(pid, {}).get(season - 1)
    return ((lg[season - 1] * v[0] - v[1]) / (v[0] + 500) * 100) if v else np.nan

# ---- EDGE priors: league averages per season, then each goalie's last season relative to them ----
E = gd['edge']; lgE = {}
for v in E.values():
    for k in ('hd', 'md', 'ld'):
        if v.get(k) and (v[k][0] is None or v[k][1] is None): v[k] = None
for y in range(2021, 2026):
    xs = [v for k, v in E.items() if k.startswith(f'{y}:')]
    def rate(key):
        s = sum(v[key][0] for v in xs if v.get(key)); g = sum(v[key][1] for v in xs if v.get(key)); return g / s if s else np.nan
    w5 = [(v['sv5'], v['shots5']) for v in xs if v['sv5'] is not None and v['shots5']]
    lgE[y] = dict(sv5=sum(a * b for a, b in w5) / sum(b for _, b in w5), hd=rate('hd'), md=rate('md'), ld=rate('ld'))
def edgef(pid, season):
    v = E.get(f'{season - 1}:{pid}'); L = lgE.get(season - 1)
    if not v or not L: return [np.nan] * 5
    def rel(key, k=150):
        if not v.get(key): return np.nan
        s, g = v[key]; return (L[key] * s - g) / (s + k) * 100
    sv5 = (v['sv5'] - L['sv5']) * v['shots5'] / (v['shots5'] + 400) * 100 if v['sv5'] is not None and v['shots5'] else np.nan
    cl = (v['sv5close'] - L['sv5']) * 100 if v['sv5close'] is not None else np.nan
    return [sv5, cl, rel('hd'), rel('md'), rel('ld')]

# ---- shot-level history ----
LG = 0.9993
TYPEK = {t: i for i, t in enumerate(['wrist', 'snap', 'slap', 'backhand', 'tip-in', 'deflected', 'wrap-around'])}
st = defaultdict(lambda: dict(side_g=[0., 0.], side_x=[0., 0.], type_g=[0.] * 8, type_x=[0.] * 8, saves=0., reb=0.))
starts = defaultdict(list)       # goalie -> list of date ordinals he played
lg_reb = deque(maxlen=20000)
F = ['gc_career', 'gc_career_shots', 'gc_last', 'ge_sv5', 'ge_close', 'ge_hd', 'ge_md', 'ge_ld',
     'g_glove_side', 'g_sv_side', 'g_sv_type2', 'g_reb_rate', 'g_starts7', 'g_consec', 'g_height']
out = np.full((len(df), len(F)), np.nan)
cache = {}
for gid, g in df.groupby('game', sort=False):
    season = int(g.season.iat[0]); dn = int(g.dnum.iat[0])
    lgr = (sum(lg_reb) / len(lg_reb)) if lg_reb else 0.1
    for i, gl, y, typ in zip(g.index, g.goalie, g.y, g.type):
        if not gl: continue
        key = (gl, season)
        if key not in cache: cache[key] = [*career(gl, season), last(gl, season), *edgef(gl, season)]
        p = players.get(str(gl)); hand = p[0] if p else ''
        glove = int((y < 0) if hand == 'L' else (y > 0)) if hand in ('L', 'R') else -1
        a = st[gl]; sd = glove if glove >= 0 else 0; tk = TYPEK.get(str(typ), 7)
        ds = sorted(starts[gl]); s7 = sum(1 for d in ds if dn - 7 <= d < dn)
        consec = 0
        # consecutive team games he started is approximated by consecutive starts with gaps of <= 3 days
        prev = dn
        for d in reversed(ds):
            if prev - d <= 3: consec += 1; prev = d
            else: break
        out[i] = [*cache[key], glove, math.log((a['side_x'][sd] + 5) / (a['side_g'][sd] + 5)), math.log((a['type_x'][tk] + 3) / (a['type_g'][tk] + 3)),
                  ((a['reb'] + 10 * lgr) / (a['saves'] + 10)) - lgr, s7, consec, p[3] if p and p[3] else np.nan]
    # update after the game
    rows = list(zip(g.goalie, g.y, g.type, g.goal, g.xg_base, g.en, g.ongoal, g.team, g.t))
    for j, (gl, y, typ, goal, xb, en, og, team, t) in enumerate(rows):
        if not gl or en or xb != xb: continue
        p = players.get(str(gl)); hand = p[0] if p else ''
        sd = int((y < 0) if hand == 'L' else (y > 0)) if hand in ('L', 'R') else 0
        a = st[gl]; tk = TYPEK.get(str(typ), 7)
        for k in ('side_g', 'side_x', 'type_g', 'type_x'): a[k] = [v * LG for v in a[k]]
        a['saves'] *= LG; a['reb'] *= LG
        a['side_g'][sd] += goal; a['side_x'][sd] += xb; a['type_g'][tk] += goal; a['type_x'][tk] += xb
        if og and not goal:
            nxt = rows[j + 1] if j + 1 < len(rows) else None
            r = int(bool(nxt and nxt[7] == team and 0 <= nxt[8] - t <= 3))
            a['saves'] += 1; a['reb'] += r; lg_reb.append(r)
    for gl in set(x for x in g.goalie if x): starts[gl].append(dn)
for j, c in enumerate(F): df[c] = out[:, j]
df.to_parquet('shots_feat2.parquet')
print(df[df.season != 2025][F].describe().T[['count', 'mean', '50%']])
