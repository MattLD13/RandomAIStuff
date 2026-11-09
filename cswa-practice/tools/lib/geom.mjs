// Modelling helpers on top of manifold-3d.
// World axes follow SOLIDWORKS: Y is up, the Front plane is XY, the Top plane is XZ.
// Every circle and arc is a polygon whose radius is scaled so the polygon has the same
// area as the true circle, so volumes (and therefore masses) come out exact for prisms
// and revolves, not ~0.01 % low like a plain faceted model.
import Module from 'manifold-3d';

const wasm = await Module();
wasm.setup();
export const { Manifold, CrossSection } = wasm;

export const SEG = 360; // segments per full circle
const DELTA = (2 * Math.PI) / SEG;
export const K = Math.sqrt(DELTA / Math.sin(DELTA)); // area-matching radius factor

const rad = (d) => (d * Math.PI) / 180;

// Points of an arc from a0 to a1 (degrees, counter-clockwise if a1 > a0) about (cu, cv).
// Interior points use the area-matched radius; the end points sit on the true radius so
// arcs meet straight edges exactly.
export function arc(cu, cv, r, a0, a1) {
  const n = Math.max(2, Math.ceil(Math.abs(a1 - a0) / (360 / SEG)));
  const pts = [];
  for (let i = 0; i <= n; i++) {
    const a = rad(a0 + ((a1 - a0) * i) / n);
    const rr = i === 0 || i === n ? r : r * K;
    pts.push([cu + rr * Math.cos(a), cv + rr * Math.sin(a)]);
  }
  return pts;
}

export function circlePts(cu, cv, r) {
  const pts = [];
  for (let i = 0; i < SEG; i++) {
    const a = i * DELTA;
    pts.push([cu + r * K * Math.cos(a), cv + r * K * Math.sin(a)]);
  }
  return pts;
}

export const rectPts = (u0, v0, u1, v1) => [[u0, v0], [u1, v0], [u1, v1], [u0, v1]];

// Make sure a polygon is counter-clockwise (manifold treats CW as a hole).
function ccw(pts) {
  let a = 0;
  for (let i = 0; i < pts.length; i++) {
    const [x1, y1] = pts[i];
    const [x2, y2] = pts[(i + 1) % pts.length];
    a += x1 * y2 - x2 * y1;
  }
  return a < 0 ? pts.slice().reverse() : pts;
}

// Extrude a closed profile drawn on one of the three principal planes.
//   'XY' (Front): profile (x, y), extruded along Z from d0 to d1
//   'XZ' (Top):   profile (x, z), extruded along Y from d0 to d1
//   'YZ' (Right): profile (z, y), extruded along X from d0 to d1
// `holes` are extra closed loops cut out of the profile.
export function prism(plane, pts, d0, d1, holes = []) {
  const h = d1 - d0;
  if (h <= 0) throw new Error('prism: d1 must be greater than d0');
  if (plane === 'XY') {
    const cs = new CrossSection([ccw(pts), ...holes.map((p) => ccw(p).reverse())]);
    return Manifold.extrude(cs, h).translate([0, 0, d0]);
  }
  if (plane === 'XZ') {
    const m = (p) => p.map(([x, z]) => [x, -z]);
    const cs = new CrossSection([ccw(m(pts)), ...holes.map((p) => ccw(m(p)).reverse())]);
    return Manifold.extrude(cs, h).rotate([-90, 0, 0]).translate([0, d0, 0]);
  }
  if (plane === 'YZ') {
    const m = (p) => p.map(([z, y]) => [-z, y]);
    const cs = new CrossSection([ccw(m(pts)), ...holes.map((p) => ccw(m(p)).reverse())]);
    return Manifold.extrude(cs, h).rotate([0, 90, 0]).translate([d0, 0, 0]);
  }
  throw new Error('prism: unknown plane ' + plane);
}

export const box = (x0, y0, z0, x1, y1, z1) =>
  Manifold.cube([x1 - x0, y1 - y0, z1 - z0]).translate([x0, y0, z0]);

// Cylinder along a principal axis. (cu, cv) is the centre in that plane's profile coords.
export const cyl = (plane, cu, cv, r, d0, d1) => prism(plane, circlePts(cu, cv, r), d0, d1);

// Revolve a profile of (radius, height) points about the world Y axis.
export function revolveY(pts, degrees = 360) {
  const cs = new CrossSection([ccw(pts)]);
  const segs = Math.round((SEG * degrees) / 360);
  let m = Manifold.revolve(cs, segs, degrees).rotate([-90, 0, 0]);
  if (degrees === 360) m = m.scale([K, 1, K]);
  return m;
}

export const union = (...ms) => Manifold.union(ms.flat());
export const subtract = (a, ...ms) => a.subtract(Manifold.union(ms.flat()));

// Volume (mm^3) and centre of mass (mm) from the triangle mesh.
export function massProps(manifold) {
  const mesh = manifold.getMesh();
  const p = mesh.vertProperties;
  const np = mesh.numProp;
  const t = mesh.triVerts;
  let v = 0, cx = 0, cy = 0, cz = 0;
  for (let i = 0; i < t.length; i += 3) {
    const a = t[i] * np, b = t[i + 1] * np, c = t[i + 2] * np;
    const ax = p[a], ay = p[a + 1], az = p[a + 2];
    const bx = p[b], by = p[b + 1], bz = p[b + 2];
    const qx = p[c], qy = p[c + 1], qz = p[c + 2];
    const d = (ax * (by * qz - bz * qy) - ay * (bx * qz - bz * qx) + az * (bx * qy - by * qx)) / 6;
    v += d;
    cx += d * (ax + bx + qx) / 4;
    cy += d * (ay + by + qy) / 4;
    cz += d * (az + bz + qz) / 4;
  }
  return { volume: v, com: [cx / v, cy / v, cz / v] };
}

