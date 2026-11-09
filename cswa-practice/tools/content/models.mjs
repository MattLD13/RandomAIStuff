// Parametric models for the practice exams. Each model returns the solid (or the placed
// components of an assembly) plus the dimensioned views that become the question images.
// Axes follow SOLIDWORKS: Y up, Front plane = XY, Top plane = XZ.
import {
  box, cyl, prism, arc, rectPts, circlePts, revolveY, union, subtract,
  rotAxis, place, I3,
} from '../lib/geom.mjs';

// ---- annotation shorthands -------------------------------------------------------------
const dim = (a, b, off, text, o = {}) => ({ t: 'dim', a, b, off, text, ...o });
const lead = (at, dx, dy, text, o = {}) => ({ t: 'leader', at, dx, dy, text, ...o });
const ang = (c, u, v, r, text, o = {}) => ({ t: 'angle', c, u, v, r, text, ...o });
const triad = (at, len, label, o = {}) => ({ t: 'triad', at, len, label, ...o });
const cline = (a, b) => ({ t: 'line', a, b, dash: '14 4 3 4', w: 0.9 });

export const ISO = { dir: [1, 0.8, 1.15] };
export const ISO_L = { dir: [-1, 0.8, 1.15] };
export const ISO_BELOW = { dir: [1, -0.85, 1.15] };
export const FRONT = { dir: [0, 0, 1] };
export const TOP = { dir: [0, 1, 0], up: [0, 0, -1] };
export const RIGHT = { dir: [1, 0, 0] };

const v = (view, title, ann) => ({ ...view, title, ann });
const fmt = (n) => (Number.isInteger(n) ? String(n) : n.toFixed(1));
// point on the rim of a hole, handy for leader arrows
const rimY = (x, y, z, r) => [x + r * 0.7, y, z + r * 0.7];
const rimZ = (x, y, z, r) => [x + r * 0.7, y + r * 0.7, z];
const rimX = (x, y, z, r) => [x, y + r * 0.7, z + r * 0.7];

// ======================================================================================
// EXAM 1
// ======================================================================================

// Basic part: L-block with a cross hole and two base holes.
export function lBlock({ A, B }) {
  const body = subtract(
    union(box(0, 0, 0, A, 20, 50), box(0, 20, 0, 20, B, 50)),
    cyl('YZ', 25, B - 18, 8, -1, 21),
    cyl('XZ', A - 20, 15, 6, -1, 21),
    cyl('XZ', A - 20, 35, 6, -1, 21),
  );
  const views = [
    v(ISO, 'Isometric', [
      dim([0, 0, 50], [A, 0, 50], [0, 0, 26], 'A', { bold: true }),
      dim([A, 0, 50], [A, 0, 0], [26, 0, 0], '50'),
      dim([0, 0, 50], [0, B, 50], [-24, 0, 0], 'B', { bold: true }),
      lead(rimX(20, B - 18, 25, 8), 70, -70, 'Ø16 THRU'),
      lead(rimY(A - 20, 20, 35, 6), 70, -60, '2X Ø12 THRU'),
    ]),
    v(FRONT, 'Front', [
      dim([A, 0, 50], [A, 20, 50], [18, 0, 0], '20'),
      dim([0, B, 50], [20, B, 50], [0, 16, 0], '20'),
      dim([0, 0, 50], [A, 0, 50], [0, -18, 0], 'A', { bold: true }),
    ]),
    v(TOP, 'Top', [
      dim([A - 20, 20, 50], [A, 20, 50], [0, 0, 18], '20'),
      dim([A, 20, 0], [A, 20, 15], [20, 0, 0], '15'),
      dim([A, 20, 15], [A, 20, 35], [20, 0, 0], '20'),
      cline([A - 30, 20, 15], [A - 10, 20, 15]), cline([A - 30, 20, 35], [A - 10, 20, 35]),
    ]),
    v(RIGHT, 'Right', [
      dim([A, B, 50], [A, B - 18, 50], [0, 0, 18], '18'),
      dim([A, B, 0], [A, B, 25], [0, 16, 0], '25'),
      cline([A, B - 18, 10], [A, B - 18, 40]),
    ]),
  ];
  return { body, views };
}

