TRAIN, VAL, TEST = [2021, 2022, 2023], [2024], [2025, 2026]
CAT = ['type', 'prev_type', 'hand', 'ghand', 'spos', 'miss_reason']
BASE = ['dist', 'angle', 'x', 'y', 'behind', 'type', 'prev_type', 'prev_same', 'prev_dt', 'prev_dist', 'prev_speed', 'prev_x', 'prev_y',
        'rebound', 'reb_angle', 'reb_speed', 'rush', 'cross', 'since_fo', 'fo_ozone', 'flurry', 'own', 'opp', 'skdiff', 'pulled',
        'sdiff', 'period', 't', 'home', 'hand', 'offwing', 'spos', 'ghand', 'g_faced']
SH = ['sh_n', 'sh_fin_a2', 'sh_fin_a10', 'sh_fin_season', 'sh_recent100', 'sh_recent_games', 'sh_avgdist', 'sh_ongoal']
GL = ['g_n', 'g_sv_a5', 'g_sv_a20', 'g_sv_season', 'g_recent300', 'g_rest', 'g_b2b', 'g_age_days']
P = dict(objective='binary', learning_rate=0.03, num_leaves=15, min_data_in_leaf=300, feature_fraction=0.9, bagging_fraction=0.8,
         bagging_freq=1, lambda_l2=10.0, verbose=-1, seed=1, num_threads=4)
STREAK = ['sh_dry_shots', 'sh_dry_games', 'sh_goals_last5', 'g_shutout_streak_shots']
FORM = ['sh_recent100', 'sh_recent_games', 'g_recent300'] + STREAK            # short-term form: the "hot/cold" bits
SH = SH + ['sh_dry_shots', 'sh_dry_games', 'sh_goals_last5']
GL = GL + ['g_shutout_streak_shots']
# ---- round 2 ----
CTX = ['lg_env', 'sh_shift', 'tm_shift_mean', 'op_shift_mean', 'op_shift_max', 'n_d_on', 'n_f_on']
SHOOT = ['sh_neff', 'sh_fin_d', 'sh_fin_area', 'sh_fin_type', 'sh_acc_d', 'sh_dist_d', 'sh_rate60', 'sh_fin_season']
SPEED = ['sh_edge_avg', 'sh_edge_top', 'sh_edge_hard']
GOAL = ['g_neff', 'g_sv_d', 'g_sv_area', 'g_sv_season', 'g_rest', 'g_b2b', 'g_age_days']
MATES = ['tm_a1_60_max', 'tm_a1_60_mean', 'tm_xgf60_mean', 'sh_xgf60', 'op_xga60_mean', 'op_xga60_min']
FORM2 = ['sh_recent100', 'sh_recent_games', 'sh_dry_shots', 'sh_dry_games', 'sh_goals_last5', 'g_recent300', 'g_shutout_streak_shots']
REVENGE = ['vs_old_team', 'old_team_first', 'old_team_away']
MOM = ['since_goal', 'last_goal_us', 'sh_goals_game', 'team_goals_game_diff_last10m']
TRAVEL = ['sh_rest', 'sh_b2b', 'sh_travel_km', 'sh_tz', 'df_rest', 'df_b2b', 'df_travel_km', 'df_tz']
ARENA = ['arena_bias']
PLACEBO = ['placebo1', 'placebo2']
GROUPS = dict(context=CTX, shooter=SHOOT, speed=SPEED, goalie=GOAL, linemates=MATES, momentum=MOM, travel=TRAVEL,
              arena=ARENA, streaks=FORM2, revenge=REVENGE, placebo=PLACEBO)
# ---- v2 ----
CHANGE = ['tm_shift_min', 'op_shift_min']                 # time since each team's last change, at the shot
CHANGE_LAG = ['tm_shift_min_lag2', 'op_shift_min_lag2']   # same, 2 s before the shot (artifact control)
