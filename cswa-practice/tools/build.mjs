// Builds ../site/img/* and ../site/data/exams.js from the models and exam definitions.
//   cd cswa-practice/tools && npm install && node build.mjs [--no-images]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { massProps, meshData, apply } from './lib/geom.mjs';
import { MODELS } from './content/models.mjs';
import { EXAMS, MATERIALS, SECTIONS } from './content/exams.mjs';
import { DRAFTING } from './content/drafting.mjs';
import { startRenderer } from './lib/render.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.resolve(HERE, '..', 'site');
const IMG = path.join(OUT, 'img');
const NO_IMAGES = process.argv.includes('--no-images');
const ASSEMBLY_IMAGES_ONLY = process.argv.includes('--assembly-images');
fs.mkdirSync(IMG, { recursive: true });
fs.mkdirSync(path.join(OUT, 'data'), { recursive: true });

const r2 = (x) => Math.round(x * 100) / 100;
const dens = (mat) => {
  if (!(mat in MATERIALS)) throw new Error('unknown material ' + mat);
  return MATERIALS[mat] * 1e-6; // kg/m^3 -> g/mm^3
};

// ---- model evaluation (cached) --------------------------------------------------------
const cache = new Map();
function evalModel(fn, params = {}) {
  const key = fn + JSON.stringify(params);
  if (!cache.has(key)) {
    const res = MODELS[fn](params);
    if (res.body) res.props = massProps(res.body);
    cache.set(key, res);
  }
  return cache.get(key);
}

function partResult(fn, params, material) {
  const m = evalModel(fn, params);
  const d = dens(material);
  const o = m.origin || [0, 0, 0];
  return { volume: m.props.volume, mass: m.props.volume * d, com: m.props.com.map((x, i) => x - o[i]), density: d };
}

function asmResult(fn, params, materials) {
  const a = evalModel(fn, params);
  let mass = 0;
  const c = [0, 0, 0];
  const parts = [];
  for (const comp of a.components) {
    const m = evalModel(comp.model, comp.params || {});
    const mat = materials[comp.name];
    const pm = m.props.volume * dens(mat);
    const wc = apply(comp.T, m.props.com);
    mass += pm;
    for (let i = 0; i < 3; i++) c[i] += pm * wc[i];
    parts.push({ name: comp.name, material: mat, mass: pm });
  }
  const com = c.map((x) => x / mass);
  const o = a.origin || [0, 0, 0];
  const comOrigin = com.map((x, i) => x - o[i]);
  const cs = params.cs || null;
  return { mass, comOrigin, cs, rel: cs ? com.map((x, i) => x - cs[i]) : comOrigin, parts };
}

// ---- images ----------------------------------------------------------------------------
let renderer = null;
const rendered = new Map();
async function renderPart(fn, params, prefix) {
  const key = 'p:' + fn + JSON.stringify(params);
  if (rendered.has(key)) return rendered.get(key);
  const m = evalModel(fn, params);
  const mesh = meshData(m.body);
  const out = [];
  for (let i = 0; i < m.views.length; i++) {
    const view = m.views[i];
    const file = `${prefix}-${i + 1}.png`;
    if (!NO_IMAGES && !ASSEMBLY_IMAGES_ONLY) await renderer.render({ bodies: [mesh], annotations: view.ann, view }, path.join(IMG, file));
    out.push({ src: 'img/' + file, title: view.title });
  }
  rendered.set(key, out);
  return out;
}

function transformMesh(mesh, T) {
  const p = mesh.positions.slice();
  for (let i = 0; i < p.length; i += 3) {
    const q = apply(T, [p[i], p[i + 1], p[i + 2]]);
    p[i] = q[0]; p[i + 1] = q[1]; p[i + 2] = q[2];
  }
  return { positions: p, indices: mesh.indices };
}

async function renderAssembly(fn, params, prefix, examId) {
  const a = evalModel(fn, params);
  const bodies = a.components.map((c) => {
    const m = evalModel(c.model, c.params || {});
    return { ...transformMesh(meshData(m.body), c.T), color: c.color };
  });
  const out = [];
  for (let i = 0; i < a.views.length; i++) {
    const view = a.views[i];
    const file = `${prefix}-asm-${i + 1}.png`;
    if (!NO_IMAGES) await renderer.render({ bodies, annotations: view.ann, view }, path.join(IMG, file));
    out.push({ src: 'img/' + file, title: view.title });
  }
  const seen = new Set();
  for (const c of a.components) {
    const k = c.model + JSON.stringify(c.params || {});
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(...(await renderPart(c.model, c.params || {}, `${examId}-${c.model}`)));
  }
  return out;
}

