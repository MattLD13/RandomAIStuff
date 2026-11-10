// Exam definitions. All questions are original practice items written in the style of the
// CSWA exam: 14 questions, 240 points, five sections. Exams 1–2 aim at real-exam difficulty;
// Exam 3 is a little harder. Prompts are deliberately terse: the drawings carry the geometry,
// and the working is only shown after answering (practice mode / review).
// Answers for model questions are not typed in here; build.mjs measures them from the models.
import { CONCEPT_DRILLS } from './concept-drills.mjs';

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
  concept: 'Concepts',
};
const PTS = { draft: 5, basic: 15, inter: 15, adv: 15, asm: 30 };
const g = (mat) => (MATERIALS[mat] / 1e6).toFixed(4);

const partNotes = (mat, origin = 'arbitrary') => `
<ul class="notes">
  <li>Unit system: MMGS (millimeter, gram, second)</li>
  <li>Decimal places: 2</li>
  <li>Part origin: ${origin}</li>
  <li>All holes through all unless shown otherwise</li>
  <li>Material: ${mat} — density = ${g(mat)} g/mm³</li>
</ul>`;
const build = (mat, vars, origin) => `<p>Build this part in SOLIDWORKS.</p>${partNotes(mat, origin)}<p><b>${vars}</b></p><p>What is the overall mass of the part (grams)?</p>`;
const modify = (mat, vars, extra = '', origin) => `<p>Modify the part from the previous question.</p>${partNotes(mat, origin)}<p><b>${vars}</b></p>${extra ? `<p>${extra}</p>` : ''}<p>Note: all other dimensions are the same as in the previous question.</p><p>What is the overall mass of the part (grams)?</p>`;
const asmNotes = (mats, extra) => `<ul class="notes"><li>Unit system: MMGS, decimal places: 2</li>${mats.map(([n, m]) => `<li>${n}: ${m} (${g(m)} g/mm³)</li>`).join('')}${extra.map((x) => `<li>${x}</li>`).join('')}</ul>`;

const draft = (id, svg, prompt, options, answer, explain) => ({ id, section: 'draft', points: PTS.draft, kind: 'mc', svg, prompt, options, answer, explain });
const text = (id, prompt, options, answer, explain, section = 'draft') => ({ id, section, points: PTS[section] ?? 5, kind: 'mc', prompt, options, answer, explain });

