// Exam definitions. All questions are original practice items written in the style of the
// CSWA exam: 14 questions, 240 points, five sections.
// Answers for model questions are not typed in here; build.mjs measures them from the models.

export const MATERIALS = {
  'AISI 1020': 7900,
  '6061 Alloy': 2700,
  '1060 Alloy': 2700,
  'Alloy Steel': 7700,
  'Plain Carbon Steel': 7800,
  'Cast Alloy Steel': 7300,
  Brass: 8500,
  Copper: 8900,
  ABS: 1020,
};

export const SECTIONS = {
  draft: 'Drafting Competencies',
  basic: 'Basic Part Creation and Modification',
  inter: 'Intermediate Part Creation and Modification',
  adv: 'Advanced Part Creation and Modification',
  asm: 'Assembly Creation and Modification',
};
const PTS = { draft: 5, basic: 15, inter: 15, adv: 15, asm: 30 };

const partNotes = (mat, extra = '') => `
<ul class="notes">
  <li>Unit system: MMGS (millimeter, gram, second)</li>
  <li>Decimal places: 2</li>
  <li>Part origin: ${extra || 'arbitrary'}</li>
  <li>All holes through all unless shown otherwise</li>
  <li>Material: <b>${mat}</b> — density = <b>${(MATERIALS[mat] / 1e6).toFixed(4)} g/mm³</b></li>
</ul>`;

const draft = (id, svg, prompt, options, answer, explain) => ({ id, section: 'draft', points: PTS.draft, kind: 'mc', svg, prompt, options, answer, explain });
const text = (id, prompt, options, answer, explain, section = 'draft') => ({ id, section, points: PTS[section] ?? 5, kind: 'mc', prompt, options, answer, explain });