// ---- options -----------------------------------------------------------------------------
function hash(s) { let h = 2166136261; for (const ch of s) h = Math.imul(h ^ ch.charCodeAt(0), 16777619); return h >>> 0; }
function shuffle(arr, seed) {
  const a = arr.slice();
  let s = seed || 1;
  for (let i = a.length - 1; i > 0; i--) {
    s = (Math.imul(s, 1103515245) + 12345) >>> 0;
    const j = s % (i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
const NAMES = {
  lBracket: 'L-Bracket', archBracket: 'Arch Bracket', flangedHub: 'Flanged Hub', hingeAssembly: 'Hinged Arm',
  guideBlock: 'Guide Block', shaftSupport: 'Shaft Support', housing: 'Housing', slideAssembly: 'Slide',
  angleSupport: 'Angle Support', steppedSpindle: 'Spindle', toolBlock: 'Tool Block', chainAssembly: 'Link Chain',
};
// Component part files for the assembly questions (made by tools/parts.py).
const PARTS = {
  hingeAssembly: 'parts/exam1-hinged-arm-parts.zip',
  slideAssembly: 'parts/exam2-slide-parts.zip',
  chainAssembly: 'parts/exam3-link-chain-parts.zip',
};
const f2 = (x) => (Math.abs(x) < 0.005 ? 0 : x).toFixed(2);
const fmtCom = (c) => `X = ${f2(c[0])} mm, Y = ${f2(c[1])} mm, Z = ${f2(c[2])} mm`;

function buildChoices(q, correct, makeAlt, distinct, fmt) {
  const opts = [correct];
  for (const d of q.distract) {
    let alt = makeAlt(d);
    let tries = 0;
    while (opts.some((o) => !distinct(o, alt)) && tries++ < 5) alt = makeAlt({ ...d, nudge: tries });
    opts.push(alt);
  }
  const order = shuffle([0, 1, 2, 3], hash(q.id));
  return { options: order.map((i) => fmt(opts[i])), answer: order.indexOf(0) };
}

// ---- main ----------------------------------------------------------------------------------
async function main() {
  if (!NO_IMAGES) renderer = await startRenderer();
  for (const [name, fn] of Object.entries(DRAFTING)) fs.writeFileSync(path.join(IMG, `draft-${name}.svg`), fn());

  const out = { generated: new Date().toISOString().slice(0, 10), sections: SECTIONS, exams: [] };
  for (const exam of EXAMS) {
    const steps = {};
    const qs = [];
    for (const [qi, q] of exam.questions.entries()) {
      const o = { id: q.id, n: qi + 1, section: q.section, points: q.points, prompt: q.prompt, explain: q.explain || '' };
      // Real-exam style heading: "Part (Name) – Step n" / "Assembly (Name) – Step n"
      const fn = q.model?.fn || q.assembly?.fn;
      if (fn) {
        steps[fn] = (steps[fn] || 0) + 1;
        o.heading = `${q.assembly ? 'Assembly' : 'Part'} (${NAMES[fn] || fn}) – Step ${steps[fn]}`;
      }
      if (exam.showHints !== false && (q.kind === 'mc-mass' || q.kind === 'mc-com')) o.prompt += '<p class="hint-line">Hint: if none of the options is within 1 % of your answer, re-check your model.</p>';
      let images = [];
      if (q.svg) images = [{ src: `img/draft-${q.svg}.svg`, title: 'Drawing' }];
      if (q.model) images = await renderPart(q.model.fn, q.model.params, q.id);
      else if (q.assembly) images = await renderAssembly(q.assembly.fn, q.assembly.params, q.id, exam.id);
      o.images = images;
      if (q.assembly && PARTS[q.assembly.fn]) o.parts = PARTS[q.assembly.fn];

      if (q.kind === 'mc') {
        // shuffle fixed options too, so the right letter isn't predictable
        const order = shuffle(q.options.map((_, i) => i), hash(q.id + 'opts'));
        o.type = 'mc'; o.options = order.map((i) => q.options[i]); o.answer = order.indexOf(q.answer);
      } else if (q.model) {
        const res = partResult(q.model.fn, q.model.params, q.material);
        const calc = `Volume ${res.volume.toFixed(2)} mm³ × ${res.density.toFixed(5)} g/mm³ = <b>${r2(res.mass).toFixed(2)} g</b>.`;
        if (q.kind === 'num') {
          o.type = 'num'; o.unit = 'g'; o.answer = { value: r2(res.mass), tol: 0.01 };
          o.explain += `<p class="calc">${calc}</p>`;
        } else if (q.kind === 'mc-mass') {
          o.type = 'mc';
          const alt = (d) => {
            if (d.factor) return res.mass * (d.factor + (d.nudge || 0) * 0.013);
            if (d.params) return partResult(q.model.fn, d.params, q.material).mass * (1 + (d.nudge || 0) * 0.013);
            return res.mass;
          };
          Object.assign(o, buildChoices(q, res.mass, alt, (a, b) => Math.abs(a - b) / a > 0.02, (m) => `${m.toFixed(2)} g`));
          o.explain += `<p class="calc">${calc}</p>`;
        } else if (q.kind === 'mc-com') {
          o.type = 'mc';
          const alt = (d) => {
            let c = res.com.slice();
            if (d.params) c = partResult(q.model.fn, d.params, q.material).com.slice();
            if (d.shift) c = c.map((x, i) => x + d.shift[i]);
            if (d.swap) { const [i, j] = d.swap; [c[i], c[j]] = [c[j], c[i]]; }
            if (d.mirrorX) c[0] = -c[0];
            if (d.nudge) c = c.map((x, i) => x + (i === 1 ? 2.7 : -1.9) * d.nudge);
            return c;
          };
          Object.assign(o, buildChoices(q, res.com, alt, (a, b) => Math.max(...a.map((x, i) => Math.abs(x - b[i]))) > 1, fmtCom));
          o.explain += `<p class="calc">Centre of mass: ${fmtCom(res.com)} (part mass ${r2(res.mass).toFixed(2)} g).</p>`;
        }
      } else if (q.assembly) {
        const res = asmResult(q.assembly.fn, q.assembly.params, q.materials);
        const table = '<table class="calc"><tr><th>Component</th><th>Material</th><th>Mass (g)</th></tr>' +
          res.parts.map((p) => `<tr><td>${p.name}</td><td>${p.material}</td><td>${p.mass.toFixed(2)}</td></tr>`).join('') +
          `<tr><td colspan="2"><b>Total</b></td><td><b>${res.mass.toFixed(2)}</b></td></tr></table>`;
        if (q.kind === 'num') {
          o.type = 'num'; o.unit = 'g'; o.answer = { value: r2(res.mass), tol: 0.01 };
          o.explain += table;
        } else {
          o.type = 'mc';
          const alt = (d) => {
            let c = res.rel.slice();
            if (d.params) {
              const r = asmResult(q.assembly.fn, { ...d.params, cs: q.assembly.params.cs }, q.materials);
              c = r.rel.slice();
            }
            if (d.noCs) c = res.comOrigin.slice();
            if (d.negate) c = c.map((x) => -x);
            if (d.shift) c = c.map((x, i) => x + d.shift[i]);
            if (d.nudge) c = c.map((x, i) => x + (i === 0 ? 2.3 : -1.7) * d.nudge);
            return c;
          };
          Object.assign(o, buildChoices(q, res.rel, alt, (a, b) => Math.max(...a.map((x, i) => Math.abs(x - b[i]))) > 1, fmtCom));
          o.explain += `<p class="calc">Centre of mass${res.cs ? ' relative to Coordinate System1' : ''}: ${fmtCom(res.rel)}${res.cs ? `<br>(relative to the assembly origin: ${fmtCom(res.comOrigin)})` : ''}</p>` + table;
        }
      }
      qs.push(o);
      console.log(`${exam.id} Q${o.n} ${o.type}`, o.type === 'num' ? o.answer.value : o.options?.[o.answer]);
    }
    const total = qs.reduce((s, q) => s + q.points, 0);
    out.exams.push({
      id: exam.id, title: exam.title, blurb: exam.blurb,
      difficultyRank: exam.difficultyRank, difficultyLabel: exam.difficultyLabel,
      timeMinutes: exam.timeMinutes || 180,
      total,
      passScore: Math.ceil((total * (exam.passPercent || 70)) / 100),
      questions: qs,
    });
  }
  // Earlier exam versions stay available for resuming or reviewing saved attempts.
  out.exams.push(...JSON.parse(fs.readFileSync(path.join(HERE, 'content', 'legacy-exams.json'), 'utf8')));
  fs.writeFileSync(path.join(OUT, 'data', 'exams.js'), '// Generated by tools/build.mjs. Do not edit by hand.\nwindow.CSWA_DATA = ' + JSON.stringify(out, null, 1) + ';\n');
  if (renderer) await renderer.close();
  console.log('done');
}

await main();
