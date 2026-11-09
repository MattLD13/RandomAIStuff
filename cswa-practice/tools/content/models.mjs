// Parametric models for the practice exams. Each model returns the solid (or the placed
// components of an assembly) plus the dimensioned views that become the question images.
// Axes follow SOLIDWORKS: Y up, Front plane = XY, Top plane = XZ.
// Difficulty target: real CSWA level (Exams 1–2) and a little above it (Exam 3) — fillets,
// counterbores, slots, angled features, and all information on the drawings.
import {
  box, cyl, prism, arc, revolveY, union, subtract, intersect,
  filletPoly, roundRect, slotU, cylXYDir, rotAxis, place, I3,
} from '../lib/geom.mjs';

// ---- annotation shorthands -------------------------------------------------------------
const dim = (a, b, off, text, o = {}) => ({ t: 'dim', a, b, off, text, ...o });
const lead = (at, dx, dy, text, o = {}) => ({ t: 'leader', at, dx, dy, text, ...o });
const ang = (c, u, v, r, text, o = {}) => ({ t: 'angle', c, u, v, r, text, ...o });
const triad = (at, len, label, o = {}) => ({ t: 'triad', at, len, label, ...o });
const cline = (a, b) => ({ t: 'line', a, b, dash: '14 4 3 4', w: 0.9 });

export const ISO = { dir: [1, 0.8, 1.15] };
export const ISO_BELOW = { dir: [1, -0.85, 1.15] };
export const FRONT = { dir: [0, 0, 1] };
export const TOP = { dir: [0, 1, 0], up: [0, 0, -1] };
export const RIGHT = { dir: [1, 0, 0] };

const v = (view, title, ann) => ({ ...view, title, ann });
const S45 = Math.SQRT1_2;
// point on the rim of a hole (at 45°), handy for leader arrows
const rimY = (x, y, z, r) => [x + r * S45, y, z + r * S45];
const rimZ = (x, y, z, r) => [x + r * S45, y + r * S45, z];
const rimX = (x, y, z, r) => [x, y + r * S45, z + r * S45];
const CB = (d, D, depth) => `Ø${d} THRU\nC'BORE Ø${D} ↧ ${depth}`;

// ======================================================================================
// EXAM 1
// ======================================================================================

// Basic part: L-bracket with inside fillet, chamfer, rounded foot, counterbored cross
// hole and a through slot.
export function lBracket({ A, B }) {
  const prof = filletPoly([[0, 0], [A, 0], [A, 20], [20, 20, 8], [20, B], [8, B], [0, B - 8]]);
  let body = prism('XY', prof, 0, 50);
  body = intersect(body, prism('XZ', filletPoly([[0, 0], [A, 0, 10], [A, 50, 10], [0, 50]]), -1, B + 1));
  body = subtract(body,
    cyl('YZ', 25, B - 18, 8, -1, 21),
    cyl('YZ', 25, B - 18, 13, 15, 21),
    prism('XZ', slotU(A - 36, A - 18, 25, 6), -1, 21),
  );
  const views = [
    v(ISO, 'Isometric', [
      dim([0, 0, 50], [A, 0, 50], [0, 0, 26], 'A', { bold: true }),
      dim([A, 0, 50], [A, 0, 0], [24, 0, 0], '50'),
      dim([0, 0, 50], [0, B, 50], [-24, 0, 0], 'B', { bold: true }),
      lead([20, B - 18 + 13 * S45, 25 + 13 * S45], 80, -70, CB(16, 26, 5)),
      lead([A - 10 + 10 * S45, 20, 40 + 10 * S45], 70, -40, 'R10 (2X)'),
    ]),
    v(FRONT, 'Front', [
      dim([A, 0, 50], [A, 20, 50], [18, 0, 0], '20'),
      dim([0, B, 50], [20, B, 50], [0, 30, 0], '20'),
      dim([0, B, 50], [8, B, 50], [0, 14, 0], '8'),
      dim([0, B - 8, 50], [0, B, 50], [-16, 0, 0], '8'),
      lead([28 - 8 * S45, 28 - 8 * S45, 50], 70, -60, 'R8'),
      dim([0, 0, 50], [A, 0, 50], [0, -18, 0], 'A', { bold: true }),
    ]),
    v(TOP, 'Top', [
      dim([A - 42, 20, 25], [A - 12, 20, 25], [0, 0, -40], '30'),
      dim([A - 12, 20, 25], [A, 20, 25], [0, 0, -40], '12'),
      dim([A - 27, 20, 19], [A - 27, 20, 31], [-44, 0, 0], '12'),
      dim([A, 20, 25], [A, 20, 50], [18, 0, 0], '25'),
      cline([A - 48, 20, 25], [A - 6, 20, 25]),
    ]),
    v(RIGHT, 'Right', [
      dim([A, B, 50], [A, B - 18, 50], [0, 0, 18], '18'),
      dim([A, B, 0], [A, B, 25], [0, 16, 0], '25'),
      cline([A, B - 18, 6], [A, B - 18, 44]),
    ]),
  ];
  return { body, views };
}

