# CSWA Practice Tester

A local practice app for the **Certified SOLIDWORKS Associate (CSWA – Mechanical Design)** exam.
It copies the exam-client workflow so test day feels familiar: a question list with answered and
marked status, a countdown timer, Previous / Next, Mark for review, a Summary screen and
End Examination. After you end, you get a pass/fail result with a score for each section and a
full answer review.

You build every part and assembly yourself in SOLIDWORKS, the same as on the real exam. The app
only gives you the drawings and checks your answers.

## Use it

**Online:** https://cswa.mattdicks.org (once the one-time setup below is done).
**Offline:** open `site/index.html` in a browser. It needs no install or server. Keep SOLIDWORKS open beside it.

| | |
|---|---|
| **Practice Exams 1–10** | 14 questions, 240 points, 180 minutes, pass mark 168 (70%): 3 drafting (5 pts), 2 basic part (15), 2 intermediate part (15), 3 advanced part (15), 4 assembly (30). Exams 4–10 recombine the original model families and vary part dimensions and assembly positions; they are not seven entirely new designs. |
| **Concepts Exams 1–5** | Five text-only multiple-choice exams covering sketch relations, features, mates, drawings, units and mass properties. |
| **Exam mode** | Timed. Answers are scored only when you click End Test (or time runs out). |
| **Practice mode** | Untimed. **Check answer** shows right/wrong, the correct value and the working (volume × density, or a mass table for assemblies). |

- Click a drawing to open the image viewer. Zoom with the mouse wheel or + / −, drag to pan, and use ◀ ▶ to switch views.
- **Assembly questions come with the parts**, like the real exam: **Download parts (zip)** includes standalone SOLIDWORKS 2025 `.SLDPRT` parts and exact STEP copies. Open the parts, apply the materials from the question, then insert the Base first, fixed at the origin. Its part origin is already on the assembly origin shown in the images. The native files contain imported solid geometry, rather than editable feature histories.
- Fill-in answers are grams, numbers only. Answers within **1 %** of the correct value score full points.
- Progress saves in the browser, so you can close the tab and resume. Past attempts are listed on the home screen with a Review button.
- Keyboard: PageUp / PageDown move between questions; Esc closes the viewer.

## How the answers are made, and checked

