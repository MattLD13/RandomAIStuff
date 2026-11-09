"""Exports the assembly component parts as exact STEP files (true planes, cylinders and arcs),
the way the real CSWA hands you a zip of parts for the assembly questions.

    python3 -m venv .venv && .venv/bin/pip install cadquery
    .venv/bin/python parts.py            # writes ../site/parts/*.zip and checks volumes

Geometry mirrors content/models.mjs (Y up, Front plane = XY). Each Base part is shifted so
its part origin sits at the assembly origin shown in the question images: insert the Base
first and fix it with its origin on the assembly origin, and the centre-of-mass answers line up.
"""
import json
import os
import subprocess
import sys
import zipfile

import cadquery as cq

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, '..', 'site', 'parts')


# ---- helpers (same plane conventions as lib/geom.mjs) --------------------------------------
def wp(plane, d0):
    """Workplane whose local (u, v) are the profile coords used in models.mjs."""
    if plane == 'XY':   # (x, y), extrude +Z
        return cq.Workplane(cq.Plane(origin=(0, 0, d0), xDir=(1, 0, 0), normal=(0, 0, 1)))
    if plane == 'XZ':   # (x, -z), extrude +Y
        return cq.Workplane(cq.Plane(origin=(0, d0, 0), xDir=(1, 0, 0), normal=(0, 1, 0)))
    if plane == 'YZ':   # (-z, y), extrude +X
        return cq.Workplane(cq.Plane(origin=(d0, 0, 0), xDir=(0, 0, -1), normal=(1, 0, 0)))
    raise ValueError(plane)


def uv(plane, a, b):
    """Convert models.mjs profile coords to this workplane's local coords."""
    if plane == 'XZ':
        return (a, -b)
    if plane == 'YZ':
        return (-a, b)
    return (a, b)


def poly(plane, pts, d0, d1):
    return wp(plane, d0).polyline([uv(plane, *p) for p in pts]).close().extrude(d1 - d0)


def cyl(plane, cu, cv, r, d0, d1):
    return wp(plane, d0).center(*uv(plane, cu, cv)).circle(r).extrude(d1 - d0)


def box(x0, y0, z0, x1, y1, z1):
    return cq.Workplane('XY').box(x1 - x0, y1 - y0, z1 - z0, centered=False).translate((x0, y0, z0))


def obround(plane, u1, u2, v, r, d0, d1):
    """Straight slot / link outline along u (centres u1, u2), as in slotU()."""
    w = wp(plane, d0)
    p = lambda a, b: uv(plane, a, b)
    s = (w.moveTo(*p(u1, v - r)).lineTo(*p(u2, v - r))
         .threePointArc(p(u2 + r, v), p(u2, v + r)).lineTo(*p(u1, v + r))
         .threePointArc(p(u1 - r, v), p(u1, v - r)).close())
    return s.extrude(d1 - d0)


def arch(plane, x0, x1, y0, yc, d0, d1):
    """Rectangle x0..x1 from y0 up to yc, topped by a half circle (ears, tongue, hanger top)."""
    r = (x1 - x0) / 2
    xc = (x0 + x1) / 2
    w = wp(plane, d0)
    s = (w.moveTo(x0, y0).lineTo(x1, y0).lineTo(x1, yc)
         .threePointArc((xc, yc + r), (x0, yc)).close())
    return s.extrude(d1 - d0)


# ---- parts ---------------------------------------------------------------------------------
def hingeBase():
    b = box(0, 0, 0, 120, 10, 60).union(arch('XY', 10, 40, 10, 40, 10, 18)).union(arch('XY', 10, 40, 10, 40, 42, 50))
    return b.cut(cyl('XY', 25, 40, 5, 9, 51))


def hingeArm():
    return obround('XY', 0, 120, 0, 15, 0, 24).cut(cyl('XY', 0, 0, 5, -1, 25)).cut(cyl('XY', 120, 0, 5, -1, 25))


def plainPin():
    return cyl('XY', 0, 0, 5, 0, 50)


def hanger():
    w = wp('XY', 0)
    s = w.moveTo(15, 0).threePointArc((0, 15), (-15, 0)).lineTo(-15, -50).lineTo(15, -50).close().extrude(10)
    return s.cut(cyl('XY', 0, 0, 5, -1, 11)).cut(cyl('XY', 0, -35, 6, -1, 11))


