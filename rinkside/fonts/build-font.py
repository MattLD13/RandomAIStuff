#!/usr/bin/env python3
"""Builds Rinkside Mono, the board's numeral font, from straight-line geometry.

Sporty monoline numerals: every glyph is a centerline widened by one constant stroke,
with 45-degree chamfered corners, flat cut terminals, no serifs and no curves.
Proportions were measured from the reference screenshot (digit height = 700 units).

    pip install fonttools brotli shapely
    python3 fonts/build-font.py                       # writes site/fonts/RinksideMono.woff2
    python3 fonts/build-font.py --stroke 80 --chamfer 110   # tune

The output covers 0-9 . , - + − – : / and space. Other characters fall back to the
next font in the CSS stack.
"""
import argparse
from pathlib import Path

from fontTools.fontBuilder import FontBuilder
from fontTools.pens.ttGlyphPen import TTGlyphPen
from shapely import affinity
from shapely.geometry import LineString, Polygon, box
from shapely.geometry.polygon import orient
from shapely.ops import unary_union

ap = argparse.ArgumentParser()
ap.add_argument('--stroke', type=float, default=93, help='stroke width (the reference: 4px at a 30px digit height)')
ap.add_argument('--chamfer', type=float, default=96, help='corner cut, measured on the centerline')
ap.add_argument('--advance', type=int, default=590)
ap.add_argument('--width', type=float, default=446)
ap.add_argument('--out', default=str(Path(__file__).resolve().parent.parent / 'site' / 'fonts' / 'RinksideMono.woff2'))
o = ap.parse_args()

S, CC, ADV, H = o.stroke, o.chamfer, o.advance, 700
L = (ADV - o.width) / 2
R = L + o.width
CX = ADV / 2
h = S / 2
XL, XR, YB, YT = L + h, R - h, h, H - h  # centerline box
ADV_P = 300


def stroke(*paths, closed=False):
    """Widen centerline paths by the one stroke width: mitred joins, flat ends."""
    shapes = []
    for pts in paths:
        if closed:
            pts = list(pts) + [pts[0], pts[1]]
        shapes.append(LineString(pts).buffer(h, cap_style='flat', join_style='mitre', mitre_limit=3))
    return unary_union(shapes)


def octagon(x0, y0, x1, y1, c=CC):
    c = min(c, (x1 - x0) / 2, (y1 - y0) / 2)
    return [(x0 + c, y0), (x1 - c, y0), (x1, y0 + c), (x1, y1 - c), (x1 - c, y1), (x0 + c, y1), (x0, y1 - c), (x0, y0 + c)]


def clip(g, x0=L, x1=R, y0=0, y1=H):
    """Cut every terminal flat at the glyph box."""
    return g.intersection(box(x0, y0, x1, y1))


U = lambda *g: unary_union(g)


def g_zero():
    return U(stroke(octagon(XL, YB, XR, YT), closed=True), box(CX - h * 1.05, H / 2 - h * 1.25, CX + h * 1.05, H / 2 + h * 1.25))

def g_one():
    x = CX + 55
    return clip(stroke([(x - 175, YT - 125), (x, YT), (x, -50)], ), x0=0, x1=ADV)

def g_two():
    return clip(stroke([(XL, YT - CC - 40), (XL, YT - CC), (XL + CC, YT), (XR - CC, YT), (XR, YT - CC), (XR, 430), (XL, YB + 10), (XL, YB), (R + 50, YB)]))

def g_three():
    ym = 372
    return clip(stroke([(L - 50, YT), (XR - CC, YT), (XR, YT - CC), (XR, ym + CC * 0.8), (XR - CC * 0.8, ym), (L + 110, ym)],
                       [(XR - CC * 0.8, ym), (XR, ym - CC * 0.8), (XR, YB + CC), (XR - CC, YB), (L - 50, YB)]))

def g_four():
    xs = L + 318
    return clip(stroke([(xs, -50), (xs, YT), (XL, 262), (R + 50, 262)]))

def g_five():
    ym = 418
    return clip(stroke([(R + 50, YT), (XL, YT), (XL, ym), (XR - CC, ym), (XR, ym - CC), (XR, YB + CC), (XR - CC, YB), (L - 50, YB)]))

def g_six():
    yb = 400
    return clip(stroke([(R + 50, YT), (XL + CC, YT), (XL, YT - CC), (XL, YB + CC), (XL + CC, YB), (XR - CC, YB), (XR, YB + CC),
                        (XR, yb - CC), (XR - CC, yb), (XL, yb)]))

def g_seven():
    return clip(stroke([(L - 50, YT), (XR, YT), (L + 140, -60)]))

def g_eight():
    ym = 378
    return U(stroke(octagon(XL + 16, ym, XR - 16, YT, CC * 0.9), closed=True), stroke(octagon(XL, YB, XR, ym), closed=True))