// ======================================================================================
const exam1 = {
  id: 'exam1',
  title: 'CSWA Practice Exam 1',
  blurb: 'L-block, arched bracket, flanged hub and a hinged arm assembly.',
  questions: [
    draft('e1q1', 'section-view',
      '<p>View B was created from View A using one of the SOLIDWORKS drawing view tools. Which tool was used?</p>',
      ['Section View', 'Aligned Section View', 'Broken-out Section', 'Detail View'], 0,
      'A straight cutting line (A–A) drawn across the parent view, with the hatched result placed as a new view, is a <b>Section View</b>. An aligned section needs a bent cutting line; a broken-out section stays inside the original view; a detail view enlarges a circled region.'),
    draft('e1q2', 'detail-view',
      '<p>View B was created from View A. Which drawing view tool was used?</p>',
      ['Crop View', 'Detail View', 'Broken-out Section', 'Auxiliary View'], 1,
      'A circle drawn on the parent view, labelled with a letter, and shown again at a larger scale as "DETAIL C" is a <b>Detail View</b>. A crop view hides everything outside a closed profile but keeps the same scale and replaces the original view.'),
    draft('e1q3', 'auxiliary-view',
      '<p>View B shows the true shape of the inclined face of the part in View A. Which drawing view tool was used to create View B?</p>',
      ['Projected View', 'Auxiliary View', 'Section View', 'Alternate Position View'], 1,
      'An <b>Auxiliary View</b> is projected perpendicular to a selected reference edge (here the inclined edge), so an inclined face appears at its true size. A projected view can only go in the standard orthographic directions.'),
    {
      id: 'e1q4', section: 'basic', points: PTS.basic, kind: 'num',
      model: { fn: 'lBlock', params: { A: 90, B: 60 } }, material: 'AISI 1020',
      prompt: `<p>Build this part in SOLIDWORKS.</p>${partNotes('AISI 1020')}<p><b>A = 90 mm, B = 60 mm</b></p><p>What is the overall mass of the part (grams)?</p>`,
      explain: 'Extrude the L-shaped profile (base 20 thick, upright 20 thick) 50 mm deep, then cut the Ø16 hole through the upright and the two Ø12 holes through the base.',
    },
    {
      id: 'e1q5', section: 'basic', points: PTS.basic, kind: 'num',
      model: { fn: 'lBlock', params: { A: 110, B: 72 } }, material: 'AISI 1020', reuseImagesOf: 'e1q4',
      prompt: `<p>Modify the part from the previous question.</p>${partNotes('AISI 1020')}<p>Change the dimensions to <b>A = 110 mm, B = 72 mm</b>. All other dimensions stay the same (the Ø16 hole stays 18 mm below the top face).</p><p>What is the overall mass of the part (grams)?</p>`,
      explain: 'Only A and B change. Because the hole is dimensioned from the top face, it moves up with B.',
    },
    {
      id: 'e1q6', section: 'inter', points: PTS.inter, kind: 'mc-mass',
      model: { fn: 'archBracket', params: { A: 100, B: 24, C: 60 } }, material: '6061 Alloy',
      distract: [{ factor: 1.064 }, { factor: 0.938 }, { factor: 1.121 }],
      prompt: `<p>Build this part in SOLIDWORKS.</p>${partNotes('6061 Alloy')}<p><b>A = 100 mm, B = 24 mm, C = 60 mm</b></p><p>The arched wall and the rib are centred on the length of the base. The ØB hole is concentric with the R30 arc.</p><p>What is the overall mass of the part (grams)?</p>`,
      explain: 'Base plate A × 12 × C; wall 60 wide and 14 thick at the back edge with an R30 top; triangular rib 12 wide (30 × 25) on the front of the wall; two Ø10 holes 15 from the side and front edges; a 30 × 15 notch centred on the front edge.',
    },
    {
      id: 'e1q7', section: 'inter', points: PTS.inter, kind: 'num',
      model: { fn: 'archBracket', params: { A: 120, B: 30, C: 70 } }, material: '6061 Alloy', reuseImagesOf: 'e1q6',
      prompt: `<p>Modify the part from the previous question.</p>${partNotes('6061 Alloy')}<p>Change the dimensions to <b>A = 120 mm, B = 30 mm, C = 70 mm</b>. The wall, rib and notch stay centred on the length of the base.</p><p>What is the overall mass of the part (grams)?</p>`,
      explain: 'The holes and notch are dimensioned from the front edge, so they move with C.',
    },
    {
      id: 'e1q8', section: 'adv', points: PTS.adv, kind: 'num',
      model: { fn: 'flangedHub', params: { A: 120, B: 45 } }, material: 'Alloy Steel',
      prompt: `<p>Build this part in SOLIDWORKS.</p>${partNotes('Alloy Steel', 'centre of the bottom face of the flange')}<p><b>A = 120 mm, B = 45 mm</b></p><p>The flange is 15 mm thick. The hub is Ø70. The keyway (12 wide, bottom 26 mm from the axis) runs the full height. The six Ø10 holes are equally spaced on a Ø95 bolt circle, the first one 30° from the keyway direction.</p><p>What is the overall mass of the part (grams)?</p>`,
      explain: 'Revolve or extrude the flange and hub, cut the Ø40 bore and the keyway through all, add the Ø50 × 8 counterbore at the top, then make one Ø10 hole and a 6× circular pattern.',
    },
    {
      id: 'e1q9', section: 'adv', points: PTS.adv, kind: 'num',
      model: { fn: 'flangedHub', params: { A: 130, B: 55 } }, material: 'Alloy Steel', reuseImagesOf: 'e1q8',
      prompt: `<p>Modify the part from the previous question.</p>${partNotes('Alloy Steel', 'centre of the bottom face of the flange')}<p>Change the dimensions to <b>A = 130 mm, B = 55 mm</b>. The bolt circle stays Ø95 and the counterbore stays 8 mm deep from the top of the hub.</p><p>What is the overall mass of the part (grams)?</p>`,
      explain: 'Only the flange diameter and the hub height change.',
    },
    {
      id: 'e1q10', section: 'adv', points: PTS.adv, kind: 'mc-com',
      model: { fn: 'flangedHub', params: { A: 130, B: 55, D: 50 } }, material: 'Alloy Steel',
      distract: [{ params: { A: 130, B: 55, D: null } }, { mirrorX: true }, { shift: [0, 4.6, 0] }],
      prompt: `<p>Modify the part from the previous question (A = 130 mm, B = 55 mm).</p>${partNotes('Alloy Steel', 'centre of the bottom face of the flange')}<p>Cut a flat on the flange on the side opposite the keyway. The flat is parallel to the keyway sides at a distance <b>D = 50 mm</b> from the axis, through the full flange thickness.</p><p>What is the centre of mass of the part, relative to the part origin shown?</p>`,
      explain: 'The flat removes material on the −X side, so the centre of mass moves toward +X. The keyway removes material on the +X side, which pulls it the other way a little.',
    },
    {
      id: 'e1q11', section: 'asm', points: PTS.asm, kind: 'mc-com',
      assembly: { fn: 'hingeAssembly', params: { A: 30 } },
      materials: { Base: 'AISI 1020', Arm: '6061 Alloy', Pin: 'Alloy Steel' },
      distract: [{ params: { A: 60 } }, { shift: [0, 0, 6] }, { shift: [5.3, -3.9, 0] }],
      prompt: `<p>Build this assembly in SOLIDWORKS. It has one Base, one Arm and two Pins. Build the parts from the drawings shown.</p>
<ul class="notes"><li>Unit system: MMGS, decimal places: 2</li>
<li>Base: AISI 1020 (0.0079 g/mm³). Arm: 6061 Alloy (0.0027 g/mm³). Pin: Alloy Steel (0.0077 g/mm³).</li>
<li>The Base is fixed. The assembly origin is the bottom front-left corner of the Base, as shown.</li>
<li>The Arm sits between the two ears (its faces coincident with the inner ear faces). One hole of the Arm is concentric with the ear holes.</li>
<li>One Pin goes through the ears and the Arm; the other through the free end of the Arm. Both Pins are centred on the middle plane of the Base (Pin length 50 mm).</li>
<li>Angle <b>A</b> is between the top face of the Base and the centre line of the Arm.</li></ul>
<p><b>A = 30°</b>. What is the centre of mass of the assembly, relative to the assembly origin?</p>`,
      explain: 'Fix the Base, add a concentric and a coincident (or width) mate for the Arm, an angle mate between the Arm and the Base top face, and concentric + symmetric mates for each Pin. Then Evaluate → Mass Properties.',
    },
    {
      id: 'e1q12', section: 'asm', points: PTS.asm, kind: 'mc-com',
      assembly: { fn: 'hingeAssembly', params: { A: 50 } }, reuseImagesOf: 'e1q11',
      materials: { Base: 'AISI 1020', Arm: '6061 Alloy', Pin: 'Alloy Steel' },
      distract: [{ params: { A: 40 } }, { params: { A: 30 } }, { shift: [-4.4, 2.8, 0] }],
      prompt: '<p>Use the assembly from the previous question.</p><p>Change angle <b>A to 50°</b>. Everything else stays the same.</p><p>What is the centre of mass of the assembly, relative to the assembly origin?</p>',
      explain: 'Edit the angle mate value and rebuild before you open Mass Properties.',
    },
    {
      id: 'e1q13', section: 'asm', points: PTS.asm, kind: 'mc-com',
      assembly: { fn: 'hingeAssembly', params: { A: 40, cs: [120, 0, 60] } },
      materials: { Base: 'AISI 1020', Arm: '6061 Alloy', Pin: 'Alloy Steel' },
      distract: [{ noCs: true }, { negate: true }, { shift: [3.6, 0, -4.1] }],
      prompt: `<p>Use the same assembly with angle <b>A = 40°</b>.</p>
<p>Create a coordinate system, <i>Coordinate System1</i>, at the bottom front-right corner of the Base as shown. Its axes are parallel to the assembly axes and point the same way.</p>
<p>What is the centre of mass of the assembly, relative to <i>Coordinate System1</i>?</p>`,
      explain: 'Insert → Reference Geometry → Coordinate System, then in Mass Properties choose "Report coordinate values relative to: Coordinate System1". The values are the origin-based centre of mass minus (120, 0, 60).',
    },
    {
      id: 'e1q14', section: 'asm', points: PTS.asm, kind: 'num',
      assembly: { fn: 'hingeAssembly', params: { A: 40 } }, reuseImagesOf: 'e1q11',
      materials: { Base: 'AISI 1020', Arm: 'Brass', Pin: 'Alloy Steel' },
      prompt: '<p>Use the same assembly with angle <b>A = 40°</b>.</p><p>Change the material of the Arm to <b>Brass</b> (density 0.0085 g/mm³). The other parts keep their materials.</p><p>What is the total mass of the assembly (grams)?</p>',
      explain: 'Edit the Arm part, apply Brass, then read the assembly mass. The angle does not change the mass.',
    },
  ],
};

