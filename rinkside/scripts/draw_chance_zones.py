import json, math, numpy as np, matplotlib
matplotlib.use('Agg'); import matplotlib.pyplot as plt
from matplotlib.patches import Arc, Circle, Rectangle, FancyBboxPatch
from matplotlib.colors import ListedColormap
Z = dict(dump=58, hiDist=23, hiAng=55, midDist=27, midAng=80, crease=12, creaseLo=80, creaseHi=180)
INK, SEC, SURF, LINE = '#14202c', '#4c5b69', '#fbfdfe', '#b9c6d1'
HI, MID, LOW, DUMP = '#4caf6e', '#e9b73c', '#e2736b', '#c7cfd6'
def cls(x, y):
    fx = 89 - x; ay = abs(y); d = math.hypot(fx, ay); ang = math.degrees(math.atan2(ay, fx)) if fx > 0 else 90 + math.degrees(math.atan2(-fx, ay + 1e-9))
    if fx > Z['dump']: return 3
    return 0 if ((d <= Z['hiDist'] and ang <= Z['hiAng']) or (d <= Z['crease'] and Z['creaseLo'] <= ang <= Z['creaseHi'])) else 1 if (d <= Z['midDist'] and ang <= Z['midAng']) else 2
xs = np.linspace(25, 100, 751); ys = np.linspace(-42.5, 42.5, 851)
G = np.array([[cls(x, y) for x in xs] for y in ys], float)
# outside the rounded boards -> blank
for i, y in enumerate(ys):
    for j, x in enumerate(xs):
        if x > 72 and abs(y) > 14.5 and math.hypot(x - 72, abs(y) - 14.5) > 28: G[i, j] = np.nan
fig, ax = plt.subplots(figsize=(10, 9.2), facecolor=SURF); ax.set_facecolor(SURF)
ax.imshow(G, extent=(25, 100, -42.5, 42.5), origin='lower', cmap=ListedColormap([HI, MID, LOW, DUMP]), vmin=0, vmax=3, alpha=.55, interpolation='nearest', zorder=1)
# rink markings
th = np.linspace(-np.pi / 2, 0, 50)
bx = np.r_[25, 72, 72 + 28 * np.cos(th[::-1] * -1 - np.pi / 2 + np.pi / 2)]
ax.plot([25, 72], [42.5, 42.5], color=LINE, lw=2, zorder=3); ax.plot([25, 72], [-42.5, -42.5], color=LINE, lw=2, zorder=3); ax.plot([100, 100], [-14.5, 14.5], color=LINE, lw=2, zorder=3)
ax.add_patch(Arc((72, 14.5), 56, 56, theta1=0, theta2=90, color=LINE, lw=2, zorder=3)); ax.add_patch(Arc((72, -14.5), 56, 56, theta1=270, theta2=360, color=LINE, lw=2, zorder=3))
ax.plot([25, 25], [-42.5, 42.5], color='#6f95c4', lw=4, zorder=3)
h = 14.5 + math.sqrt(28 ** 2 - 17 ** 2); ax.plot([89, 89], [-h, h], color='#d77a76', lw=1.4, zorder=3)
for cy in (-22, 22): ax.add_patch(Circle((69, cy), 15, fill=False, ec='#d77a76', lw=1.2, zorder=3)); ax.add_patch(Circle((69, cy), .9, color='#d77a76', zorder=3))
ax.add_patch(Arc((89, 0), 12, 12, theta1=90, theta2=270, color='#6f95c4', lw=1.4, zorder=3)); ax.add_patch(Rectangle((89, -3), 3.3, 6, fill=False, ec=INK, lw=1.4, zorder=3))
# the old box, for comparison
ax.plot([89 - 20, 92, 92, 89 - 20, 89 - 20], [-19, -19, 19, 19, -19], color=INK, lw=1.3, ls=(0, (5, 3)), zorder=4)
ax.plot([89 - 30, 92, 92, 89 - 30, 89 - 30], [-30, -30, 30, 30, -30], color=SEC, lw=1, ls=(0, (2, 3)), zorder=4)
# shots from NYR @ EDM, Nov 9 2026 (both teams turned to attack right)
S = json.load(open('g283_sog.json'))   # shots on goal with their real positions (attacking right)
for team, mk, col, lab in ((3, 'o', '#1f4fa3', 'Rangers'), (22, 's', '#d0612a', 'Oilers')):
    pts = [s for s in S if s['team'] == team and s['x'] >= 24]
    for s in pts: ax.scatter([s['x']], [s['y']], marker=mk, s=80 if s['goal'] else 34, facecolor=col if s['goal'] else 'white', edgecolor=col, linewidth=1.4, zorder=6)
    ax.scatter([], [], marker=mk, s=34, facecolor='white', edgecolor=col, linewidth=1.4, label=f'{lab} shot on goal')
ax.scatter([], [], marker='o', s=70, facecolor='#1f4fa3', edgecolor='#1f4fa3', label='filled = goal')
from matplotlib.patches import Patch
from matplotlib.lines import Line2D
handles = [Patch(color=HI, alpha=.55, label=f'High danger: within {Z["hiDist"]} ft and {Z["hiAng"]}°, or the crease: within {Z["crease"]} ft, from 10° in front of the goal line around the back of the net'),
           Patch(color=MID, alpha=.55, label=f'Mid danger: within {Z["midDist"]} ft and {Z["midAng"]}°'),
           Patch(color=LOW, alpha=.55, label='Low danger: the rest of the zone'),
           Patch(color=DUMP, alpha=.55, label=f'Dump: more than {Z["dump"]} ft from the goal line'),
           Line2D([], [], color=INK, ls=(0, (5, 3)), lw=1.3, label='Old high-danger box (20 ft out, 19 ft wide)'),
           Line2D([], [], color=SEC, ls=(0, (2, 3)), lw=1, label='Old mid-danger box (30 × 30 ft)')] + ax.get_legend_handles_labels()[0]
ax.legend(handles=handles, loc='upper left', bbox_to_anchor=(0, -0.04), ncol=1, frameon=False, fontsize=9.5)
ax.set_xlim(24, 101); ax.set_ylim(-44, 44); ax.set_aspect('equal'); ax.axis('off')
ax.text(89.5, -45.5, 'goal line', fontsize=8.5, color=SEC, ha='center'); ax.text(25.5, 43.2, 'blue line', fontsize=8.5, color=SEC)
ax.set_title('Rinkside scoring-chance zones (fitted to Clear Sight reports)\nShots: NYR @ EDM, Nov 9 2026', loc='left', fontsize=13, fontweight='bold', color=INK)
plt.savefig('charts/chance_cone.png', dpi=200, bbox_inches='tight', facecolor=SURF)
