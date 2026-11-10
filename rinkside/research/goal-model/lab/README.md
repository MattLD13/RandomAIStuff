# SGP Shot Lab

Interactive page that runs the frozen SGP v2.1 model (all 5 seeds x 1,000 trees) in the browser: place a shot, change the situation, see the breakdown and every tree. Published at https://claude.ai/artifact/ExkjJKAogAsy8XPdsRd7dQ

- `sgp_model.json`: the frozen trees in a compact form (exported from `../frozen/sgp_s*.txt.gz`).
- `evaluator.js` / `test.js`: the tree evaluator and its check against Python on `js_tests.json` (400 real shots; max log-odds error 3e-9).
