// Validate generated exam structure, choices, image files and assembly downloads.
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { EXAMS } from './content/exams.mjs';

const site = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'site');
const context = { window: {} };
vm.runInNewContext(fs.readFileSync(path.join(site, 'data/exams.js'), 'utf8'), context);
const allExams = context.window.CSWA_DATA.exams;
const exams = allExams.filter(e => !e.legacy && e.group !== 'drawing');
const drawing = allExams.filter(e => !e.legacy && e.group === 'drawing');
const lessons = context.window.CSWA_DATA.lessons || [];
const errors = [];
const imageModels = new Map();
if (exams.length !== 15 || EXAMS.filter(e => e.group !== 'drawing').length !== 15) errors.push('Expected 10 mocks and 5 concept exams');
if (allExams.filter(e => e.legacy).length !== 32) errors.push('Expected 32 saved-attempt versions');
if (new Set(allExams.map(e => e.id)).size !== allExams.length) errors.push('Exam ids must be unique across live and saved versions');
for (const e of exams) for (const old of e.lineage || []) if (!allExams.some(x => x.legacy && x.id === old)) errors.push(`${e.id}: lineage ${old} has no saved version`);
// Current CSWA layout: 3 drafting, Part 1 (2), Part 2 (2), Assembly 1 (2), Assembly 2 (2), Part 3 (3).
const LAYOUT = ['draft', 'draft', 'draft', 'part1', 'part1', 'part2', 'part2', 'asm1', 'asm1', 'asm2', 'asm2', 'part3', 'part3', 'part3'];
const SOURCE = Object.fromEntries(EXAMS.map(e => [e.id, e]));
for (const e of exams.slice(0, 10)) {
  if (e.questions.map(q => q.section).join() !== LAYOUT.join()) errors.push(`${e.id}: questions are not in the current CSWA layout`);
  const src = SOURCE[e.id].questions;
  if (src[7].assembly.fn === src[9].assembly.fn) errors.push(`${e.id}: Assembly 1 and Assembly 2 must be different assemblies`);
  // Part 3: one model throughout, and steps 2 and 3 must change the shape, not only dimensions
  const p3 = src.slice(11);
  if (new Set(p3.map(q => q.model.fn)).size !== 1) errors.push(`${e.id}: Part 3 must use one model`);
  // shape = which parameters exist (a new one is a new feature) plus every non-dimension value
  const shape = (q) => JSON.stringify([Object.keys(q.model.params).sort(), Object.entries(q.model.params).filter(([k]) => !/^[A-Z]$/.test(k)).sort()]);
  if (shape(p3[0]) === shape(p3[1]) || shape(p3[1]) === shape(p3[2])) errors.push(`${e.id}: Part 3 steps must change the part's shape`);
}
if (exams.slice(0, 10).flatMap(e => e.questions).filter(q => /^asm[12]$/.test(q.section) && q.parts).length !== 40) {
  errors.push('Expected an assembly download in all 40 assembly questions');
}
if (exams.slice(7, 10).some(e => e.questions.some(q => q.prompt.includes('Hint: if none of the options')))) {
  errors.push('Hardest exams should not show multiple-choice hints');
}
if (exams[8].questions[4].type !== 'num' || exams[9].questions[4].type !== 'num') {
  errors.push('The two hardest exams should require a numeric mass answer');
}
for (const old of allExams.filter(e => e.legacy)) {
  for (const q of old.questions) {
    for (const image of q.images) if (!fs.existsSync(path.join(site, image.src))) errors.push(`${q.id}: missing historical image ${image.src}`);
    if (q.parts && !fs.existsSync(path.join(site, q.parts))) errors.push(`${q.id}: missing historical archive ${q.parts}`);
    if (/^asm/.test(q.section) && !q.parts) errors.push(`${q.id}: missing historical assembly download`);
  }
}
for (const [index, exam] of exams.entries()) {
  if (index < 10 && (exam.questions.length !== 14 || exam.total !== 240 || exam.passScore !== 168)) {
    errors.push(`${exam.id}: unexpected mock exam format`);
  }
  if (index >= 10 && exam.questions.some(q => q.type !== 'mc' || q.section !== 'concept')) {
    errors.push(`${exam.id}: expected text-only concept questions`);
  }
  if (exam.difficultyRank !== (index < 10 ? index + 1 : index - 9)) errors.push(`${exam.id}: difficulty order`);
  const ids = new Set();
  for (const q of exam.questions) {
    if (ids.has(q.id)) errors.push(`${exam.id}: duplicate ${q.id}`);
    ids.add(q.id);
    if (q.type === 'mc' && (q.options.length !== 4 || new Set(q.options).size !== 4 || q.answer < 0 || q.answer > 3)) {
      errors.push(`${q.id}: invalid multiple choice`);
    }
    if (q.type === 'num' && (!Number.isFinite(q.answer.value) || q.answer.value <= 0)) errors.push(`${q.id}: invalid numeric answer`);
    for (const image of q.images) if (!fs.existsSync(path.join(site, image.src))) errors.push(`${q.id}: missing ${image.src}`);
    if (q.parts && !fs.existsSync(path.join(site, q.parts))) errors.push(`${q.id}: missing ${q.parts}`);
    if (/^asm/.test(q.section) && !q.parts) errors.push(`${q.id}: missing assembly archive`);
  }
  // Every model prompt must include its driving dimensions when the variable is specified.
  for (const q of EXAMS[index].questions.filter(q => (q.model || q.assembly) && q.prompt.includes('A ='))) {
    const match = q.prompt.match(/\bA\s*=\s*(\d+)/);
    if (!match || Number(match[1]) !== (q.model || q.assembly).params.A) errors.push(`${q.id}: A does not match model`);
  }
  for (const [i, q] of EXAMS[index].questions.entries()) {
    if (!q.model) continue;
    const src = exam.questions[i].images[0]?.src;
    const key = JSON.stringify(q.model);
    if (imageModels.has(src) && imageModels.get(src) !== key) errors.push(`${q.id}: image reused for different geometry`);
    imageModels.set(src, key);
  }
}
// Drawing Views drill and guide
if (drawing.length !== 1) errors.push('Expected one Drawing Views drill');
for (const ex of drawing) {
  if (ex.questions.length < 20) errors.push(`${ex.id}: drill should have at least 20 questions`);
  for (const q of ex.questions) {
    if (q.type !== 'mc' || q.options.length !== 4 || new Set(q.options).size !== 4 || q.answer < 0 || q.answer > 3) errors.push(`${q.id}: invalid drill question`);
    for (const image of q.images) if (!fs.existsSync(path.join(site, image.src))) errors.push(`${q.id}: missing ${image.src}`);
  }
}
if (lessons.length < 12) errors.push('Expected at least 12 Drawing Views lessons');
for (const l of lessons) {
  for (const im of [l.image, l.extra].filter(Boolean)) if (!fs.existsSync(path.join(site, im.src))) errors.push(`lesson ${l.id}: missing ${im.src}`);
  if (!l.recognise?.length || !l.make?.length || !l.confuse || !l.summary) errors.push(`lesson ${l.id}: incomplete`);
  const c = l.check;
  if (!c || c.options.length !== 4 || new Set(c.options).size !== 4 || c.answer < 0 || c.answer > 3) errors.push(`lesson ${l.id}: invalid quick check`);
}
if (errors.length) throw new Error(errors.join('\n'));
console.log(`Validated ${exams.length} exams, the Drawing Views drill (${drawing[0]?.questions.length} questions) and ${lessons.length} lessons, ${exams.reduce((n, e) => n + e.questions.length, 0)} questions and all image/download paths.`);
