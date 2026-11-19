// Drawing Views guide (lessons) and drill (a scored practice set). Original material written
// for the Drafting Competencies section of the CSWA: what each SOLIDWORKS drawing view looks
// like, how to make it, what it is confused with, plus projection, line types and callouts.

const svg = (name) => ({ src: `img/draft-${name}.svg`, title: 'Drawing' });

// Each lesson ends with one quick-check question; `answer` indexes `options` as written
// (the build shuffles the order).
export const DRAWING_LESSONS = [
  {
    id: 'projection', title: 'First- and third-angle projection', group: 'Reading a drawing',
    image: svg('projection-symbols'),
    summary: 'Projection decides where the views go around the front view. Every drawing tells you which one it uses with a small cone symbol in the title block.',
    recognise: [
      'Third angle (ANSI, the SOLIDWORKS default in North America): each view sits on the side it is seen from. Top view above the front, right view to the right.',
      'First angle (ISO): each view sits on the opposite side. Top view below the front, right view to the left.',
      'Symbol: a truncated cone drawn twice. In third angle the small end of the cone points at the circles; in first angle the large end does.',
    ],
    make: [
      'Right-click the sheet (or the Sheet tab) and choose Properties.',
      'Under Type of projection, pick First angle or Third angle.',
      'Existing projected views move to match.',
    ],
    confuse: 'Do not judge projection from one view on its own. Look at where a projected view sits relative to the front view, or read the symbol.',
    check: {
      prompt: 'A drawing uses first-angle projection. Where is the right view placed?',
      options: ['To the left of the front view', 'To the right of the front view', 'Above the front view', 'Below the front view'],
      answer: 0,
      explain: 'First angle places each view on the side opposite the one it is seen from, so the right view goes to the left.',
    },
  },
  {
    id: 'lines', title: 'Line types', group: 'Reading a drawing',
    image: svg('line-types'),
    summary: 'Each line style means something different. Reading them correctly tells you what is an edge, what is hidden, and where a part moves or is cut.',
    recognise: [
      '1 Visible line: thick and continuous. Edges you can see.',
      '2 Hidden line: thin short dashes. Edges behind the surface, such as the inside of a hole.',
      '3 Center line: thin long and short dashes. Axes of holes and symmetry.',
      '4 Phantom line: thin long dash, two short dashes. An alternate position, a neighbouring part, or a repeated feature.',
      '5 Cutting-plane line: thick dash pattern with arrows at the ends. Where a section is cut; the arrows show the direction of sight.',
    ],
    make: [
      'SOLIDWORKS picks these for you: hidden lines with Hidden Lines Visible on a view, center lines with Annotation > Centerline, phantom lines on Alternate Position views.',
      'Change a line style with the Line Format toolbar (Line Style, Line Thickness) if a drawing needs it.',
    ],
    confuse: 'A center line and a phantom line look alike. Count the short dashes: one for a center line, two for a phantom line.',
    check: {
      prompt: 'Which line type shows the second position of a moving part?',
      options: ['Phantom line', 'Hidden line', 'Center line', 'Cutting-plane line'],
      answer: 0,
      explain: 'Phantom lines (long dash, two short dashes) show alternate positions and neighbouring parts.',
    },
  },
  {
    id: 'standard3', title: 'Standard 3 View', group: 'Placing views',
    image: svg('standard-3-view'),
    summary: 'Inserts the Front, Top and Right views of a model in one step, already lined up with each other.',
    recognise: [
      'Three orthographic views of the same part, aligned: the top view shares the front view\'s width, the right view shares its height.',
      'With third-angle projection: top above, right to the right.',
    ],
    make: [
      'In a drawing, View Layout tab > Standard 3 View.',
      'Pick the open part or assembly (or Browse), then OK.',
      'The top and right views stay aligned with the front view when you drag them.',
    ],
    confuse: 'Model View inserts one view at a time and lets you choose any orientation. Standard 3 View always gives Front, Top and Right together.',
    check: {
      prompt: 'Which views does Standard 3 View insert?',
      options: ['Front, Top and Right', 'Front, Top and Isometric', 'Front, Left and Bottom', 'Top, Right and Isometric'],
      answer: 0,
      explain: 'Standard 3 View always creates the Front, Top and Right views, aligned with each other.',
    },
  },
  {
    id: 'model', title: 'Model View', group: 'Placing views',
    image: { src: 'img/e1q4-1.png', title: 'An isometric model view' },
    summary: 'Inserts a single view of a model in an orientation you choose: Front, Top, Isometric, or a named view saved in the model.',
    recognise: [
      'Often the first view on a sheet, or the isometric in the corner.',
      'Not linked to another view: it can sit anywhere and use its own scale.',
    ],
    make: [
      'View Layout tab > Model View.',
      'Pick the part or assembly, then choose an Orientation (for example *Isometric).',
      'Click on the sheet to place it. Keep moving to place projected views straight away, or press Esc.',
    ],
    confuse: 'A projected view is folded from a parent view in a standard direction. A model view is placed on its own in any orientation.',
    check: {
      prompt: 'You need one isometric view of a part on a new sheet. Which tool fits best?',
      options: ['Model View', 'Projected View', 'Auxiliary View', 'Detail View'],
      answer: 0,
      explain: 'Model View inserts one view in the orientation you pick, including isometric.',
    },
  },
  {
    id: 'projected', title: 'Projected View', group: 'Placing views',
    image: svg('projected-view'),
    summary: 'Folds a new orthographic view out of an existing one: up, down, left, right, or diagonally for an isometric.',
    recognise: [
      'Lined up with its parent view, in one of the standard directions.',
      'Usually no label, because its position already says how it was projected.',
    ],
    make: [
      'View Layout tab > Projected View.',
      'Select the parent view, move the cursor to the side you want, and click.',
      'Where it lands follows the sheet\'s projection type (first or third angle).',
    ],
    confuse: 'An auxiliary view is also projected, but perpendicular to a slanted edge, not in a standard direction.',
    check: {
      prompt: 'What decides whether a projected top view is placed above or below the front view?',
      options: ['The sheet\'s projection type', 'The scale of the front view', 'The order the views were made', 'The material of the part'],
      answer: 0,
      explain: 'Third angle puts the top view above the front view; first angle puts it below.',
    },
  },
  {
    id: 'auxiliary', title: 'Auxiliary View', group: 'Placing views',
    image: svg('auxiliary-view'),
    summary: 'Projects a view perpendicular to a slanted edge, so an inclined face is shown at its true size and shape.',
    recognise: [
      'The new view is rotated to line up with an inclined edge of the parent view.',
      'An arrow with a letter points at the edge; the view is labelled VIEW and the letter.',
    ],
    make: [
      'View Layout tab > Auxiliary View.',
      'Select a reference edge in a view (an edge that is neither horizontal nor vertical).',
      'Move the cursor along the projection direction and click to place it.',
    ],
    confuse: 'A projected view can only go in the standard directions. If the view is tilted to match a sloped edge, it is auxiliary.',
    check: {
      prompt: 'What must you select to create an auxiliary view?',
      options: ['A reference edge in an existing view', 'A closed spline sketched on the view', 'A circle around the area to enlarge', 'A cutting line drawn across the view'],
      answer: 0,
      explain: 'The auxiliary view is projected perpendicular to the reference edge you pick.',
    },
  },
  {
    id: 'section', title: 'Section View (and half section)', group: 'Showing the inside',
    image: svg('section-view'),
    extra: svg('half-section'),
    summary: 'Cuts the part along a line drawn across a view and shows the result as a new view, with the cut material hatched.',
    recognise: [
      'A cutting-plane line with letters (A–A) and arrows on the parent view.',
      'A new view labelled SECTION A-A, with hatching where material was cut.',
      'Half section: the cutting line turns 90° at the centre, so half the view shows the outside and half shows the section.',
    ],
    make: [
      'View Layout tab > Section View.',
      'On the Section tab choose the cutting line (Horizontal, Vertical, Auxiliary or Aligned); for a half section use the Half Section tab.',
      'Click on the parent view to place the line, confirm, then place the new view. Use Flip Direction if it looks the wrong way.',
    ],
    confuse: 'A broken-out section shows the inside within the same view, not as a new one. An aligned section uses a bent line through angled features.',
    check: {
      prompt: 'On a cutting-plane line, what do the arrows show?',
      options: ['The direction you look at the section', 'The direction the part was machined', 'The direction of the hatch lines', 'Which side of the part is removed for good'],
      answer: 0,
      explain: 'The arrows give the direction of sight for the section view.',
    },
  },
  {
    id: 'aligned', title: 'Aligned Section', group: 'Showing the inside',
    image: svg('aligned-section'),
    summary: 'A section cut along two lines at an angle. The angled part is rotated into the same plane, so features like holes on a bolt circle show at their true distance from the centre.',
    recognise: [
      'The cutting-plane line bends at the centre of a round part.',
      'The section shows features from both legs of the line as if they were in one plane.',
    ],
    make: [
      'View Layout tab > Section View, then choose the Aligned cutting line.',
      'Click the centre point, then a point on each leg of the line.',
      'Place the new view.',
    ],
    confuse: 'A plain section view has a straight cutting line. If the line bends at an angle and the result is unfolded, it is aligned.',
    check: {
      prompt: 'Why use an aligned section on a flange with holes at 0° and 120°?',
      options: ['To show both holes at their true distance from the centre', 'To show the flange at a larger scale than the sheet', 'To remove the middle of the flange so it fits', 'To show only the area inside a closed spline'],
      answer: 0,
      explain: 'The angled leg is rotated into the plane of the other, so both holes show at their real radius.',
    },
  },
  {
    id: 'detail', title: 'Detail View', group: 'Zooming and trimming',
    image: svg('detail-view'),
    summary: 'Shows a small area of a view again at a larger scale, so small features can be seen and dimensioned.',
    recognise: [
      'A circle with a letter on the parent view.',
      'A new view labelled DETAIL and the letter, with its own scale such as 2 : 1.',
    ],
    make: [
      'View Layout tab > Detail View.',
      'Sketch a circle around the area (or select a closed profile you drew first).',
      'Place the view and set its scale in the PropertyManager.',
    ],
    confuse: 'A crop view also starts from a closed profile, but it trims the original view at the same scale instead of making a new, larger view.',
    check: {
      prompt: 'A detail view is drawn at 4 : 1. A feature is 3 mm long on the part. How long is it drawn?',
      options: ['12 mm', '3 mm', '0.75 mm', '7 mm'],
      answer: 0,
      explain: '4 : 1 means four times actual size: 3 × 4 = 12 mm on the sheet. Dimensions still read 3.',
    },
  },
  {
    id: 'brokenout', title: 'Broken-out Section', group: 'Showing the inside',
    image: svg('broken-out-section'),
    summary: 'Removes material inside a closed outline on an existing view, to a depth you set, so a local inside detail shows without a separate section view.',
    recognise: [
      'An irregular (usually spline) boundary inside a view, with hatching only inside it.',
      'Everything else in the view is unchanged, and no new view is created.',
    ],
    make: [
      'View Layout tab > Broken-out Section. The tool starts a spline for you.',
      'Close the spline around the area, then set the depth (a value, or an edge in another view).',
      'OK. The cut stays part of the original view.',
    ],
    confuse: 'A crop view also uses a closed spline, but it hides everything outside it and cuts nothing.',
    check: {
      prompt: 'Which statement about a broken-out section is true?',
      options: ['It cuts away material inside a closed profile within the same view', 'It creates a new view of the cut part beside the parent', 'It enlarges the area inside a circle in a new view', 'It shortens a long part between two break lines'],
      answer: 0,
      explain: 'A broken-out section changes the existing view; it does not create a new one.',
    },
  },
  {
    id: 'break', title: 'Break (broken) View', group: 'Zooming and trimming',
    image: svg('break-view'),
    summary: 'Removes the middle of a long, uniform part so it fits on the sheet at a readable scale.',
    recognise: [
      'Two break lines (zigzag, straight or curved) with a gap between them.',
      'Dimensions across the break still show the full length.',
    ],
    make: [
      'View Layout tab > Break, then select the view.',
      'Choose horizontal or vertical break lines and click twice to place them.',
      'Set the gap and line style in the PropertyManager.',
    ],
    confuse: 'A broken-out section has nothing to do with length: it cuts into a view to show the inside.',
    check: {
      prompt: 'A 1200 mm shaft is shown with a break view. What does the overall dimension read?',
      options: ['1200 mm, the true length', 'The shortened length drawn on the sheet', 'Nothing; break views cannot be dimensioned', 'The length of the gap between the break lines'],
      answer: 0,
      explain: 'A break view changes only the picture; dimensions show the model\'s real size.',
    },
  },
  {
    id: 'crop', title: 'Crop View', group: 'Zooming and trimming',
    image: svg('crop-view'),
    summary: 'Hides everything outside a closed profile on a view, leaving only the area you need, at the same scale.',
    recognise: [
      'A view that ends abruptly along an irregular outline, with no hatching and no new label.',
      'The scale is the same as before; there is no separate enlarged view.',
    ],
    make: [
      'Sketch a closed profile (spline, circle or rectangle) on the view.',
      'Select it, then View Layout tab > Crop View.',
      'Use Edit Crop or Remove Crop from the right-click menu to change it later.',
    ],
    confuse: 'A detail view makes a new view at a bigger scale. A crop view trims the existing one.',
    check: {
      prompt: 'What must exist before you click Crop View?',
      options: ['A closed sketch profile selected on the view', 'A cutting line with section arrows', 'A reference edge picked on a slanted face', 'A second configuration of the assembly'],
      answer: 0,
      explain: 'Crop View uses a closed profile you sketched and selected on the view.',
    },
  },
  {
    id: 'altpos', title: 'Alternate Position View', group: 'Assemblies',
    image: svg('alternate-position'),
    summary: 'Shows an assembly in two or more positions in one view, the extra positions in phantom lines. Used for levers, lids and linkages.',
    recognise: [
      'One view of an assembly with a moving part drawn twice: solid in one position, phantom lines in another.',
      'Only on assembly drawings.',
    ],
    make: [
      'View Layout tab > Alternate Position View, then select an assembly view.',
      'Choose New configuration (or an existing one).',
      'SOLIDWORKS opens the assembly: move the components to the second position and confirm.',
    ],
    confuse: 'Phantom lines on a part drawing usually mean a neighbouring part. Two positions of the same component means an alternate position view.',
    check: {
      prompt: 'Which kind of drawing can have an alternate position view?',
      options: ['An assembly drawing', 'A single-part drawing', 'A sheet with only sketch geometry', 'Any drawing without a title block'],
      answer: 0,
      explain: 'Alternate positions come from moving components, so they need an assembly.',
    },
  },
  {
    id: 'callouts', title: 'Hole callouts and symbols', group: 'Reading a drawing',
    image: svg('hole-callouts'),
    summary: 'The text next to a hole tells you everything about it: how many, diameter, depth, counterbore or countersink, and where.',
    recognise: [
      'Ø diameter, R radius. 4X means four identical features.',
      'THRU goes all the way through; otherwise a depth symbol (an arrow down to a bar) gives the depth.',
      'Counterbore: a square-bottomed U symbol, then the counterbore diameter and depth.',
      'Countersink: a V symbol, then the countersink diameter and the included angle.',
      'EQ. SP. means equally spaced; B.C. is the bolt circle the hole centres sit on. TYP means "the same wherever this feature repeats".',
    ],
    make: [
      'Hole Wizard holes carry their size, so Annotation > Hole Callout writes this text for you.',
      'For holes made with cuts, type the callout with the symbol library in the dimension PropertyManager.',
    ],
    confuse: 'The first diameter is the through hole; the diameter after the counterbore or countersink symbol is the larger recess.',
    check: {
      prompt: 'A callout reads 4X Ø10 THRU, then the counterbore symbol, Ø18, depth symbol, 6. How deep is the counterbore?',
      options: ['6 mm', '10 mm', '18 mm', 'Through the part'],
      answer: 0,
      explain: 'The value after the depth symbol is the counterbore depth. Ø18 is its diameter; Ø10 THRU is the hole.',
    },
  },
];