// Intermediate part: plate with an arched wall, front boss, rib, counterbored holes,
// rounded corners and a notch.
export function archBracket({ A, B, C }) {
  const m = A / 2;
  const wall = [[m - 30, 12], [m + 30, 12], ...arc(m, 52, 30, 0, 180)];
  const body = subtract(
    union(
      prism('XZ', roundRect(0, 0, A, C, 8), 0, 12),
      prism('XY', wall, 0, 14),
      cyl('XY', m, 52, 20, 14, 20),
      prism('YZ', [[14, 12], [44, 12], [14, 37]], m - 6, m + 6),
    ),
    cyl('XY', m, 52, B / 2, -1, 21),
    cyl('XZ', 15, C - 15, 5, -1, 13), cyl('XZ', 15, C - 15, 8, 8, 13),
    cyl('XZ', A - 15, C - 15, 5, -1, 13), cyl('XZ', A - 15, C - 15, 8, 8, 13),
    box(m - 15, -1, C - 15, m + 15, 13, C + 1),
  );
  const views = [
    v(ISO, 'Isometric', [
      dim([0, 0, C], [A, 0, C], [0, 0, 24], 'A', { bold: true }),
      dim([A, 0, C], [A, 0, 0], [24, 0, 0], 'C', { bold: true }),
      lead(rimZ(m, 52, 20, B / 2), 100, -40, 'ØB THRU', { bold: true }),
      lead([m - 20 * S45, 52 + 20 * S45, 20], -90, -10, 'Ø40'),
      lead(rimY(A - 15, 12, C - 15, 8), 60, -50, '2X ' + CB(10, 16, 4)),
      lead([m - 30 * Math.cos(1), 52 + 30 * Math.sin(1), 14], -70, -40, 'R30'),
      lead([8 - 8 * S45, 12, C - 8 + 8 * S45], -40, 30, 'R8 (4X)'),
    ]),
    v(FRONT, 'Front', [
      dim([m - 30, 12, C], [m + 30, 12, C], [0, -30, 0], '60'),
      dim([0, 0, C], [0, 12, C], [-16, 0, 0], '12'),
      dim([A, 0, C], [A, 52, C], [20, 0, 0], '52'),
      cline([m - 40, 52, C], [m + 40, 52, C]), cline([m, 12, C], [m, 92, C]),
    ]),
    v(TOP, 'Top', [
      dim([0, 12, C - 15], [15, 12, C - 15], [0, 0, 26], '15'),
      dim([A, 12, C - 15], [A, 12, C], [18, 0, 0], '15'),
      dim([m - 15, 12, C], [m + 15, 12, C], [0, 0, 16], '30'),
      dim([0, 12, 0], [0, 12, 14], [-16, 0, 0], '14'),
      dim([m + 20, 82, 14], [m + 20, 82, 20], [34, 0, 0], '6'),
      dim([m - 6, 12, 44], [m + 6, 12, 44], [0, 0, 8], '12'),
      cline([5, 12, C - 15], [25, 12, C - 15]), cline([A - 25, 12, C - 15], [A - 5, 12, C - 15]),
    ]),
    v(RIGHT, 'Right (rib)', [
      dim([A, 12, 14], [A, 12, 44], [0, -20, 0], '30'),
      dim([A, 12, 14], [A, 37, 14], [0, 0, -24], '25'),
    ]),
  ];
  return { body, views };
}

// Advanced part: revolved flanged hub with fillet and chamfer, keyway, counterbore,
// bolt circle, a side port boss and an optional flat.
export function flangedHub({ A, B, D = null }) {
  const H = 15 + B;
  const prof = filletPoly([[20, 0], [A / 2, 0], [A / 2, 15], [35, 15, 4], [35, H - 3], [32, H], [25, H], [25, H - 8], [20, H - 8]]);
  const holes = [];
  for (let k = 0; k < 6; k++) {
    const a = ((30 + 60 * k) * Math.PI) / 180;
    holes.push(cyl('XZ', 47.5 * Math.cos(a), 47.5 * Math.sin(a), 5, -1, 16));
  }
  const cuts = [
    cyl('XZ', 0, 0, 20, -1, H + 1),
    box(0, -1, -6, 26, H + 1, 6),
    cyl('XY', 0, 35, 6, 0, 51),
    ...holes,
  ];
  if (D) cuts.push(box(-A, -1, -A, -D, 16, A));
  const body = subtract(union(revolveY(prof), cyl('XY', 0, 35, 12, 0, 50)), cuts);
  const iso = [
    dim([-A / 2, 0, 0], [A / 2, 0, 0], [0, -8, A / 2 + 18], 'ØA', { bold: true }),
    dim([35, 15, 0], [35, H, 0], [A / 2 - 35 + 20, 0, 0], 'B', { bold: true }),
    dim([A / 2, 0, 0], [A / 2, 15, 0], [18, 0, 0], '15'),
    lead([-35 * S45, H - 10, 35 * S45], -80, -40, 'Ø70'),
    lead([-25 * S45, H, 25 * S45], -110, -110, "C'BORE Ø50 ↧ 8"),
    lead([-20 * S45, H - 8, 20 * S45], -150, -40, 'Ø40 THRU'),
    lead([12 * S45, 35 + 12 * S45, 50], 90, -50, 'Ø24 BOSS\nØ12 THRU TO BORE'),
    triad([0, 0, 0], 22, 'Origin: centre of bottom face', { dx: 40, dy: 80 }),
  ];
  const top = [
    dim([0, H, -6], [0, H, 6], [32, 0, 0], '12'),
    dim([0, H, 0], [26, H, 0], [0, 0, -45], '26'),
    dim([0, 15, 0], [0, 15, 50], [-A / 2 - 20, 0, 0], '50'),
    ang([0, 15, 0], [1, 0, 0], [Math.cos(Math.PI / 6), 0, Math.sin(Math.PI / 6)], 62, '30°'),
    lead([47.5 * Math.cos(Math.PI / 6) + 3.5, 15, 47.5 * Math.sin(Math.PI / 6) + 3.5], 90, 60, '6X Ø10 THRU\nEQ. SP. ON Ø95 B.C.'),
    { t: 'line', a: [0, 15, 0], b: [47.5 * Math.cos(Math.PI / 6), 15, 47.5 * Math.sin(Math.PI / 6)], dash: '14 4 3 4', w: 0.9 },
  ];
  if (D) top.push(dim([0, 15, -A / 2 + 5], [-D, 15, -A / 2 + 5], [0, 0, -25], 'D', { bold: true }));
  const front = [
    dim([A / 2, 0, 0], [A / 2, 35, 0], [22, 0, 0], '35'),
    lead([35 + 4 - 4 * S45, 15 + 4 - 4 * S45, 0], 80, 40, 'R4'),
    lead([33.5, H - 1.5, 0], 80, -30, '3 X 45°'),
    cline([-20, 35, 50], [20, 35, 50]),
  ];
  const views = [v(ISO, 'Isometric', iso), v(TOP, 'Top', top), v(FRONT, 'Front', front)];
  return { body, views };
}

