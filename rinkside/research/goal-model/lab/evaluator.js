// LightGBM tree evaluator for the exported SGP model (shared by the page and the node test).
function sgpPrepare(model) {
  model.fidx = Object.fromEntries(model.features.map((f, i) => [f, i]));
  return model;
}
function encodeRow(model, feats) {   // feature dict -> numeric vector (categoricals -> category codes, missing -> NaN)
  return model.features.map((f) => {
    const v = feats[f];
    if (v === null || v === undefined || v === '') {
      if (model.cats[f] && v === '' && model.cats[f].includes('')) return model.cats[f].indexOf('');
      return NaN;
    }
    if (model.cats[f]) { const i = model.cats[f].indexOf(String(v)); return i < 0 ? NaN : i; }
    return +v;
  });
}
// walk one tree; returns [leafValue, path of node ids, contributions per feature (Saabas)]
function walkTree(t, x, contrib) {
  const [F, T, DT, DL, MT, L, R, IV, IC, LV] = t;
  if (!F.length) return { v: LV[0], path: [] };
  let n = 0; const path = [0];
  for (;;) {
    const v = x[F[n]]; let left;
    if (DT[n] === 1) {   // categorical: listed category codes go left, anything else (incl. missing) right
      left = !Number.isNaN(v) && v >= 0 && T[n].includes(v);
    } else {
      let val = v;
      if (MT[n] === 2 && Number.isNaN(val)) left = DL[n] === 1;
      else if (MT[n] === 1 && (Number.isNaN(val) || val === 0)) left = DL[n] === 1;
      else { if (Number.isNaN(val)) val = 0; left = val <= T[n]; }
    }
    const next = left ? L[n] : R[n];
    const nextVal = next < 0 ? LV[-next - 1] : IV[next];
    if (contrib) contrib[F[n]] += nextVal - IV[n];
    if (next < 0) { path.push(next); return { v: LV[-next - 1], path, root: IV[0] }; }
    path.push(next); n = next;
  }
}
function sgpPredict(model, x, wantContrib) {
  const nf = model.features.length, contrib = wantContrib ? new Float64Array(nf) : null;
  let z = 0, bias = 0;
  for (const trees of model.seeds) {
    let zs = 0;
    for (const t of trees) { const r = walkTree(t, x, contrib); zs += r.v; if (wantContrib) bias += t[0].length ? t[7][0] : t[9][0]; }
    z += zs;
  }
  const k = model.seeds.length; z /= k;
  if (contrib) for (let i = 0; i < nf; i++) contrib[i] /= k;
  return { z, bias: bias / k, contrib };
}
if (typeof module !== 'undefined') module.exports = { sgpPrepare, encodeRow, sgpPredict, walkTree };
