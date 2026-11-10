// Looks for ways to get a question right without doing the work, and for broken questions.
// Exits non-zero if any check fails. Run after build.mjs.
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const site = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'site');
const ctx = { window: {} };
vm.runInNewContext(fs.readFileSync(path.join(site, 'data/exams.js'), 'utf8'), ctx);
const exams = ctx.window.CSWA_DATA.exams.filter((e) => !e.legacy);
const VERBOSE = process.argv.includes('-v');
const nums = (s) => (s.match(/-?\d+(?:\.\d+)?/g) || []).map(Number);
const issues = {};
const add = (k, msg) => (issues[k] ||= []).push(msg);
const ranks = [];
let comQs = 0, massQs = 0, textQs = 0, centroidHits = 0;
const longestHits = [];

for (const ex of exams) {
  for (const [i, q] of ex.questions.entries()) {
    const tag = `${ex.id} Q${q.n}`;
    if (q.type !== 'mc') continue;
    const vals = q.options.map(nums);
    const isCom = q.options.every((o) => /^X = /.test(o));
    const isMass = q.options.every((o) => / g$/.test(o));
    if (isCom) {
      comQs++;
      // 1. agreement leak: the option sharing the most coordinates with the others
      const score = vals.map((v, a) => vals.reduce((s, w, b) => s + (a === b ? 0 : v.filter((x, k) => Math.abs(x - w[k]) < 0.005).length), 0));
      const max = Math.max(...score);
      if (score.filter((s) => s === max).length === 1 && score[q.answer] === max) add('com-agreement', `${tag}: correct option is the unique "most shared coordinates" option ${JSON.stringify(score)}`);
      // per-coordinate: correct value is the unique mode
      for (let k = 0; k < 3; k++) {
        const col = vals.map((v) => v[k].toFixed(2));
        const counts = col.reduce((m, x) => ((m[x] = (m[x] || 0) + 1), m), {});
        const c = counts[col[q.answer]];
        if (c > 1 && c < 4 && Object.values(counts).filter((n) => n >= c).length === 1) add('com-mode', `${tag}: ${'XYZ'[k]} of the correct option is the unique repeated value`);
      }
      for (const [a, v] of vals.entries()) if (a !== q.answer && Math.max(...v.map((x, k) => Math.abs(x - vals[q.answer][k]))) < 1) add('too-close', `${tag}: option ${'ABCD'[a]} within 1 mm of the answer`);
      const mean = [0, 1, 2].map((k) => vals.reduce((s, v) => s + v[k], 0) / 4);
      const dist = vals.map((v) => Math.hypot(...v.map((x, k) => x - mean[k])));
      if (dist.indexOf(Math.min(...dist)) === q.answer) centroidHits++;
    } else if (isMass) {
      massQs++;
      const m = vals.map((v) => v[0]);
      const rank = [...m].sort((a, b) => a - b).indexOf(m[q.answer]);
      ranks.push(rank);
      for (const [a, x] of m.entries()) if (a !== q.answer && Math.abs(x - m[q.answer]) / m[q.answer] < 0.02) add('too-close', `${tag}: option ${'ABCD'[a]} within 2 % of the answer`);
    } else {
      textQs++;
      const len = q.options.map((o) => o.length);
      const longest = Math.max(...len);
      if (q.section === 'concept' && len[q.answer] === longest) longestHits.push(ex.id);
      if (q.section === 'concept' && len[q.answer] === longest && len.filter((l) => l === longest).length === 1 && longest > 1.3 * Math.max(...len.filter((_, a) => a !== q.answer))) add('text-longest', `${tag}: correct answer is by far the longest option`);
    }
    if (new Set(q.options).size !== q.options.length) add('duplicate-options', tag);
  }
  // 2. modification steps must follow a question on the same model
  for (const [i, q] of ex.questions.entries()) {
    if (!/previous question|Modify the assembly|Use the same assembly|Use the part from/.test(q.prompt)) continue;
    const prev = ex.questions[i - 1];
    const name = (h) => (h || '').replace(/ – Step \d+$/, '');
    if (!prev || name(prev.heading) !== name(q.heading)) add('broken-step', `${ex.id} Q${q.n}: refers to the previous question, but Q${q.n - 1} is "${prev?.heading}"`);
  }
}
if (centroidHits > 0.4 * comQs) add('com-centroid', `correct option is the one nearest the average of the options in ${centroidHits} of ${comQs} questions`);
const conceptQs = exams.filter((e) => e.id.startsWith('drill')).reduce((n, e) => n + e.questions.length, 0);
if (longestHits.length > 0.4 * conceptQs) add('text-longest-rate', `correct concept answer is the longest option in ${longestHits.length} of ${conceptQs} questions`);
const hist = [0, 1, 2, 3].map((r) => ranks.filter((x) => x === r).length);
if (massQs && Math.max(...hist) > 0.5 * massQs) add('mass-rank', `correct mass sits at the same sorted position in ${Math.max(...hist)} of ${massQs} questions ${JSON.stringify(hist)}`);

console.log(`Checked ${exams.length} exams: ${comQs} centre-of-mass, ${massQs} mass and ${textQs} text multiple-choice questions.`);
console.log(`Correct-mass sorted position (smallest = 0): ${JSON.stringify(hist)}`);
console.log(`Correct centre of mass nearest the options' average: ${centroidHits} of ${comQs} (chance is about ${Math.round(comQs / 4)})`);
console.log(`Correct concept answer is the longest option: ${longestHits.length} of ${conceptQs} (chance is about ${Math.round(conceptQs / 4)})`);
for (const [k, list] of Object.entries(issues)) {
  console.log(`\n${k}: ${list.length}`);
  for (const m of VERBOSE ? list : list.slice(0, 6)) console.log('  ' + m);
}
if (Object.keys(issues).length) process.exit(1);
console.log('No answer leaks found.');
