# Pass 1: one row per unblocked shot attempt (shot on goal, goal, missed shot), with everything known
# at the moment of the shot from the play-by-play itself. History features come later (history.py).
import gzip, json, math, os, sys
import pandas as pd

RAW = 'raw'
players = json.load(open('players.json'))
SHOTS = {'shot-on-goal', 'goal', 'missed-shot'}
ATTEMPTS = SHOTS | {'blocked-shot'}

def secs(t):
    m, s = (t or '0:0').split(':')
    return int(m) * 60 + int(s)

rows = []
CUR = int(os.environ.get('SEASON', '0'))     # with SEASON set, completed seasons are read from a per-season cache
cached = []
for season in sorted(os.listdir(RAW)):
    cf = f'cache_shots_{season}.parquet'
    if CUR and int(season) < CUR and os.path.exists(cf):
        cached.append(pd.read_parquet(cf)); continue
    start = len(rows)
    for f in sorted(os.listdir(f'{RAW}/{season}')):
        g = json.loads(gzip.open(f'{RAW}/{season}/{f}').read())
        home, away = g['home'], g['away']
        pos = {r[0]: r[2] for r in g['roster']}
        plays = sorted(g['plays'], key=lambda p: p[1])
        # attack direction per (period, team): +1 if that team shoots at the goal on the +x side
        dirs = {}
        votes = {}
        for eid, so, per, ptype, tip, sit, hside, typ, d in plays:
            if hside in ('left', 'right') and per is not None:
                hd = 1 if hside == 'left' else -1
                dirs[(per, home)] = hd; dirs[(per, away)] = -hd
            if typ in SHOTS and d.get('xCoord') is not None and d.get('zoneCode') == 'O':
                k = (per, d.get('eventOwnerTeamId'))
                votes[k] = votes.get(k, 0) + (1 if d['xCoord'] > 0 else -1)
        for k, v in votes.items():
            if k not in dirs and v != 0: dirs[k] = 1 if v > 0 else -1
        score = {home: 0, away: 0}
        prev = None          # last event with a location
        last_fo = None       # (t, zone from the faceoff winner's... we store the shot team's view later)
        goalie_faced = {}    # unblocked shots a goalie has faced so far this game
        team_att = {home: [], away: []}   # times of this team's attempts (for flurries)
        for eid, so, per, ptype, tip, sit, hside, typ, d in plays:
            if ptype == 'SO' or per is None: continue
            t = (per - 1) * 1200 + secs(tip)
            team = d.get('eventOwnerTeamId')
            x, y = d.get('xCoord'), d.get('yCoord')
            if typ == 'faceoff':
                last_fo = (t, x)
            if typ in SHOTS and x is not None and team in (home, away):
                dr = dirs.get((per, team))
                if dr is None: dr = 1 if x > 0 else -1
                xn, yn = x * dr, y * dr
                fx = 89 - xn
                dist = math.hypot(fx, yn)
                ang = math.degrees(math.atan2(abs(yn), fx)) if fx > 0 else 90 + math.degrees(math.atan2(-fx, abs(yn) + 1e-9))
                sc = str(sit or '1551').zfill(4)
                ag, ask, hsk, hg = int(sc[0]), int(sc[1]), int(sc[2]), int(sc[3])
                ishome = team == home
                own, opp = (hsk, ask) if ishome else (ask, hsk)
                own_g, opp_g = (hg, ag) if ishome else (ag, hg)
                shooter = d.get('shootingPlayerId') or d.get('scoringPlayerId') or 0
                goalie = d.get('goalieInNetId') or 0
                en = 1 if opp_g == 0 else 0          # game state only: an outcome-free rule (review fix)
                other = away if ishome else home
                r = dict(season=int(season), game=g['id'], date=g['date'], so=so, eid=eid, period=per, t=t,
                         team=team, home=int(ishome), shooter=shooter, goalie=goalie, goal=int(typ == 'goal'),
                         ongoal=int(typ != 'missed-shot'), miss_reason=d.get('reason', ''),
                         type=d.get('shotType', 'unknown'), zone=d.get('zoneCode', ''),
                         x=xn, y=yn, dist=dist, angle=ang, behind=int(fx < 0),
                         own=own, opp=opp, en=en, pulled=int(own_g == 0),
                         sdiff=score[team] - score[other], venue=g.get('venue') or '', home_team=home)
                p = players.get(str(shooter))
                r['hand'] = p[0] if p else ''
                r['spos'] = (p[1] if p else pos.get(shooter, '')) or ''
                r['height'] = p[3] if p and p[3] else None
                gp = players.get(str(goalie))
                r['ghand'] = gp[0] if gp else ''
                # previous event
                if prev and prev['per'] == per:
                    dt = t - prev['t']
                    same = prev['team'] == team
                    px = prev['x'] * dr; py = prev['y'] * dr
                    dd = math.hypot(xn - px, yn - py)
                    r.update(prev_type=prev['typ'], prev_same=int(same), prev_dt=dt, prev_dist=dd,
                             prev_speed=dd / max(dt, 1), prev_x=px, prev_y=py)
                    rebound = prev['typ'] in ATTEMPTS and same and dt <= 3
                    r['rebound'] = int(rebound)
                    if rebound:
                        pfx = 89 - px
                        pang = math.degrees(math.atan2(py, max(pfx, 0.5)))
                        cang = math.degrees(math.atan2(yn, max(fx, 0.5)))
                        r['reb_angle'] = abs(cang - pang)
                        r['reb_speed'] = abs(cang - pang) / max(dt, 1)
                    else:
                        r['reb_angle'] = 0; r['reb_speed'] = 0
                    r['rush'] = int(dt <= 4 and (px < 25))          # previous event outside the offensive zone
                    r['cross'] = int(abs(py - yn) > 15 and dt <= 2 and same)   # quick east-west movement
                else:
                    r.update(prev_type='none', prev_same=0, prev_dt=999, prev_dist=0, prev_speed=0, prev_x=0, prev_y=0,
                             rebound=0, reb_angle=0, reb_speed=0, rush=0, cross=0)
                r['since_fo'] = t - last_fo[0] if last_fo else 999
                r['fo_ozone'] = int(last_fo is not None and last_fo[1] is not None and (last_fo[1] * dr) > 25 and t - last_fo[0] <= 10)
                r['g_faced'] = goalie_faced.get(goalie, 0)
                ta = team_att[team]
                r['flurry'] = sum(1 for tt in ta if t - tt <= 10)   # own attempts in the previous 10 seconds
                rows.append(r)
                if goalie and not en: goalie_faced[goalie] = goalie_faced.get(goalie, 0) + 1
            if typ in ATTEMPTS and team in team_att:
                team_att[team].append(t)
            if typ == 'goal' and team in score:
                score[team] += 1
            if x is not None:
                prev = dict(per=per, t=t, team=team, typ=typ, x=x if x is not None else 0, y=y or 0)
            if typ == 'goal': prev = None
    if CUR and int(season) < CUR: pd.DataFrame(rows[start:]).to_parquet(cf)
    print(season, len(rows), file=sys.stderr)

df = pd.concat(cached + [pd.DataFrame(rows)], ignore_index=True) if cached else pd.DataFrame(rows)
df.to_parquet('shots.parquet')
print(df.shape, df.goal.mean())