// ---- Exam 1 assembly: base with clevis ears, arm at angle A, two pins, hanger ----------
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
      lead([-15 * S45, 15 * S45, 24], -50, -50, 'R15 (2X)'),
      lead([120 + 5 * S45, 5 * S45, 24], 50, -70, '2X Ø10 THRU'),
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
    lead([(d / 2) * S45, (d / 2) * S45, L], 60, -50, `Ø${d}`),
  ])];
  return { body, views };
}

export function hanger() {
  const pts = [...arc(0, 0, 15, 0, 180), [-15, -50], [15, -50]];
  const body = subtract(prism('XY', pts, 0, 10), cyl('XY', 0, 0, 5, -1, 11), cyl('XY', 0, -35, 6, -1, 11));
  const views = [v(FRONT, 'Hanger – front', [
    dim([-15, -50, 10], [15, -50, 10], [0, -18, 0], '30'),
    dim([15, 0, 10], [15, -50, 10], [26, 0, 0], '50'),
    dim([-15, 0, 10], [-15, -35, 10], [-22, 0, 0], '35'),
    lead([-15 * S45, 15 * S45, 10], -50, -40, 'R15'),
    lead([5 * S45, 5 * S45, 10], 60, -40, 'Ø10 THRU'),
    lead([6 * S45, -35 + 6 * S45, 10], 60, 0, 'Ø12 THRU'),
    lead([0, -25, 10], 70, 50, 'THICKNESS 10'),
    cline([-22, 0, 10], [22, 0, 10]), cline([-22, -35, 10], [22, -35, 10]),
  ])];
  return { body, views };
}

