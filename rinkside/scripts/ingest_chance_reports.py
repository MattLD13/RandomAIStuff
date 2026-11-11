# Read every report graphic in calibration/inbox/, add its counts to calibration/chance-reports.json, refit the zones.
#   python3 scripts/ingest_chance_reports.py           (needs tesseract-ocr, Pillow and node)
# A graphic is used only if both sides add up (chances = high + mid + low) and the game is found in the NHL schedule;
# otherwise it stays in the inbox and the reason goes to calibration/inbox/NEEDS_REVIEW.txt.
import hashlib, json, os, shutil, subprocess, sys, urllib.request
here = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(here, 'scripts'))
from read_chance_report import read
inbox, done, rep = (os.path.join(here, 'calibration', d) for d in ('inbox', 'reports', 'chance-reports.json'))
data = json.load(open(rep)); have = {r.get('sha') for r in data['reports']}
review, added = [], 0
def schedule(date):
    with urllib.request.urlopen(urllib.request.Request(f'https://api-web.nhle.com/v1/schedule/{date}', headers={'User-Agent': 'rinkside'})) as r:
        days = json.load(r)['gameWeek']
    return [g for d in days if d['date'] == date for g in d['games']]
def match(name, team):
    words = f"{team.get('placeName', {}).get('default', '')} {team.get('commonName', {}).get('default', '')}".upper().replace('.', '').split()
    return words and words[-1] in name.replace('.', '').split()           # the nickname ("RANGERS", "OILERS") is enough
for f in sorted(os.listdir(inbox)):
    if not f.lower().endswith(('.png', '.jpg', '.jpeg', '.webp')): continue
    p = os.path.join(inbox, f); sha = hashlib.sha256(open(p, 'rb').read()).hexdigest()[:16]
    if sha in have: os.remove(p); continue
    r = read(p)
    if not r['date'] or not r['away_name']: review.append(f'{f}: could not read the date or teams ({r["header"]!r})'); continue
    games = [g for g in schedule(r['date']) if match(r['away_name'], g['awayTeam']) and match(r['home_name'], g['homeTeam'])]
    if len(games) != 1: review.append(f'{f}: no single NHL game on {r["date"]} for {r["away_name"]} @ {r["home_name"]}'); continue
    g = games[0]; bad = [s for s in ('left', 'right') if not r[s]['consistent']]
    if bad: review.append(f'{f}: numbers do not add up on the {" and ".join(bad)} side: {json.dumps({s: r[s] for s in bad})}'); continue
    for side, team in (('left', g['awayTeam']), ('right', g['homeTeam'])):
        s = r[side]
        data['reports'].append(dict(game=g['id'], date=r['date'], matchup=f"{g['awayTeam']['abbrev']} @ {g['homeTeam']['abbrev']}", team=team['abbrev'],
                                    chances=s['chances'], hi=s['hi'], mid=s['mid'], low=s['low'], dumps=s.get('dumps'), noShots=s.get('noShots'), xg=s['xg'],
                                    hiGoals=s['hiGoals'], midGoals=s['midGoals'], lowGoals=s['lowGoals'], sha=sha, auto=True))
    shutil.move(p, os.path.join(done, f"{r['date']}-{g['awayTeam']['abbrev']}-{g['homeTeam']['abbrev']}{os.path.splitext(f)[1].lower()}")); added += 1
json.dump(data, open(rep, 'w'), indent=2); open(rep, 'a').write('\n')
rv = os.path.join(inbox, 'NEEDS_REVIEW.txt')
if review: open(rv, 'w').write('\n'.join(review) + '\n')
elif os.path.exists(rv): os.remove(rv)
print(f'added {added} report(s); {len(review)} need review')
for x in review: print(' ', x)
if added: subprocess.run(['node', os.path.join(here, 'scripts', 'fit-chance-zones.mjs'), '--write'], check=True)