// ======================================================================================
const E1_MATS = [['Base', 'AISI 1020'], ['Arm', '6061 Alloy'], ['Pin (2X)', 'Alloy Steel'], ['Hanger', 'Cast Alloy Steel']];
const E1_MAP = { Base: 'AISI 1020', Arm: '6061 Alloy', Pin: 'Alloy Steel', Hanger: 'Cast Alloy Steel' };
const exam1 = {
  id: 'exam1',
  title: 'CSWA Practice Exam 1',
  blurb: 'Real-exam level. L-bracket, arched bracket, flanged hub and a hinged arm assembly.',
  questions: [
    draft('e1q1', 'section-view',
      '<p>To create View B from View A, which SOLIDWORKS view type was inserted?</p>',
      ['Section View', 'Aligned Section View', 'Broken-out Section', 'Detail View'], 0,
      'A straight cutting line (A–A) drawn across the parent view, with the hatched result placed as a new view, is a <b>Section View</b>. An aligned section needs a bent cutting line; a broken-out section stays inside the original view; a detail view enlarges a circled region.'),
    draft('e1q2', 'detail-view',
      '<p>To create View B from View A, which SOLIDWORKS view type was inserted?</p>',
      ['Crop View', 'Detail View', 'Broken-out Section', 'Auxiliary View'], 1,
      'A circle on the parent view, labelled with a letter, shown again at a larger scale as "DETAIL C" is a <b>Detail View</b>. A crop view hides everything outside a closed profile but keeps the scale and replaces the original view.'),
    draft('e1q3', 'auxiliary-view',
      '<p>To create View B from View A, which SOLIDWORKS view type was inserted?</p>',
      ['Projected View', 'Auxiliary View', 'Section View', 'Alternate Position View'], 1,
      'An <b>Auxiliary View</b> is projected perpendicular to a selected reference edge (here the inclined edge), so the inclined face appears at its true size. A projected view only goes in the standard orthographic directions.'),
    {
      id: 'e1q4', section: 'basic', points: PTS.basic, kind: 'num',
      model: { fn: 'lBracket', params: { A: 90, B: 60 } }, material: 'AISI 1020',
      prompt: build('AISI 1020', 'A = 90, B = 60'),
      explain: 'Sketch the L profile on the Front plane with the 8 × 8 chamfer and the R8 inside fillet, extrude 50. Round the two outer corners of the foot R10, cut the 30 × 12 slot through the foot, then the Ø16 hole with its Ø26 × 5 counterbore from the inside face of the upright (Hole Wizard or two cuts).',
    },
    {
      id: 'e1q5', section: 'basic', points: PTS.basic, kind: 'num',
      model: { fn: 'lBracket', params: { A: 110, B: 72 } }, material: 'AISI 1020',
      prompt: modify('AISI 1020', 'A = 110, B = 72'),
      explain: 'The slot is dimensioned from the right end and the hole from the top face, so both follow the new A and B.',
    },
    {
      id: 'e1q6', section: 'inter', points: PTS.inter, kind: 'mc-mass',
      model: { fn: 'archBracket', params: { A: 100, B: 24, C: 60 } }, material: '6061 Alloy',
      distract: [{ factor: 1.036 }, { factor: 0.957 }, { factor: 1.081 }],
      prompt: build('6061 Alloy', 'A = 100, B = 24, C = 60'),
      explain: 'Plate A × C × 12 with R8 corners; arched wall 60 wide × 14 thick at the back edge with R30 top; Ø40 × 6 boss on the front of the wall; ØB through both; triangular rib 12 wide (30 × 25); two Ø10 holes counterbored Ø16 × 4, 15 from the side and front edges; 30 × 15 notch in the middle of the front edge.',
    },
    {
      id: 'e1q7', section: 'inter', points: PTS.inter, kind: 'num',
      model: { fn: 'archBracket', params: { A: 120, B: 30, C: 70 } }, material: '6061 Alloy',
      prompt: modify('6061 Alloy', 'A = 120, B = 30, C = 70', 'The wall, boss, rib and notch stay centred on the length of the plate.'),
      explain: 'The holes and notch are dimensioned from the front edge, so they move with C.',
    },
    {
      id: 'e1q8', section: 'adv', points: PTS.adv, kind: 'num',
      model: { fn: 'flangedHub', params: { A: 120, B: 45 } }, material: 'Alloy Steel',
      prompt: build('Alloy Steel', 'A = 120, B = 45', 'centre of the bottom face (see image)'),
      explain: 'Revolve the half section (flange 15 thick, Ø70 hub, R4 fillet at the root, 3 × 45° chamfer at the top, Ø40 bore, Ø50 × 8 counterbore). Add the Ø24 side boss (axis 35 above the bottom, 50 from the axis) and its Ø12 hole, the 12-wide keyway (26 from the axis) and the 6 × Ø10 holes on Ø95, the first at 30° to the keyway.',
    },
    {
      id: 'e1q9', section: 'adv', points: PTS.adv, kind: 'num',
      model: { fn: 'flangedHub', params: { A: 130, B: 55 } }, material: 'Alloy Steel',
      prompt: modify('Alloy Steel', 'A = 130, B = 55', '', 'centre of the bottom face'),
      explain: 'Only the flange diameter and the hub height change; the side boss stays 35 above the bottom.',
    },
    {
      id: 'e1q10', section: 'adv', points: PTS.adv, kind: 'mc-com',
      model: { fn: 'flangedHub', params: { A: 130, B: 55, D: 50 } }, material: 'Alloy Steel',
      distract: [{ params: { A: 130, B: 55, D: null } }, { mirrorX: true }, { shift: [0, 3.1, -2.2] }],
      prompt: `<p>Modify the part from the previous question (A = 130, B = 55): cut a flat on the flange on the side opposite the keyway, at distance <b>D = 50</b> from the axis, through the flange thickness (see Top view).</p>${partNotes('Alloy Steel', 'centre of the bottom face (see image)')}<p>What is the centre of mass of the part (millimeters)?</p>`,
      explain: 'The flat removes material on −X, so the centre of mass moves toward +X; the side boss pulls it toward +Z.',
    },
    {
      id: 'e1q11', section: 'asm', points: PTS.asm, kind: 'mc-com',
      assembly: { fn: 'hingeAssembly', params: { A: 30 } }, materials: E1_MAP,
      distract: [{ params: { A: 60 } }, { shift: [0, 0, 6] }, { shift: [4.3, -3.1, 0] }],
      prompt: `<p>Build this assembly in SOLIDWORKS. It contains one Base, one Arm, two Pins and one Hanger. Download the attached parts and open them in SOLIDWORKS.</p>
${asmNotes(E1_MATS, [
  'The Base is fixed; the assembly origin is shown.',
  'The Arm sits centred between the ears and is concentric with the ear holes.',
  'Each Pin is concentric with its holes and symmetric about the middle plane of the Base.',
  'The Hanger hangs from the free-end Pin against the front face of the Arm; its long edges stay perpendicular to the top face of the Base.',
  'Angle <b>A</b> is between the top face of the Base and the Arm.',
])}
<p><b>A = 30°</b>. What is the centre of mass of the assembly (millimeters)?</p>`,
      explain: 'Mates: Base fixed; Arm concentric + width (or coincident to an ear face); angle mate A between Arm face and Base top; Pins concentric + symmetric (or distance); Hanger concentric to Pin 2, coincident to the Arm front face, and parallel (Hanger side edge ⊥ Base top). Evaluate → Mass Properties.',
    },
    {
      id: 'e1q12', section: 'asm', points: PTS.asm, kind: 'mc-com',
      assembly: { fn: 'hingeAssembly', params: { A: 50 } }, materials: E1_MAP,
      distract: [{ params: { A: 40 } }, { params: { A: 30 } }, { shift: [-3.8, 2.6, 0] }],
      prompt: '<p>Modify the assembly from the previous question: <b>A = 50°</b>.</p><p>What is the centre of mass of the assembly (millimeters)?</p>',
      explain: 'Edit the angle mate and rebuild before opening Mass Properties. The Hanger stays vertical, so it moves only with the free-end pin.',
    },
    {
      id: 'e1q13', section: 'asm', points: PTS.asm, kind: 'mc-com',
      assembly: { fn: 'hingeAssembly', params: { A: 40, cs: [120, 0, 60] } }, materials: E1_MAP,
      distract: [{ noCs: true }, { negate: true }, { shift: [3.6, 0, -4.1] }],
      prompt: '<p>Modify the assembly: <b>A = 40°</b>. Create <i>Coordinate System1</i> at the corner of the Base shown, with axes parallel to the assembly axes.</p><p>What is the centre of mass of the assembly relative to <i>Coordinate System1</i> (millimeters)?</p>',
      explain: 'Insert → Reference Geometry → Coordinate System, then in Mass Properties choose "Report coordinate values relative to: Coordinate System1".',
    },
    {
      id: 'e1q14', section: 'asm', points: PTS.asm, kind: 'num',
      assembly: { fn: 'hingeAssembly', params: { A: 40 } },
      materials: { ...E1_MAP, Arm: 'Brass' },
      prompt: `<p>Modify the assembly (A = 40°): change the material of the Arm to <b>Brass</b> (density = ${g('Brass')} g/mm³). All other parts keep their materials.</p><p>What is the total mass of the assembly (grams)?</p>`,
      explain: 'Edit the Arm part and apply Brass, then read the assembly mass. The angle does not change the mass.',
    },
  ],
};