export function hingeAssembly({ A, cs = null }) {
  const a = (A * Math.PI) / 180;
  const x2 = 25 + 120 * Math.cos(a), y2 = 40 + 120 * Math.sin(a);
  const comps = [
    { name: 'Base', model: 'hingeBase', T: { R: I3, t: [0, 0, 0] }, color: '#9aa3ad' },
    { name: 'Arm', model: 'hingeArm', T: place(rotAxis('z', A), [0, 0, 0], [25, 40, 18]), color: '#c9b37e' },
    { name: 'Pin', model: 'plainPin', params: { L: 50, d: 10 }, T: { R: I3, t: [25, 40, 5] }, color: '#5f7d9c' },
    { name: 'Pin', model: 'plainPin', params: { L: 50, d: 10 }, T: { R: I3, t: [x2, y2, 5] }, color: '#5f7d9c' },
    { name: 'Hanger', model: 'hanger', T: { R: I3, t: [x2, y2, 42] }, color: '#b87d5b' },
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

// Basic part: guide block — channel with root fillets, chamfers, rounded corners,
// counterbored holes from the channel floor.
export function guideBlock({ A, B }) {
  const prof = filletPoly([[0, 0], [60, 0], [60, B - 10], [50, B], [42, B], [42, B - 12, 3], [18, B - 12, 3], [18, B], [10, B], [0, B - 10]]);
  let body = intersect(prism('YZ', prof, 0, A), prism('XZ', roundRect(0, 0, A, 60, 10), -1, B + 1));
  body = subtract(body,
    cyl('XZ', 15, 30, 5, -1, B + 1), cyl('XZ', 15, 30, 8, B - 17, B + 1),
    cyl('XZ', A - 15, 30, 5, -1, B + 1), cyl('XZ', A - 15, 30, 8, B - 17, B + 1),
  );
  const views = [
    v(ISO, 'Isometric', [
      dim([0, 0, 60], [A, 0, 60], [0, 0, 24], 'A', { bold: true }),
      dim([A, 0, 60], [A, 0, 0], [24, 0, 0], '60'),
      dim([0, 0, 50], [0, B, 50], [-22, 0, 0], 'B', { bold: true }),
      lead(rimY(A - 15, B - 12, 30, 8), 80, -90, '2X ' + CB(10, 16, 5)),
      lead([A - 10 + 10 * S45, 0, 50 + 10 * S45], 50, 40, 'R10 (4X)'),
    ]),
    v(RIGHT, 'Right', [
      dim([A, B, 60], [A, B, 50], [0, 18, 0], '10'),
      dim([A, B - 10, 60], [A, B, 60], [0, 0, 16], '10'),
      dim([A, B, 42], [A, B, 18], [0, 40, 0], '24'),
      dim([A, B, 18], [A, B - 12, 18], [0, 0, 34], '12'),
      dim([A, B, 0], [A, B, 10], [0, 18, 0], '10'),
      dim([A, B - 10, 0], [A, B, 0], [0, 0, -16], '10'),
      lead([A, B - 12 + 3 - 3 * S45, 42 - 3 + 3 * S45], -60, 50, 'R3 (2X)'),
    ]),
    v(TOP, 'Top', [
      dim([0, B - 12, 30], [15, B - 12, 30], [0, 0, 44], '15'),
      dim([A - 15, B - 12, 30], [A, B - 12, 30], [0, 0, 44], '15'),
      dim([A, B, 10], [A, B, 30], [20, 0, 0], '', {}),
      dim([A, B, 0], [A, B, 30], [20, 0, 0], '30'),
      cline([5, B - 12, 30], [A - 5, B - 12, 30]),
    ].filter((d) => d.text !== '')),
  ];
  return { body, views };
}

// Intermediate part: shaft support — tapered web with two gussets, boss with oil hole,
// two slots, rounded base.
export function shaftSupport({ A, B, C }) {
  const m = A / 2;
  const body = subtract(
    union(
      prism('XZ', roundRect(0, 0, A, 50, 10), 0, 12),
      prism('XY', [[m - 25, 12], [m + 25, 12], [m + 12, B - 10], [m - 12, B - 10]], 20, 30),
      prism('YZ', [[30, 12], [45, 12], [30, 32]], m - 4, m + 4),
      prism('YZ', [[20, 12], [5, 12], [20, 32]], m - 4, m + 4),
      cyl('XY', m, B, 20, 10, 40),
    ),
    cyl('XY', m, B, C / 2, 9, 41),
    cyl('XZ', m, 25, 3, B, B + 21),
    prism('XZ', slotU(15, 25, 25, 5), -1, 13),
    prism('XZ', slotU(A - 25, A - 15, 25, 5), -1, 13),
  );
  const views = [
    v(ISO, 'Isometric', [
      dim([0, 0, 50], [A, 0, 50], [0, 0, 24], 'A', { bold: true }),
      dim([A, 0, 50], [A, 0, 0], [24, 0, 0], '50'),
      lead(rimZ(m, B, 40, C / 2), 90, -50, 'ØC THRU', { bold: true }),
      lead([m - 20 * S45, B + 20 * S45, 40], -90, -40, 'Ø40'),
      lead([m, B + 20, 25], 60, -60, 'Ø6 THRU TO BORE'),
      lead([A - 15 + 5 * S45, 12, 25 + 5 * S45], 70, -40, '2X SLOT, R5 ENDS'),
      lead([A - 10 + 10 * S45, 0, 40 + 10 * S45], 50, 40, 'R10 (4X)'),
    ]),
    v(FRONT, 'Front', [
      dim([0, 0, 50], [0, B, 50], [-20, 0, 0], 'B', { bold: true }),
      dim([A, 0, 50], [A, 12, 50], [18, 0, 0], '12'),
      dim([m - 25, 12, 50], [m + 25, 12, 50], [0, -30, 0], '50'),
      dim([m - 12, B - 10, 30], [m + 12, B - 10, 30], [0, 0, 0], '24', { textOff: -14 }),
      dim([m + 40, B - 10, 30], [m + 40, B, 30], [6, 0, 0], '10'),
      cline([m - 30, B, 50], [m + 30, B, 50]), cline([m, 20, 50], [m, B + 30, 50]),
    ]),
    v(TOP, 'Top', [
      dim([A, 12, 10], [A, 12, 40], [16, 0, 0], '30'),
      dim([m - 4, B + 20, 20], [m - 4, B + 20, 30], [-70, 0, 0], '10'),
      dim([0, 12, 25], [10, 12, 25], [0, 0, -36], '10'),
      dim([10, 12, 25], [30, 12, 25], [0, 0, -36], '20'),
      dim([0, 12, 0], [0, 12, 25], [-16, 0, 0], '25'),
      cline([5, 12, 25], [35, 12, 25]), cline([A - 35, 12, 25], [A - 5, 12, 25]),
    ]),
    v(RIGHT, 'Right (gussets)', [
      dim([A, 12, 30], [A, 12, 45], [0, -20, 0], '15'),
      dim([A, 12, 30], [A, 32, 30], [0, 0, 26], '20'),
      dim([A, 12, 20], [A, 12, 30], [0, -20, 0], '10'),
    ]),
  ];
  return { body, views };
}

// Advanced part: shelled housing with rounded corners, end tabs with gussets, boss,
// optional window.
export function housing({ A, B, window = false }) {
  const cuts = [
    prism('XZ', roundRect(6, 6, A - 6, 74, 4), -1, B - 6),
    cyl('XZ', 40, 40, 10, B - 7, B + 16),
    cyl('XZ', -10, 15, 4, -1, 9), cyl('XZ', -10, 65, 4, -1, 9),
    cyl('XZ', A + 10, 15, 4, -1, 9), cyl('XZ', A + 10, 65, 4, -1, 9),
  ];
  if (window) cuts.push(box(A - 60, 15, 73, A - 20, 35, 81));
  const body = subtract(
    union(
      prism('XZ', roundRect(0, 0, A, 80, 10), 0, B),
      box(-20, 0, 0, 8, 8, 80), box(A - 8, 0, 0, A + 20, 8, 80),
      prism('XY', [[A, 8], [A + 15, 8], [A, 28]], 37, 43),
      prism('XY', [[0, 8], [0, 28], [-15, 8]], 37, 43),
      cyl('XZ', 40, 40, 20, B, B + 15),
    ),
    cuts,
  );
  const iso = [
    dim([0, 0, 80], [A, 0, 80], [0, 0, 26], 'A', { bold: true }),
    dim([A + 20, 0, 80], [A + 20, 0, 0], [22, 0, 0], '80'),
    dim([0, 8, 70], [0, B, 70], [-34, 0, 0], 'B', { bold: true, textOff: 16 }),
    dim([-20, 0, 80], [0, 0, 80], [0, 0, 26], '20'),
    lead([40 + 20 * S45, B + 15, 40 + 20 * S45], 80, -50, 'Ø40 ↑ 15'),
    lead([40 - 10 * S45, B + 15, 40 + 10 * S45], -90, -60, 'Ø20 THRU TO CAVITY'),
    lead([A + 10 + 4 * S45, 8, 65 + 4 * S45], 60, -30, '4X Ø8 THRU'),
    lead([A - 10 + 10 * S45, B, 70 + 10 * S45], 50, -70, 'R10 (4X)'),
    triad([0, 0, 80], 26, 'Origin', { dx: -70, dy: 30 }),
  ];
  if (window) {
    iso.push(dim([A - 60, 15, 80], [A - 20, 15, 80], [0, -24, 0], '40'));
    iso.push(dim([A, 15, 80], [A, 35, 80], [16, 0, 0], '20'));
    iso.push(dim([A - 20, 35, 80], [A - 10, 35, 80], [0, 24, 0], '', {}));
    iso.push(dim([A, 0, 80], [A, 15, 80], [16, 0, 0], '15'));
  }
  const views = [
    v(ISO, 'Isometric', iso.filter((d) => d.text !== '')),
    v(ISO_BELOW, 'From below', [
      lead([A / 2, 0, 6], 60, -150, 'SHELL 6, BOTTOM FACE OPEN\nINSIDE CORNERS R4'),
      dim([A + 20, 0, 80], [A + 20, 8, 80], [0, 0, 18], '8'),
    ]),
    v(TOP, 'Top', [
      dim([0, B + 15, 40], [40, B + 15, 40], [0, 0, 60], '40'),
      dim([0, B, 0], [0, B, 40], [-36, 0, 0], '40'),
      dim([-20, 8, 0], [-20, 8, 15], [-16, 0, 0], '15'),
      dim([-20, 8, 0], [-10, 8, 0], [0, 0, -16], '10'),
      dim([-20, 8, 65], [-20, 8, 80], [-16, 0, 0], '15'),
      dim([A, 8, 37], [A, 8, 43], [36, 0, 0], '6'),
    ]),
    v(FRONT, 'Front (gussets)', [
      dim([A, 8, 80], [A + 15, 8, 80], [0, -16, 0], '15'),
      dim([A, 8, 80], [A, 28, 80], [-14, 0, 0], '20'),
      ...(window ? [dim([A - 20, 35, 80], [A, 35, 80], [0, 20, 0], '20')] : []),
    ]),
  ];
  return { body, views, origin: [0, 0, 80] };
}

// ---- Exam 2 assembly: U-rail, end caps, slider, post, handle ----------------------------
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
      lead(rimY(20, 22, 15, 6), 60, -50, 'Ø12 THRU, CENTRED'),
    ])],
  };
}