// ======================================================================================
const exam2 = {
  id: 'exam2',
  title: 'CSWA Practice Exam 2',
  blurb: 'Guide block, shaft support, shelled housing and a linear slide assembly.',
  questions: [
    draft('e2q1', 'broken-out-section',
      '<p>View B was created from View A. Which drawing view tool was used?</p>',
      ['Broken-out Section', 'Section View', 'Crop View', 'Detail View'], 0,
      'A <b>Broken-out Section</b> removes material to a given depth inside a closed spline drawn on an existing view, so the inside of that local region is shown hatched while the rest of the view is unchanged.'),
    draft('e2q2', 'projected-view',
      '<p>The drawing uses third-angle projection. View B was created from View A and placed directly above it. Which drawing view tool was used?</p>',
      ['Auxiliary View', 'Projected View', 'Detail View', 'Relative View'], 1,
      'A <b>Projected View</b> is folded from an existing view in one of the eight standard directions. In third-angle projection the top view goes above the front view.'),
    draft('e2q3', 'break-view',
      '<p>View B was created from View A. The overall dimension still reads the full length. Which drawing view tool was used?</p>',
      ['Crop View', 'Broken-out Section', 'Break (Broken) View', 'Detail View'], 2,
      'A <b>Break</b> (broken) view removes a portion of a long part between two break lines so it fits on the sheet. Dimensions across the break still show the real length.'),
    {
      id: 'e2q4', section: 'basic', points: PTS.basic, kind: 'mc-mass',
      model: { fn: 'guideBlock', params: { A: 100, B: 30 } }, material: '6061 Alloy',
      distract: [{ factor: 0.947 }, { factor: 1.058 }, { factor: 1.114 }],
      prompt: `<p>Build this part in SOLIDWORKS.</p>${partNotes('6061 Alloy')}<p><b>A = 100 mm, B = 30 mm</b></p><p>The channel (24 wide, 12 deep) runs the full length and is centred on the 60 mm width. Both top edges have 10 × 10 chamfers.</p><p>What is the overall mass of the part (grams)?</p>`,
      explain: 'Sketch the end profile (chamfers and channel included) on the Right plane and extrude it A long, then cut the two Ø10 holes.',
    },
    {
      id: 'e2q5', section: 'basic', points: PTS.basic, kind: 'num',
      model: { fn: 'guideBlock', params: { A: 140, B: 36 } }, material: '6061 Alloy', reuseImagesOf: 'e2q4',
      prompt: `<p>Modify the part from the previous question.</p>${partNotes('6061 Alloy')}<p>Change the dimensions to <b>A = 140 mm, B = 36 mm</b>. The channel depth (12) and the chamfers (10 × 10) do not change.</p><p>What is the overall mass of the part (grams)?</p>`,
      explain: 'Only the length and height change.',
    },
    {
      id: 'e2q6', section: 'inter', points: PTS.inter, kind: 'num',
      model: { fn: 'shaftSupport', params: { A: 110, B: 60, C: 20 } }, material: 'Cast Alloy Steel',
      prompt: `<p>Build this part in SOLIDWORKS.</p>${partNotes('Cast Alloy Steel')}<p><b>A = 110 mm, B = 60 mm, C = 20 mm</b></p><p>The boss (Ø40, 30 long) and the web (10 thick) are centred on the base in both directions. The web is 50 wide at the base and 24 wide at height B − 10. The slots are 10 wide with full rounded ends, 20 long overall, 10 from the ends of the base and centred on its width.</p><p>What is the overall mass of the part (grams)?</p>`,
      explain: 'Base plate, tapered web (extruded mid-plane 10), boss (mid-plane 30), then the ØC hole and the two straight slots.',
    },
    {
      id: 'e2q7', section: 'inter', points: PTS.inter, kind: 'mc-mass',
      model: { fn: 'shaftSupport', params: { A: 130, B: 70, C: 24 } }, material: 'Cast Alloy Steel', reuseImagesOf: 'e2q6',
      distract: [{ params: { A: 130, B: 60, C: 24 } }, { factor: 1.071 }, { factor: 0.912 }],
      prompt: `<p>Modify the part from the previous question.</p>${partNotes('Cast Alloy Steel')}<p>Change the dimensions to <b>A = 130 mm, B = 70 mm, C = 24 mm</b>. The web top stays 24 wide at height B − 10.</p><p>What is the overall mass of the part (grams)?</p>`,
      explain: 'A taller B makes the web taller; the boss and slots keep their size.',
    },
    {
      id: 'e2q8', section: 'adv', points: PTS.adv, kind: 'num',
      model: { fn: 'housing', params: { A: 120, B: 50 } }, material: '1060 Alloy',
      prompt: `<p>Build this part in SOLIDWORKS.</p>${partNotes('1060 Alloy', 'bottom front-left corner of the box, as shown')}<p><b>A = 120 mm, B = 50 mm</b></p><p>The box is shelled from the bottom: walls and top are 6 mm thick and the bottom is open. The two end tabs are 20 × 80 × 8. The Ø40 boss is 15 high on the top face; its Ø20 hole goes through into the cavity.</p><p>What is the overall mass of the part (grams)?</p>`,
      explain: 'Extrude the A × B × 80 box, shell it 6 mm removing the bottom face, add the tabs and the boss, then cut the Ø20 hole and the four Ø8 holes.',
    },
    {
      id: 'e2q9', section: 'adv', points: PTS.adv, kind: 'num',
      model: { fn: 'housing', params: { A: 150, B: 60 } }, material: '1060 Alloy', reuseImagesOf: 'e2q8',
      prompt: `<p>Modify the part from the previous question.</p>${partNotes('1060 Alloy', 'bottom front-left corner of the box')}<p>Change the dimensions to <b>A = 150 mm, B = 60 mm</b>. The boss stays 40 mm from the left and rear faces.</p><p>What is the overall mass of the part (grams)?</p>`,
      explain: 'The tab holes are dimensioned from the tab edges, so they move with A.',
    },
    {
      id: 'e2q10', section: 'adv', points: PTS.adv, kind: 'mc-com',
      model: { fn: 'housing', params: { A: 150, B: 60, window: true } }, material: '1060 Alloy',
      distract: [{ params: { A: 150, B: 60, window: false } }, { shift: [-6.2, 0, 0] }, { swap: [1, 2] }],
      prompt: `<p>Modify the part from the previous question (A = 150 mm, B = 60 mm).</p>${partNotes('1060 Alloy', 'bottom front-left corner of the box, as shown')}<p>Cut a 40 × 20 rectangular window through the front wall. Its right edge is 20 mm from the right face of the box and its bottom edge is 15 mm above the bottom.</p><p>What is the centre of mass of the part, relative to the origin shown?</p>`,
      explain: 'Removing material from the front wall moves the centre of mass toward the rear (−Z) and slightly to the left.',
    },
    {
      id: 'e2q11', section: 'asm', points: PTS.asm, kind: 'mc-com',
      assembly: { fn: 'slideAssembly', params: { A: 40 } },
      materials: { Rail: 'AISI 1020', 'End Cap': 'ABS', Slider: '6061 Alloy', Post: 'Alloy Steel' },
      distract: [{ params: { A: 80 } }, { shift: [0, 7.5, 0] }, { shift: [-5.8, 0, 3.2] }],
      prompt: `<p>Build this assembly in SOLIDWORKS. It has one Rail, two End Caps, one Slider and one Post. Build the parts from the drawings shown.</p>
<ul class="notes"><li>Unit system: MMGS, decimal places: 2</li>
<li>Rail: AISI 1020 (0.0079 g/mm³). End Cap: ABS (0.00102 g/mm³). Slider: 6061 Alloy (0.0027 g/mm³). Post: Alloy Steel (0.0077 g/mm³).</li>
<li>The Rail is fixed. The assembly origin is the bottom front-left corner of the Rail, as shown.</li>
<li>The End Caps cover both ends of the Rail, flush with its bottom, back and front faces.</li>
<li>The Slider sits on the floor of the channel between the walls.</li>
<li>The Post is concentric with the Slider hole and its bottom is flush with the bottom of the Slider.</li>
<li>Distance <b>A</b> is from the left end face of the Rail to the left face of the Slider.</li></ul>
<p><b>A = 40 mm</b>. What is the centre of mass of the assembly, relative to the assembly origin?</p>`,
      explain: 'Use a distance mate for A. Mass Properties of the whole assembly gives the answer.',
    },
    {
      id: 'e2q12', section: 'asm', points: PTS.asm, kind: 'mc-com',
      assembly: { fn: 'slideAssembly', params: { A: 120 } }, reuseImagesOf: 'e2q11',
      materials: { Rail: 'AISI 1020', 'End Cap': 'ABS', Slider: '6061 Alloy', Post: 'Alloy Steel' },
      distract: [{ params: { A: 140 } }, { params: { A: 100 } }, { shift: [0, -6.4, 2.5] }],
      prompt: '<p>Use the assembly from the previous question.</p><p>Change distance <b>A to 120 mm</b>.</p><p>What is the centre of mass of the assembly, relative to the assembly origin?</p>',
      explain: 'Only the X coordinate changes, because the Slider and Post move along X.',
    },
    {
      id: 'e2q13', section: 'asm', points: PTS.asm, kind: 'mc-com',
      assembly: { fn: 'slideAssembly', params: { A: 80, cs: [206, 25, 50] } },
      materials: { Rail: 'AISI 1020', 'End Cap': 'ABS', Slider: '6061 Alloy', Post: 'Alloy Steel' },
      distract: [{ noCs: true }, { negate: true }, { shift: [6, 0, 0] }],
      prompt: `<p>Use the same assembly with <b>A = 80 mm</b>.</p><p>Create <i>Coordinate System1</i> at the top front-right corner of the right End Cap, as shown. Its axes are parallel to the assembly axes and point the same way.</p><p>What is the centre of mass of the assembly, relative to <i>Coordinate System1</i>?</p>`,
      explain: 'The values are the origin-based centre of mass minus (206, 25, 50).',
    },
    {
      id: 'e2q14', section: 'asm', points: PTS.asm, kind: 'num',
      assembly: { fn: 'slideAssembly', params: { A: 80 } }, reuseImagesOf: 'e2q11',
      materials: { Rail: 'AISI 1020', 'End Cap': 'ABS', Slider: 'Brass', Post: 'Alloy Steel' },
      prompt: '<p>Use the same assembly with <b>A = 80 mm</b>.</p><p>Change the Slider material to <b>Brass</b> (0.0085 g/mm³).</p><p>What is the total mass of the assembly (grams)?</p>',
      explain: 'Only the Slider mass changes.',
    },
  ],
};