// ======================================================================================
const E2_MATS = [['Rail', 'AISI 1020'], ['End Cap (2X)', 'ABS'], ['Slider', '6061 Alloy'], ['Post', 'Alloy Steel'], ['Handle', 'AISI 1020']];
const E2_MAP = { Rail: 'AISI 1020', 'End Cap': 'ABS', Slider: '6061 Alloy', Post: 'Alloy Steel', Handle: 'AISI 1020' };
const exam2 = {
  id: 'exam2',
  title: 'CSWA Practice Exam 2',
  blurb: 'Real-exam level. Guide block, shaft support, shelled housing and a slide assembly with a swinging handle.',
  questions: [
    draft('e2q1', 'broken-out-section',
      '<p>To create View B from View A, which SOLIDWORKS view type was inserted?</p>',
      ['Broken-out Section', 'Section View', 'Crop View', 'Detail View'], 0,
      'A <b>Broken-out Section</b> removes material to a given depth inside a closed spline drawn on an existing view, so only that local region is shown cut and hatched.'),
    draft('e2q2', 'projected-view',
      '<p>The drawing uses third-angle projection. To create View B from View A, which SOLIDWORKS view type was inserted?</p>',
      ['Auxiliary View', 'Projected View', 'Detail View', 'Relative View'], 1,
      'A <b>Projected View</b> is folded from an existing view in one of the standard directions. In third-angle projection the top view goes above the front view.'),
    draft('e2q3', 'break-view',
      '<p>To create View B from View A, which SOLIDWORKS view type was inserted?</p>',
      ['Crop View', 'Broken-out Section', 'Break (Broken) View', 'Detail View'], 2,
      'A <b>Break</b> view removes a portion of a long part between two break lines. Dimensions across the break still show the real length.'),
    {
      id: 'e2q4', section: 'basic', points: PTS.basic, kind: 'mc-mass',
      model: { fn: 'guideBlock', params: { A: 100, B: 30 } }, material: '6061 Alloy',
      distract: [{ factor: 0.962 }, { factor: 1.041 }, { factor: 1.093 }],
      prompt: build('6061 Alloy', 'A = 100, B = 30'),
      explain: 'Sketch the end profile on the Right plane (10 × 10 chamfers, 24 × 12 channel with R3 root fillets), extrude A, round the four vertical corners R10, then add two Ø10 holes with Ø16 × 5 counterbores from the channel floor.',
    },
    {
      id: 'e2q5', section: 'basic', points: PTS.basic, kind: 'num',
      model: { fn: 'guideBlock', params: { A: 140, B: 36 } }, material: '6061 Alloy',
      prompt: modify('6061 Alloy', 'A = 140, B = 36'),
      explain: 'Only the length and height change; the channel depth (12) and the counterbore depth (5 from the channel floor) stay.',
    },
    {
      id: 'e2q6', section: 'inter', points: PTS.inter, kind: 'num',
      model: { fn: 'shaftSupport', params: { A: 110, B: 60, C: 20 } }, material: 'Cast Alloy Steel',
      prompt: build('Cast Alloy Steel', 'A = 110, B = 60, C = 20'),
      explain: 'Base A × 50 × 12 with R10 corners; tapered web 10 thick (50 wide at the base, 24 wide 10 below the boss axis); two triangular gussets 8 wide (15 × 20) on either side of the web; Ø40 × 30 boss; ØC bore; Ø6 oil hole from the top into the bore; two R5-ended slots 20 long, 10 from each end.',
    },
    {
      id: 'e2q7', section: 'inter', points: PTS.inter, kind: 'mc-mass',
      model: { fn: 'shaftSupport', params: { A: 130, B: 70, C: 24 } }, material: 'Cast Alloy Steel',
      distract: [{ params: { A: 130, B: 60, C: 24 } }, { factor: 1.047 }, { factor: 0.938 }],
      prompt: modify('Cast Alloy Steel', 'A = 130, B = 70, C = 24'),
      explain: 'A taller B makes the web taller; the boss, gussets and slots keep their size.',
    },
    {
      id: 'e2q8', section: 'adv', points: PTS.adv, kind: 'num',
      model: { fn: 'housing', params: { A: 120, B: 50 } }, material: '1060 Alloy',
      prompt: build('1060 Alloy', 'A = 120, B = 50', 'as shown'),
      explain: 'Extrude the A × 80 footprint (R10 corners) to height B and shell it 6 removing the bottom face (inside corners become R4). Add the 20 × 80 × 8 tabs, the 6-thick triangular gussets (15 × 20), the Ø40 × 15 boss 40 from the left and rear faces, the Ø20 hole into the cavity and the 4 × Ø8 tab holes.',
    },
    {
      id: 'e2q9', section: 'adv', points: PTS.adv, kind: 'num',
      model: { fn: 'housing', params: { A: 150, B: 60 } }, material: '1060 Alloy',
      prompt: modify('1060 Alloy', 'A = 150, B = 60', '', 'as shown'),
      explain: 'The tab holes are dimensioned from the tab edges, so they move with A.',
    },
    {
      id: 'e2q10', section: 'adv', points: PTS.adv, kind: 'mc-com',
      model: { fn: 'housing', params: { A: 150, B: 60, window: true } }, material: '1060 Alloy',
      distract: [{ params: { A: 150, B: 60, window: false } }, { shift: [-5.4, 0, 0] }, { swap: [1, 2] }],
      prompt: `<p>Modify the part from the previous question (A = 150, B = 60): cut the 40 × 20 window through the front wall as shown.</p>${partNotes('1060 Alloy', 'as shown')}<p>What is the centre of mass of the part (millimeters)?</p>`,
      explain: 'Removing material from the front wall moves the centre of mass toward the rear (−Z) and slightly to the left.',
    },
    {
      id: 'e2q11', section: 'asm', points: PTS.asm, kind: 'mc-com',
      assembly: { fn: 'slideAssembly', params: { A: 40, B: 0 } }, materials: E2_MAP,
      distract: [{ params: { A: 80, B: 0 } }, { shift: [0, 7.5, 0] }, { params: { A: 40, B: 90 } }],
      prompt: `<p>Build this assembly in SOLIDWORKS. It contains one Rail, two End Caps, one Slider, one Post and one Handle. Download the attached parts and open them in SOLIDWORKS.</p>
${asmNotes(E2_MATS, [
  'The Rail is fixed; the assembly origin is shown.',
  'The End Caps are flush with the ends, bottom, back and front of the Rail.',
  'The Slider sits on the channel floor between the walls. The Post is concentric with the Slider hole, its bottom flush with the Slider bottom.',
  'The Handle sits on top of the Post collar, concentric with the Post.',
  'Distance <b>A</b>: Rail left end to Slider left face. Angle <b>B</b>: Rail long edge to the Handle centre line, Handle swinging toward the front.',
])}
<p><b>A = 40, B = 0°</b>. What is the centre of mass of the assembly (millimeters)?</p>`,
      explain: 'Use a distance mate for A and an angle mate for B (between a Handle side face and the Rail front face, or between planes).',
    },
    {
      id: 'e2q12', section: 'asm', points: PTS.asm, kind: 'mc-com',
      assembly: { fn: 'slideAssembly', params: { A: 120, B: 60 } }, materials: E2_MAP,
      distract: [{ params: { A: 120, B: 30 } }, { params: { A: 100, B: 60 } }, { shift: [0, -6.4, 2.5] }],
      prompt: '<p>Modify the assembly: <b>A = 120, B = 60°</b>.</p><p>What is the centre of mass of the assembly (millimeters)?</p>',
      explain: 'The Handle swing changes X and Z; the Slider position changes X only.',
    },
    {
      id: 'e2q13', section: 'asm', points: PTS.asm, kind: 'mc-com',
      assembly: { fn: 'slideAssembly', params: { A: 80, B: 90, cs: [206, 25, 50] } }, materials: E2_MAP,
      distract: [{ noCs: true }, { negate: true }, { params: { A: 80, B: 0 } }],
      prompt: '<p>Modify the assembly: <b>A = 80, B = 90°</b>. Create <i>Coordinate System1</i> at the corner of the right End Cap shown, with axes parallel to the assembly axes.</p><p>What is the centre of mass of the assembly relative to <i>Coordinate System1</i> (millimeters)?</p>',
      explain: 'The values are the origin-based centre of mass minus the position of Coordinate System1.',
    },
    {
      id: 'e2q14', section: 'asm', points: PTS.asm, kind: 'num',
      assembly: { fn: 'slideAssembly', params: { A: 80, B: 90 } },
      materials: { ...E2_MAP, Slider: 'Brass' },
      prompt: `<p>Modify the assembly (A = 80, B = 90°): change the Slider material to <b>Brass</b> (density = ${g('Brass')} g/mm³).</p><p>What is the total mass of the assembly (grams)?</p>`,
      explain: 'Only the Slider mass changes.',
    },
  ],
};

