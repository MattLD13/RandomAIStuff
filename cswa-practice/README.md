# CSWA Practice Tester

A local practice app for the **Certified SOLIDWORKS Associate (CSWA – Mechanical Design)** exam.
It copies the exam-client workflow so test day feels familiar: a question list with answered and
marked status, a countdown timer, Previous / Next, Mark for review, a Summary screen and
End Examination. After you end, you get a pass/fail result with a score for each section and a
full answer review.

You build every part and assembly yourself in SOLIDWORKS, the same as on the real exam. The app
only gives you the drawings and checks your answers.

## Use it

Open `index.html` in a browser; no install or server is needed. Keep SOLIDWORKS open beside it.

| | |
|---|---|
| **Practice Exams 1–3** | 14 questions, 240 points, 180 minutes, pass mark 165: 3 drafting (5 pts), 2 basic part (15), 2 intermediate part (15), 3 advanced part (15), 4 assembly (30). Exams 1–2 aim at real-exam difficulty; Exam 3 is a little harder (angled hole, revolve with groove, three-link chain with relative angles). |
| **Concepts Drill** | 16 quick multiple-choice questions on sketch relations, features, mates and drawing views. |
| **Exam mode** | Timed. Answers are scored only when you end the exam (or time runs out). |
| **Practice mode** | Untimed. **Check answer** shows right/wrong, the correct value and the working (volume × density, or a mass table for assemblies). |

- Click a drawing to open the image viewer. Zoom with the mouse wheel or + / −, drag to pan, and use ◀ ▶ to switch views.
- Fill-in answers are grams, numbers only. Answers within **1 %** of the correct value score full points.
- Progress saves in the browser, so you can close the tab and resume. Past attempts are listed on the home screen with a Review button.
- Keyboard: PageUp / PageDown move between questions; Esc closes the viewer.

## How the answers are made

Each part is a parametric solid model in `tools/content/models.mjs`, built with
[manifold-3d](https://github.com/elalish/manifold). The build script measures every mass and
centre of mass straight from the geometry. Circles are polygons sized to the exact circle area,
so the volumes match a real CAD model. The same model is rendered to the dimensioned drawing
(three.js in headless Chromium), so the drawing and the answer key cannot disagree.

Coordinates follow SOLIDWORKS: Y up, Front plane = XY, Top plane = XZ.

## Rebuild or add questions

```bash
cd cswa-practice/tools
npm install
node build.mjs            # renders img/*.png and writes data/exams.js
node build.mjs --no-images  # answers only, keeps the existing images
```

- `tools/content/models.mjs`: part and assembly models, with their dimensioned views
- `tools/content/exams.mjs`: question text, parameters, materials and multiple-choice distractors
- `tools/content/drafting.mjs`: the drawing-sheet SVGs for the drafting questions
- `tools/lib/geom.mjs`: modelling helpers and mass properties; `tools/lib/render.mjs` and `tools/render/`: the image renderer

To add a question, add a model function (or reuse one with new parameters), add an entry in
`exams.mjs`, and run the build.

## Difficulty

The exams were calibrated against the official SOLIDWORKS CSWA exam guide and sample test.
That calibration set the format (14 questions, 240 points, 180 minutes, 165 to pass, 1 % answer
tolerance), the terse question style ("Part (Name) – Step n", variables A/B/C, everything else
read from the drawing) and the feature mix. Basic and intermediate parts have about 6–9 features
each, including fillets, chamfers, counterbores, slots and revolves. Advanced parts build on
earlier steps. Assemblies have 5–7 components, with angles or distances you change between
questions. Exam 3's assembly uses angles measured between neighbouring links, the hardest mate
setup on the exam.

Multiple-choice distractors here are deliberately closer to the right answer than on the
official sample, so a careless model is less likely to match a wrong option by luck.

A good readiness check: finish an exam in Exam mode within the time and score 165 or more.

## Notes

- All questions and drawings are original practice material written in the CSWA format.
  They are not real exam questions, and no official or textbook material is copied into this app.
- This is an independent study tool. It is not affiliated with Dassault Systèmes or the company
  that makes the official exam client.