// Intermediate part: base plate with an arched wall, rib, two holes and a front notch.
export function archBracket({ A, B, C }) {
  const m = A / 2;
  const wall = [[m - 30, 12], [m + 30, 12], ...arc(m, 52, 30, 0, 180)];
  const body = subtract(
    union(
      box(0, 0, 0, A, 12, C),
      prism('XY', wall, 0, 14),
      prism('YZ', [[14, 12], [44, 12], [14, 37]], m - 6, m + 6),
    ),
    cyl('XY', m, 52, B / 2, -1, 15),
    cyl('XZ', 15, C - 15, 5, -1, 13),
    cyl('XZ', A - 15, C - 15, 5, -1, 13),
    box(m - 15, -1, C - 15, m + 15, 13, C + 1),
  );
  const views = [
    v(ISO, 'Isometric', [
      dim([0, 0, C], [A, 0, C], [0, 0, 24], 'A', { bold: true }),
      dim([A, 0, C], [A, 0, 0], [24, 0, 0], 'C', { bold: true }),
      lead(rimZ(m, 52, 14, B / 2), 90, -40, 'ØB THRU', { bold: true }),
      lead(rimY(A - 15, 12, C - 15, 5), 60, -50, '2X Ø10 THRU'),
      lead([m - 30 * Math.cos(1), 52 + 30 * Math.sin(1), 14], -70, -40, 'R30'),
    ]),
    v(FRONT, 'Front', [
      dim([m - 30, 12, C], [m + 30, 12, C], [0, -30, 0], '60'),
      dim([0, 0, C], [0, 12, C], [-16, 0, 0], '12'),
      dim([A, 0, C], [A, 52, C], [20, 0, 0], '52'),
      cline([m - 40, 52, C], [m + 40, 52, C]), cline([m, 12, C], [m, 92, C]),
    ]),
    v(TOP, 'Top', [
      dim([0, 12, C], [15, 12, C], [0, 0, 16], '15'),
      dim([A, 12, C - 15], [A, 12, C], [18, 0, 0], '15'),
      dim([m - 15, 12, C], [m + 15, 12, C], [0, 0, 16], '30'),
      dim([0, 12, 0], [0, 12, 14], [-16, 0, 0], '14'),
      dim([m - 6, 12, 44], [m + 6, 12, 44], [0, 0, 8], '12'),
      cline([5, 12, C - 15], [25, 12, C - 15]), cline([A - 25, 12, C - 15], [A - 5, 12, C - 15]),
    ]),
    v(RIGHT, 'Right (rib)', [
      dim([A, 12, 14], [A, 12, 44], [0, -20, 0], '30'),
      dim([A, 12, 14], [A, 37, 14], [0, 0, -20], '25'),
    ]),
  ];
  return { body, views };
}

// Advanced part: flanged hub with keyway, counterbore and bolt circle; optional flat.
export function flangedHub({ A, B, D = null }) {
  const H = 15 + B;
  const holes = [];
  for (let k = 0; k < 6; k++) {
    const a = ((30 + 60 * k) * Math.PI) / 180;
    holes.push(cyl('XZ', 47.5 * Math.cos(a), 47.5 * Math.sin(a), 5, -1, 16));
  }
  const cuts = [
    cyl('XZ', 0, 0, 20, -1, H + 1),
    box(0, -1, -6, 26, H + 1, 6),
    cyl('XZ', 0, 0, 25, H - 8, H + 1),
    ...holes,
  ];
  if (D) cuts.push(box(-A, -1, -A, -D, 16, A));
  const body = subtract(union(cyl('XZ', 0, 0, A / 2, 0, 15), cyl('XZ', 0, 0, 35, 15, H)), cuts);
  const iso = [
    dim([-A / 2, 0, 0], [A / 2, 0, 0], [0, -8, A / 2 + 18], 'ØA', { bold: true }),
    dim([35, 15, 0], [35, H, 0], [A / 2 - 35 + 20, 0, 0], 'B', { bold: true }),
    dim([A / 2, 0, 0], [A / 2, 15, 0], [18, 0, 0], '15'),
    lead([0, H, 35], -80, -50, 'Ø70'),
    lead([-25 * 0.7, H, 25 * 0.7], -110, -110, 'C\'BORE Ø50 ↧ 8'),
    lead([-20 * 0.7, H - 8, 20 * 0.7], -150, -40, 'Ø40 THRU'),
    triad([0, 0, 0], 22, 'Origin: centre of bottom face', { dx: 40, dy: 80 }),
  ];
  const top = [
    dim([0, H, -6], [0, H, 6], [32, 0, 0], '12'),
    dim([0, H, 0], [26, H, 0], [0, 0, -45], '26'),
    ang([0, 15, 0], [1, 0, 0], [Math.cos(Math.PI / 6), 0, Math.sin(Math.PI / 6)], 62, '30°'),
    lead([47.5 * Math.cos(Math.PI / 6) + 3.5, 15, 47.5 * Math.sin(Math.PI / 6) + 3.5], 90, 60, '6X Ø10 THRU\nEQ. SP. ON Ø95 B.C.'),
    { t: 'line', a: [0, 15, 0], b: [47.5 * Math.cos(Math.PI / 6), 15, 47.5 * Math.sin(Math.PI / 6)], dash: '14 4 3 4', w: 0.9 },
  ];
  if (D) top.push(dim([0, 15, A / 2 - 5], [-D, 15, A / 2 - 5], [0, 0, 25], 'D', { bold: true }));
  const views = [v(ISO, 'Isometric', iso), v(TOP, 'Top', top)];
  return { body, views };
}

