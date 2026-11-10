# League-relative skill: each finishing / saving number minus its league-wide average over the previous 30 game days
# (earlier dates only), so drift in the base xG cancels out.
import pandas as pd, numpy as np
df = pd.read_parquet('shots_feat2.parquet')
REL = ['sh_fin_d', 'sh_fin_area', 'sh_fin_type', 'sh_fin_season', 'g_sv_d', 'g_sv_area', 'g_sv_season', 'g_sv_side', 'g_sv_type2']
day = df[df.en == 0].groupby('dnum')[REL].agg(['sum', 'count'])
season_of_day = df[df.en == 0].groupby('dnum').season.first()
for c in REL:
    if c.endswith('_season'):   # within the same season only (review fix): at a season's start everyone is 0
        S_ = day[(c, 'sum')].groupby(season_of_day).transform(lambda v: v.rolling(30, min_periods=1).sum().shift(1))
        N_ = day[(c, 'count')].groupby(season_of_day).transform(lambda v: v.rolling(30, min_periods=1).sum().shift(1))
        df[c + '_rel'] = df[c] - df.dnum.map((S_ / N_).fillna(0))
    else:
        s = day[(c, 'sum')].rolling(30, min_periods=5).sum().shift(1); n = day[(c, 'count')].rolling(30, min_periods=5).sum().shift(1)
        df[c + '_rel'] = df[c] - df.dnum.map(s / n)
df.to_parquet('shots_feat2.parquet')
print(df[df.season != 2025].groupby('season')[[c + '_rel' for c in REL]].mean().round(4))
