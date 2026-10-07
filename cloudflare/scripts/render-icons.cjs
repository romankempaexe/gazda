const { chromium } = require('playwright') // npm i -D playwright (alebo NODE_PATH na globálny);
const fs = require('fs');
const { art } = require('./icon-art.cjs');
// Použitie: node scripts/render-icons.cjs public/icons  (potrebuje Playwright s Chromium)
const out = process.argv[2];
(async () => {
  const b = await chromium.launch();
  const page = await b.newPage();
  const shot = async (file, size, svg) => {
    await page.setViewportSize({ width: size, height: size });
    await page.setContent(`<html><body style="margin:0;background:transparent">${svg.replace('<svg ', `<svg width="${size}" height="${size}" `)}</body></html>`);
    await page.screenshot({ path: out + '/' + file, omitBackground: true, clip: { x: 0, y: 0, width: size, height: size } });
  };
  fs.writeFileSync(out + '/icon.svg', art() + '\n');
  await shot('icon-192.png', 192, art());
  await shot('icon-512.png', 512, art());
  await shot('maskable-512.png', 512, art({ background: 'full', scale: 0.78 })); // bezpečná zóna 80 %
  await shot('apple-touch-icon.png', 180, art({ background: 'full', scale: 0.9 })); // iOS zaobľuje sám
  await shot('badge-96.png', 96, art({ background: 'none', mono: true, scale: 1.12 })); // stavový riadok Androidu
  await shot('favicon-32.png', 32, art());
  // náhľad: všetky veľkosti, svetlé aj tmavé pozadie, maskable orezaná do kruhu
  await page.setViewportSize({ width: 900, height: 420 });
  const img = (f, s, extra = '') => `<img src="data:image/png;base64,${fs.readFileSync(out + '/' + f).toString('base64')}" width="${s}" height="${s}" style="${extra}">`;
  await page.setContent(`<body style="margin:0;font-family:sans-serif">
    <div style="display:flex;gap:28px;align-items:center;padding:24px;background:#f4f6f3">${img('icon-512.png', 160)}${img('icon-192.png', 96)}${img('maskable-512.png', 120, 'border-radius:50%')}${img('apple-touch-icon.png', 96, 'border-radius:22px')}${img('favicon-32.png', 32)}</div>
    <div style="display:flex;gap:28px;align-items:center;padding:24px;background:#111">${img('icon-512.png', 120)}${img('maskable-512.png', 96, 'border-radius:50%')}<div style="background:#333;padding:8px;border-radius:8px">${img('badge-96.png', 48)}</div>${img('badge-96.png', 24)}</div></body>`);
  await page.screenshot({ path: out + '/preview.png' });
  await b.close();
})();