// Assembly: base with clevis ears, arm at angle A, two pins.
export function hingeBase() {
  const ear = [[10, 10], [40, 10], ...arc(25, 40, 15, 0, 180)];
  const body = subtract(
    union(box(0, 0, 0, 120, 10, 60), prism('XY', ear, 10, 18), prism('XY', ear, 42, 50)),
    cyl('XY', 25, 40, 5, 9, 51),
  );
  const views = [
    v(ISO, 'Base – isometric', [
      dim([0, 0, 60], [120, 0, 60], [0, 0, 24], '120'),
      dim([120, 0, 60], [120, 0, 0], [24, 0, 0], '60'),
      dim([120, 0, 0], [120, 10, 0], [0, 0, -18], '10'),
      lead(rimZ(25, 40, 50, 5), -70, -60, 'Ø10 THRU'),
      lead([25 + 15 * Math.cos(0.8), 40 + 15 * Math.sin(0.8), 50], 80, -70, 'R15 (2X)'),
    ]),
    v(FRONT, 'Base – front', [
      dim([0, 10, 60], [10, 10, 60], [0, 14, 0], '10'),
      dim([10, 10, 60], [40, 10, 60], [0, -26, 0], '30'),
      dim([120, 10, 60], [120, 40, 60], [-62, 0, 0], '30'),
      cline([5, 40, 60], [45, 40, 60]), cline([25, 15, 60], [25, 60, 60]),
    ]),
    v(TOP, 'Base – top', [
      dim([45, 55, 10], [45, 55, 18], [30, 0, 0], '8'),
      dim([45, 55, 18], [45, 55, 42], [30, 0, 0], '24'),
      dim([45, 55, 42], [45, 55, 50], [30, 0, 0], '8'),
      dim([0, 55, 0], [0, 55, 10], [-14, 0, 0], '10'),
    ]),
  ];
  return { body, views };
}

export function hingeArm() {
  const pts = [...arc(0, 0, 15, 90, 270), ...arc(120, 0, 15, -90, 90)];
  const body = subtract(prism('XY', pts, 0, 24), cyl('XY', 0, 0, 5, -1, 25), cyl('XY', 120, 0, 5, -1, 25));
  const views = [
    v(FRONT, 'Arm – front', [
      dim([0, 0, 24], [120, 0, 24], [0, -32, 0], '120'),
      lead([-15 * 0.7, 15 * 0.7, 24], -50, -50, 'R15 (2X)'),
      lead([120 + 5 * 0.7, 5 * 0.7, 24], 50, -70, '2X Ø10 THRU'),
      cline([-20, 0, 24], [140, 0, 24]),
    ]),
    v(ISO, 'Arm – isometric', [dim([135, 0, 0], [135, 0, 24], [18, 0, 0], '24')]),
  ];
  return { body, views };
}

export function plainPin({ L = 50, d = 10 }) {
  const body = cyl('XY', 0, 0, d / 2, 0, L);
  const views = [v({ dir: [1, 0.6, 0.6] }, 'Pin', [
    dim([0, -d / 2, 0], [0, -d / 2, L], [0, -16, 0], String(L)),
    lead([d / 2 * 0.7, d / 2 * 0.7, L], 60, -50, `Ø${d}`),
  ])];
  return { body, views };
}

export function hingeAssembly({ A, cs = null }) {
  const a = (A * Math.PI) / 180;
  const R = rotAxis('z', A);
  const comps = [
    { name: 'Base', model: 'hingeBase', T: { R: I3, t: [0, 0, 0] }, color: '#9aa3ad' },
    { name: 'Arm', model: 'hingeArm', T: place(R, [0, 0, 0], [25, 40, 18]), color: '#c9b37e' },
    { name: 'Pin', model: 'plainPin', params: { L: 50, d: 10 }, T: { R: I3, t: [25, 40, 5] }, color: '#5f7d9c' },
    { name: 'Pin', model: 'plainPin', params: { L: 50, d: 10 }, T: { R: I3, t: [25 + 120 * Math.cos(a), 40 + 120 * Math.sin(a), 5] }, color: '#5f7d9c' },
  ];
  const ann = [
    ang([25, 40, 42], [1, 0, 0], [Math.cos(a), Math.sin(a), 0], 70, 'A', { bold: true }),
    triad([0, 0, 60], 30, 'Assembly origin', { dx: -120, dy: 30 }),
  ];
  if (cs) ann.push(triad(cs, 30, 'Coordinate System1', { dx: 10, dy: 28 }));
  return { components: comps, views: [v(ISO, 'Assembly', ann)], origin: [0, 0, 60] };
}

// ======================================================================================
// EXAM 2
// ======================================================================================

