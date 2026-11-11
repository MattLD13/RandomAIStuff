# Usage: python3 scripts/read_chance_report.py <image>   (needs tesseract-ocr and Pillow)
# Read a Clear Sight Analytics "Scoring Chances Report" graphic. The layout is fixed, so each number is read from
# its own cell (positions as fractions of the image), enlarged and thresholded, digits only.
import re, subprocess, sys, json, tempfile, os
from PIL import Image, ImageOps
def ocr(img, cfg):
    with tempfile.NamedTemporaryFile(suffix='.png', delete=False) as f: img.save(f.name)
    out = subprocess.run(['tesseract', f.name, '-', *cfg.split()], capture_output=True, text=True).stdout
    os.unlink(f.name); return out.strip()
def cell(im, box, digits=True, scale=3, cut=110):
    W, H = im.size; x0, y0, x1, y1 = box
    c = im.crop((int(x0 * W), int(y0 * H), int(x1 * W), int(y1 * H))).convert('L')
    c = c.resize((c.width * scale, c.height * scale), Image.LANCZOS)
    c = c.point(lambda v: 0 if v < cut else 255)            # dark navy text on pastel cells
    c = ImageOps.expand(c, 20, fill=255)
    cfg = '--psm 7 -c tessedit_char_whitelist=0123456789.' if digits else '--psm 6'
    return ocr(c, cfg)
def tries(im, box, parse, digits=True):
    for cut in (110, 140, 90, 170):                          # retry at other contrast levels until something parses
        for scale in (3, 2, 4):
            v = parse(cell(im, box, digits, scale, cut))
            if v is not None: return v
    return None
def num(s, kind=int):
    m = re.findall(r'\d+(?:\.\d+)?', s); return kind(m[0]) if m else None
# column spans (fraction of width) and row spans (fraction of height) of the table
L, R_ = (0.03, 0.375), (0.625, 0.97)
ROWS = {'chances': (0.450, 0.500), 'hi': (0.510, 0.548), 'mid': (0.574, 0.612), 'low': (0.638, 0.676), 'xg': (0.705, 0.762), 'goals': (0.770, 0.825)}
SUB = {'hi': (0.549, 0.571), 'mid': (0.613, 0.634), 'low': (0.677, 0.698)}   # "xG 2.27 | Goals 1" lines
def read(path):
    im = Image.open(path).convert('RGB'); out = {'NYR?': None}
    hc = im.crop((int(im.width * 0.18), int(im.height * 0.07), int(im.width * 0.82), int(im.height * 0.19))).convert('L')
    hc = hc.resize((hc.width * 2, hc.height * 2), Image.LANCZOS).point(lambda v: 0 if v < 120 else 255)
    head = ocr(ImageOps.expand(hc, 20, fill=255), '--psm 6')
    res = {'header': head}
    MONTHS = 'JANUARY FEBRUARY MARCH APRIL MAY JUNE JULY AUGUST SEPTEMBER OCTOBER NOVEMBER DECEMBER'.split()
    m = re.search(r'(' + '|'.join(MONTHS) + r')\s+(\d{1,2}),?\s+(\d{4})', head.upper())
    res['date'] = f"{m.group(3)}-{MONTHS.index(m.group(1)) + 1:02d}-{int(m.group(2)):02d}" if m else None
    m = re.search(r'([A-Z. ]{4,}?)\s*@\s*([A-Z. ]{4,})', head.upper())
    res['away_name'], res['home_name'] = (m.group(1).strip(), m.group(2).strip()) if m else (None, None)
    for side, (a, b) in (('left', L), ('right', R_)):
        r = {}
        for k, (y0, y1) in ROWS.items(): r[k] = tries(im, (a, y0, b, y1), lambda t, k=k: num(t, float if k == 'xg' else int))
        for k, (y0, y1) in SUB.items():
            def p(t):
                m = re.search(r'xG\s*([\d.]+).*?Goals?\s*(\d+)', t.replace('|', ' '))
                return (float(m.group(1)), int(m.group(2))) if m else None
            r[k + 'Xg'], r[k + 'Goals'] = tries(im, (a, y0, b, y1), p, digits=False) or (None, None)
        # the parts add up: fill one missing danger count from the total, then check
        parts = [r['hi'], r['mid'], r['low']]
        if r['chances'] is not None and parts.count(None) == 1:
            i = parts.index(None); parts[i] = r['chances'] - sum(x for x in parts if x is not None); r[['hi', 'mid', 'low'][i]] = parts[i]; r['filled'] = ['hi', 'mid', 'low'][i]
        r['consistent'] = None not in parts and r['chances'] == sum(parts)
        res[side] = r
    foot = cell(im, (0.0, 0.90, 1.0, 0.985), digits=False)
    res['footer'] = foot
    nums = [int(x) for x in re.findall(r'\b\d+\b', foot.replace('Q', '0').replace('O', '0'))]
    if len(nums) >= 6: res['left'].update(en=nums[0], dumps=nums[2], noShots=nums[4]); res['right'].update(en=nums[1], dumps=nums[3], noShots=nums[5])
    return res
if __name__ == '__main__':
    print(json.dumps(read(sys.argv[1]), indent=1))
