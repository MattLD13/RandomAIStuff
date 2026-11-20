"""Independent check of the assembly answer key: places the exact CAD parts from parts.py in
CadQuery/OpenCascade and computes the centre of mass, then compares with data/exams.js."""
import json, math, os, re, sys
import cadquery as cq
import parts as P

DENS = {'AISI 1020': 7900, '6061 Alloy': 2700, 'Alloy Steel': 7700, 'Cast Alloy Steel': 7300, 'ABS': 1020, 'Brass': 8500, 'Plain Carbon Steel': 7800, '1060 Alloy': 2700, 'Copper': 8900}

def placed(shape, rot=None, at=(0, 0, 0)):
    s = shape.val()
    if rot:
        axis, deg = rot
        s = s.rotate((0, 0, 0), axis, deg)
    return s.translate(cq.Vector(*at))

def com(items, ref):
    m = 0; c = [0, 0, 0]
    for solid, mat in items:
        mass = solid.Volume() * DENS[mat] * 1e-6
        p = cq.Shape.centerOfMass(solid)
        m += mass
        for i, v in enumerate((p.x, p.y, p.z)):
            c[i] += mass * v
    return [c[i] / m - ref[i] for i in range(3)], m

# Each builder takes the question's parameters and materials (by component name). Results are
# relative to Coordinate System1 when the question has one, otherwise to the assembly origin.
def hinge(p, mats):
    A = p['A']; a = math.radians(A); x2, y2 = 25 + 120 * math.cos(a), 40 + 120 * math.sin(a)
    return com([
        (placed(P.hingeBase()), mats['Base']),
        (placed(P.hingeArm(), ((0, 0, 1), A), (25, 40, 18)), mats['Arm']),
        (placed(P.plainPin(), None, (25, 40, 5)), mats['Pin']),
        (placed(P.plainPin(), None, (x2, y2, 5)), mats['Pin']),
        (placed(P.hanger(), None, (x2, y2, 42)), mats['Hanger']),
    ], p.get('cs') or (0, 0, 60))

def slide(p, mats):
    A, B = p['A'], p['B']
    return com([
        (placed(P.rail()), mats['Rail']),
        (placed(P.endCap(), None, (-6, 0, 0)), mats['End Cap']),
        (placed(P.endCap(), None, (200, 0, 0)), mats['End Cap']),
        (placed(P.slider(), None, (A, 8, 10)), mats['Slider']),
        (placed(P.post(), None, (A + 20, 8, 25)), mats['Post']),
        (placed(P.handle(), ((0, 1, 0), -B), (A + 20, 74, 25)), mats['Handle']),
    ], p.get('cs') or (0, 0, 50))

def chain(p, mats):
    A, B, C = p['A'], p['B'], p['C']
    t1 = A; t2 = A - (180 - B); t3 = t2 + (180 - C)
    p1 = (40, 60); r = math.radians
    p2 = (p1[0] + 100 * math.cos(r(t1)), p1[1] + 100 * math.sin(r(t1)))
    p3 = (p2[0] + 100 * math.cos(r(t2)), p2[1] + 100 * math.sin(r(t2)))
    return com([
        (placed(P.tongueBase()), mats['Base']),
        (placed(P.link(100), ((0, 0, 1), t1), (*p1, 30)), mats['Link 1']),
        (placed(P.link(100), ((0, 0, 1), t2), (*p2, 40)), mats['Link 2']),
        (placed(P.link(140), ((0, 0, 1), t3), (*p3, 50)), mats['Link 3']),
        (placed(P.headedPin(), None, (*p1, 20)), mats['Pin']),
        (placed(P.headedPin(), None, (*p2, 30)), mats['Pin']),
        (placed(P.headedPin(), None, (*p3, 40)), mats['Pin']),
    ], p.get('cs') or (0, 0, 50))

BUILD = {'hingeAssembly': hinge, 'slideAssembly': slide, 'chainAssembly': chain}

src = open(os.path.join(os.path.dirname(__file__), '..', 'site', 'data', 'exams.js')).read()
data = json.loads(src[src.index('{'):src.rindex('}') + 1])
worst, n = 0, 0
for e in [x for x in data['exams'] if not x.get('legacy')]:
    for q in e['questions']:
        chk = q.get('asmCheck')
        if not chk:
            continue
        c, m = BUILD[chk['fn']](chk['params'], chk['materials'])
        if q['type'] == 'mc':
            key = [float(v) for v in re.findall(r'-?\d+\.\d+', q['options'][q['answer']])]
            d = max(abs(a - b) for a, b in zip(c, key))
        else:
            d = abs(m - q['answer']['value'])
        n += 1
        worst = max(worst, d)
        if d > 0.01 or '-v' in sys.argv:
            print(f"{e['id']} Q{q['n']}: CAD {[round(x, 2) for x in c]} mass {m:.2f}  diff {d:.4f}")
print(f'Checked {n} assembly questions with the exact CAD parts; worst difference {worst:.4f}')
sys.exit(0 if worst < 0.01 else 1)