// Basic part: guide block with a top channel, two chamfers and two holes.
export function guideBlock({ A, B }) {
  const prof = [[0, 0], [60, 0], [60, B - 10], [50, B], [42, B], [42, B - 12], [18, B - 12], [18, B], [10, B], [0, B - 10]];
  const body = subtract(prism('YZ', prof, 0, A), cyl('XZ', 15, 30, 5, -1, B + 1), cyl('XZ', A - 15, 30, 5, -1, B + 1));
  const views = [
    v(ISO, 'Isometric', [
      dim([0, 0, 60], [A, 0, 60], [0, 0, 24], 'A', { bold: true }),
      dim([A, 0, 60], [A, 0, 0], [24, 0, 0], '60'),
      dim([0, 0, 60], [0, B - 10, 60], [-22, 0, 0], '', {}),
      dim([0, 0, 60], [0, B, 60], [-22, 0, 0], 'B', { bold: true }),
      lead(rimY(A - 15, B - 12, 30, 5), 80, -90, '2X Ø10 THRU'),
    ].filter((d) => d.text !== '')),
    v(RIGHT, 'Right', [
      dim([A, B, 60], [A, B, 50], [0, 18, 0], '10'),
      dim([A, B - 10, 60], [A, B, 60], [0, 0, 16], '10'),
      dim([A, B, 42], [A, B, 18], [0, 40, 0], '24'),
      dim([A, B, 18], [A, B - 12, 18], [0, 0, 34], '12'),
      dim([A, B, 0], [A, B, 10], [0, 18, 0], '10'),
      dim([A, B - 10, 0], [A, B, 0], [0, 0, -16], '10'),
    ]),
    v(TOP, 'Top', [
      dim([0, B - 12, 30], [15, B - 12, 30], [0, 0, 44], '15'),
      dim([A - 15, B - 12, 30], [A, B - 12, 30], [0, 0, 44], '15'),
      dim([A, B, 0], [A, B, 30], [20, 0, 0], '30'),
      cline([5, B - 12, 30], [A - 5, B - 12, 30]),
    ]),
  ];
  return { body, views };
}

// Intermediate part: shaft support with tapered web, boss and two slots.
export function shaftSupport({ A, B, C }) {
  const m = A / 2;
  const slot = (x0) => [...arc(x0, 25, 5, 90, 270), ...arc(x0 + 10, 25, 5, -90, 90)];
  const body = subtract(
    union(
      box(0, 0, 0, A, 12, 50),
      prism('XY', [[m - 25, 12], [m + 25, 12], [m + 12, B - 10], [m - 12, B - 10]], 20, 30),
      cyl('XY', m, B, 20, 10, 40),
    ),
    cyl('XY', m, B, C / 2, 9, 41),
    prism('XZ', slot(15), -1, 13),
    prism('XZ', slot(A - 25), -1, 13),
  );
  const views = [
    v(ISO, 'Isometric', [
      dim([0, 0, 50], [A, 0, 50], [0, 0, 24], 'A', { bold: true }),
      dim([A, 0, 50], [A, 0, 0], [24, 0, 0], '50'),
      lead(rimZ(m, B, 40, C / 2), 90, -50, 'ØC THRU', { bold: true }),
      lead([m - 20 * 0.7, B + 20 * 0.7, 40], -90, -40, 'Ø40'),
      lead([A - 15 + 5 * 0.7, 12, 25 + 5 * 0.7], 70, -40, '2X SLOT 10 WIDE'),
    ]),
    v(FRONT, 'Front', [
      dim([0, 0, 50], [0, B, 50], [-20, 0, 0], 'B', { bold: true }),
      dim([A, 0, 50], [A, 12, 50], [18, 0, 0], '12'),
      dim([m - 25, 12, 50], [m + 25, 12, 50], [0, -30, 0], '50'),
      dim([m - 12, B - 10, 50], [m + 12, B - 10, 50], [0, 0, 0], '', {}),
      lead([m + 12, B - 10, 30], 80, 20, 'WEB TOP: 24 WIDE\nAT B − 10'),
      cline([m - 30, B, 50], [m + 30, B, 50]), cline([m, 20, 50], [m, B + 30, 50]),
    ].filter((d) => d.text !== '')),
    v(TOP, 'Top', [
      dim([0, B + 20, 10], [0, B + 20, 40], [-0, 0, 0], '', {}),
      dim([A, 12, 10], [A, 12, 40], [16, 0, 0], '30'),
      dim([m - 5, B + 20, 20], [m - 5, B + 20, 30], [-70, 0, 0], '10'),
      dim([0, 12, 25], [10, 12, 25], [0, 0, -36], '10'),
      dim([10, 12, 25], [30, 12, 25], [0, 0, -36], '20'),
      dim([0, 12, 0], [0, 12, 25], [-16, 0, 0], '25'),
      cline([5, 12, 25], [25, 12, 25]), cline([A - 25, 12, 25], [A - 5, 12, 25]),
    ].filter((d) => d.text !== '')),
  ];
  return { body, views };
}

