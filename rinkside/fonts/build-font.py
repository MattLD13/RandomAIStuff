#!/usr/bin/env python3
"""Builds Rinkside Mono, the board's numeral font, from straight-line geometry.

Sporty athletic numerals: 45-degree chamfered corners, spur terminals, no curves.
Proportions were measured from the reference screenshot (digit height = 700 units).

    pip install fonttools brotli shapely
    python3 fonts/build-font.py            # writes site/fonts/RinksideMono.woff2
    python3 fonts/build-font.py --stroke 84 --chamfer 104   # tune

The output covers 0-9 . , - + − – : / and space. Other characters fall back to the
next font in the CSS stack.
"""
import argparse
import math
from pathlib import Path

from fontTools.fontBuilder import FontBuilder
from fontTools.pens.ttGlyphPen import TTGlyphPen
from shapely import affinity
from shapely.geometry import Polygon, box
from shapely.geometry.polygon import orient
from shapely.ops import unary_union

ap = argparse.ArgumentParser()
ap.add_argument('--stroke', type=float, default=82)
ap.add_argument('--chamfer', type=float, default=112)
ap.add_argument('--advance', type=int, default=590)
ap.add_argument('--width', type=float, default=446)
ap.add_argument('--out', default=str(Path(__file__).resolve().parent.parent / 'site' / 'fonts' / 'RinksideMono.woff2'))
o = ap.parse_args()

S, C, ADV, H = o.stroke, o.chamfer, o.advance, 700
L = (ADV - o.width) / 2
R = L + o.width
CX = ADV / 2
CI = max(C - S * (math.sqrt(2) - 1), 8)  # inner chamfer keeps the stroke even round the corner


def octagon(x0, y0, x1, y1, c):
    c = min(c, (x1 - x0) / 2, (y1 - y0) / 2)
    return Polygon([(x0 + c, y0), (x1 - c, y0), (x1, y0 + c), (x1, y1 - c),
                    (x1 - c, y1), (x0 + c, y1), (x0, y1 - c), (x0, y0 + c)])


def ring(x0, y0, x1, y1, c=C, s=S):
    return octagon(x0, y0, x1, y1, c).difference(octagon(x0 + s, y0 + s, x1 - s, y1 - s, CI))


def band(top_l, top_r, bot_l, bot_r, y_top, y_bot):
    """A slanted stroke between two horizontal spans."""
    return Polygon([(top_l, y_top), (top_r, y_top), (bot_r, y_bot), (bot_l, y_bot)])


U = lambda *g: unary_union(g)
MID = 365  # waist of 3 and 8
SPUR_HI, SPUR_LO = 490, 236  # where the top / bottom spurs end

def g_zero():
    return U(ring(L, 0, R, H), box(CX - 50, H / 2 - 58, CX + 50, H / 2 + 58))

def g_one():
    sl, sr = CX - S * 0.53, CX + S * 0.53
    flag = Polygon([(sl, H), (sl - 172, H - 98), (sl - 172, H - 98 - 86), (sl, H - 86)])
    return U(box(sl, 0, sr, H), box(CX - 175, 0, CX + 175, S + 4), flag)

def g_two():
    top = ring(L, 300, R, H).difference(box(L - 1, 0, L + S + 1, SPUR_HI)).difference(box(L - 1, 0, R + 1, 430))
    diag = band(R - S * 1.3, R, L, L + S * 1.3, 470, S - 2)
    return U(top, diag, box(L, 0, R, S), box(R - S, 0, R, 190))

def g_three():
    up = ring(L + 12, MID - S / 2, R, H)
    lo = ring(L, 0, R, MID + S / 2)
    return U(up, lo).difference(box(L - 1, SPUR_LO, L + 120, SPUR_HI + 10))

def g_four():
    stem_l, stem_r = L + 285, L + 285 + S
    diag = band(stem_l - 95, stem_r - 10, L, L + S * 1.3, H, 285)
    return U(box(stem_l, 0, stem_r, H), diag, box(L, 200, R, 285), box(stem_l - 45, 0, stem_r + 45, S - 4))

def g_five():
    ymid = 440
    lo = ring(L, 0, R, ymid).difference(box(L - 1, SPUR_LO, L + S + 1, ymid - S))
    return U(box(L, H - S, R, H), box(R - S, 505, R, H), box(L, ymid - S, L + S, H), lo)

def g_six():
    return affinity.rotate(g_nine(), 180, origin=(CX, H / 2))

def g_seven():
    bar = box(L, H - S + 4, R, H)
    spur = box(L, 520, L + S - 6, H)
    diag = band(R - S * 1.1, R, L + 150, L + 150 + S * 1.1, H - S + 4, S)
    foot = box(L + 80, 0, L + 295, S + 4)
    return U(bar, spur, diag, foot)

def g_eight():
    return U(ring(L + 14, MID - S / 2, R - 14, H), ring(L, 0, R, MID + S / 2))

def g_nine():
    yb = 290
    full = ring(L, 0, R, H).difference(box(L - 1, SPUR_LO, L + S + 1, H))
    return U(full, ring(L, yb, R, H))

def g_period():
    return box(ADV_P / 2 - 52, 0, ADV_P / 2 + 52, 104)

def g_comma():
    return U(box(ADV_P / 2 - 52, 0, ADV_P / 2 + 52, 104), Polygon([(ADV_P / 2 - 52, 0), (ADV_P / 2 + 52, 0), (ADV_P / 2 - 10, -110), (ADV_P / 2 - 70, -110)]))

def g_hyphen():
    return box(CX - 146, 357 - S / 2 + 4, CX + 146, 357 + S / 2 - 4)

def g_minus():
    return box(CX - 175, 357 - S / 2 + 4, CX + 175, 357 + S / 2 - 4)

def g_plus():
    return U(g_minus(), box(CX - S / 2 + 4, 357 - 175, CX + S / 2 - 4, 357 + 175))

def g_colon():
    return U(box(ADV_P / 2 - 52, 80, ADV_P / 2 + 52, 184), box(ADV_P / 2 - 52, 430, ADV_P / 2 + 52, 534))

def g_slash():
    return band(R - S * 1.2 - 40, R - 40, L + 40, L + 40 + S * 1.2, H, 0)

ADV_P = 300
glyphs = {
    'zero': ('0', g_zero, ADV), 'one': ('1', g_one, ADV), 'two': ('2', g_two, ADV), 'three': ('3', g_three, ADV),
    'four': ('4', g_four, ADV), 'five': ('5', g_five, ADV), 'six': ('6', g_six, ADV), 'seven': ('7', g_seven, ADV),
    'eight': ('8', g_eight, ADV), 'nine': ('9', g_nine, ADV), 'period': ('.', g_period, ADV_P),
    'comma': (',', g_comma, ADV_P), 'hyphen': ('-', g_hyphen, ADV), 'minus': ('−', g_minus, ADV),
    'endash': ('–', g_minus, ADV), 'plus': ('+', g_plus, ADV), 'colon': (':', g_colon, ADV_P),
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
print(f'wrote {o.out} (stroke {S}, chamfer {C}, advance {ADV})')