def g_nine():
    return affinity.rotate(g_six(), 180, origin=(CX, H / 2))

def dot(cx, y0):
    return box(cx - h * 1.1, y0, cx + h * 1.1, y0 + S * 1.1)

def g_period():
    return dot(ADV_P / 2, 0)

def g_comma():
    return U(dot(ADV_P / 2, 0), Polygon([(ADV_P / 2 - h * 1.1, 0), (ADV_P / 2 + h * 1.1, 0), (ADV_P / 2 - 20, -120), (ADV_P / 2 - 20 - S * 0.9, -120)]))

def g_hyphen():
    return box(CX - 150, 357 - h, CX + 150, 357 + h)

def g_minus():
    return box(CX - 180, 357 - h, CX + 180, 357 + h)

def g_plus():
    return U(g_minus(), box(CX - h, 357 - 180, CX + h, 357 + 180))

def g_colon():
    return U(dot(ADV_P / 2, 70), dot(ADV_P / 2, 430))

def g_slash():
    return clip(stroke([(L + 60, -60), (R - 60, H + 60)]))


glyphs = {
    'zero': ('0', g_zero, ADV), 'one': ('1', g_one, ADV), 'two': ('2', g_two, ADV), 'three': ('3', g_three, ADV),
    'four': ('4', g_four, ADV), 'five': ('5', g_five, ADV), 'six': ('6', g_six, ADV), 'seven': ('7', g_seven, ADV),
    'eight': ('8', g_eight, ADV), 'nine': ('9', g_nine, ADV), 'period': ('.', g_period, ADV_P),
    'comma': (',', g_comma, ADV_P), 'hyphen': ('-', g_hyphen, ADV), 'minus': ('\u2212', g_minus, ADV),
    'endash': ('\u2013', g_minus, ADV), 'plus': ('+', g_plus, ADV), 'colon': (':', g_colon, ADV_P),
    'slash': ('/', g_slash, ADV),
}


def to_glyph(geom):
    pen = TTGlyphPen(None)
    polys = [geom] if geom.geom_type == 'Polygon' else list(getattr(geom, 'geoms', []))
    for p in polys:
        if p.is_empty or p.geom_type != 'Polygon' or p.area < 400:  # drop slivers left by boolean ops
            continue
        p = orient(p.simplify(0.5), sign=-1.0)  # TrueType: outer clockwise, holes counter-clockwise
        for ring_ in [p.exterior, *[i for i in p.interiors if Polygon(i).area >= 400]]:
            pts = [(round(x), round(y)) for x, y in list(ring_.coords)[:-1]]
            dedup = [pt for i, pt in enumerate(pts) if pt != pts[i - 1]]
            if len(dedup) < 3:
                continue
            pen.moveTo(dedup[0])
            for pt in dedup[1:]:
                pen.lineTo(pt)
            pen.closePath()
    return pen.glyph()


order = ['.notdef', 'space'] + list(glyphs)
fb = FontBuilder(1000, isTTF=True)
fb.setupGlyphOrder(order)
fb.setupCharacterMap({32: 'space', **{ord(ch): name for name, (ch, _, _) in glyphs.items()}})
built = {'.notdef': to_glyph(box(60, 0, 440, H).difference(box(110, 50, 390, H - 50))), 'space': TTGlyphPen(None).glyph()}
metrics = {'.notdef': (500, 60), 'space': (ADV_P, 0)}
for name, (_, fn, adv) in glyphs.items():
    geom = fn()
    built[name] = to_glyph(geom)
    metrics[name] = (adv, int(round(geom.bounds[0])) if not geom.is_empty else 0)
fb.setupGlyf(built)
fb.setupHorizontalMetrics(metrics)
fb.setupHorizontalHeader(ascent=850, descent=-200)
fb.setupNameTable({'familyName': 'Rinkside Mono', 'styleName': 'Regular', 'uniqueFontIdentifier': 'RinksideMono-Regular',
                   'fullName': 'Rinkside Mono Regular', 'psName': 'RinksideMono-Regular', 'version': 'Version 1.000',
                   'copyright': 'Rinkside Mono: generated by fonts/build-font.py'})
fb.setupOS2(sTypoAscender=850, sTypoDescender=-200, usWinAscent=850, usWinDescent=200, sCapHeight=H, sxHeight=500,
            achVendID='RNKS', usWeightClass=400)
fb.setupPost()
fb.font['head'].fontRevision = 1.0
fb.font.flavor = 'woff2'
Path(o.out).parent.mkdir(parents=True, exist_ok=True)
fb.save(o.out)
print(f'wrote {o.out} (stroke {S}, chamfer {CC}, advance {ADV})')
