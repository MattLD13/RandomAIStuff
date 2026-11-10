# usage: rep.py spec1,spec2,... [folds]  -- spec = name or a+b+c (equal-weight log-odds average of raw predictions, then the standard recal); v2 is the reference
from lib import *
REF = os.environ.get('REF', 'v2'); ne = load(); names = [REF] + sys.argv[1].split(','); folds = [int(x) for x in sys.argv[2].split(',')] if len(sys.argv) > 2 else FOLDS
lo = lambda p: np.log(p / (1 - p))
def raw(spec, t):
    parts = spec.split('+'); return 1 / (1 + np.exp(-np.mean([lo(get(k, t)) for k in parts], axis=0)))
Q = {}
for k in names:
    Q[k] = {}
    for t in FOLDS:
        ok = t in folds and all(have(x, t) for x in k.split('+'))
        Q[k][t] = recal(ne, raw(k, t)) if ok else np.full(len(ne), np.nan)
report(ne, Q, ref=REF)