// ======================================================================================
const E3_MATS = [['Base', 'AISI 1020'], ['Link 1, Link 2, Link 3', '6061 Alloy'], ['Pin (3X)', 'Alloy Steel']];
const E3_MAP = { Base: 'AISI 1020', 'Link 1': '6061 Alloy', 'Link 2': '6061 Alloy', 'Link 3': '6061 Alloy', Pin: 'Alloy Steel' };
const exam3 = {
  id: 'exam3',
  title: 'CSWA Practice Exam 3',
  blurb: 'A little harder than the real exam. Angle support, revolved spindle, tool block with an angled hole, three-link chain.',
  questions: [
    draft('e3q1', 'aligned-section',
      '<p>To create View B from View A, which SOLIDWORKS view type was inserted?</p>',
      ['Section View', 'Aligned Section View', 'Revolved Section', 'Broken-out Section'], 1,
      'An <b>Aligned Section</b> uses a cutting line of two segments at an angle; the angled portion is rotated into the plane of the other, so the hole at 330° shows at its true distance from the centre.'),
    draft('e3q2', 'crop-view',
      '<p>To create View B from View A, which SOLIDWORKS view type was inserted?</p>',
      ['Detail View', 'Crop View', 'Broken-out Section', 'Break View'], 1,
      'A <b>Crop View</b> hides everything outside a closed profile sketched on a view; unlike a detail view it does not create a new, larger view.'),
    text('e3q3',
      '<p>A drawing uses <b>first-angle</b> projection (ISO). Where is the Top view placed relative to the Front view?</p>',
      ['Above the Front view', 'Below the Front view', 'To the right of the Front view', 'To the left of the Front view'], 1,
      'In first-angle projection each view is placed on the opposite side from where it is seen: the top view goes <b>below</b> the front view and the right view to the left. Third-angle (ANSI) does the opposite.'),
    {
      id: 'e3q4', section: 'basic', points: PTS.basic, kind: 'num',
      model: { fn: 'angleSupport', params: { A: 80, B: 70 } }, material: 'Plain Carbon Steel',
      prompt: build('Plain Carbon Steel', 'A = 80, B = 70'),
      explain: 'Front-plane profile: foot 15 thick, upright 30 wide at the foot tapering to 18 at the top, R6 root fillet; extrude 40. Full-round R20 end on the foot with a concentric Ø10 hole; Ø10 cross hole 25 below the top; 6-wide × 15-deep slot through the top, centred.',
    },
    {
      id: 'e3q5', section: 'basic', points: PTS.basic, kind: 'mc-mass',
      model: { fn: 'angleSupport', params: { A: 100, B: 60 } }, material: 'Plain Carbon Steel',
      distract: [{ params: { A: 100, B: 70 } }, { factor: 1.052 }, { factor: 0.966 }],
      prompt: modify('Plain Carbon Steel', 'A = 100, B = 60'),
      explain: 'The taper of the upright changes because its top width (18) and bottom width (30) stay while the height changes.',
    },
    {
      id: 'e3q6', section: 'inter', points: PTS.inter, kind: 'num',
      model: { fn: 'steppedSpindle', params: { A: 40, B: 60 } }, material: 'Brass',
      prompt: build('Brass', 'A = 40, B = 60'),
      explain: 'Revolve the half profile with the Ø16 bore, R2 root fillet and 1 × 45° end chamfer. Cut the 2 × 1.5 ring groove 10 from the end, the Ø8 cross hole 15 above the shoulder, the flat (20 long, 10 from the axis), and the 4 × Ø8 holes on Ø50 at 45°.',
    },
    {
      id: 'e3q7', section: 'inter', points: PTS.inter, kind: 'num',
      model: { fn: 'steppedSpindle', params: { A: 55, B: 70 } }, material: 'Brass',
      prompt: modify('Brass', 'A = 55, B = 70'),
      explain: 'A is the length of the Ø30 section; the groove and the flat stay referenced to the top end.',
    },
    {
      id: 'e3q8', section: 'adv', points: PTS.adv, kind: 'num',
      model: { fn: 'toolBlock', params: { A: 120, B: 15, C: 25 } }, material: '6061 Alloy',
      prompt: build('6061 Alloy', 'A = 120, B = 15, C = 25', 'as shown'),
      explain: 'Extrude the side profile with the sloped end (15 high at the end, C back along the top), round the two left vertical edges R10, cut the 40 × 30 pocket (R5 corners, B deep), the 2 × Ø12 holes, the 10 × 8 groove, the Ø16 hole, and a Ø10 hole 20 deep normal to the sloped face at its midpoint (make a plane on the face, or a sketch point at the midpoint and Hole Wizard).',
    },
    {
      id: 'e3q9', section: 'adv', points: PTS.adv, kind: 'num',
      model: { fn: 'toolBlock', params: { A: 140, B: 20, C: 30 } }, material: '6061 Alloy',
      prompt: modify('6061 Alloy', 'A = 140, B = 20, C = 30', 'The angled hole stays at the midpoint of the sloped face.', 'as shown'),
      explain: 'Changing C changes the slope angle, so the angled hole changes direction too.',
    },
    {
      id: 'e3q10', section: 'adv', points: PTS.adv, kind: 'mc-com',
      model: { fn: 'toolBlock', params: { A: 140, B: 20, C: 30 } }, material: '6061 Alloy',
      distract: [{ params: { A: 120, B: 15, C: 25 } }, { swap: [0, 2] }, { shift: [0, -2.4, 1.7] }],
      prompt: `<p>Use the part from the previous question (A = 140, B = 20, C = 30).</p>${partNotes('6061 Alloy', 'as shown')}<p>What is the centre of mass of the part (millimeters)?</p>`,
      explain: 'Evaluate → Mass Properties. The origin is at the bottom front-left corner and the part extends toward −Z, so Z is negative.',
    },
    {
      id: 'e3q11', section: 'asm', points: PTS.asm, kind: 'mc-com',
      assembly: { fn: 'chainAssembly', params: { A: 45, B: 135, C: 135 } }, materials: E3_MAP,
      distract: [{ params: { A: 45, B: 135, C: 225 } }, { params: { A: 45, B: 225, C: 135 } }, { shift: [0, 0, -6] }],
      prompt: `<p>Build this assembly in SOLIDWORKS. It contains one Base, Link 1 and Link 2 (100 centres), Link 3 (140 centres) and three Pins. Download the attached parts and open them in SOLIDWORKS.</p>
${asmNotes(E3_MATS, [
  'The Base is fixed; the assembly origin is shown.',
  'Link 1 is against the front face of the tongue; each following Link is against the front face of the one before it.',
  'Pins are concentric with the holes they join (no clearance), head against the front part.',
  'A: angle between the top face of the Base and Link 1. B: angle between Link 1 and Link 2. C: angle between Link 2 and Link 3. B and C are the angles at the pins, as shown.',
])}
<p><b>A = 45°, B = 135°, C = 135°</b>. What is the centre of mass of the assembly (millimeters)?</p>`,
      explain: 'B and C are measured between neighbouring links, not from horizontal: use angle mates between the side faces of neighbouring Links (Link 2 ends up horizontal here, Link 3 back at 45°). Check the bend direction against the image; flipping a mate gives one of the wrong answers.',
    },
    {
      id: 'e3q12', section: 'asm', points: PTS.asm, kind: 'mc-com',
      assembly: { fn: 'chainAssembly', params: { A: 60, B: 120, C: 150 } }, materials: E3_MAP,
      distract: [{ params: { A: 60, B: 150, C: 120 } }, { params: { A: 60, B: 120, C: 210 } }, { shift: [4.9, -2.2, 0] }],
      prompt: '<p>Modify the assembly: <b>A = 60°, B = 120°, C = 150°</b>.</p><p>What is the centre of mass of the assembly (millimeters)?</p>',
      explain: 'Absolute directions: Link 1 at 60°, Link 2 at 60 − (180 − 120) = 0°, Link 3 at 0 + (180 − 150) = 30°.',
    },
    {
      id: 'e3q13', section: 'asm', points: PTS.asm, kind: 'mc-com',
      assembly: { fn: 'chainAssembly', params: { A: 30, B: 150, C: 120, cs: [80, 0, 50] } }, materials: E3_MAP,
      distract: [{ noCs: true }, { negate: true }, { shift: [0, 5.5, -3] }],
      prompt: '<p>Modify the assembly: <b>A = 30°, B = 150°, C = 120°</b>. Create <i>Coordinate System1</i> at the corner of the Base shown, with axes parallel to the assembly axes.</p><p>What is the centre of mass of the assembly relative to <i>Coordinate System1</i> (millimeters)?</p>',
      explain: 'Coordinate System1 sits 80 mm along X from the assembly origin, so the values are the origin-based centre of mass minus (80, 0, 0).',
    },
    {
      id: 'e3q14', section: 'asm', points: PTS.asm, kind: 'mc-com',
      assembly: { fn: 'chainAssembly', params: { A: 75, B: 110, C: 140 } }, materials: E3_MAP,
      distract: [{ params: { A: 75, B: 140, C: 110 } }, { params: { A: 105, B: 110, C: 140 } }, { shift: [-4.1, 0, 2.4] }],
      prompt: '<p>Modify the assembly: <b>A = 75°, B = 110°, C = 140°</b>.</p><p>What is the centre of mass of the assembly (millimeters)?</p>',
      explain: 'Absolute directions: Link 1 at 75°, Link 2 at 5°, Link 3 at 45°.',
    },
  ],
};