export function post() {
  const body = union(cyl('XZ', 0, 0, 6, 0, 100), cyl('XZ', 0, 0, 15, 60, 66));
  return {
    body,
    views: [v({ dir: [1, 0.35, 1.1] }, 'Post', [
      dim([15, 0, 0], [15, 60, 0], [16, 0, 0], '60'),
      dim([15, 60, 0], [15, 66, 0], [16, 0, 0], '6'),
      dim([-6, 0, 0], [-6, 100, 0], [-30, 0, 0], '100'),
      lead([6 * S45, 30, 6 * S45], 60, 0, 'Ø12'),
      lead([-15 * S45, 66, 15 * S45], -70, -30, 'Ø30'),
    ])],
  };
}

export function handle() {
  const body = subtract(prism('XZ', slotU(0, 80, 0, 10), 0, 8), cyl('XZ', 0, 0, 6, -1, 9), cyl('XZ', 80, 0, 4, -1, 9));
  return {
    body,
    views: [v(TOP, 'Handle – top', [
      dim([0, 8, 0], [80, 8, 0], [0, 0, 26], '80'),
      lead([80 + 10 * S45, 8, -10 * S45], 50, -30, 'R10 (2X)'),
      lead([6 * S45, 8, -6 * S45], -30, -50, 'Ø12 THRU'),
      lead([80 - 4 * S45, 8, -4 * S45], -40, -50, 'Ø8 THRU'),
      lead([40, 8, -10], 0, -50, 'THICKNESS 8'),
      cline([-16, 8, 0], [96, 8, 0]),
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

export function slideAssembly({ A, B, cs = null }) {
  const b = (B * Math.PI) / 180;
  const comps = [
    { name: 'Rail', model: 'rail', T: { R: I3, t: [0, 0, 0] }, color: '#9aa3ad' },
    { name: 'End Cap', model: 'endCap', T: { R: I3, t: [-6, 0, 0] }, color: '#3d4a5a' },
    { name: 'End Cap', model: 'endCap', T: { R: I3, t: [200, 0, 0] }, color: '#3d4a5a' },
    { name: 'Slider', model: 'slider', T: { R: I3, t: [A, 8, 10] }, color: '#c9b37e' },
    { name: 'Post', model: 'post', T: { R: I3, t: [A + 20, 8, 25] }, color: '#5f7d9c' },
    { name: 'Handle', model: 'handle', T: place(rotAxis('y', -B), [0, 0, 0], [A + 20, 74, 25]), color: '#b87d5b' },
  ];
  const ann = [
    dim([0, 25, 50], [A, 25, 50], [0, 0, 30], 'A', { bold: true }),
    ang([A + 20, 82, 25], [1, 0, 0], [Math.cos(b), 0, Math.sin(b)], 60, 'B', { bold: true }),
    triad([0, 0, 50], 30, 'Assembly origin', { dx: -120, dy: 30 }),
  ];
  if (cs) ann.push(triad(cs, 30, 'Coordinate System1', { dx: 10, dy: -26 }));
  return { components: comps, views: [v(ISO, 'Assembly', ann)], origin: [0, 0, 50] };
}

// ======================================================================================
// EXAM 3 (a little harder than the real exam)
// ======================================================================================

// Basic part: angle support — tapered upright with root fillet, full-round foot end,
// top slot, two holes.
export function angleSupport({ A, B }) {
  const prof = filletPoly([[0, 0], [A, 0], [A, 15], [30, 15, 6], [18, B], [0, B]]);
  let body = intersect(prism('XY', prof, 0, 40), prism('XZ', [[0, 0], [A - 20, 0], ...arc(A - 20, 20, 20, -90, 90), [0, 40]], -1, B + 1));
  body = subtract(body,
    cyl('XZ', A - 20, 20, 5, -1, 16),
    cyl('YZ', 20, B - 25, 5, -1, 31),
    box(-1, B - 15, 17, 31, B + 1, 23),
  );
  const views = [
    v(ISO, 'Isometric', [
      dim([0, 0, 40], [0, B, 40], [-22, 0, 0], 'B', { bold: true }),
      lead(rimY(A - 20, 15, 20, 5), 70, -60, 'Ø10 THRU'),
      lead([A - 20 + 20 * S45, 0, 20 + 20 * S45], 60, 40, 'R20 FULL ROUND'),
      lead([24, B - 25 + 5 * S45, 20 + 5 * S45], 80, -50, 'Ø10 THRU'),
      lead([6, B, 23], -60, -50, 'SLOT 6 WIDE x 15 DEEP\nTHRU, CENTRED'),
    ]),
    v(FRONT, 'Front', [
      dim([0, 0, 40], [A, 0, 40], [0, -18, 0], 'A', { bold: true }),
      dim([A, 0, 40], [A, 15, 40], [16, 0, 0], '15'),
      dim([0, 15, 40], [30, 15, 40], [0, -36, 0], '30'),
      dim([0, B, 40], [18, B, 40], [0, 16, 0], '18'),
      dim([0, B, 40], [0, B - 25, 40], [-18, 0, 0], '25'),
      lead([30 - 3, 15 + 4, 40], 70, -40, 'R6'),
      cline([-6, B - 25, 40], [30, B - 25, 40]),
    ]),
    v(TOP, 'Top', [
      dim([A, B, 0], [A, B, 20], [18, 0, 0], '20'),
      dim([0, B, 17], [0, B, 23], [-30, 0, 0], '6'),
      cline([A - 30, 15, 20], [A + 4, 15, 20]), cline([A - 20, 15, 4], [A - 20, 15, 36]),
    ]),
  ];
  return { body, views };
}

// Intermediate part: revolved stepped spindle — root fillet, end chamfer, ring groove,
// bore, cross hole, flange hole pattern and a D-flat.
export function steppedSpindle({ A, B }) {
  const top = 50 + A;
  const prof = filletPoly([[8, 0], [B / 2, 0], [B / 2, 20], [20, 20, 2], [20, 50], [15, 50], [15, top - 1], [14, top], [8, top]]);
  const holes = [];
  for (let k = 0; k < 4; k++) {
    const a = ((45 + 90 * k) * Math.PI) / 180;
    holes.push(cyl('XZ', 25 * Math.cos(a), 25 * Math.sin(a), 4, -1, 21));
  }
  const body = subtract(
    revolveY(prof),
    revolveY([[13.5, top - 12], [16, top - 12], [16, top - 10], [13.5, top - 10]]),
    cyl('YZ', 0, 35, 4, -25, 25),
    box(10, top - 20, -20, 20, top + 1, 20),
    ...holes,
  );
  const F = { dir: [0, 0, 1] };
  const views = [
    v({ dir: [1, 0.55, 1.15] }, 'Isometric', [
      lead([10, top - 6, 9], 80, -30, 'FLAT'),
      lead([20 * S45, 35 + 4, 20 * S45], -110, 10, 'Ø8 THRU (CROSS HOLE)'),
      lead([25 * Math.cos(Math.PI / 4) + 4 * S45, 20, 25 * Math.sin(Math.PI / 4) + 4 * S45], 90, 40, '4X Ø8 THRU\nEQ. SP. ON Ø50 B.C.'),
    ]),
    v(F, 'Front', [
      dim([-B / 2, 0, 0], [B / 2, 0, 0], [0, -20, 0], 'ØB', { bold: true }),
      lead([-20, 42, 0], -60, 0, 'Ø40'),
      lead([-15, top - 30, 0], -60, 0, 'Ø30'),
      dim([B / 2, 0, 0], [B / 2, 20, 0], [24, 0, 0], '20'),
      dim([20, 20, 0], [20, 50, 0], [B / 2 - 20 + 24, 0, 0], '30'),
      dim([15, 50, 0], [15, top, 0], [B / 2 - 15 + 24, 0, 0], 'A', { bold: true }),
      dim([-20, 20, 0], [-20, 35, 0], [-30, 0, 0], '15'),
      dim([10, top - 20, 0], [10, top, 0], [-62, 0, 0], '20'),
      lead([-8, top, 0], -50, -30, 'Ø16 THRU'),
      lead([-20 - 2 + 2 * S45, 20 + 2 - 2 * S45, 0], -60, 30, 'R2'),
      lead([-14.5, top - 0.5, 0], -70, -60, '1 X 45°'),
      lead([15, top - 11, 0], 150, -6, 'GROOVE 2 WIDE x 1.5 DEEP\n10 FROM END'),
      cline([0, -8, 0], [0, top + 10, 0]),
    ]),
    v(TOP, 'Top', [
      dim([0, top, -16], [10, top, -16], [0, 0, -14], '10'),
      ang([0, 20, 0], [1, 0, 0], [S45, 0, S45], B / 2 + 8, '45°'),
      cline([-20, top, 0], [20, top, 0]),
    ]),
  ];
  return { body, views };
}

// Advanced part: tool block — sloped end with a blind hole normal to it, rounded pocket,
// rounded corners, groove, through holes.
export function toolBlock({ A, B, C }) {
  const L = Math.hypot(C, 25);
  const n = [25 / L, C / L]; // outward normal of the sloped face (x, y)
  const mid = [A - C / 2, 27.5];
  let body = intersect(
    prism('XY', [[0, 0], [A, 0], [A, 15], [A - C, 40], [0, 40]], 0, 60),
    prism('XZ', filletPoly([[0, 0, 10], [A, 0], [A, 60], [0, 60, 10]]), -1, 41),
  );
  body = subtract(body,
    prism('XZ', roundRect(15, 15, 55, 45, 5), 40 - B, 41),
    cyl('XZ', 75, 15, 6, -1, 41), cyl('XZ', 75, 45, 6, -1, 41),
    box(-1, 10, 52, A + 1, 20, 61),
    cyl('XY', 30, 10, 8, -1, 61),
    cylXYDir([mid[0], mid[1], 30], n, 5, -20, 1),
  );
  const views = [
    v(ISO, 'Isometric', [
      dim([A, 0, 60], [A, 0, 0], [26, 0, 0], '60'),
      dim([0, 0, 60], [0, 40, 60], [-22, 0, 0], '40'),
      lead([15, 40 - B, 30], -80, -80, 'POCKET ↧ B, R5 CORNERS', { bold: true }),
      lead(rimY(75, 40, 45, 6), 60, -80, '2X Ø12 THRU'),
      lead(rimZ(30, 10, 60, 8), -70, 60, 'Ø16 THRU'),
      lead([A * 0.8, 15, 56], 70, 40, 'GROOVE 10 WIDE x 8 DEEP\nFULL LENGTH'),
      lead([mid[0] + 5 * S45, mid[1] + 3, 30 + 5 * S45], 60, -60, 'Ø10 ↧ 20, ⊥ TO SLOPED FACE\nAT ITS MIDPOINT, CENTRED'),
      triad([0, 0, 60], 24, 'Origin', { dx: -70, dy: 30 }),
    ]),
    v(FRONT, 'Front', [
      dim([A, 0, 60], [A, 15, 60], [18, 0, 0], '15'),
      dim([A - C, 40, 60], [A, 40, 60], [0, 18, 0], 'C', { bold: true }),
      dim([0, 0, 60], [30, 0, 60], [0, -20, 0], '30'),
      dim([0, 0, 60], [A, 0, 60], [0, -40, 0], 'A', { bold: true }),
      dim([0, 0, 60], [0, 10, 60], [-16, 0, 0], '10'),
      dim([0, 10, 60], [0, 20, 60], [-16, 0, 0], '10'),
      cline([18, 10, 60], [42, 10, 60]), cline([30, -4, 60], [30, 24, 60]),
      { t: 'line', a: [mid[0] - n[0] * 26, mid[1] - n[1] * 26, 60], b: [mid[0] + n[0] * 14, mid[1] + n[1] * 14, 60], dash: '14 4 3 4', w: 0.9 },
    ]),
    v(TOP, 'Top', [
      dim([0, 40, 15], [15, 40, 15], [0, 0, -30], '15'),
      dim([15, 40, 15], [55, 40, 15], [0, 0, -30], '40'),
      dim([0, 40, 15], [0, 40, 45], [-16, 0, 0], '30'),
      dim([10, 40, 0], [10, 40, 15], [-26, 0, 0], '15'),
      dim([0, 40, 60], [75, 40, 60], [0, 0, 20], '75'),
      dim([A, 40, 0], [A, 40, 15], [24, 0, 0], '15'),
      dim([A, 40, 15], [A, 40, 45], [24, 0, 0], '30'),
      dim([A, 40, 52], [A, 40, 60], [24, 0, 0], '8'),
      lead([10 - 10 * S45, 40, 10 - 10 * S45], -40, -40, 'R10 (2X)'),
      cline([65, 40, 15], [85, 40, 15]), cline([65, 40, 45], [85, 40, 45]),
    ]),
  ];
  return { body, views, origin: [0, 0, 60] };
}

// ---- Exam 3 assembly: base with tongue, short link, long link, two headed pins ----------
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
        lead([40 - 15 * S45, 60 + 15 * S45, 30], -70, -40, 'R15'),
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

function linkPart(len, title) {
  const pts = [...arc(0, 0, 12, 90, 270), ...arc(len, 0, 12, -90, 90)];
  const body = subtract(prism('XY', pts, 0, 10), cyl('XY', 0, 0, 5, -1, 11), cyl('XY', len, 0, 5, -1, 11));
  return {
    body,
    views: [v(FRONT, title, [
      dim([0, 0, 10], [len, 0, 10], [0, -26, 0], String(len)),
      lead([-12 * S45, 12 * S45, 10], -50, -40, 'R12 (2X)'),
      lead([len + 5 * S45, 5 * S45, 10], 40, -60, '2X Ø10 THRU'),
      lead([len / 2, 12, 10], 0, -60, 'THICKNESS 10'),
      cline([-18, 0, 10], [len + 18, 0, 10]),
    ])],
  };
}
export const link100 = () => linkPart(100, 'Link 1 and Link 2 – front');
export const link140 = () => linkPart(140, 'Link 3 – front');

export function headedPin() {
  const body = union(cyl('XY', 0, 0, 5, 0, 20), cyl('XY', 0, 0, 8, 20, 23));
  return {
    body,
    views: [v({ dir: [1, 0.5, 0.7] }, 'Pin', [
      dim([0, -5, 0], [0, -5, 20], [0, -14, 0], '20'),
      dim([0, -8, 20], [0, -8, 23], [0, -11, 0], '3'),
      lead([5 * S45, 5 * S45, 6], 60, 30, 'Ø10'),
      lead([-8 * S45, 8 * S45, 23], -60, -40, 'Ø16'),
    ])],
  };
}

// Chain of three links with RELATIVE angles: A = Base top face to Link 1, B = included
// angle between Link 1 and Link 2 (bending down), C = included angle between Link 2 and
// Link 3 (bending back up). This mirrors the hardest mate skill on the real exam.
export function chainAssembly({ A, B, C, cs = null }) {
  const r = (d) => (d * Math.PI) / 180;
  const t1 = A, t2 = A - (180 - B), t3 = t2 + (180 - C);
  const p1 = [40, 60];
  const p2 = [p1[0] + 100 * Math.cos(r(t1)), p1[1] + 100 * Math.sin(r(t1))];
  const p3 = [p2[0] + 100 * Math.cos(r(t2)), p2[1] + 100 * Math.sin(r(t2))];
  const comps = [
    { name: 'Base', model: 'tongueBase', T: { R: I3, t: [0, 0, 0] }, color: '#9aa3ad' },
    { name: 'Link 1', model: 'link100', T: place(rotAxis('z', t1), [0, 0, 0], [p1[0], p1[1], 30]), color: '#c9b37e' },
    { name: 'Link 2', model: 'link100', T: place(rotAxis('z', t2), [0, 0, 0], [p2[0], p2[1], 40]), color: '#d6a35c' },
    { name: 'Link 3', model: 'link140', T: place(rotAxis('z', t3), [0, 0, 0], [p3[0], p3[1], 50]), color: '#c9b37e' },
    { name: 'Pin', model: 'headedPin', T: { R: I3, t: [p1[0], p1[1], 20] }, color: '#5f7d9c' },
    { name: 'Pin', model: 'headedPin', T: { R: I3, t: [p2[0], p2[1], 30] }, color: '#5f7d9c' },
    { name: 'Pin', model: 'headedPin', T: { R: I3, t: [p3[0], p3[1], 40] }, color: '#5f7d9c' },
  ];
  const d = (t) => [Math.cos(r(t)), Math.sin(r(t)), 0];
  const ann = [
    ang([p1[0], p1[1], 40], [1, 0, 0], d(t1), 50, 'A', { bold: true }),
    ang([p2[0], p2[1], 50], d(t1 + 180), d(t2), 42, 'B', { bold: true, ext: false }),
    ang([p3[0], p3[1], 60], d(t2 + 180), d(t3), 42, 'C', { bold: true, ext: false }),
    triad([0, 0, 50], 26, 'Assembly origin', { dx: -120, dy: 30 }),
  ];
  if (cs) ann.push(triad(cs, 26, 'Coordinate System1', { dx: 10, dy: 28 }));
  return { components: comps, views: [v(ISO, 'Assembly', ann)], origin: [0, 0, 50] };
}

export const MODELS = {
  lBracket, archBracket, flangedHub, hingeBase, hingeArm, plainPin, hanger, hingeAssembly,
  guideBlock, shaftSupport, housing, rail, slider, post, handle, endCap, slideAssembly,
  angleSupport, steppedSpindle, toolBlock, tongueBase, link100, link140, headedPin, chainAssembly,
};