// Advanced part: open-bottom housing with end tabs and an off-centre boss.
export function housing({ A, B, window = false }) {
  const cuts = [
    box(6, -1, 6, A - 6, B - 6, 74),
    cyl('XZ', 40, 40, 10, B - 7, B + 16),
    cyl('XZ', -10, 15, 4, -1, 9), cyl('XZ', -10, 65, 4, -1, 9),
    cyl('XZ', A + 10, 15, 4, -1, 9), cyl('XZ', A + 10, 65, 4, -1, 9),
  ];
  if (window) cuts.push(box(A - 60, 15, 73, A - 20, 35, 81));
  const body = subtract(
    union(box(0, 0, 0, A, B, 80), box(-20, 0, 0, 0, 8, 80), box(A, 0, 0, A + 20, 8, 80), cyl('XZ', 40, 40, 20, B, B + 15)),
    cuts,
  );
  const iso = [
    dim([0, 0, 80], [A, 0, 80], [0, 0, 26], 'A', { bold: true }),
    dim([A + 20, 0, 80], [A + 20, 0, 0], [22, 0, 0], '80'),
    dim([0, 8, 80], [0, B, 80], [-34, 0, 0], 'B', { bold: true, textOff: 16 }),
    dim([-20, 0, 80], [0, 0, 80], [0, 0, 26], '20'),
    lead([40 + 20 * 0.7, B + 15, 40 + 20 * 0.7], 80, -50, 'Ø40 BOSS, 15 HIGH'),
    lead([40 - 10 * 0.7, B + 15, 40 + 10 * 0.7], -90, -60, 'Ø20 THRU INTO CAVITY'),
    lead([A + 10 + 4 * 0.7, 8, 65 + 4 * 0.7], 60, -30, '4X Ø8 THRU'),
    triad([0, 0, 80], 26, 'Origin', { dx: -70, dy: 30 }),
  ];
  if (window) {
    iso.push(dim([A - 60, 15, 80], [A - 20, 15, 80], [0, -24, 0], '40'));
    iso.push(dim([A, 15, 80], [A, 35, 80], [16, 0, 0], '20'));
    iso.push(dim([A - 20, 35, 80], [A, 35, 80], [0, 24, 0], '20'));
    iso.push(dim([A, 0, 80], [A, 15, 80], [16, 0, 0], '15'));
  }
  const views = [
    v(ISO, 'Isometric', iso),
    v(ISO_BELOW, 'From below', [
      lead([A / 2, 0, 6], 60, -150, 'SHELL: WALLS AND TOP 6 THICK\nBOTTOM OPEN'),
      dim([A + 20, 0, 80], [A + 20, 8, 80], [0, 0, 18], '8'),
    ]),
    v(TOP, 'Top', [
      dim([0, B + 15, 40], [40, B + 15, 40], [0, 0, 60], '40'),
      dim([0, B, 0], [0, B, 40], [-36, 0, 0], '40'),
      dim([-20, 8, 0], [-20, 8, 15], [-16, 0, 0], '15'),
      dim([-20, 8, 0], [-10, 8, 0], [0, 0, -16], '10'),
      dim([-20, 8, 65], [-20, 8, 80], [-16, 0, 0], '15'),
    ]),
  ];
  return { body, views, origin: [0, 0, 80] };
}

// Assembly: U-rail, slider, post and two end caps.
export function rail() {
  const prof = [[0, 0], [50, 0], [50, 25], [40, 25], [40, 8], [10, 8], [10, 25], [0, 25]];
  const body = prism('YZ', prof, 0, 200);
  return {
    body,
    views: [
      v(ISO, 'Rail – isometric', [
        dim([0, 0, 50], [200, 0, 50], [0, 0, 24], '200'),
        dim([200, 0, 50], [200, 25, 50], [20, 0, 0], '25'),
      ]),
      v(RIGHT, 'Rail – end', [
        dim([200, 0, 0], [200, 0, 50], [0, -18, 0], '50'),
        dim([200, 25, 0], [200, 25, 10], [0, 16, 0], '10'),
        dim([200, 25, 10], [200, 25, 40], [0, 34, 0], '30'),
        dim([200, 25, 40], [200, 25, 50], [0, 16, 0], '10'),
        dim([200, 0, 25], [200, 8, 25], [0, 0, 0], '8', { textOff: 12 }),
      ]),
    ],
  };
}

export function slider() {
  const body = subtract(box(0, 0, 0, 40, 22, 30), cyl('XZ', 20, 15, 6, -1, 23));
  return {
    body,
    views: [v(ISO, 'Slider', [
      dim([0, 0, 30], [40, 0, 30], [0, 0, 18], '40'),
      dim([40, 0, 30], [40, 0, 0], [18, 0, 0], '30'),
      dim([0, 0, 30], [0, 22, 30], [-16, 0, 0], '22'),
      lead(rimY(20, 22, 15, 6), 60, -50, 'Ø12 THRU, CENTERED'),
    ])],
  };
}

