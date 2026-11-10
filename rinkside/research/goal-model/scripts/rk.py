import numpy as np
TYPES = ['snap', 'slap', 'backhand', 'tip-in', 'deflected', 'wrap-around']
def rk_X(d):
    fx = (89 - d.x).clip(lower=0.5); ay = d.y.abs()
    dd = np.hypot(89 - d.x, ay) / 10; ang = np.degrees(np.arctan2(ay, fx)) / 45
    cols = [dd, dd ** 2, ang, d.rebound, d.rush, d.pp, d.sh] + [(d.type.astype(str) == t).astype(int) for t in TYPES] + \
           [(~d.type.astype(str).isin(['wrist'] + TYPES)).astype(int)]
    return np.column_stack(cols)
def rk_fit_predict(tr, d):
    from sklearn.linear_model import LogisticRegression
    lr = LogisticRegression(max_iter=2000, C=1e4).fit(rk_X(tr), tr.goal)
    return lr.predict_proba(rk_X(d))[:, 1]
