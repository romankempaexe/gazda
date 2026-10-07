// Spoločná kresba ikony Gazdu (512×512). variant: rounded | full | mask | badge
function art({ scale = 1, background = 'rounded', mono = false } = {}) {
  const bg =
    background === 'none'
      ? ''
      : `<rect width="512" height="512" ${background === 'rounded' ? 'rx="116"' : ''} fill="url(#bg)"/>` +
        `<rect width="512" height="256" ${background === 'rounded' ? 'rx="116"' : ''} fill="url(#shine)"/>`;
  const white = mono ? '#fff' : '#ffffff';
  const house =
    // komín
    `<rect x="322" y="128" width="44" height="96" rx="10" fill="${white}"/>` +
    // strecha (zaoblené rohy cez hrubý obrys)
    `<path d="M108 252 L256 132 L404 252 Z" fill="${white}" stroke="${white}" stroke-width="36" stroke-linejoin="round"/>` +
    // telo domu
    `<rect x="140" y="226" width="232" height="186" rx="30" fill="${white}"/>`;
  const check = mono
    ? '' // pri jednofarebnej ikone je fajka vyrezaná maskou
    : `<path d="M204 318 L240 354 L310 282" fill="none" stroke="url(#check)" stroke-width="34" stroke-linecap="round" stroke-linejoin="round"/>`;
  const defs =
    `<defs>` +
    `<linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#3ddc84"/><stop offset="1" stop-color="#0f7a3d"/></linearGradient>` +
    `<linearGradient id="shine" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff" stop-opacity=".18"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></linearGradient>` +
    `<linearGradient id="check" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#22c55e"/><stop offset="1" stop-color="#15803d"/></linearGradient>` +
    `<filter id="shadow" x="-20%" y="-20%" width="140%" height="140%"><feDropShadow dx="0" dy="10" stdDeviation="12" flood-color="#064e24" flood-opacity=".28"/></filter>` +
    (mono
      ? `<mask id="cut"><rect width="512" height="512" fill="#fff"/><path d="M204 318 L240 354 L310 282" fill="none" stroke="#000" stroke-width="34" stroke-linecap="round" stroke-linejoin="round"/></mask>`
      : '') +
    `</defs>`;
  const t = `translate(256 262) scale(${scale}) translate(-256 -262)`;
  const g = mono
    ? `<g transform="${t}" mask="url(#cut)">${house}</g>`
    : `<g transform="${t}"><g filter="url(#shadow)">${house}</g>${check}</g>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">${defs}${bg}${g}</svg>`;
}
module.exports = { art };