export function post() {
  const body = union(cyl('XZ', 0, 0, 6, 0, 80), cyl('XZ', 0, 0, 15, 80, 86));
  return {
    body,
    views: [v({ dir: [1, 0.35, 1.1] }, 'Post', [
      dim([15, 0, 0], [15, 80, 0], [16, 0, 0], '80'),
      dim([15, 80, 0], [15, 86, 0], [16, 0, 0], '6'),
      lead([6 * 0.7, 30, 6 * 0.7], -60, 0, 'Ø12'),
      lead([-15 * 0.7, 86, 15 * 0.7], -70, -30, 'Ø30'),
    ])],
  };
}

export function endCap() {
  const body = box(0, 0, 0, 6, 25, 50);
  return { body, views: [v(ISO, 'End cap', [
    dim([0, 0, 50], [6, 0, 50], [0, 0, 16], '6'),
    dim([6, 0, 50], [6, 0, 0], [16, 0, 0], '50'),
    dim([0, 0, 50], [0, 25, 50], [-14, 0, 0], '25'),
  ])] };
}

export function slideAssembly({ A, cs = null }) {
  const comps = [
    { name: 'Rail', model: 'rail', T: { R: I3, t: [0, 0, 0] }, color: '#9aa3ad' },
    { name: 'End Cap', model: 'endCap', T: { R: I3, t: [-6, 0, 0] }, color: '#3d4a5a' },
    { name: 'End Cap', model: 'endCap', T: { R: I3, t: [200, 0, 0] }, color: '#3d4a5a' },
    { name: 'Slider', model: 'slider', T: { R: I3, t: [A, 8, 10] }, color: '#c9b37e' },
    { name: 'Post', model: 'post', T: { R: I3, t: [A + 20, 8, 25] }, color: '#5f7d9c' },
  ];
  const ann = [
    dim([0, 25, 50], [A, 25, 50], [0, 0, 30], 'A', { bold: true }),
    triad([0, 0, 50], 30, 'Assembly origin', { dx: -120, dy: 30 }),
  ];
  if (cs) ann.push(triad(cs, 30, 'Coordinate System1', { dx: 10, dy: -26 }));
  return { components: comps, views: [v(ISO, 'Assembly', ann)], origin: [0, 0, 50] };
}

// ======================================================================================
// EXAM 3
// ======================================================================================

// Basic part: angle support with a tapered upright.
export function angleSupport({ A, B }) {
  const prof = [[0, 0], [A, 0], [A, 15], [30, 15], [18, B], [0, B]];
  const body = subtract(prism('XY', prof, 0, 40), cyl('XZ', A - 20, 20, 5, -1, 16), cyl('YZ', 20, B - 15, 5, -1, 31));
  const views = [
    v(ISO, 'Isometric', [
      dim([0, 0, 40], [A, 0, 40], [0, 0, 22], 'A', { bold: true }),
      dim([A, 0, 40], [A, 0, 0], [22, 0, 0], '40'),
      dim([0, 0, 40], [0, B, 40], [-22, 0, 0], 'B', { bold: true }),
      lead(rimY(A - 20, 15, 20, 5), 70, -60, 'Ø10 THRU'),
      lead([24, B - 15 + 5 * 0.7, 20 + 5 * 0.7], 80, -70, 'Ø10 THRU'),
    ]),
    v(FRONT, 'Front', [
      dim([A, 0, 40], [A, 15, 40], [16, 0, 0], '15'),
      dim([0, 15, 40], [30, 15, 40], [0, -36, 0], '30'),
      dim([0, B, 40], [18, B, 40], [0, 16, 0], '18'),
      dim([0, B, 40], [0, B - 15, 40], [-18, 0, 0], '15'),
      cline([-6, B - 15, 40], [30, B - 15, 40]),
    ]),
    v(TOP, 'Top', [
      dim([A - 20, 15, 40], [A, 15, 40], [0, 0, 18], '20'),
      dim([A, 15, 0], [A, 15, 20], [18, 0, 0], '20'),
      cline([A - 30, 15, 20], [A - 10, 15, 20]),
    ]),
  ];
  return { body, views };
}

