// Kresby ikon Family Grid a podaplikácií (512×512), všetky v rovnakom štýle:
// farebný prechod, biely tvar so tieňom a farebná značka (pri jednofarebnej ikone vyrezaná).
// variant: rounded | full | none; mono = jednofarebný badge do stavového riadku Androidu.

const APPS = {
  // Gazda: domček s fajkou
  gazda: {
    bg: ['#3ddc84', '#0f7a3d'],
    mark: ['#22c55e', '#15803d'],
    shadow: '#064e24',
    shape: (w) =>
      `<rect x="322" y="128" width="44" height="96" rx="10" fill="${w}"/>` +
      `<path d="M108 252 L256 132 L404 252 Z" fill="${w}" stroke="${w}" stroke-width="36" stroke-linejoin="round"/>` +
      `<rect x="140" y="226" width="232" height="186" rx="30" fill="${w}"/>`,
    stroke: 'M204 318 L240 354 L310 282',
  },
  // Family Grid: štyri dlaždice, v jednej srdce
  family: {
    bg: ['#8b8cf8', '#3730a3'],
    mark: ['#818cf8', '#4338ca'],
    shadow: '#1e1b4b',
    shape: (w) =>
      `<rect x="132" y="138" width="110" height="110" rx="30" fill="${w}"/>` +
      `<rect x="270" y="138" width="110" height="110" rx="30" fill="${w}"/>` +
      `<rect x="132" y="276" width="110" height="110" rx="30" fill="${w}"/>` +
      `<rect x="270" y="276" width="110" height="110" rx="30" fill="${w}"/>`,
    fill: 'M325 362 C295 343 285 326 291 312 C297 298 316 295 325 311 C334 295 353 298 359 312 C365 326 355 343 325 362 Z',
  },
  // Zdravko: srdce s krivkou pulzu
  zdravko: {
    bg: ['#7cc8f2', '#1f5f9e'],
    mark: ['#38a3e0', '#1d5fa0'],
    shadow: '#0c2f52',
    shape: (w) =>
      `<path d="M256 412 C116 322 92 238 134 184 C174 134 234 146 256 196 C278 146 338 134 378 184 C420 238 396 322 256 412 Z" fill="${w}" stroke="${w}" stroke-width="16" stroke-linejoin="round"/>`,
    stroke: 'M150 272 L212 272 L234 228 L264 322 L290 246 L306 272 L362 272',
    strokeWidth: 24,
  },
  // Skládko: krabica s fajkou
  skladko: {
    bg: ['#fdba74', '#c2410c'],
    mark: ['#fb923c', '#c2410c'],
    shadow: '#5a1f04',
    shape: (w) =>
      `<path d="M128 206 L178 150 L334 150 L384 206 Z" fill="${w}" stroke="${w}" stroke-width="24" stroke-linejoin="round"/>` +
      `<rect x="132" y="228" width="248" height="178" rx="26" fill="${w}"/>`,
    stroke: 'M204 316 L240 352 L310 282',
  },
  // QuickStash: dva prekryté listy (kopírovanie) s kľúčom
  quickstash: {
    bg: ['#5eead4', '#0f766e'],
    mark: ['#2dd4bf', '#0f766e'],
    shadow: '#042f2e',
    shape: (w) =>
      `<rect x="112" y="112" width="208" height="232" rx="36" fill="${w}" opacity=".55"/>` +
      `<rect x="176" y="168" width="224" height="248" rx="38" fill="${w}"/>`,
    stroke: 'M248 268 m-34 0 a34 34 0 1 0 68 0 a34 34 0 1 0 -68 0 M282 268 L346 268 M322 268 L322 300 M346 268 L346 292',
    strokeWidth: 22,
  },
};

function art({ app = 'gazda', scale = 1, background = 'rounded', mono = false } = {}) {
  const a = APPS[app];
  const rx = background === 'rounded' ? 'rx="116"' : '';
  const bg =
    background === 'none'
      ? ''
      : `<rect width="512" height="512" ${rx} fill="url(#bg)"/><rect width="512" height="256" ${rx} fill="url(#shine)"/>`;
  const sw = a.strokeWidth || 34;
  const markEl = (color) =>
    a.stroke
      ? `<path d="${a.stroke}" fill="none" stroke="${color}" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round"/>`
      : `<path d="${a.fill}" fill="${color}"/>`;
  const defs =
    `<defs>` +
    `<linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${a.bg[0]}"/><stop offset="1" stop-color="${a.bg[1]}"/></linearGradient>` +
    `<linearGradient id="shine" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff" stop-opacity=".18"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></linearGradient>` +
    `<linearGradient id="mark" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${a.mark[0]}"/><stop offset="1" stop-color="${a.mark[1]}"/></linearGradient>` +
    `<filter id="shadow" x="-20%" y="-20%" width="140%" height="140%"><feDropShadow dx="0" dy="10" stdDeviation="12" flood-color="${a.shadow}" flood-opacity=".28"/></filter>` +
    (mono ? `<mask id="cut"><rect width="512" height="512" fill="#fff"/>${markEl('#000')}</mask>` : '') +
    `</defs>`;
  const t = `translate(256 262) scale(${scale}) translate(-256 -262)`;
  const g = mono
    ? `<g transform="${t}" mask="url(#cut)">${a.shape('#fff')}</g>`
    : `<g transform="${t}"><g filter="url(#shadow)">${a.shape('#ffffff')}</g>${markEl('url(#mark)')}</g>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">${defs}${bg}${g}</svg>`;
}

module.exports = { art, APPS: Object.keys(APPS) };