// ======================================================================================
const exam3 = {
  id: 'exam3',
  title: 'CSWA Practice Exam 3',
  blurb: 'Angle support, revolved spindle, tool block and a two-link arm assembly.',
  questions: [
    draft('e3q1', 'aligned-section',
      '<p>View B was created from View A. The cutting line A–A bends at the centre of the part. Which drawing view tool was used?</p>',
      ['Section View', 'Aligned Section View', 'Revolved Section', 'Broken-out Section'], 1,
      'An <b>Aligned Section</b> uses a cutting line made of two segments at an angle. The angled portion is rotated into the plane of the other so that features such as the hole at 330° show at their true distance from the centre.'),
    draft('e3q2', 'crop-view',
      '<p>View B was created from View A. Only the geometry inside a closed spline is kept, at the same scale. Which drawing view tool was used?</p>',
      ['Detail View', 'Crop View', 'Broken-out Section', 'Break View'], 1,
      'A <b>Crop View</b> hides everything outside a closed profile sketched on a view. Unlike a detail view it does not create a new, larger view.'),
    text('e3q3',
      '<p>A drawing uses <b>third-angle</b> projection. Where is the Right view placed relative to the Front view?</p>',
      ['To the right of the Front view', 'To the left of the Front view', 'Above the Front view', 'Below the Front view'], 0,
      'In third-angle projection (ANSI default) each view goes on the side it is seen from: the right view to the right, the top view above. In first-angle projection (ISO) they swap.'),
    {
      id: 'e3q4', section: 'basic', points: PTS.basic, kind: 'num',
      model: { fn: 'angleSupport', params: { A: 80, B: 70 } }, material: 'Plain Carbon Steel',
      prompt: `<p>Build this part in SOLIDWORKS.</p>${partNotes('Plain Carbon Steel')}<p><b>A = 80 mm, B = 70 mm</b></p><p>The part is 40 mm deep. Both Ø10 holes are centred on the 40 mm depth.</p><p>What is the overall mass of the part (grams)?</p>`,
      explain: 'Sketch the side profile on the Front plane: foot 15 thick, upright 30 wide at the foot tapering to 18 at the top. Extrude 40, then cut the two holes.',
    },
    {
      id: 'e3q5', section: 'basic', points: PTS.basic, kind: 'mc-mass',
      model: { fn: 'angleSupport', params: { A: 100, B: 60 } }, material: 'Plain Carbon Steel', reuseImagesOf: 'e3q4',
      distract: [{ params: { A: 100, B: 70 } }, { factor: 1.087 }, { factor: 0.958 }],
      prompt: `<p>Modify the part from the previous question.</p>${partNotes('Plain Carbon Steel')}<p>Change the dimensions to <b>A = 100 mm, B = 60 mm</b>. The horizontal hole stays 15 mm below the top face.</p><p>What is the overall mass of the part (grams)?</p>`,
      explain: 'The taper of the upright changes because its top width (18) and bottom width (30) stay the same while the height changes.',
    },
    {
      id: 'e3q6', section: 'inter', points: PTS.inter, kind: 'num',
      model: { fn: 'steppedSpindle', params: { A: 40, B: 60 } }, material: 'Brass',
      prompt: `<p>Build this part in SOLIDWORKS.</p>${partNotes('Brass')}<p><b>A = 40 mm, B = 60 mm</b></p><p>The Ø8 cross hole goes through the Ø40 section, 15 mm above the shoulder of the ØB flange. The flat on the Ø30 end is 20 long and 10 mm from the axis.</p><p>What is the overall mass of the part (grams)?</p>`,
      explain: 'Revolve the half profile (with the Ø16 bore) about the axis, then cut the cross hole and the flat.',
    },
    {
      id: 'e3q7', section: 'inter', points: PTS.inter, kind: 'num',
      model: { fn: 'steppedSpindle', params: { A: 55, B: 70 } }, material: 'Brass', reuseImagesOf: 'e3q6',
      prompt: `<p>Modify the part from the previous question.</p>${partNotes('Brass')}<p>Change the dimensions to <b>A = 55 mm, B = 70 mm</b>. The flat stays 20 long, measured from the top end.</p><p>What is the overall mass of the part (grams)?</p>`,
      explain: 'A is the length of the Ø30 section; B is the flange diameter.',
    },
    {
      id: 'e3q8', section: 'adv', points: PTS.adv, kind: 'num',
      model: { fn: 'toolBlock', params: { A: 120, B: 15, C: 25 } }, material: '6061 Alloy',
      prompt: `<p>Build this part in SOLIDWORKS.</p>${partNotes('6061 Alloy', 'bottom front-left corner, as shown')}<p><b>A = 120 mm, B = 15 mm, C = 25 mm</b></p><p>The block is 40 high and 60 deep. The pocket is 40 × 30 and B deep. The groove on the front face is 10 wide (10 to 20 mm above the bottom) and 8 deep. The Ø16 hole goes front to back, 30 from the left end and 10 above the bottom.</p><p>What is the overall mass of the part (grams)?</p>`,
      explain: 'Extrude the side profile with the sloped end, then cut the pocket, the two Ø12 holes, the groove and the Ø16 hole.',
    },
    {
      id: 'e3q9', section: 'adv', points: PTS.adv, kind: 'num',
      model: { fn: 'toolBlock', params: { A: 140, B: 20, C: 30 } }, material: '6061 Alloy', reuseImagesOf: 'e3q8',
      prompt: `<p>Modify the part from the previous question.</p>${partNotes('6061 Alloy', 'bottom front-left corner')}<p>Change the dimensions to <b>A = 140 mm, B = 20 mm, C = 30 mm</b>.</p><p>What is the overall mass of the part (grams)?</p>`,
      explain: 'The holes stay 75 mm from the left end.',
    },
    {
      id: 'e3q10', section: 'adv', points: PTS.adv, kind: 'mc-com',
      model: { fn: 'toolBlock', params: { A: 140, B: 20, C: 30 } }, material: '6061 Alloy', reuseImagesOf: 'e3q8',
      distract: [{ params: { A: 120, B: 15, C: 25 } }, { swap: [0, 2] }, { shift: [0, -3.4, 2.7] }],
      prompt: '<p>Use the part from the previous question (A = 140 mm, B = 20 mm, C = 30 mm).</p><p>What is the centre of mass of the part, relative to the origin shown (bottom front-left corner)?</p>',
      explain: 'Evaluate → Mass Properties. The origin is at the bottom front-left corner and the part extends toward −Z, so the Z value is negative.',
    },
    {
      id: 'e3q11', section: 'asm', points: PTS.asm, kind: 'mc-com',
      assembly: { fn: 'twoLinkAssembly', params: { A: 45, B: 0 } },
      materials: { Base: 'AISI 1020', Link: '6061 Alloy', Pin: 'Alloy Steel' },
      distract: [{ params: { A: 0, B: 45 } }, { shift: [0, 0, -5] }, { params: { A: 45, B: 45 } }],
      prompt: `<p>Build this assembly in SOLIDWORKS. It has one Base, two identical Links and two identical Pins. Build the parts from the drawings shown.</p>
<ul class="notes"><li>Unit system: MMGS, decimal places: 2</li>
<li>Base: AISI 1020 (0.0079 g/mm³). Link: 6061 Alloy (0.0027 g/mm³). Pin: Alloy Steel (0.0077 g/mm³).</li>
<li>The Base is fixed. The assembly origin is the bottom front-left corner of the Base, as shown.</li>
<li>Link 1 is against the front face of the tongue and concentric with its hole. Link 2 is against the front face of Link 1, concentric with its free hole.</li>
<li>Each Pin goes through the two holes it joins, with its head against the front face of the front part.</li>
<li>Angle <b>A</b> is between the Base top face and Link 1. Angle <b>B</b> is between the Base top face and Link 2 (both measured from horizontal).</li></ul>
<p><b>A = 45°, B = 0°</b>. What is the centre of mass of the assembly, relative to the assembly origin?</p>`,
      explain: 'Use angle mates between each Link and the top face of the Base (or a horizontal plane) so that B is measured from horizontal, not from Link 1.',
    },
    {
      id: 'e3q12', section: 'asm', points: PTS.asm, kind: 'mc-com',
      assembly: { fn: 'twoLinkAssembly', params: { A: 60, B: -30 } }, reuseImagesOf: 'e3q11',
      materials: { Base: 'AISI 1020', Link: '6061 Alloy', Pin: 'Alloy Steel' },
      distract: [{ params: { A: 60, B: 30 } }, { params: { A: 30, B: -30 } }, { shift: [4.9, -2.2, 0] }],
      prompt: '<p>Use the assembly from the previous question.</p><p>Change the angles to <b>A = 60°</b> and <b>B = −30°</b> (Link 2 points down and to the right, 30° below horizontal).</p><p>What is the centre of mass of the assembly, relative to the assembly origin?</p>',
      explain: 'A negative angle flips the mate (use Flip dimension) so Link 2 points below horizontal.',
    },
    {
      id: 'e3q13', section: 'asm', points: PTS.asm, kind: 'mc-com',
      assembly: { fn: 'twoLinkAssembly', params: { A: 30, B: 30, cs: [80, 0, 50] } },
      materials: { Base: 'AISI 1020', Link: '6061 Alloy', Pin: 'Alloy Steel' },
      distract: [{ noCs: true }, { negate: true }, { shift: [0, 5.5, -3] }],
      prompt: '<p>Use the same assembly with <b>A = 30°</b> and <b>B = 30°</b>.</p><p>Create <i>Coordinate System1</i> at the bottom front-right corner of the Base, as shown. Its axes are parallel to the assembly axes and point the same way.</p><p>What is the centre of mass of the assembly, relative to <i>Coordinate System1</i>?</p>',
      explain: 'The values are the origin-based centre of mass minus (80, 0, 50).',
    },
    {
      id: 'e3q14', section: 'asm', points: PTS.asm, kind: 'mc-com',
      assembly: { fn: 'twoLinkAssembly', params: { A: 120, B: 45 } },
      materials: { Base: 'AISI 1020', Link: '6061 Alloy', Pin: 'Alloy Steel' },
      distract: [{ params: { A: 60, B: 45 } }, { params: { A: 120, B: -45 } }, { shift: [-4.1, 0, 2.4] }],
      prompt: '<p>Use the same assembly. Change the angles to <b>A = 120°</b> and <b>B = 45°</b> (Link 1 leans back over the Base; Link 2 points up and to the right).</p><p>What is the centre of mass of the assembly, relative to the assembly origin?</p>',
      explain: 'Angles above 90° are measured from the +X direction of the Base top face, counter-clockwise when viewed from the front.',
    },
  ],
};

