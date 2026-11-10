# Research-driven features (each tested as its own group), all known before the shot:
#   momentum:  seconds since the last goal by either team, who scored it, shooter's goals so far this game
#   travel:    rest days, back-to-back, km travelled and time zones crossed since the previous game (both teams)
#   arena:     scorekeeper distance bias of this rink (trailing: mean shot distance here minus the same teams elsewhere)
#   placebo:   pure random noise (a control: a real group has to beat this)
import gzip, json, math
from collections import defaultdict, deque
import numpy as np, pandas as pd

df = pd.read_parquet('shots_feat2.parquet')
# team home cities: lat, lon, UTC offset (standard time)
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

F = ['since_goal', 'last_goal_us', 'sh_goals_game', 'team_goals_game_diff_last10m',
     'sh_rest', 'sh_b2b', 'sh_travel_km', 'sh_tz', 'df_rest', 'df_b2b', 'df_travel_km', 'df_tz',
     'arena_bias', 'placebo1', 'placebo2']
last = {}                                     # team -> (date ordinal, city)
arena_d = defaultdict(lambda: deque(maxlen=4000)); away_d = defaultdict(lambda: deque(maxlen=4000))   # trailing shot distances
rng = np.random.default_rng(12345)
out = np.full((len(df), len(F)), np.nan)
for gid, g in df.groupby('game', sort=False):
    season = int(g.season.iat[0])
    raw = json.loads(gzip.open(f'raw/{season}/{gid}.json.gz').read())
    home, away, ha, aa = raw['home'], raw['away'], raw['homeAbbrev'], raw['awayAbbrev']
    city = CITY.get(ha)
    dn = int(g.dnum.iat[0])
    trav = {}
    for tm, ab in ((home, ha), (away, aa)):
        if tm in last and city:
            pd_, pc = last[tm]
            trav[tm] = (dn - pd_, int(dn - pd_ == 1), km(pc, city), abs(pc[2] - city[2]))
        else:
            trav[tm] = (np.nan, 0, np.nan, np.nan)
    # arena bias: mean distance of shots in this rink minus mean distance of the same two teams' shots in other rinks
    ad = arena_d[home]; o1, o2 = away_d[home], away_d[away]
    bias = (np.mean(ad) - np.mean(list(o1) + list(o2))) if len(ad) > 300 and len(o1) + len(o2) > 300 else np.nan
    # in-game momentum: walk the shots in order (goals come from the shot rows themselves)
    last_goal_t, last_goal_team = None, None
    sh_goals = defaultdict(int); goal_times = []
    for i, team, s, t, goal in zip(g.index, g.team, g.shooter, g.t, g.goal):
        other = away if team == home else home
        recent = sum(1 if tm == team else -1 for tt, tm in goal_times if t - tt <= 600)
        r = trav[team]; d = trav[other]
        out[i] = [t - last_goal_t if last_goal_t is not None else t, (1 if last_goal_team == team else -1) if last_goal_team is not None else 0,
                  sh_goals[s], recent, *r, *d, bias, rng.normal(), rng.random()]
        if goal:
            last_goal_t, last_goal_team = t, team; sh_goals[s] += 1; goal_times.append((t, team))
    # update after the game
    for team, dist in zip(g.team, g.dist):
        arena_d[home].append(dist)
        if team == away: away_d[away].append(dist)     # a team's shots in other teams' rinks
    if city:
        for tm in (home, away): last[tm] = (dn, city)

for j, c in enumerate(F): df[c] = out[:, j]
df.to_parquet('shots_feat2.parquet')
ne = df[df.en == 0]
print(df[F].describe().T[['count', 'mean', '50%']])
for c in ['sh_goals_game', 'last_goal_us', 'df_b2b', 'sh_b2b']:
    print(ne.groupby(ne[c].clip(upper=2)).agg(shots=('goal', 'size'), goals=('goal', 'sum'), xg=('xg_base', 'sum')).assign(ratio=lambda d: d.goals / d.xg))
