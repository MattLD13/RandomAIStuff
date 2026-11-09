// Renders a part or assembly as a shaded model with black edges, then draws dimensions
// on an SVG layer over it. Driven from Node through window.renderScene(spec).
import * as THREE from 'three';
import { LineSegments2 } from 'three/addons/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/addons/lines/LineSegmentsGeometry.js';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';

const SVGNS = 'http://www.w3.org/2000/svg';
const V = (a) => new THREE.Vector3(a[0], a[1], a[2]);

function edgesFor(positions, indices, viewDir, creaseDeg) {
  const P = (i) => new THREE.Vector3(positions[i * 3], positions[i * 3 + 1], positions[i * 3 + 2]);
  const ntri = indices.length / 3;
  const normals = [];
  for (let f = 0; f < ntri; f++) {
    const a = P(indices[f * 3]), b = P(indices[f * 3 + 1]), c = P(indices[f * 3 + 2]);
    normals.push(new THREE.Vector3().crossVectors(b.clone().sub(a), c.clone().sub(a)).normalize());
  }
  const map = new Map();
  for (let f = 0; f < ntri; f++) {
    for (let k = 0; k < 3; k++) {
      const i = indices[f * 3 + k], j = indices[f * 3 + ((k + 1) % 3)];
      const key = i < j ? i + '_' + j : j + '_' + i;
      if (!map.has(key)) map.set(key, [i, j, []]);
      map.get(key)[2].push(f);
    }
  }
  const cosLim = Math.cos((creaseDeg * Math.PI) / 180);
  const out = [];
  for (const [i, j, fs] of map.values()) {
    let draw = false;
    if (fs.length !== 2) draw = true;
    else {
      const n1 = normals[fs[0]], n2 = normals[fs[1]];
      if (n1.dot(n2) < cosLim) draw = true;
      else if (n1.dot(viewDir) * n2.dot(viewDir) < 0) draw = true;
    }
    if (draw) out.push(...positions.slice(i * 3, i * 3 + 3), ...positions.slice(j * 3, j * 3 + 3));
  }
  return out;
}

function el(name, attrs, parent) {
  const e = document.createElementNS(SVGNS, name);
  for (const k in attrs) e.setAttribute(k, attrs[k]);
  if (parent) parent.appendChild(e);
  return e;
}