// ======================================================================================
const drill = {
  id: 'drill',
  title: 'Concepts Drill',
  blurb: '16 quick questions on sketching, features, mates and drawings. No models to build.',
  timeMinutes: 30,
  passPercent: 70,
  questions: [
    text('d1', '<p>A sketch line is shown in <b>black</b>. What is its status?</p>', ['Under defined', 'Fully defined', 'Over defined', 'Not solvable'], 1, 'Black = fully defined, blue = under defined, red/yellow = over defined or conflicting.'),
    text('d2', '<p>In the default colour scheme, which colour shows that a sketch entity is <b>over defined</b>?</p>', ['Blue', 'Black', 'Red', 'Green'], 2, 'Over-defined entities are shown in red (with dangling/conflicting items in yellow or brown).'),
    text('d3', '<p>Which sketch relation makes two circles share the same centre point, while still allowing different radii?</p>', ['Coradial', 'Concentric', 'Coincident', 'Equal'], 1, '<b>Concentric</b> shares the centre only. Coradial also forces equal radii.'),
    text('d4', '<p>Which feature turns a solid into a thin-walled part with a constant wall thickness, removing one or more selected faces?</p>', ['Rib', 'Shell', 'Thin Feature Extrude', 'Draft'], 1, '<b>Shell</b> hollows a solid with a uniform thickness; selected faces are removed to open it.'),
    text('d5', '<p>Which feature creates a solid by rotating a sketch profile about a centre line?</p>', ['Swept Boss/Base', 'Lofted Boss/Base', 'Revolved Boss/Base', 'Extruded Boss/Base'], 2, '<b>Revolved Boss/Base</b> spins a closed profile around an axis or centreline.'),
    text('d6', '<p>Where do you find the Mass Properties tool in a part or assembly?</p>', ['Features tab', 'Evaluate tab', 'Sketch tab', 'Insert → Reference Geometry'], 1, 'Evaluate → Mass Properties (also Tools → Evaluate → Mass Properties).'),
    text('d7', '<p>A material has a density of 7,800 kg/m³. What is this in g/mm³, the unit shown in MMGS?</p>', ['0.78 g/mm³', '0.078 g/mm³', '0.0078 g/mm³', '0.00078 g/mm³'], 2, '1 kg/m³ = 10⁻⁶ g/mm³, so 7800 kg/m³ = 0.0078 g/mm³.'),
    text('d8', '<p>Which tool creates a counterbored hole sized from a standard fastener (for example an M8 socket head cap screw)?</p>', ['Simple Hole', 'Extruded Cut', 'Hole Wizard', 'Revolved Cut'], 2, '<b>Hole Wizard</b> creates standard counterbore, countersink, tapped and other holes from fastener tables.'),
    text('d9', '<p>In an assembly, which standard mate keeps two cylindrical faces on the same axis?</p>', ['Coincident', 'Concentric', 'Tangent', 'Parallel'], 1, '<b>Concentric</b> places two cylindrical (or conical) faces on a common axis.'),
    text('d10', '<p>Which mate centres a part between two faces of another part, so it stays in the middle when sizes change?</p>', ['Width mate', 'Distance mate', 'Lock mate', 'Path mate'], 0, 'The <b>Width</b> mate (an advanced mate) centres a tab between two faces of a groove.'),
    text('d11', '<p>The exam asks for a centre of mass relative to a point that is not the origin. What is the most reliable method?</p>',
      ['Move the part origin with the Move/Copy Body tool', 'Create a coordinate system at the point and select it in Mass Properties', 'Subtract the coordinates by hand from the Measure tool', 'Change the document units'], 1,
      'Insert a <b>Coordinate System</b> at the point, then choose it under "Report coordinate values relative to" in Mass Properties.'),
    text('d12', '<p>Which feature bevels an edge using a distance and an angle (for example 2 × 45°)?</p>', ['Fillet', 'Chamfer', 'Draft', 'Dome'], 1, '<b>Chamfer</b> cuts an angled face along an edge; fillet rounds it.'),
    text('d13', '<p>Six holes are equally spaced around the axis of a flange. Which pattern is the best fit?</p>', ['Linear Pattern', 'Circular Pattern', 'Curve Driven Pattern', 'Mirror'], 1, '<b>Circular Pattern</b> repeats a feature around an axis with equal spacing.'),
    text('d14', '<p>By default, what happens to the first component you insert into a new assembly?</p>', ['It floats freely', 'It is fixed', 'It is hidden', 'It is suppressed'], 1, 'The first component is <b>fixed</b> at the assembly origin. Right-click → Float to release it.'),
    text('d15', '<p>Which drawing command adds the Front, Top and Right views of a model in one step?</p>', ['Model View', 'Standard 3 View', 'Projected View', 'Relative View'], 1, '<b>Standard 3 View</b> inserts three orthographic views aligned with each other.'),
    text('d16', '<p>Which feature adds a thin support from an open sketch line between two walls?</p>', ['Rib', 'Shell', 'Wrap', 'Dome'], 0, '<b>Rib</b> extrudes an open contour to a set thickness until it meets the existing geometry.'),
  ],
};

export const EXAMS = [exam1, exam2, exam3, drill];