// ---- drill --------------------------------------------------------------------------------
let n = 0;
const q = (prompt, options, answer, explain, img) => ({
  id: `dv${++n}`, section: 'draft', points: 5, kind: 'mc', ...(img ? { svg: img } : {}), prompt: `<p>${prompt}</p>`, options, answer, explain,
});
// View-identification item: correct view plus three others commonly confused with it.
const ident = (img, correct, others, explain, prompt = 'To create View B from View A, which SOLIDWORKS view type was inserted?') =>
  q(prompt, [correct, ...others], 0, explain, img);

export const DRAWING_DRILL = {
  id: 'drawing',
  title: 'Drawing Views Drill',
  blurb: 'Every drawing view type, projection, line types and hole callouts. Read the guide first, then test yourself.',
  timeMinutes: 30,
  passPercent: 70,
  group: 'drawing',
  questions: [
    ident('section-view', 'Section View', ['Aligned Section View', 'Broken-out Section', 'Crop View'], 'A straight cutting line A–A on the parent view and a new hatched view labelled SECTION A-A.'),
    ident('detail-view', 'Detail View', ['Crop View', 'Broken-out Section', 'Projected View'], 'A circled, lettered area shown again at a larger scale (DETAIL C, SCALE 4 : 1).'),
    ident('auxiliary-view', 'Auxiliary View', ['Projected View', 'Section View', 'Model View'], 'The new view is projected perpendicular to the inclined edge, so the slanted face shows at true size.'),
    ident('broken-out-section', 'Broken-out Section', ['Section View', 'Crop View', 'Detail View'], 'The inside is shown within a closed spline in the same view, to a set depth.'),
    ident('projected-view', 'Projected View', ['Auxiliary View', 'Model View', 'Detail View'], 'View B is folded straight up from View A: a top view in third-angle projection.', 'The drawing uses third-angle projection. To create View B from View A, which SOLIDWORKS view type was inserted?'),
    ident('break-view', 'Break View', ['Crop View', 'Broken-out Section', 'Detail View'], 'Break lines remove the middle of a long part; the dimension still reads the true length.'),
    ident('aligned-section', 'Aligned Section View', ['Section View', 'Broken-out Section', 'Detail View'], 'The cutting line bends at the centre, and the angled leg is rotated into one plane.'),
    ident('crop-view', 'Crop View', ['Detail View', 'Broken-out Section', 'Break View'], 'Only the area inside a closed spline is kept, at the same scale, with no new label.'),
    ident('half-section', 'Section View (half section)', ['Aligned Section View', 'Broken-out Section', 'Crop View'], 'The cutting line turns 90° at the centre: half the view shows the outside and half the section. It is made with the Section View tool\'s Half Section tab.'),
    ident('alternate-position', 'Alternate Position View', ['Section View', 'Broken-out Section', 'Model View'], 'One assembly view with the lever in a second position drawn in phantom lines.', 'This assembly view shows the lever in two positions. Which SOLIDWORKS view type adds the second position?'),
    ident('standard-3-view', 'Standard 3 View', ['Model View', 'Projected View', 'Auxiliary View'], 'Front, Top and Right views placed at once and aligned with each other.', 'All three views were placed with a single command. Which one?'),
    q('Which symbol is shown?', ['Third-angle projection', 'First-angle projection', 'A countersink callout', 'A section view label'], 0,
      'The small end of the cone points at the circles: third-angle projection.', 'projection-third'),
    q('Which symbol is shown?', ['First-angle projection', 'Third-angle projection', 'A counterbore callout', 'An auxiliary view arrow'], 0,
      'The large end of the cone faces the circles: first-angle projection.', 'projection-first'),
    q('A drawing uses third-angle projection. Where is the right view placed?', ['To the right of the front view', 'To the left of the front view', 'Above the front view', 'Below the front view'], 0,
      'Third angle places each view on the side it is seen from.'),
    q('A drawing uses first-angle projection. Where is the top view placed?', ['Below the front view', 'Above the front view', 'To the right of the front view', 'To the left of the front view'], 0,
      'First angle places each view on the opposite side: the top view goes below.'),
    q('What type of line is line 2?', ['Hidden line', 'Center line', 'Phantom line', 'Visible line'], 0, 'Thin short dashes: an edge behind the surface, here the inside of the hole.', 'line-types'),
    q('What type of line is line 4?', ['Phantom line', 'Center line', 'Hidden line', 'Cutting-plane line'], 0, 'Long dash and two short dashes: an alternate position (here a lid swung open).', 'line-types'),
    q('What type of line is line 5?', ['Cutting-plane line', 'Center line', 'Phantom line', 'Hidden line'], 0, 'A thick dash pattern ending in arrows: where a section is cut, and the direction of sight.', 'line-types'),
    q('How deep is the counterbore on the four corner holes?', ['6 mm', '10 mm', '18 mm', 'Through the plate'], 0, 'The number after the depth symbol is the counterbore depth.', 'hole-callouts'),
    q('What is the diameter of the counterbore?', ['18 mm', '10 mm', '6 mm', '160 mm'], 0, 'The diameter after the counterbore symbol is the recess. Ø10 is the through hole.', 'hole-callouts'),
    q('What is the included angle of the countersink on the centre hole?', ['90°', '45°', '82°', '120°'], 0, 'The angle after the countersink diameter: Ø20 X 90°.', 'hole-callouts'),
    q('On which circle do the four corner holes sit?', ['A Ø160 bolt circle', 'A Ø18 counterbore', 'A Ø20 countersink', 'A Ø10 circle'], 0, 'EQ. SP. ON Ø160 B.C.: equally spaced on a 160 mm bolt circle.', 'hole-callouts'),
    q('Which view tool needs you to select a reference edge first?', ['Auxiliary View', 'Detail View', 'Crop View', 'Standard 3 View'], 0, 'The auxiliary view is projected perpendicular to the edge you pick.'),
    q('A detail view is drawn at 2 : 1. A slot is 5 mm wide on the part. What does its dimension read?', ['5 mm', '10 mm', '2.5 mm', '7 mm'], 0, 'Dimensions always show the real size; the scale only changes the picture.'),
    q('You sketch a closed spline on a view and want only the area inside it kept, at the same scale. Which tool?', ['Crop View', 'Detail View', 'Broken-out Section', 'Break View'], 0, 'Crop View trims the view to the closed profile without enlarging it.'),
    q('In a section view, what does the hatching mark?', ['Material the cutting plane passed through', 'Surfaces that face away from the viewer', 'Edges hidden behind the cut surface', 'Holes that pass through the part'], 0, 'Section lining (hatching) shows the cut material.'),
  ],
};