window.renderScene = async function (spec) {
  const W = spec.width || 960, H = spec.height || 640;
  const stage = document.getElementById('stage');
  stage.innerHTML = '';
  stage.style.width = W + 'px';
  stage.style.height = H + 'px';

  const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(window.devicePixelRatio);
  renderer.setSize(W, H);
  renderer.setClearColor(0xffffff, 1);
  stage.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  const dir = V(spec.view?.dir || [1, 0.8, 1.15]).normalize();
  const up = V(spec.view?.up || [0, 1, 0]);

  // Gather points to frame: all vertices plus annotation anchor points.
  const pts = [];
  for (const b of spec.bodies) for (let i = 0; i < b.positions.length; i += 3) pts.push(new THREE.Vector3(b.positions[i], b.positions[i + 1], b.positions[i + 2]));
  for (const a of spec.annotations || []) for (const p of anchorPoints(a)) pts.push(p);
  const center = new THREE.Box3().setFromPoints(pts).getCenter(new THREE.Vector3());
  const radius = Math.max(...pts.map((p) => p.distanceTo(center))) || 1;

  const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, radius * 20);
  cam.up.copy(up);
  cam.position.copy(center).addScaledVector(dir, radius * 5);
  cam.lookAt(center);
  cam.updateMatrixWorld();
  // Fit in camera space, keep the aspect ratio, leave a pixel margin for text.
  const inv = cam.matrixWorldInverse;
  let minx = Infinity, maxx = -Infinity, miny = Infinity, maxy = -Infinity;
  for (const p of pts) {
    const q = p.clone().applyMatrix4(inv);
    minx = Math.min(minx, q.x); maxx = Math.max(maxx, q.x);
    miny = Math.min(miny, q.y); maxy = Math.max(maxy, q.y);
  }
  const margin = spec.margin ?? 70;
  const sx = (maxx - minx) / (W - 2 * margin), sy = (maxy - miny) / (H - 2 * margin);
  const s = Math.max(sx, sy);
  const cx = (minx + maxx) / 2, cy = (miny + maxy) / 2;
  cam.left = cx - (W / 2) * s; cam.right = cx + (W / 2) * s;
  cam.top = cy + (H / 2) * s; cam.bottom = cy - (H / 2) * s;
  cam.updateProjectionMatrix();

  scene.add(new THREE.HemisphereLight(0xffffff, 0x8a8f99, 1.6));
  const key = new THREE.DirectionalLight(0xffffff, 1.5);
  key.position.copy(dir).add(new THREE.Vector3(-0.35, 0.9, 0.2)).multiplyScalar(100);
  scene.add(key);

  const lineRes = new THREE.Vector2(W * window.devicePixelRatio, H * window.devicePixelRatio);
  for (const b of spec.bodies) {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(b.positions, 3));
    geo.setIndex(b.indices);
    const mat = new THREE.MeshStandardMaterial({
      color: new THREE.Color(b.color || '#b9c3cf'), roughness: 0.55, metalness: 0.05, flatShading: true,
      polygonOffset: true, polygonOffsetFactor: 1.5, polygonOffsetUnits: 2,
      transparent: !!b.opacity, opacity: b.opacity ?? 1,
    });
    scene.add(new THREE.Mesh(geo, mat));
    const lines = edgesFor(b.positions, b.indices, dir, 28);
    const lg = new LineSegmentsGeometry().setPositions(lines);
    const lm = new LineMaterial({ color: 0x111111, linewidth: 1.4 * window.devicePixelRatio, resolution: lineRes });
    scene.add(new LineSegments2(lg, lm));
  }
  renderer.render(scene, cam);

  // ---- annotation layer ----
  const svg = el('svg', { width: W, height: H, viewBox: `0 0 ${W} ${H}` }, stage);
  const defs = el('defs', {}, svg);
  const mk = el('marker', { id: 'arr', viewBox: '0 0 10 10', refX: 10, refY: 5, markerWidth: 9, markerHeight: 9, orient: 'auto-start-reverse', markerUnits: 'userSpaceOnUse' }, defs);
  el('path', { d: 'M0,1.8 L10,5 L0,8.2 z', fill: spec.dimColor || '#0a0a0a' }, mk);
  const proj = (p) => {
    const v = (p.isVector3 ? p.clone() : V(p)).project(cam);
    return [(v.x + 1) * W / 2, (1 - v.y) * H / 2];
  };
  const col = spec.dimColor || '#0a0a0a';
  const line = (a, b, extra = {}) => el('line', { x1: a[0], y1: a[1], x2: b[0], y2: b[1], stroke: col, 'stroke-width': 1.1, ...extra }, svg);
  const text = (x, y, str, anchor = 'middle', extra = {}) => {
    const lines = String(str).split('\n');
    const t = el('text', {
      x, y: y - ((lines.length - 1) * 17) / 2, 'text-anchor': anchor, 'dominant-baseline': 'central',
      'font-size': extra.size || 16, 'font-weight': extra.bold ? 700 : 400, fill: extra.fill || col,
      stroke: '#fff', 'stroke-width': 4, 'paint-order': 'stroke', 'stroke-linejoin': 'round',
    }, svg);
    lines.forEach((ln, i) => { const ts = el('tspan', { x, dy: i === 0 ? 0 : 17 }, t); ts.textContent = ln; });
    return t;
  };
  const unit = (a, b) => { const dx = b[0] - a[0], dy = b[1] - a[1], l = Math.hypot(dx, dy) || 1; return [dx / l, dy / l]; };

  for (const a of spec.annotations || []) {
    if (a.t === 'dim') {
      const A = V(a.a), B = V(a.b), O = V(a.off);
      const e1 = A.clone().add(O), e2 = B.clone().add(O);
      const pa = proj(A), pb = proj(B), p1 = proj(e1), p2 = proj(e2);
      const ua = unit(pa, p1), ub = unit(pb, p2);
      line([pa[0] + ua[0] * 4, pa[1] + ua[1] * 4], [p1[0] + ua[0] * 7, p1[1] + ua[1] * 7]);
      line([pb[0] + ub[0] * 4, pb[1] + ub[1] * 4], [p2[0] + ub[0] * 7, p2[1] + ub[1] * 7]);
      const len = Math.hypot(p2[0] - p1[0], p2[1] - p1[1]);
      if (len > 34) {
        line(p1, p2, { 'marker-start': 'url(#arr)', 'marker-end': 'url(#arr)' });
      } else {
        const u = unit(p1, p2);
        line([p1[0] - u[0] * 22, p1[1] - u[1] * 22], p1, { 'marker-end': 'url(#arr)' });
        line([p2[0] + u[0] * 22, p2[1] + u[1] * 22], p2, { 'marker-end': 'url(#arr)' });
        line(p1, p2);
      }
      const mid = [(p1[0] + p2[0]) / 2, (p1[1] + p2[1]) / 2];
      const side = unit(proj(A.clone().add(B).multiplyScalar(0.5)), mid);
      const off = a.textOff ?? 13;
      text(mid[0] + side[0] * off + (a.dx || 0), mid[1] + side[1] * off + (a.dy || 0), a.text, 'middle', { bold: a.bold });
    } else if (a.t === 'leader') {
      const p = proj(a.at);
      const q = a.to ? proj(a.to) : [p[0] + (a.dx ?? 60), p[1] + (a.dy ?? -50)];
      line(q, p, { 'marker-end': 'url(#arr)' });
      const right = q[0] >= p[0];
      const sh = [q[0] + (right ? 14 : -14), q[1]];
      line(q, sh);
      text(sh[0] + (right ? 5 : -5), sh[1], a.text, right ? 'start' : 'end', { bold: a.bold });
    } else if (a.t === 'angle') {
      const C = V(a.c), U = V(a.u).normalize(), W3 = V(a.v).normalize();
      const n = new THREE.Vector3().crossVectors(U, W3).normalize();
      const ang = U.angleTo(W3);
      const ptsA = [];
      for (let i = 0; i <= 48; i++) {
        const q = U.clone().applyAxisAngle(n, (ang * i) / 48).multiplyScalar(a.r).add(C);
        ptsA.push(proj(q));
      }
      el('path', { d: 'M' + ptsA.map((p) => p.join(',')).join(' L'), fill: 'none', stroke: col, 'stroke-width': 1.1, 'marker-start': 'url(#arr)', 'marker-end': 'url(#arr)' }, svg);
      if (a.ext !== false) {
        line(proj(C), proj(C.clone().addScaledVector(U, a.r * 1.15)), { 'stroke-dasharray': '6 3' });
        line(proj(C), proj(C.clone().addScaledVector(W3, a.r * 1.15)), { 'stroke-dasharray': '6 3' });
      }
      const mid = U.clone().applyAxisAngle(n, ang / 2).multiplyScalar(a.r * 1.0 + (a.textR || 0)).add(C);
      const pm = proj(mid), pc = proj(C), u = unit(pc, pm);
      text(pm[0] + u[0] * 16 + (a.dx || 0), pm[1] + u[1] * 16 + (a.dy || 0), a.text, 'middle', { bold: a.bold });
    } else if (a.t === 'label') {
      const p = proj(a.at);
      text(p[0] + (a.dx || 0), p[1] + (a.dy || 0), a.text, a.anchor || 'middle', { bold: a.bold, size: a.size, fill: a.fill });
    } else if (a.t === 'line') {
      el('line', { ...Object.fromEntries(['x1', 'y1'].map((k, i) => [k, proj(a.a)[i]])), ...Object.fromEntries(['x2', 'y2'].map((k, i) => [k, proj(a.b)[i]])), stroke: a.color || col, 'stroke-width': a.w || 1, 'stroke-dasharray': a.dash || '' }, svg);
    } else if (a.t === 'triad') {
      const O = V(a.at), L = a.len || 20, po = proj(O);
      const axes = [[[1, 0, 0], '#d22', 'X'], [[0, 1, 0], '#1a9a2a', 'Y'], [[0, 0, 1], '#1f4fd6', 'Z']];
      for (const [d, c, n] of axes) {
        const pe = proj(O.clone().addScaledVector(V(d), L));
        el('line', { x1: po[0], y1: po[1], x2: pe[0], y2: pe[1], stroke: c, 'stroke-width': 2.4 }, svg);
        const u = unit(po, pe);
        text(pe[0] + u[0] * 9, pe[1] + u[1] * 9, n, 'middle', { fill: c, bold: true, size: 14 });
      }
      el('circle', { cx: po[0], cy: po[1], r: 3, fill: '#111' }, svg);
      if (a.label) text(po[0] + (a.dx ?? 10), po[1] + (a.dy ?? 22), a.label, 'start', { size: 14 });
    }
  }
  await new Promise((r) => requestAnimationFrame(() => r()));
  // Report whether any label spills off the image so the caller can retry with a wider margin.
  for (const t of svg.querySelectorAll('text')) {
    const bb = t.getBBox();
    if (bb.x < 2 || bb.y < 2 || bb.x + bb.width > W - 2 || bb.y + bb.height > H - 2) return false;
  }
  return true;
};

function anchorPoints(a) {
  if (a.t === 'dim') return [V(a.a), V(a.b), V(a.a).add(V(a.off)), V(a.b).add(V(a.off))];
  if (a.t === 'leader') return [V(a.at), ...(a.to ? [V(a.to)] : [])];
  if (a.t === 'angle') return [V(a.c)];
  if (a.t === 'label' || a.t === 'triad') return [V(a.at)];
  if (a.t === 'line') return [V(a.a), V(a.b)];
  return [];
}

window.rendererReady = true;
