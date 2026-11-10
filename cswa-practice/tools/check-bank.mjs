// Validate generated exam structure, choices, image files and assembly downloads.
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { EXAMS } from './content/exams.mjs';

const site = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'site');
const context = { window: {} };
vm.runInNewContext(fs.readFileSync(path.join(site, 'data/exams.js'), 'utf8'), context);
const exams = context.window.CSWA_DATA.exams;
const errors = [];
const imageModels = new Map();
if (exams.length !== 15 || EXAMS.length !== 15) errors.push('Expected 10 mocks and 5 concept exams');
for (const [index, exam] of exams.entries()) {
  if (index < 10 && (exam.questions.length !== 14 || exam.total !== 240 || exam.passScore !== 168)) {
    errors.push(`${exam.id}: unexpected mock exam format`);
  }
  if (index >= 10 && exam.questions.some(q => q.type !== 'mc' || q.section !== 'concept')) {
    errors.push(`${exam.id}: expected text-only concept questions`);
  }
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
    if (q.section === 'asm' && !q.parts) errors.push(`${q.id}: missing assembly archive`);
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
if (errors.length) throw new Error(errors.join('\n'));
console.log(`Validated ${exams.length} exams, ${exams.reduce((n, e) => n + e.questions.length, 0)} questions and all image/download paths.`);
