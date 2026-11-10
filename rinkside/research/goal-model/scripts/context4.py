# v3 candidate features, all known at the moment of the shot.
#   ENTRY: how the puck got here. Seconds since the last event outside the shooting team's offensive zone and since the
#          last event in its own end; events since then; the event before the previous one.
#   CHANGE2: line-change detail. Players on each team who started their shift in the last 5 s; the shortest shift among
#          the defending team's defensemen and among its forwards.
import gzip, json, math, os
import numpy as np, pandas as pd
df = pd.read_parquet('shots_feat2.parquet')
pos = {}
F = ['t_since_out_oz', 't_since_own_dz', 'n_ev_since_entry', 'prev2_type_code', 'prev2_dt',
     'tm_fresh5', 'op_fresh5', 'op_d_shift_min', 'op_f_shift_min']
TYPES = {t: i for i, t in enumerate(['faceoff', 'hit', 'giveaway', 'takeaway', 'blocked-shot', 'missed-shot', 'shot-on-goal', 'goal', 'stoppage', 'penalty'])}
out = np.full((len(df), len(F)), np.nan)
secs = lambda t: int(t.split(':')[0]) * 60 + int(t.split(':')[1]) if t else 0
for gid, g in df.groupby('game', sort=False):
    season = int(g.season.iat[0])
    raw = json.loads(gzip.open(f'raw/{season}/{gid}.json.gz').read())
    for pid, tid, pc, num in raw['roster']: pos[pid] = pc
    home, away = raw['home'], raw['away']
    plays = sorted(raw['plays'], key=lambda p: p[1])
    # attack direction per (period, team), as in build.py
    dirs, votes = {}, {}
    for eid, so, per, ptype, tip, sit, hside, typ, d in plays:
        if hside in ('left', 'right') and per is not None:
            hd = 1 if hside == 'left' else -1; dirs[(per, home)] = hd; dirs[(per, away)] = -hd
        if typ in ('shot-on-goal', 'goal', 'missed-shot') and d.get('xCoord') is not None and d.get('zoneCode') == 'O':
            k = (per, d.get('eventOwnerTeamId')); votes[k] = votes.get(k, 0) + (1 if d['xCoord'] > 0 else -1)
    for k, v in votes.items():
        if k not in dirs and v != 0: dirs[k] = 1 if v > 0 else -1
    ev = [(so, per, (per - 1) * 1200 + secs(tip), typ, d.get('xCoord')) for eid, so, per, ptype, tip, sit, hside, typ, d in plays if per is not None and ptype != 'SO']
    sf = f'shifts/{season}/{gid}.json.gz'
    sh = np.array(json.loads(gzip.open(sf).read()) if os.path.exists(sf) else [], dtype=float).reshape(-1, 5)
    for i, so, per, t, team in zip(g.index, g.so, g.period, g.t, g.team):
        dr = dirs.get((per, team), 1)
        prior = [e for e in ev if e[1] == per and e[0] < so]
        last_out = last_dz = None; n_since = 0
        for e in reversed(prior):
            if e[4] is None: continue
            xn = e[4] * dr
            if last_out is None:
                if xn < 25: last_out = e[2]
                else: n_since += 1
            if xn < -25: last_dz = e[2]; break
        p2 = prior[-2] if len(prior) >= 2 else None
        row = [t - last_out if last_out is not None else t - (per - 1) * 1200, t - last_dz if last_dz is not None else np.nan, n_since,
               TYPES.get(p2[3], -1) if p2 else -1, t - p2[2] if p2 else np.nan]
        if len(sh) > 200:
            tp = t - (per - 1) * 1200
            on = sh[(sh[:, 2] == per) & (sh[:, 3] < tp) & (sh[:, 4] >= tp)]
            own = [(int(p), tp - st) for p, tm, _, st, _ in on if tm == team and pos.get(int(p)) != 'G']
            opp = [(int(p), tp - st) for p, tm, _, st, _ in on if tm != team and pos.get(int(p)) != 'G']
            od = [x for p, x in opp if pos.get(p) == 'D']; of = [x for p, x in opp if pos.get(p) in ('C', 'L', 'R')]
            row += [sum(1 for _, x in own if x <= 5), sum(1 for _, x in opp if x <= 5), min(od) if od else np.nan, min(of) if of else np.nan]
        else:
            row += [np.nan] * 4
        out[i] = row
for j, c in enumerate(F): df[c] = out[:, j]
df.to_parquet('shots_feat2.parquet')
x = df[(df.en == 0) & df.season.isin([2022, 2023, 2024])]
print(x[F].describe().T[['count', 'mean', '50%']])
print(x.groupby(pd.cut(x.t_since_out_oz, [-1, 2, 4, 6, 10, 20, 60, 2000])).agg(n=('goal', 'size'), g=('goal', 'mean'), xg=('xg_base', 'mean')).assign(r=lambda d: d.g / d.xg).round(3))
