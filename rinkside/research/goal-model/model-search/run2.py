# refit policies. usage: run2.py <folds comma> <names comma>
# name grammar: {m|b|w}{window}[_hl{halflife}][_cw{k}][_s{seed}][_placebo]   m = monthly, b = every 14 days, w = every 7 days
from lib import *
import re
def parse(name):
    m = re.fullmatch(r'([mbw])(\d+)(?:_hl(\d+))?(?:_cw(\d+))?(?:_s(\d+))?(_placebo)?', name)
    return dict(every={'m': 'M', 'b': 14, 'w': 7}[m[1]], window=int(m[2]), halflife=int(m[3]) if m[3] else None, cur_w=int(m[4]) if m[4] else None,
                seed=int(m[5]) if m[5] else 1, cols=V2 + PLACEBO if m[6] else V2)
if __name__ == '__main__':
    ne = load()
    for name in sys.argv[2].split(','):
        for t in [int(x) for x in sys.argv[1].split(',')]:
            if have(name, t): continue
            save(name, t, refit(ne, t, **parse(name))); print(name, t, time.strftime('%H:%M:%S'), flush=True)
