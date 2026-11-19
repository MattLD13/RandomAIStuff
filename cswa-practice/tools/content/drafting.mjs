// Hand-drawn drawing-sheet SVGs for the Drafting Competencies questions.
// Each function returns an SVG string. Coordinates are in a 900 x 520 sheet.

const W = 900, H = 520;
const INK = '#111';

function sheet(body, title = 'PRACTICE DRAWING') {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W * 2}" height="${H * 2}" font-family="DejaVu Sans, Arial, sans-serif">
<defs>
  <pattern id="hatch" width="9" height="9" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
    <rect width="9" height="9" fill="#fff"/><line x1="0" y1="0" x2="0" y2="9" stroke="${INK}" stroke-width="1"/>
  </pattern>
  <marker id="ar" viewBox="0 0 10 10" refX="10" refY="5" markerWidth="10" markerHeight="10" orient="auto-start-reverse" markerUnits="userSpaceOnUse">
    <path d="M0,1.5 L10,5 L0,8.5 z" fill="${INK}"/>
  </marker>
  <marker id="arBig" viewBox="0 0 10 10" refX="10" refY="5" markerWidth="16" markerHeight="16" orient="auto-start-reverse" markerUnits="userSpaceOnUse">
    <path d="M0,1 L10,5 L0,9 z" fill="${INK}"/>
  </marker>
</defs>
<rect x="0" y="0" width="${W}" height="${H}" fill="#fff"/>
<rect x="10" y="10" width="${W - 20}" height="${H - 20}" fill="none" stroke="${INK}" stroke-width="2"/>
<g transform="translate(${W - 250} ${H - 60})" font-size="10" fill="${INK}">
  <rect width="240" height="50" fill="none" stroke="${INK}" stroke-width="1.2"/>
  <line x1="0" y1="25" x2="240" y2="25" stroke="${INK}"/><line x1="150" y1="25" x2="150" y2="50" stroke="${INK}"/>
  <text x="8" y="17" font-size="12" font-weight="700">${title}</text>
  <text x="8" y="42">UNITS: MM</text><text x="158" y="42">SHEET 1 OF 1</text>
