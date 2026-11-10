const fs = require('fs'); const E = require('./evaluator.js');
const m = E.sgpPrepare(JSON.parse(fs.readFileSync('sgp_model.json')));
const tests = JSON.parse(fs.readFileSync('js_tests.json')); let worst = 0, w2 = 0;
for (const t of tests) {
  const r = E.sgpPredict(m, E.encodeRow(m, t.f), true);
  worst = Math.max(worst, Math.abs(r.z - t.z));
  const s = r.bias + r.contrib.reduce((a, b) => a + b, 0); w2 = Math.max(w2, Math.abs(s - r.z));
}
const pre = JSON.parse(fs.readFileSync('sgp_presets.json'));
for (const p of pre.presets) { const r = E.sgpPredict(m, E.encodeRow(m, p.features)); console.log(p.label, (1 / (1 + Math.exp(-(r.z + p.cal)))).toFixed(4), 'python', p.p.toFixed(4)); }
console.log('max |z_js - z_python| over', tests.length, 'shots:', worst.toExponential(2), ' contributions sum check:', w2.toExponential(2));