// ======================================================================================
const drill = {
  id: 'drill',
  title: 'Concepts Exam 1: Core Skills',
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
drill.questions.forEach((q) => { q.section = 'concept'; });

// Additional mock exams recombine established model families and vary their driving A
// dimension. The four-step assembly sequences are kept intact with their native parts.
// They are additional practice sets, not seven entirely new model families.
const families = [exam1, exam2, exam3];
const combinations = [
  [0, 0, 0, 0, 0], [1, 1, 0, 0, 0], [1, 1, 1, 1, 1],
  [2, 2, 0, 1, 1], [0, 0, 2, 1, 2], [1, 2, 1, 2, 2], [2, 2, 2, 2, 2],
];
const variants = combinations.map(([draftFamily, basicFamily, interFamily, advFamily, asmFamily], index) => {
  const number = index + 4;
  const groups = [[draftFamily, 0, 3], [basicFamily, 3, 5], [interFamily, 5, 7],
    [advFamily, 7, 10], [asmFamily, 10, 14]];
  const questions = groups.flatMap(([family, start, end]) =>
    structuredClone(families[family].questions.slice(start, end)));
  const delta = 4 * (index + 1);
  questions.forEach((q, i) => {
    q.id = `e${number}r2q${i + 1}`;
    if (number >= 8 && q.kind === 'mc-mass') q.kind = 'num';
    if (q.assembly && typeof q.assembly.params.A === 'number') {
      // Keep all four assembly modifications coherent, including the final material step.
      const assemblyDelta = 2 * (index + 1);
      q.assembly.params.A += assemblyDelta;
      q.prompt = q.prompt.replace(/\bA\s*=\s*(\d+)/g, (_, n) => `A = ${Number(n) + assemblyDelta}`);
      for (const alt of q.distract || []) {
        if (alt.params && typeof alt.params.A === 'number') alt.params.A += assemblyDelta;
      }
      if (q.assembly.fn === 'chainAssembly' && i !== 12) {
        q.explain = 'Set the specified mates and compare the bend direction with the drawing. B and C are angles between neighbouring links; rebuild and check Mass Properties.';
      }
      return;
    }
    if (!q.model || typeof q.model.params.A !== 'number') return;
    q.model.params.A += delta;
    q.prompt = q.prompt.replace(/\bA\s*=\s*(\d+)/g, (_, n) => `A = ${Number(n) + delta}`);
    for (const alt of q.distract || []) {
      if (alt.params && typeof alt.params.A === 'number') alt.params.A += delta;
    }
  });
  return {
    id: `exam${number}-r2`,
    title: `CSWA Practice Exam ${number}`,
    blurb: 'A mixed practice set with changed dimensions and assembly positions, combining familiar model families.',
    questions,
  };
});

// Editorial study progression, not an official SOLIDWORKS difficulty rating.
const orderedMocks = [exam1, variants[0], variants[1], exam2, variants[2], variants[3],
  exam3, variants[4], variants[5], variants[6]];
const descriptions = [
  'Foundation: straightforward parts and a hinged arm.',
  'Foundation: familiar features, new dimensions and a hinged arm.',
  'Developing: a guide block and a hinged arm.',
  'Developing: a sliding assembly, support and housing.',
  'Intermediate: modified dimensions and a sliding assembly.',
  'Intermediate: tapered geometry and a sliding assembly.',
  'Challenging: a revolved spindle, angled hole and three-link chain.',
  'Hard: revolve, housing and three-link chain; fewer answer cues.',
  'Harder: tapered geometry, angled hole and chain; fewer answer cues.',
  'Most challenging: tapered geometry, revolve, angled hole and chain; fewer answer cues.',
];
orderedMocks.forEach((exam, index) => {
  exam.difficultyRank = index + 1;
  exam.difficultyLabel = descriptions[index];
  if (index >= 7) exam.showHints = false;
});
const orderedConcepts = [drill, CONCEPT_DRILLS[0], CONCEPT_DRILLS[1], CONCEPT_DRILLS[3], CONCEPT_DRILLS[2]];
orderedConcepts.forEach((exam, index) => {
  exam.difficultyRank = index + 1;
  exam.difficultyLabel = 'Suggested concept-study order; topic familiarity varies.';
});
export const EXAMS = [...orderedMocks, ...orderedConcepts];