export function meshData(manifold) {
  const mesh = manifold.getMesh();
  const np = mesh.numProp;
  const n = mesh.vertProperties.length / np;
  const positions = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    positions[i * 3] = mesh.vertProperties[i * np];
    positions[i * 3 + 1] = mesh.vertProperties[i * np + 1];
    positions[i * 3 + 2] = mesh.vertProperties[i * np + 2];
  }
  return { positions: Array.from(positions), indices: Array.from(mesh.triVerts) };
}

// ---- rigid transforms for assemblies -------------------------------------------------
// A transform is { R: 3x3 row-major array, t: [x, y, z] }; p' = R p + t.
export const I3 = [1, 0, 0, 0, 1, 0, 0, 0, 1];
export function rotAxis(axis, deg) {
  const a = rad(deg), c = Math.cos(a), s = Math.sin(a);
  if (axis === 'x') return [1, 0, 0, 0, c, -s, 0, s, c];
  if (axis === 'y') return [c, 0, s, 0, 1, 0, -s, 0, c];
  return [c, -s, 0, s, c, 0, 0, 0, 1];
}
export function mul3(A, B) {
  const r = new Array(9).fill(0);
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) for (let k = 0; k < 3; k++) r[i * 3 + j] += A[i * 3 + k] * B[k * 3 + j];
  return r;
}
export const apply = (T, p) => [
  T.R[0] * p[0] + T.R[1] * p[1] + T.R[2] * p[2] + T.t[0],
  T.R[3] * p[0] + T.R[4] * p[1] + T.R[5] * p[2] + T.t[1],
  T.R[6] * p[0] + T.R[7] * p[1] + T.R[8] * p[2] + T.t[2],
];
// Transform that first rotates about the local point `pivot`, then moves pivot to `to`.
export function place(R, pivot, to) {
  const rp = apply({ R, t: [0, 0, 0] }, pivot);
  return { R, t: [to[0] - rp[0], to[1] - rp[1], to[2] - rp[2]] };
}

// ---- profile helpers for harder parts -------------------------------------------------
// Polygon with optional corner radii: verts are [u, v] or [u, v, r]. Works for convex and
// concave corners; each rounded corner becomes a tangent arc.
export function filletPoly(verts) {
  const out = [];
  const n = verts.length;
  for (let i = 0; i < n; i++) {
    const P = verts[i];
    const r = P[2] || 0;
    if (!r) { out.push([P[0], P[1]]); continue; }
    const A = verts[(i - 1 + n) % n], B = verts[(i + 1) % n];
    const ux = A[0] - P[0], uy = A[1] - P[1], lu = Math.hypot(ux, uy);
    const vx = B[0] - P[0], vy = B[1] - P[1], lv = Math.hypot(vx, vy);
    const u = [ux / lu, uy / lu], w = [vx / lv, vy / lv];
    const ang = Math.acos(Math.max(-1, Math.min(1, u[0] * w[0] + u[1] * w[1])));
    const d = r / Math.tan(ang / 2), h = r / Math.sin(ang / 2);
    if (d > lu + 1e-9 || d > lv + 1e-9) throw new Error('filletPoly: radius too large at vertex ' + i);
    const bl = Math.hypot(u[0] + w[0], u[1] + w[1]);
    const C = [P[0] + ((u[0] + w[0]) / bl) * h, P[1] + ((u[1] + w[1]) / bl) * h];
    const T1 = [P[0] + u[0] * d, P[1] + u[1] * d], T2 = [P[0] + w[0] * d, P[1] + w[1] * d];
    const a1 = (Math.atan2(T1[1] - C[1], T1[0] - C[0]) * 180) / Math.PI;
    let a2 = (Math.atan2(T2[1] - C[1], T2[0] - C[0]) * 180) / Math.PI;
    let delta = a2 - a1;
    while (delta > 180) delta -= 360;
    while (delta <= -180) delta += 360;
    out.push(...arc(C[0], C[1], r, a1, a1 + delta));
  }
  return out;
}
export const roundRect = (u0, v0, u1, v1, r) => filletPoly([[u0, v0, r], [u1, v0, r], [u1, v1, r], [u0, v1, r]]);
// Straight slot (obround) between two centres along u.
export const slotU = (u1, u2, v, r) => [...arc(u1, v, r, 90, 270), ...arc(u2, v, r, -90, 90)];
export const intersect = (a, b) => a.intersect(b);

// A cylinder along an arbitrary in-plane direction of the XY plane: starts at point p
// (x, y, z), runs along unit direction (dx, dy) from t0 to t1. Used for holes normal to
// sloped faces.
export function cylXYDir(p, dir, r, t0, t1) {
  const phi = (Math.atan2(dir[0], dir[1]) * 180) / Math.PI; // angle from +Y toward +X
  return cyl('XZ', 0, 0, r, t0, t1).rotate([0, 0, -phi]).translate(p);
}
