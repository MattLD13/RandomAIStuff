// Hometown "remix" motifs: one repeating pattern tile per team (set with "motif" in config.json).
// Generic hometown imagery only, no team marks. Each tile is drawn in currentColor.
(() => {
  const circle = (cx, cy, r) => `M${cx - r} ${cy}a${r} ${r} 0 1 0 ${2 * r} 0a${r} ${r} 0 1 0 ${-2 * r} 0z`;
  const star = (cx, cy, R, r = R * 0.42) =>
    'M' + Array.from({ length: 10 }, (_, i) => {
      const a = -Math.PI / 2 + (i * Math.PI) / 5, rr = i % 2 ? r : R;
      return `${(cx + rr * Math.cos(a)).toFixed(2)} ${(cy + rr * Math.sin(a)).toFixed(2)}`;
    }).join('L') + 'z';
  const gear = (cx, cy, R, teeth = 8) => {
    const pts = [];
    for (let i = 0; i < teeth * 4; i++) {
      const a = (i * Math.PI * 2) / (teeth * 4), rr = i % 4 < 2 ? R : R * 0.76;
      pts.push(`${(cx + rr * Math.cos(a)).toFixed(2)} ${(cy + rr * Math.sin(a)).toFixed(2)}`);
    }
    return `M${pts.join('L')}z${circle(cx, cy, R * 0.32)}`;
  };
  const snowflake = (cx, cy, r) => {
    let d = '';
    for (let i = 0; i < 6; i++) {
      const a = (i * Math.PI) / 3, c = Math.cos(a), s = Math.sin(a);
      const p = (t, o) => `${(cx + c * t - s * o).toFixed(2)} ${(cy + s * t + c * o).toFixed(2)}`;
      d += `M${p(0, 0)}L${p(r, 0)}M${p(r * 0.55, 0)}L${p(r * 0.8, r * 0.22)}M${p(r * 0.55, 0)}L${p(r * 0.8, -r * 0.22)}`;
    }
    return d;
  };
  const fill = (d, rule = 'nonzero') => `<path d="${d}" fill="currentColor" fill-rule="${rule}"/>`;
  const line = (d, w = 2) => `<path d="${d}" fill="none" stroke="currentColor" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round"/>`;

  const tiles = {
    skyline: { w: 120, h: 60, ink: 0.5, svg: fill('M0 60V34h8V22h6v12h10V14h4V6h2v8h4v46zM30 60V30h12v30zM44 60V18h10v42zM56 60V38h14v22zM72 60V10h3V3h2v7h3v50zM84 60V26h14v34zM100 60V40h20v20z') },
    waves: { w: 40, h: 20, svg: line('M0 10c5 0 5-6 10-6s5 6 10 6 5-6 10-6 5 6 10 6', 2.2) },
    peaks: { w: 48, h: 28, ink: 0.6, svg: fill('M0 28L12 8l5 7 9-15 22 28z') + `<path d="M21 8l5-8 5 8-3-1-2 2-2-2z" fill="#000" opacity=".35"/>` },
    notes: { w: 44, h: 44, svg: fill('M14 8h2.4v21H14z' + circle(11.6, 29, 4.6)) + fill('M16.4 8l9 3.2v4.4l-9-3.2z') + fill('M32 21h2v14h-2z' + circle(30, 35, 3.8)) },
    stars: { w: 40, h: 40, svg: fill(star(12, 12, 7)) + fill(star(31, 30, 5)) },
    bolts: { w: 32, h: 44, svg: fill('M18 3L8 23h8l-5 18 15-23h-8l6-15z') },
    pines: { w: 30, h: 44, svg: fill('M15 3l8 12h-5l8 11h-6l8 11H2l8-11H4l8-11H7zM13 37h4v6h-4z') },
    snow: { w: 44, h: 44, svg: line(snowflake(14, 14, 9), 1.6) + line(snowflake(33, 32, 6), 1.4) },
    suits: {
      w: 64, h: 64,
      svg: fill('M16 9l7 9-7 9-7-9z') +
        fill('M48 26C40 20 39 13 43.5 11.5 46 10.7 48 12.5 48 14.5 48 12.5 50 10.7 52.5 11.5 57 13 56 20 48 26z') +
        fill('M16 37C9 43 8 48 12 49.5c2 .6 3.4-.4 4-1.6.6 1.2 2 2.2 4 1.6 4-1.5 3-6.5-4-12.5zM14.6 48h2.8l1.6 6h-6z') +
        fill(circle(48, 43, 3.4) + circle(44, 49, 3.4) + circle(52, 49, 3.4) + 'M46.6 49h2.8l1.6 6h-6z'),
    },
    gears: { w: 48, h: 48, svg: fill(gear(15, 15, 11), 'evenodd') + fill(gear(36, 35, 8, 7), 'evenodd') },
    drops: { w: 32, h: 44, svg: fill('M16 6C16 6 8 18 8 24a8 8 0 0 0 16 0C24 18 16 6 16 6z') },
    palms: { w: 64, h: 64, svg: line('M32 60Q29 44 33 28', 3) + line('M33 28Q23 21 13 25M33 28Q41 19 52 23M33 28Q27 15 20 12M33 28Q40 13 46 12M33 28Q33 18 32 10', 2.4) },
    leaves: { w: 48, h: 48, svg: fill('M20 4l3 7 4-2-1 8 6-3-2 5 4 1-7 6 1 3-7-1v7h-2v-7l-7 1 1-3-7-6 4-1-2-5 6 3-1-8 4 2z') },
    brick: { w: 40, h: 20, svg: line('M0 0.75H40M0 10H40M10 0.75V10M30 0.75V10M0 10V19.25M20 10V19.25', 1.5) },
    arches: { w: 60, h: 30, svg: line('M0 22Q15 4 30 22Q45 4 60 22M0 29H60M7.5 14V29M15 9.5V29M22.5 14V29M37.5 14V29M45 9.5V29M52.5 14V29', 1.6) },
    spiral: { w: 48, h: 48, svg: line('M24 24m0-2.5a2.5 2.5 0 1 1-2.5 2.5a5 5 0 0 1 5-5a7.5 7.5 0 0 1 7.5 7.5a10 10 0 0 1-10 10a12.5 12.5 0 0 1-12.5-12.5', 2.2) },
    flames: { w: 36, h: 44, svg: fill('M18 4c2 8 10 12 10 22a10 10 0 0 1-20 0c0-5 3-8 5-10 0 4 1 6 3 7-1-7 0-13 2-19z') },
    stripes: { w: 24, h: 24, svg: line('M-6 6L6-6M0 24L24 0M18 30L30 18', 3.2) },
  };

  window.RinksideMotifs = {
    names: Object.keys(tiles),
    // An SVG <pattern> for the motif. `scale` sizes it, `rotate` tilts it.
    pattern(id, name, { scale = 1, rotate = 0, color = '#fff' } = {}) {
      const t = tiles[name] || tiles.stripes;
      return `<pattern id="${id}" width="${t.w}" height="${t.h}" patternUnits="userSpaceOnUse" patternTransform="rotate(${rotate}) scale(${scale})" style="color:${color}"><g opacity="${t.ink ?? 1}">${t.svg}</g></pattern>`;
    },
  };
})();