def rail():
    return poly('YZ', [(0, 0), (50, 0), (50, 25), (40, 25), (40, 8), (10, 8), (10, 25), (0, 25)], 0, 200)


def endCap():
    return box(0, 0, 0, 6, 25, 50)


def slider():
    return box(0, 0, 0, 40, 22, 30).cut(cyl('XZ', 20, 15, 6, -1, 23))


def post():
    return cyl('XZ', 0, 0, 6, 0, 100).union(cyl('XZ', 0, 0, 15, 60, 66))


def handle():
    return obround('XZ', 0, 80, 0, 10, 0, 8).cut(cyl('XZ', 0, 0, 6, -1, 9)).cut(cyl('XZ', 80, 0, 4, -1, 9))


def tongueBase():
    b = box(0, 0, 0, 80, 30, 50).union(arch('XY', 25, 55, 30, 60, 20, 30))
    return b.cut(cyl('XY', 40, 60, 5, 19, 31))


def link(n):
    return obround('XY', 0, n, 0, 12, 0, 10).cut(cyl('XY', 0, 0, 5, -1, 11)).cut(cyl('XY', n, 0, 5, -1, 11))


def headedPin():
    return cyl('XY', 0, 0, 5, 0, 20).union(cyl('XY', 0, 0, 8, 20, 23))


# exam id -> (zip name, [(file name, model name in models.mjs, builder, shift to assembly origin)])
SETS = {
    'exam1': ('exam1-hinged-arm-parts', [
        ('Base', 'hingeBase', hingeBase, (0, 0, -60)),
        ('Arm', 'hingeArm', hingeArm, None),
        ('Pin', 'plainPin', plainPin, None),
        ('Hanger', 'hanger', hanger, None),
    ]),
    'exam2': ('exam2-slide-parts', [
        ('Rail', 'rail', rail, (0, 0, -50)),
        ('End Cap', 'endCap', endCap, None),
        ('Slider', 'slider', slider, None),
        ('Post', 'post', post, None),
        ('Handle', 'handle', handle, None),
    ]),
    'exam3': ('exam3-link-chain-parts', [
        ('Base', 'tongueBase', tongueBase, (0, 0, -50)),
        ('Link 100', 'link100', lambda: link(100), None),
        ('Link 140', 'link140', lambda: link(140), None),
        ('Pin', 'headedPin', headedPin, None),
    ]),
}


def mesh_volumes(names):
    """Volumes of the same parts from the manifold models, to cross-check the STEP geometry."""
    js = ("const {MODELS}=await import('./content/models.mjs');const {massProps}=await import('./lib/geom.mjs');"
          f"const out={{}};for(const n of {json.dumps(names)}){{const m=MODELS[n]({{}});out[n]=massProps(m.body).volume;}}"
          "console.log(JSON.stringify(out));")
    r = subprocess.run(['node', '--input-type=module', '-e', js], cwd=HERE, capture_output=True, text=True, check=True)
    return json.loads(r.stdout)


def main():
    os.makedirs(OUT, exist_ok=True)
    all_names = [m for _, items in SETS.values() for _, m, _, _ in items]
    ref = mesh_volumes(all_names)
    bad = 0
    for exam, (zname, items) in SETS.items():
        files = []
        for fname, mname, fn, shift in items:
            shape = fn()
            vol = shape.val().Volume()
            diff = abs(vol - ref[mname]) / vol
            flag = 'OK ' if diff < 1e-5 else 'BAD'
            bad += flag == 'BAD'
            print(f'{flag} {exam:6} {fname:10} STEP {vol:12.3f} mm3   mesh {ref[mname]:12.3f}   diff {diff:.2e}')
            if shift:
                shape = shape.translate(shift)
            path = os.path.join(OUT, f'{zname}-{fname.replace(" ", "")}.step')
            cq.exporters.export(shape, path)
            files.append((path, f'{fname}.step'))
        with zipfile.ZipFile(os.path.join(OUT, f'{zname}.zip'), 'w', zipfile.ZIP_DEFLATED) as z:
            for path, arc in files:
                z.write(path, arc)
        for path, _ in files:
            os.remove(path)
    if bad:
        sys.exit('volume check failed')


if __name__ == '__main__':
    main()