Each part is a parametric solid model in `tools/content/models.mjs`, built with
[manifold-3d](https://github.com/elalish/manifold). The build script measures every mass and
centre of mass straight from the geometry. Circles are polygons sized to the exact circle area,
so the volumes match a real CAD model. The same model is rendered to the dimensioned drawing
(three.js in headless Chromium), so the drawing and the answer key cannot disagree.

The assembly parts are also built a second time, independently, as exact B-rep solids in
CadQuery/OpenCascade (`tools/parts.py`); that is where the STEP files come from. Both models
agree on every part's volume to better than 0.00001 %. `tools/check_assemblies.py` places the
exact parts and recomputes each assembly's centre of mass; it agrees with the answer key to
within 0.005 mm.

Coordinates follow SOLIDWORKS: Y up, Front plane = XY, Top plane = XZ.

## Rebuild or add questions

```bash
cd cswa-practice/tools
npm install
npx playwright install chromium
node build.mjs              # renders site/img/*.png and writes site/data/exams.js
node build.mjs --no-images  # answers only, keeps the existing images
node check-bank.mjs         # validate exam structure and referenced files
python3 -m venv .venv && .venv/bin/pip install cadquery
.venv/bin/python parts.py            # exact STEP parts -> site/parts/*.zip (checks volumes)
.venv/bin/python check_assemblies.py # recomputes assembly answers with the exact parts
# On Windows, with pywin32 and SOLIDWORKS 2025 or 2026 running:
python solidworks_parts.py  # add verified native 2025 parts to the STEP archives
```

- `tools/content/models.mjs`: part and assembly models, with their dimensioned views
- `tools/content/exams.mjs`: question text, parameters, materials and multiple-choice distractors
- `tools/content/drafting.mjs`: the drawing-sheet SVGs for the drafting questions; `tools/content/concept-drills.mjs`: the new text-only questions
- `tools/lib/geom.mjs`: modelling helpers and mass properties; `tools/lib/render.mjs` and `tools/render/`: the image renderer
- `site/`: the deployed app (`index.html`, `app.css`, `app.js`, `data/`, `img/`, `parts/`)

## Hosting at cswa.mattdicks.org

GitHub Pages allows one site per repository, and Rinkside already uses this one
(hockey.mattdicks.org). So CSWA is served by Cloudflare, where mattdicks.org's DNS already
lives. It's a static-assets Worker (`wrangler.toml`), deployed by GitHub Actions
(`.github/workflows/cswa.yml`) on every push to `main` that changes `cswa-practice/site/`.
Cloudflare creates the `cswa` DNS record and HTTPS certificate itself.

One-time setup:

1. **Cloudflare → My Profile → API Tokens → Create Token → "Edit Cloudflare Workers" template.**
   Under Account Resources pick your account. Under Zone Resources pick `mattdicks.org`, and
   add one more permission row, **Zone · DNS · Edit**, so it can create the `cswa` record.
   Create the token and copy it.
2. **Cloudflare → Workers & Pages:** copy your **Account ID** from the right-hand sidebar.
3. **GitHub → repo Settings → Secrets and variables → Actions → New repository secret:**
   `CLOUDFLARE_API_TOKEN` = the token, `CLOUDFLARE_ACCOUNT_ID` = the account ID.
4. Merge this branch into `main`. The **CSWA** workflow deploys on the merge; later you can
   also start it from **Actions → CSWA → Run workflow**. https://cswa.mattdicks.org loads
   within a minute or two.

If the deploy says the hostname is taken, delete any existing `cswa` DNS record in
Cloudflare and run the workflow again. If the token lacks DNS rights, add the domain by hand:
**Workers & Pages → cswa-practice → Settings → Domains & Routes → Add → Custom domain →
`cswa.mattdicks.org`**.

## Difficulty

The exams were calibrated against the official SOLIDWORKS CSWA exam guide and sample test.
That calibration set the format (14 questions, 240 points, 180 minutes, 70% to pass, 1 % answer
tolerance), the terse question style ("Part (Name) – Step n", variables A/B/C, everything else
read from the drawing) and the feature mix. Basic and intermediate parts have about 6–9 features
each, including fillets, chamfers, counterbores, slots and revolves. Advanced parts build on
earlier steps. Assemblies have 5–7 components, with angles or distances you change between
questions. Exam 3's assembly uses angles measured between neighbouring links, the hardest mate
setup on the exam.

Multiple-choice distractors here are deliberately closer to the right answer than on the
official sample, so a careless model is less likely to match a wrong option by luck.

A good readiness check: finish an exam in Exam mode within the time and score 168 or more.

## Sources and scope

- [SOLIDWORKS CSWA certification page](https://www.solidworks.com/certifications/cswa-design-associate): current 3-hour length, 70% pass mark and topic list.
- [SOLIDWORKS CSWA practice-problem database](https://www.solidworks.com/solution/education/practice-problems?exam=cswa): additional modeling exercises, including exam-level multi-step problems.
- [SOLIDWORKS practice-exam walkthrough](https://www.solidworks.com/media/solidworks-cswa-practice-exam-walk-through): official walkthrough of the sample test.
- [Historical official exam sample](https://files.solidworks.com/education/EDU_CSWA_Sample_Exam_ENG.pdf): the 14-question/240-point breakdown used for these mock exams. It lists a 165-point threshold; this app uses the current certification page's 70% instead. Actual exam content and weighting may change.
- [3D Engineering practice questions](https://www.3dengr.com/cswa-practice-questions.html): an independent free set with worked solutions.
- [University of Alberta CSWA resources](https://sites.ualberta.ca/~dnobes/Teaching_Section/NOBES_CSWA.html): a collection of study notes, practice questions and an exam.

The app's exercises are original. Additional mocks reuse and recombine three assembly sets and nine part families with changed dimensions. Refer to the official database for more independent geometry and extra practice.

## Notes

- All questions and drawings are original practice material written in the CSWA format.
  They are not real exam questions, and no official or textbook material is copied into this app.
- This is an independent study tool. It is not affiliated with Dassault Systèmes or the company
  that makes the official exam client.
