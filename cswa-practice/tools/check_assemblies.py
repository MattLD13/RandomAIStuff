"""Independent check of the assembly answer key: places the exact CAD parts from parts.py in
CadQuery/OpenCascade and computes the centre of mass, then compares with data/exams.js."""
import json, math, os, re, sys
import cadquery as cq
import parts as P

DENS = {'AISI 1020': 7900, '6061 Alloy': 2700, 'Alloy Steel': 7700, 'Cast Alloy Steel': 7300, 'ABS': 1020, 'Brass': 8500}

def placed(shape, rot=None, at=(0, 0, 0)):
    s = shape.val()
    if rot:
        axis, deg = rot
        s = s.rotate((0, 0, 0), axis, deg)
    return s.translate(cq.Vector(*at))

def com(items, origin):
    m = 0; c = [0, 0, 0]
    for solid, mat in items:
        mass = solid.Volume() * DENS[mat] * 1e-6
        p = cq.Shape.centerOfMass(solid)
        m += mass
        for i, v in enumerate((p.x, p.y, p.z)):
            c[i] += mass * v
    return [c[i] / m - origin[i] for i in range(3)], m

def hinge(A):
    a = math.radians(A); x2, y2 = 25 + 120 * math.cos(a), 40 + 120 * math.sin(a)
    return com([
        (placed(P.hingeBase()), 'AISI 1020'),
        (placed(P.hingeArm(), ((0, 0, 1), A), (25, 40, 18)), '6061 Alloy'),
        (placed(P.plainPin(), None, (25, 40, 5)), 'Alloy Steel'),
        (placed(P.plainPin(), None, (x2, y2, 5)), 'Alloy Steel'),
        (placed(P.hanger(), None, (x2, y2, 42)), 'Cast Alloy Steel'),
    ], (0, 0, 60))

def slide(A, B):
    return com([
        (placed(P.rail()), 'AISI 1020'),
        (placed(P.endCap(), None, (-6, 0, 0)), 'ABS'),
        (placed(P.endCap(), None, (200, 0, 0)), 'ABS'),
        (placed(P.slider(), None, (A, 8, 10)), '6061 Alloy'),
        (placed(P.post(), None, (A + 20, 8, 25)), 'Alloy Steel'),
        (placed(P.handle(), ((0, 1, 0), -B), (A + 20, 74, 25)), 'AISI 1020'),
    ], (0, 0, 50))

def chain(A, B, C):
    t1 = A; t2 = A - (180 - B); t3 = t2 + (180 - C)
    p1 = (40, 60); r = math.radians
    p2 = (p1[0] + 100 * math.cos(r(t1)), p1[1] + 100 * math.sin(r(t1)))
    p3 = (p2[0] + 100 * math.cos(r(t2)), p2[1] + 100 * math.sin(r(t2)))
    return com([
        (placed(P.tongueBase()), 'AISI 1020'),
        (placed(P.link(100), ((0, 0, 1), t1), (*p1, 30)), '6061 Alloy'),
        (placed(P.link(100), ((0, 0, 1), t2), (*p2, 40)), '6061 Alloy'),
        (placed(P.link(140), ((0, 0, 1), t3), (*p3, 50)), '6061 Alloy'),
        (placed(P.headedPin(), None, (*p1, 20)), 'Alloy Steel'),
        (placed(P.headedPin(), None, (*p2, 30)), 'Alloy Steel'),
        (placed(P.headedPin(), None, (*p3, 40)), 'Alloy Steel'),
    ], (0, 0, 50))

src = open(os.path.join(os.path.dirname(__file__), '..', 'site', 'data', 'exams.js')).read()
data = json.loads(src[src.index('{'):src.rindex('}') + 1])
q = {qq['id']: qq for e in data['exams'] for qq in e['questions']}
def key(qid):
    t = q[qid]['options'][q[qid]['answer']]
    return [float(v) for v in re.findall(r'-?\d+\.\d+', t)]

cases = [('e1q11', hinge(30)), ('e1q12', hinge(50)), ('e2q11', slide(40, 0)), ('e2q12', slide(120, 60)),
         ('e3q11', chain(45, 135, 135)), ('e3q12', chain(60, 120, 150)), ('e3q14', chain(75, 110, 140))]
worst = 0
for qid, (c, m) in cases:
    k = key(qid)
    d = max(abs(a - b) for a, b in zip(c, k))
    worst = max(worst, d)
    print(f'{qid}: CAD  X={c[0]:8.2f} Y={c[1]:8.2f} Z={c[2]:8.2f}   key X={k[0]:8.2f} Y={k[1]:8.2f} Z={k[2]:8.2f}   max diff {d:.3f} mm   (mass {m:.2f} g)')
print('worst difference:', round(worst, 4), 'mm')
sys.exit(0 if worst < 0.01 else 1)