// Intermediate part: revolved stepped spindle with bore, cross hole and D-flat.
export function steppedSpindle({ A, B }) {
  const top = 50 + A;
  const body = subtract(
    revolveY([[8, 0], [B / 2, 0], [B / 2, 20], [20, 20], [20, 50], [15, 50], [15, top], [8, top]]),
    cyl('YZ', 0, 35, 4, -25, 25),
    box(10, top - 20, -20, 20, top + 1, 20),
  );
  const F = { dir: [0, 0, 1] };
  const views = [
    v({ dir: [1, 0.55, 1.15] }, 'Isometric', [
      lead([10, top - 8, 9], 80, -30, 'FLAT'),
      lead([20 * 0.7, 35 + 4, 20 * 0.7], -110, 10, 'Ø8 THRU (CROSS HOLE)'),
    ]),
    v(F, 'Front', [
      dim([-B / 2, 0, 0], [B / 2, 0, 0], [0, -20, 0], 'ØB', { bold: true }),
      dim([-20, 50, 0], [20, 50, 0], [0, 0, 0], '', {}),
      lead([-20, 42, 0], -60, 0, 'Ø40'),
      lead([-15, top - 30, 0], -60, 0, 'Ø30'),
      dim([B / 2, 0, 0], [B / 2, 20, 0], [24, 0, 0], '20'),
      dim([20, 20, 0], [20, 50, 0], [B / 2 - 20 + 24, 0, 0], '30'),
      dim([15, 50, 0], [15, top, 0], [B / 2 - 15 + 24, 0, 0], 'A', { bold: true }),
      dim([-20, 20, 0], [-20, 35, 0], [-30, 0, 0], '15'),
      dim([10, top - 20, 0], [10, top, 0], [-62, 0, 0], '20'),
      lead([-8, top, 0], -50, -30, 'Ø16 THRU'),
      cline([0, -8, 0], [0, top + 10, 0]),
    ].filter((d) => d.text !== '')),
    v(TOP, 'Top (flat)', [
      dim([0, top, -16], [10, top, -16], [0, 0, -14], '10'),
      cline([-20, top, 0], [20, top, 0]),
    ]),
  ];
  return { body, views };
}

// Advanced part: tool block with sloped end, pocket, groove and holes.
export function toolBlock({ A, B, C }) {
  const prof = [[0, 0], [A, 0], [A, 15], [A - C, 40], [0, 40]];
  const body = subtract(
    prism('XY', prof, 0, 60),
    box(15, 40 - B, 15, 55, 41, 45),
    cyl('XZ', 75, 15, 6, -1, 41), cyl('XZ', 75, 45, 6, -1, 41),
    box(-1, 10, 52, A + 1, 20, 61),
    cyl('XY', 30, 10, 8, -1, 61),
  );
  const views = [
    v(ISO, 'Isometric', [
      dim([0, 0, 60], [A, 0, 60], [0, 0, 26], 'A', { bold: true }),
      dim([A, 0, 60], [A, 0, 0], [26, 0, 0], '60'),
      dim([0, 0, 60], [0, 40, 60], [-22, 0, 0], '40'),
      lead([15, 40 - B, 30], -80, -80, 'POCKET, DEPTH B', { bold: true }),
      lead(rimY(75, 40, 45, 6), 60, -80, '2X Ø12 THRU'),
      lead(rimZ(30, 10, 60, 8), -70, 60, 'Ø16 THRU'),
      lead([A * 0.8, 15, 56], 70, 40, 'GROOVE 10 WIDE x 8 DEEP\nFULL LENGTH'),
      triad([0, 0, 60], 24, 'Origin', { dx: -70, dy: 30 }),
    ]),
    v(FRONT, 'Front', [
      dim([A, 0, 60], [A, 15, 60], [18, 0, 0], '15'),
      dim([A - C, 40, 60], [A, 40, 60], [0, 18, 0], 'C', { bold: true }),
      dim([0, 0, 60], [30, 0, 60], [0, -20, 0], '30'),
      dim([0, 0, 60], [0, 10, 60], [-16, 0, 0], '10'),
      dim([0, 10, 60], [0, 20, 60], [-16, 0, 0], '10'),
      cline([18, 10, 60], [42, 10, 60]), cline([30, -4, 60], [30, 24, 60]),
    ]),
    v(TOP, 'Top', [
      dim([0, 40, 15], [15, 40, 15], [0, 0, -30], '15'),
      dim([15, 40, 15], [55, 40, 15], [0, 0, -30], '40'),
      dim([0, 40, 0], [0, 40, 15], [-16, 0, 0], '15'),
      dim([0, 40, 15], [0, 40, 45], [-16, 0, 0], '30'),
      dim([0, 40, 60], [75, 40, 60], [0, 0, 20], '75'),
      dim([A, 40, 0], [A, 40, 15], [24, 0, 0], '15'),
      dim([A, 40, 15], [A, 40, 45], [24, 0, 0], '30'),
      dim([A, 40, 52], [A, 40, 60], [24, 0, 0], '8'),
      cline([65, 40, 15], [85, 40, 15]), cline([65, 40, 45], [85, 40, 45]),
    ]),
  ];
  return { body, views, origin: [0, 0, 60] };
}