</g>
<g fill="none" stroke="${INK}" stroke-width="1.8" stroke-linejoin="round">
${body}
</g>
</svg>`;
}

const txt = (x, y, s, o = {}) =>
  `<text x="${x}" y="${y}" fill="${o.fill || INK}" stroke="none" font-size="${o.size || 15}" font-weight="${o.bold ? 700 : 400}" text-anchor="${o.anchor || 'middle'}">${s}</text>`;
const caption = (x, y, s) => txt(x, y, s, { size: 17, bold: true, fill: '#b3261e' });
const cl = (x1, y1, x2, y2) => `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke-width="0.9" stroke-dasharray="18 4 3 4"/>`;
const hidden = (x1, y1, x2, y2) => `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke-width="1.1" stroke-dasharray="6 4"/>`;
const ln = (x1, y1, x2, y2, w = 1.8) => `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke-width="${w}"/>`;
const centerMark = (x, y, r) => cl(x - r - 8, y, x + r + 8, y) + cl(x, y - r - 8, x, y + r + 8);

// Cutting-plane line with view arrows and letters, along a polyline of points.
function cutLine(pts, letter, arrowDir) {
  const d = 'M' + pts.map((p) => p.join(',')).join(' L');
  const a = pts[0], b = pts[pts.length - 1];
  const [dx, dy] = arrowDir;
  return `<path d="${d}" stroke-width="1.4" stroke-dasharray="26 5 5 5"/>
  <line x1="${a[0]}" y1="${a[1]}" x2="${a[0] + dx * 34}" y2="${a[1] + dy * 34}" stroke-width="1.6" marker-end="url(#arBig)"/>
  <line x1="${b[0]}" y1="${b[1]}" x2="${b[0] + dx * 34}" y2="${b[1] + dy * 34}" stroke-width="1.6" marker-end="url(#arBig)"/>
  ${txt(a[0] + dx * 44 - 4, a[1] + dy * 44 + 6, letter, { size: 18, bold: true })}
  ${txt(b[0] + dx * 44 + 4, b[1] + dy * 44 + 6, letter, { size: 18, bold: true })}`;
}

export function sectionView() {
  // View A: top view of a plate with two holes; View B: the cut section.
  const body = `
  <rect x="90" y="170" width="280" height="150"/>
  <circle cx="165" cy="245" r="22"/><circle cx="295" cy="245" r="22"/>
  ${centerMark(165, 245, 22)}${centerMark(295, 245, 22)}
  ${cutLine([[70, 245], [390, 245]], 'A', [0, 1])}
  ${caption(230, 375, 'View A')}
  <rect x="510" y="225" width="75" height="40" fill="url(#hatch)"/>
  <rect x="629" y="225" width="86" height="40" fill="url(#hatch)"/>
  <rect x="759" y="225" width="75" height="40" fill="url(#hatch)" stroke="none"/>
  <path d="M510,225 H834 V265 H510 Z" fill="none"/>
  ${ln(585, 225, 585, 265)}${ln(629, 225, 629, 265)}${ln(715, 225, 715, 265)}${ln(759, 225, 759, 265)}
  <rect x="586" y="226" width="42" height="38" fill="#fff" stroke="none"/><rect x="716" y="226" width="42" height="38" fill="#fff" stroke="none"/>
  ${ln(585, 225, 585, 265)}${ln(629, 225, 629, 265)}${ln(715, 225, 715, 265)}${ln(759, 225, 759, 265)}
  ${cl(607, 205, 607, 285)}${cl(737, 205, 737, 285)}
  ${txt(672, 320, 'SECTION A-A', { bold: true })}
  ${caption(672, 375, 'View B')}`;
  return sheet(body);
}

export function detailView() {
  // View A: shaft side view with a retaining-ring groove; View B: enlarged detail.
  const shaft = (s, ox, oy) => {
    // profile in local units (mm-ish); groove at x 120..128 depth 6
    const r = 40 * s;
    const pts = [
      [0, -r], [120 * s, -r], [120 * s, -r + 6 * s], [128 * s, -r + 6 * s], [128 * s, -r], [220 * s, -r],
      [220 * s, -28 * s], [300 * s, -28 * s], [300 * s, 28 * s], [220 * s, 28 * s], [220 * s, r],
      [128 * s, r], [128 * s, r - 6 * s], [120 * s, r - 6 * s], [120 * s, r], [0, r],
    ];
    return `<path d="M${pts.map(([x, y]) => `${ox + x},${oy + y}`).join(' L')} Z"/>
      ${ln(ox + 120 * s, oy - r + 6 * s, ox + 120 * s, oy + r - 6 * s, 1)}${ln(ox + 128 * s, oy - r + 6 * s, ox + 128 * s, oy + r - 6 * s, 1)}
      ${ln(ox + 220 * s, oy - 28 * s, ox + 220 * s, oy + 28 * s, 1.4)}`;
  };
  const body = `
  ${shaft(1, 70, 230)}
  ${cl(55, 230, 385, 230)}
  <circle cx="194" cy="196" r="26" stroke-width="1.1"/>
  <line x1="214" y1="178" x2="236" y2="150" stroke-width="1.1"/>${txt(245, 147, 'C', { size: 18, bold: true })}
  ${caption(220, 375, 'View A')}
  <clipPath id="dc"><circle cx="650" cy="215" r="105"/></clipPath>
  <g clip-path="url(#dc)">${shaft(4, 650 - 124 * 4, 215 + 34 * 4)}</g>
  <circle cx="650" cy="215" r="105" stroke-width="1.1"/>
  ${txt(650, 355, 'DETAIL C', { bold: true })}${txt(650, 375, 'SCALE 4 : 1', { size: 13 })}
  ${caption(650, 410, 'View B')}`;
  return sheet(body);
}

export function auxiliaryView() {
  // View A: front view of a block with an inclined face; View B: true-shape view of that face,
  // projected perpendicular to the inclined edge.
  const u = [Math.SQRT1_2, Math.SQRT1_2], e = [-Math.SQRT1_2, Math.SQRT1_2];
  const mid = [290, 190];
  const at = (k, j) => [mid[0] + u[0] * k + e[0] * j, mid[1] + u[1] * k + e[1] * j].map((v) => v.toFixed(1));
  const c = at(205, 0);
  const a0 = at(75, -62), a1 = at(14, -62);
  const h1 = at(0, 13), h2 = at(-55, 13), h3 = at(0, -13), h4 = at(-55, -13);
  const p0 = at(0, 0), p1 = at(120, 0);
  const body = `
  <path d="M70,60 H330 V150 L250,230 H70 Z"/>
  ${hidden(...h1, ...h2)}${hidden(...h3, ...h4)}${hidden(...h2, ...h4)}
  <line x1="${a0[0]}" y1="${a0[1]}" x2="${a1[0]}" y2="${a1[1]}" stroke-width="1.6" marker-end="url(#arBig)"/>
  ${txt(+a0[0] + 14, +a0[1] + 6, 'D', { size: 18, bold: true })}
  ${caption(180, 290, 'View A')}
  ${cl(...p0, ...p1)}
  <g transform="translate(${c[0]} ${c[1]}) rotate(45)">
    <rect x="-80" y="-56.5" width="160" height="113"/>
    <circle cx="0" cy="0" r="24"/>
    ${cl(-36, 0, 36, 0)}${cl(0, -36, 0, 36)}
  </g>
  ${txt(+c[0] + 150, +c[1] + 10, 'VIEW D', { bold: true })}
  ${caption(+c[0] + 150, +c[1] + 40, 'View B')}`;
  return sheet(body);
}

export function brokenOutSection() {
  const block = (ox, cut) => `
    <rect x="${ox}" y="170" width="300" height="150"/>
    ${cut ? `
      <path d="M${ox + 85},175 C${ox + 120},160 ${ox + 190},185 ${ox + 215},172 C${ox + 240},215 ${ox + 205},265 ${ox + 222},318 C${ox + 180},330 ${ox + 120},305 ${ox + 82},318 C${ox + 95},270 ${ox + 70},220 ${ox + 85},175 Z" fill="url(#hatch)" stroke-width="1.2"/>
      <rect x="${ox + 120}" y="170" width="60" height="30" fill="#fff" stroke="none"/>
      <rect x="${ox + 135}" y="200" width="30" height="119" fill="#fff" stroke="none"/>
      <path d="M${ox + 120},170 V200 H${ox + 135} V319 M${ox + 180},170 V200 H${ox + 165} V319"/>
      ${ln(ox, 170, ox + 300, 170)}${ln(ox, 320, ox + 300, 320)}
    ` : `
      ${hidden(ox + 120, 170, ox + 120, 200)}${hidden(ox + 180, 170, ox + 180, 200)}${hidden(ox + 120, 200, ox + 180, 200)}
      ${hidden(ox + 135, 200, ox + 135, 320)}${hidden(ox + 165, 200, ox + 165, 320)}
    `}
    ${cl(ox + 150, 150, ox + 150, 340)}`;
  const body = `${block(70, false)}${caption(220, 390, 'View A')}${block(520, true)}${caption(670, 390, 'View B')}`;
  return sheet(body);
}

export function projectedView() {
  // Third-angle: front view (A) at bottom, top view (B) projected above it.
  const body = `
  <path d="M120,440 H400 V410 H160 V300 H120 Z"/>
  ${hidden(300, 410, 300, 440)}${hidden(330, 410, 330, 440)}
  ${caption(470, 400, 'View A')}
  <rect x="120" y="70" width="280" height="140"/>
  ${ln(160, 70, 160, 210, 1.4)}
  <circle cx="315" cy="140" r="15"/>${centerMark(315, 140, 15)}
  ${caption(470, 140, 'View B')}
  ${cl(315, 160, 315, 430)}`;
  return sheet(body);
}

export function breakView() {
  const shaft = (oy, broken) => {
    if (!broken) {
      return `<path d="M60,${oy - 22} H110 V${oy - 32} H780 V${oy - 22} H830 V${oy + 22} H780 V${oy + 32} H110 V${oy + 22} H60 Z"/>
        ${ln(110, oy - 22, 110, oy + 22, 1.2)}${ln(780, oy - 22, 780, oy + 22, 1.2)}${cl(45, oy, 845, oy)}`;
    }
    const z = (x) => `M${x},${oy - 40} L${x},${oy - 12} L${x - 8},${oy - 4} L${x + 8},${oy + 4} L${x},${oy + 12} L${x},${oy + 40}`;
    return `<path d="M410,${oy - 32} H110 V${oy - 22} H60 V${oy + 22} H110 V${oy + 32} H410"/>
      <path d="M480,${oy - 32} H780 V${oy - 22} H830 V${oy + 22} H780 V${oy + 32} H480"/>
      ${ln(110, oy - 22, 110, oy + 22, 1.2)}${ln(780, oy - 22, 780, oy + 22, 1.2)}
      <path d="${z(410)}" stroke-width="1"/><path d="${z(480)}" stroke-width="1"/>
      ${cl(45, oy, 395, oy)}${cl(495, oy, 845, oy)}
      <line x1="60" y1="${oy + 75}" x2="830" y2="${oy + 75}" stroke-width="1" marker-start="url(#ar)" marker-end="url(#ar)"/>
      ${ln(60, oy + 30, 60, oy + 82, 0.9)}${ln(830, oy + 30, 830, oy + 82, 0.9)}
      ${txt(445, oy + 68, '1200')}`;
  };
  const body = `${shaft(120, false)}${caption(445, 195, 'View A')}${shaft(290, true)}${caption(445, 405, 'View B')}`;
  return sheet(body);
}

export function alignedSection() {
  const cx = 220, cy = 240, R = 115;
  const hole = (deg) => {
    const a = (deg * Math.PI) / 180;
    const x = cx + 80 * Math.cos(a), y = cy - 80 * Math.sin(a);
    return `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="13"/>${centerMark(x, y, 13)}`;
  };
  const a330 = (-30 * Math.PI) / 180;
  const end2 = [cx + 140 * Math.cos(a330), cy - 140 * Math.sin(a330)];
  const body = `
  <circle cx="${cx}" cy="${cy}" r="${R}"/><circle cx="${cx}" cy="${cy}" r="35"/>
  <circle cx="${cx}" cy="${cy}" r="80" stroke-width="0.9" stroke-dasharray="18 4 3 4"/>
  ${hole(90)}${hole(210)}${hole(330)}
  <path d="M${cx},${cy - 145} L${cx},${cy} L${end2[0].toFixed(1)},${end2[1].toFixed(1)}" stroke-width="1.4" stroke-dasharray="26 5 5 5"/>
  <line x1="${cx}" y1="${cy - 145}" x2="${cx - 34}" y2="${cy - 145}" stroke-width="1.6" marker-end="url(#arBig)"/>
  <line x1="${end2[0].toFixed(1)}" y1="${end2[1].toFixed(1)}" x2="${(end2[0] - 17).toFixed(1)}" y2="${(end2[1] - 29.4).toFixed(1)}" stroke-width="1.6" marker-end="url(#arBig)"/>
  ${txt(cx - 48, cy - 140, 'A', { size: 18, bold: true })}${txt(end2[0] - 24, end2[1] - 36, 'A', { size: 18, bold: true })}
  ${caption(cx, 400, 'View A')}
  <g transform="translate(560 0)">
    <rect x="40" y="125" width="30" height="230" fill="url(#hatch)"/>
    <rect x="70" y="200" width="45" height="80" fill="url(#hatch)"/>
    <rect x="40" y="125" width="30" height="230" fill="none"/>
    <rect x="41" y="137" width="28" height="26" fill="#fff" stroke="none"/><rect x="41" y="317" width="28" height="26" fill="#fff" stroke="none"/>
    ${ln(40, 137, 70, 137, 1.2)}${ln(40, 163, 70, 163, 1.2)}${ln(40, 317, 70, 317, 1.2)}${ln(40, 343, 70, 343, 1.2)}
    <rect x="71" y="206" width="43" height="68" fill="#fff" stroke="none"/>
    ${ln(70, 205, 115, 205, 1.4)}${ln(70, 275, 115, 275, 1.4)}
    ${cl(20, 150, 100, 150)}${cl(20, 330, 100, 330)}${cl(30, 240, 140, 240)}
    ${txt(80, 395, 'SECTION A-A', { bold: true })}
    ${caption(80, 430, 'View B')}
  </g>`;
  return sheet(body);
}

export function cropView() {
  const part = (ox, oy) => `
    <path d="M${ox},${oy} H${ox + 300} V${oy + 60} L${ox + 260},${oy + 160} H${ox} Z"/>
    <circle cx="${ox + 60}" cy="${oy + 50}" r="16"/>${centerMark(ox + 60, oy + 50, 16)}
    <circle cx="${ox + 60}" cy="${oy + 115}" r="16"/>${centerMark(ox + 60, oy + 115, 16)}
    <rect x="${ox + 140}" y="${oy + 35}" width="80" height="40" rx="20"/>
    ${cl(ox + 125, oy + 55, ox + 235, oy + 55)}`;
  const body = `
  ${part(70, 160)}
  ${caption(220, 390, 'View A')}
  <clipPath id="crop"><path d="M560,170 C620,140 740,150 790,190 C820,240 780,300 720,310 C640,330 560,300 545,250 C535,215 540,185 560,170 Z"/></clipPath>
  <g clip-path="url(#crop)">${part(520, 160)}</g>
  ${caption(670, 390, 'View B')}`;
  return sheet(body);
}


// ---- drawings for the Drawing Views guide and drill -------------------------------------
const phantom = (d, w = 1.3) => `<path d="${d}" stroke-width="${w}" stroke-dasharray="22 4 4 4 4 4"/>`;

export function standard3View() {
  // Third-angle: top view above the front view, right view to the right of it.
  const body = `
  <path d="M100,430 H330 V400 H140 V290 H100 Z"/>
  ${hidden(248, 400, 248, 430)}${hidden(272, 400, 272, 430)}${cl(260, 385, 260, 445)}
  <rect x="100" y="90" width="230" height="140"/>
  ${ln(140, 90, 140, 230, 1.4)}
  <circle cx="260" cy="160" r="12"/>${centerMark(260, 160, 12)}
  <rect x="420" y="290" width="140" height="140"/>
  ${ln(420, 400, 560, 400, 1.4)}
  ${hidden(478, 400, 478, 430)}${hidden(502, 400, 502, 430)}${cl(490, 385, 490, 445)}`;
  return sheet(body);
}

export function halfSection() {
  const cx = 220, cy = 230;
  const vb = 650;
  const body = `
  <circle cx="${cx}" cy="${cy}" r="110"/><circle cx="${cx}" cy="${cy}" r="60"/><circle cx="${cx}" cy="${cy}" r="35"/>
  <path d="M${cx},${cy - 140} L${cx},${cy} L${cx + 140},${cy}" stroke-width="1.4" stroke-dasharray="26 5 5 5"/>
  <line x1="${cx}" y1="${cy - 140}" x2="${cx}" y2="${cy - 106}" stroke-width="1.6" marker-end="url(#arBig)"/>
  <line x1="${cx + 140}" y1="${cy}" x2="${cx + 140}" y2="${cy + 34}" stroke-width="1.6" marker-end="url(#arBig)"/>
  ${txt(cx - 18, cy - 128, 'A', { size: 18, bold: true })}${txt(cx + 158, cy + 30, 'A', { size: 18, bold: true })}
  ${caption(cx, 400, 'View A')}
  <rect x="${vb + 35}" y="330" width="75" height="30" fill="url(#hatch)" stroke="none"/>
  <rect x="${vb + 35}" y="250" width="25" height="80" fill="url(#hatch)" stroke="none"/>
  <path d="M${vb - 110},330 H${vb - 60} V250 H${vb + 60} V330 H${vb + 110} V360 H${vb - 110} Z"/>
  ${ln(vb + 35, 250, vb + 35, 360, 1.6)}${ln(vb - 60, 330, vb, 330, 1.2)}
  ${cl(vb, 235, vb, 375)}
  ${txt(vb, 400, 'SECTION A-A', { bold: true })}
  ${caption(vb, 430, 'View B')}`;
  return sheet(body);
}

export function alternatePosition() {
  // Assembly front view: a lever on a pivot shown in its working position and, in
  // phantom lines, in a second position.
  const bar = (deg, solid) => {
    const a = (deg * Math.PI) / 180, c = Math.cos(a), sn = Math.sin(a);
    const P = (u, v) => `${(240 + u * c - v * sn).toFixed(1)},${(300 - u * sn - v * c).toFixed(1)}`;
    const d = `M${P(0, 14)} L${P(280, 14)} A14,14 0 0 1 ${P(280, -14)} L${P(0, -14)} A14,14 0 0 1 ${P(0, 14)} Z`;
    return solid ? `<path d="${d}"/>` : phantom(d);
  };
  const body = `
  <rect x="120" y="360" width="300" height="60"/>
  <rect x="222" y="300" width="36" height="60"/>
  ${bar(0, true)}${bar(32, false)}
  <circle cx="240" cy="300" r="7"/>
  <path d="M470,286 A230,230 0 0 0 440,180" stroke-width="1.1" marker-end="url(#ar)" marker-start="url(#ar)"/>`;
  return sheet(body, 'ASSEMBLY DRAWING');
}

function projSymbol(x, y, kind, k = 1) {
  // Truncated cone shown in two views. The circles are the view from the cone's small end.
  // Third angle: the small end of the trapezoid faces the circles. First angle: the large end does.
  const big = 30 * k, small = 15 * k, len = 70 * k, gap = 50 * k;
  const ccx = x + len + gap + big;
  const t = kind === 'third'
    ? `M${x},${y - big} L${x + len},${y - small} L${x + len},${y + small} L${x},${y + big} Z`
    : `M${x},${y - small} L${x + len},${y - big} L${x + len},${y + big} L${x},${y + small} Z`;
  return `<path d="${t}" stroke-width="${1.6 * k}"/>
    <circle cx="${ccx}" cy="${y}" r="${big}" stroke-width="${1.6 * k}"/><circle cx="${ccx}" cy="${y}" r="${small}" stroke-width="${1.6 * k}"/>
    ${cl(x - 12 * k, y, ccx + big + 12 * k, y)}${cl(ccx, y - big - 10 * k, ccx, y + big + 10 * k)}`;
}
export function projectionSymbols() {
  const body = `${projSymbol(110, 230, 'first', 1.6)}${txt(250, 340, 'FIRST-ANGLE', { bold: true })}
  ${projSymbol(520, 230, 'third', 1.6)}${txt(660, 340, 'THIRD-ANGLE', { bold: true })}`;
  return sheet(body);
}
export const projectionThird = () => sheet(`${projSymbol(300, 240, 'third', 2)}`);
export const projectionFirst = () => sheet(`${projSymbol(300, 240, 'first', 2)}`);

export function lineTypes() {
  const tag = (n, x, y, tx, ty) => `<line x1="${x}" y1="${y}" x2="${tx}" y2="${ty}" stroke-width="0.9"/>
    <circle cx="${tx}" cy="${ty}" r="14" fill="#fff" stroke-width="1.2"/>${txt(tx, ty + 5, n, { size: 15, bold: true })}`;
  const body = `
  <rect x="150" y="200" width="320" height="160" stroke-width="2.4"/>
  ${hidden(280, 200, 280, 360)}${hidden(320, 200, 320, 360)}
  ${cl(300, 180, 300, 380)}
  ${phantom('M470,200 L640,120 L655,150 L470,236')}
  <path d="M120,300 H500" stroke-width="2.2" stroke-dasharray="30 6 6 6"/>
  <line x1="120" y1="300" x2="120" y2="330" stroke-width="2" marker-end="url(#arBig)"/>
  <line x1="500" y1="300" x2="500" y2="330" stroke-width="2" marker-end="url(#arBig)"/>
  ${tag('1', 150, 250, 90, 200)}${tag('2', 280, 340, 240, 430)}${tag('3', 300, 380, 360, 440)}
  ${tag('4', 600, 139, 690, 100)}${tag('5', 500, 300, 560, 350)}`;
  return sheet(body);
}

// Drafting symbols drawn as paths, so no special font is needed.
const SYM = {
  cbore: (x, y) => `<path d="M${x},${y - 11} V${y} H${x + 12} V${y - 11}" stroke-width="1.4"/>`,
  csk: (x, y) => `<path d="M${x},${y - 11} L${x + 6},${y} L${x + 12},${y - 11}" stroke-width="1.4"/>`,
  depth: (x, y) => `<path d="M${x + 6},${y - 12} V${y - 1} M${x + 2},${y - 5} L${x + 6},${y - 1} L${x + 10},${y - 5} M${x},${y + 1} H${x + 12}" stroke-width="1.4"/>`,
};
function callout(x, y, lines) {
  return lines.map((parts, i) => {
    let cx = x, out = '';
    const yy = y + i * 22;
    for (const p of parts) {
      if (typeof p === 'string') { out += txt(cx, yy, p, { anchor: 'start' }); cx += p.length * 9.2 + 4; }
      else { out += SYM[p.sym](cx, yy); cx += 18; }
    }
    return out;
  }).join('');
}
export function holeCallouts() {
  const cx = 300, cy = 250, R = 100;
  const holes = [45, 135, 225, 315].map((d) => {
    const a = (d * Math.PI) / 180, x = cx + R * Math.cos(a), y = cy - R * Math.sin(a);
    return `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="10"/><circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="18" stroke-width="1.3"/>`;
  }).join('');
  const hx = cx + R * Math.cos(Math.PI / 4), hy = cy - R * Math.sin(Math.PI / 4);
  const body = `
  <rect x="150" y="100" width="300" height="300"/>
  <circle cx="${cx}" cy="${cy}" r="${R}" stroke-width="0.9" stroke-dasharray="18 4 3 4"/>
  ${holes}
  <circle cx="${cx}" cy="${cy}" r="10"/><circle cx="${cx}" cy="${cy}" r="20" stroke-width="1.3"/>
  ${centerMark(cx, cy, 20)}
  <path d="M${hx + 13},${hy - 13} L520,120 H540" stroke-width="1"/>
  ${callout(548, 126, [['4X Ø10 THRU'], [{ sym: 'cbore' }, 'Ø18 ', { sym: 'depth' }, '6'], ['EQ. SP. ON Ø160 B.C.']])}
  <path d="M${cx + 15},${cy + 13} L520,330 H540" stroke-width="1"/>
  ${callout(548, 336, [['Ø10 THRU'], [{ sym: 'csk' }, 'Ø20 X 90°']])}`;
  return sheet(body);
}

export const DRAFTING = {
  'section-view': sectionView,
  'detail-view': detailView,
  'auxiliary-view': auxiliaryView,
  'broken-out-section': brokenOutSection,
  'projected-view': projectedView,
  'break-view': breakView,
  'aligned-section': alignedSection,
  'crop-view': cropView,
  'standard-3-view': standard3View,
  'half-section': halfSection,
  'alternate-position': alternatePosition,
  'projection-symbols': projectionSymbols,
  'projection-third': projectionThird,
  'projection-first': projectionFirst,
  'line-types': lineTypes,
  'hole-callouts': holeCallouts,
};