// Assembly: base with tongue, two links, two headed pins.
export function tongueBase() {
  const tongue = [[25, 30], [55, 30], ...arc(40, 60, 15, 0, 180)];
  const body = subtract(union(box(0, 0, 0, 80, 30, 50), prism('XY', tongue, 20, 30)), cyl('XY', 40, 60, 5, 19, 31));
  return {
    body,
    views: [
      v(ISO, 'Base – isometric', [
        dim([0, 0, 50], [80, 0, 50], [0, 0, 22], '80'),
        dim([80, 0, 50], [80, 0, 0], [22, 0, 0], '50'),
        dim([0, 0, 50], [0, 30, 50], [-18, 0, 0], '30'),
        lead(rimZ(40, 60, 30, 5), 70, -40, 'Ø10 THRU'),
        lead([40 - 15 * 0.7, 60 + 15 * 0.7, 30], -70, -40, 'R15'),
      ]),
      v(FRONT, 'Base – front', [
        dim([25, 30, 50], [55, 30, 50], [0, -46, 0], '30'),
        dim([80, 30, 50], [80, 60, 50], [-10, 0, 0], '30'),
        dim([0, 30, 50], [25, 30, 50], [0, 20, 0], '25'),
        cline([20, 60, 30], [60, 60, 30]), cline([40, 40, 30], [40, 80, 30]),
      ]),
      v(TOP, 'Base – top', [
        dim([80, 30, 0], [80, 30, 20], [18, 0, 0], '20'),
        dim([80, 30, 20], [80, 30, 30], [18, 0, 0], '10'),
      ]),
    ],
  };
}

export function link100() {
  const pts = [...arc(0, 0, 12, 90, 270), ...arc(100, 0, 12, -90, 90)];
  const body = subtract(prism('XY', pts, 0, 10), cyl('XY', 0, 0, 5, -1, 11), cyl('XY', 100, 0, 5, -1, 11));
  return {
    body,
    views: [v(FRONT, 'Link – front', [
      dim([0, 0, 10], [100, 0, 10], [0, -26, 0], '100'),
      lead([-12 * 0.7, 12 * 0.7, 10], -50, -40, 'R12 (2X)'),
      lead([100 + 5 * 0.7, 5 * 0.7, 10], 40, -60, '2X Ø10 THRU'),
      lead([50, 12, 10], 0, -60, 'THICKNESS 10'),
      cline([-18, 0, 10], [118, 0, 10]),
    ])],
  };
}

export function headedPin() {
  const body = union(cyl('XY', 0, 0, 5, 0, 20), cyl('XY', 0, 0, 8, 20, 23));
  return {
    body,
    views: [v({ dir: [1, 0.5, 0.7] }, 'Pin', [
      dim([0, -5, 0], [0, -5, 20], [0, -14, 0], '20'),
      dim([0, -8, 20], [0, -8, 23], [0, -11, 0], '3'),
      lead([5 * 0.7, 5 * 0.7, 6], 60, 30, 'Ø10'),
      lead([-8 * 0.7, 8 * 0.7, 23], -60, -40, 'Ø16'),
    ])],
  };
}

export function twoLinkAssembly({ A, B, cs = null }) {
  const a = (A * Math.PI) / 180;
  const x2 = 40 + 100 * Math.cos(a), y2 = 60 + 100 * Math.sin(a);
  const b = (B * Math.PI) / 180;
  const comps = [
    { name: 'Base', model: 'tongueBase', T: { R: I3, t: [0, 0, 0] }, color: '#9aa3ad' },
    { name: 'Link', model: 'link100', T: place(rotAxis('z', A), [0, 0, 0], [40, 60, 30]), color: '#c9b37e' },
    { name: 'Link', model: 'link100', T: place(rotAxis('z', B), [0, 0, 0], [x2, y2, 40]), color: '#d6a35c' },
    { name: 'Pin', model: 'headedPin', T: { R: I3, t: [40, 60, 20] }, color: '#5f7d9c' },
    { name: 'Pin', model: 'headedPin', T: { R: I3, t: [x2, y2, 30] }, color: '#5f7d9c' },
  ];
  const ann = [
    ang([40, 60, 40], [1, 0, 0], [Math.cos(a), Math.sin(a), 0], 55, 'A', { bold: true }),
    ang([x2, y2, 50], [1, 0, 0], [Math.cos(b), Math.sin(b), 0], 55, 'B', { bold: true }),
    triad([0, 0, 50], 26, 'Assembly origin', { dx: -120, dy: 30 }),
  ];
  if (cs) ann.push(triad(cs, 26, 'Coordinate System1', { dx: 10, dy: 28 }));
  return { components: comps, views: [v(ISO, 'Assembly', ann)], origin: [0, 0, 50] };
}

export const MODELS = {
  lBlock, archBracket, flangedHub, hingeBase, hingeArm, plainPin, hingeAssembly,
  guideBlock, shaftSupport, housing, rail, slider, post, endCap, slideAssembly,
  angleSupport, steppedSpindle, toolBlock, tongueBase, link100, headedPin, twoLinkAssembly,
};
export { fmt, rectPts, circlePts };
