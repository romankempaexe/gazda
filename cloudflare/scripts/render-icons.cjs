const { chromium } = require('playwright'); // npm i -D playwright (alebo NODE_PATH na globálny)
const fs = require('fs');
const { art, APPS } = require('./icon-art.cjs');
// Použitie: node scripts/render-icons.cjs public/icons  (potrebuje Playwright s Chromium)
// Vytvorí public/icons/<aplikácia>/… pre Family Grid a každú podaplikáciu.
const root = process.argv[2];
(async () => {
  const b = await chromium.launch();
  const page = await b.newPage();
  const rows = [];
  for (const app of APPS) {
    const out = root + '/' + app;
    fs.mkdirSync(out, { recursive: true });
    const shot = async (file, size, svg) => {
      await page.setViewportSize({ width: size, height: size });
      await page.setContent(`<html><body style="margin:0;background:transparent">${svg.replace('<svg ', `<svg width="${size}" height="${size}" `)}</body></html>`);
      await page.screenshot({ path: out + '/' + file, omitBackground: true, clip: { x: 0, y: 0, width: size, height: size } });
    };
    fs.writeFileSync(out + '/icon.svg', art({ app }) + '\n');
    await shot('icon-192.png', 192, art({ app }));
    await shot('icon-512.png', 512, art({ app }));
    await shot('maskable-512.png', 512, art({ app, background: 'full', scale: 0.78 })); // bezpečná zóna 80 %
    await shot('apple-touch-icon.png', 180, art({ app, background: 'full', scale: 0.9 })); // iOS zaobľuje sám
    await shot('badge-96.png', 96, art({ app, background: 'none', mono: true, scale: 1.12 })); // stavový riadok Androidu
    await shot('favicon-32.png', 32, art({ app }));
    const img = (f, s, extra = '') => `<img src="data:image/png;base64,${fs.readFileSync(out + '/' + f).toString('base64')}" width="${s}" height="${s}" style="${extra}">`;
    rows.push(`<div style="display:flex;gap:24px;align-items:center;padding:16px 24px;background:#f4f6f3">${img('icon-512.png', 120)}${img('maskable-512.png', 96, 'border-radius:50%')}${img('favicon-32.png', 32)}
      <div style="background:#111;padding:16px;display:flex;gap:16px;border-radius:12px">${img('icon-192.png', 72)}<div style="background:#333;padding:8px;border-radius:8px">${img('badge-96.png', 48)}</div>${img('badge-96.png', 24)}</div></div>`);
  }
  // náhľad všetkých ikon (mimo public/, nech sa nenasadí)
  await page.setViewportSize({ width: 760, height: 160 * APPS.length });
  await page.setContent(`<body style="margin:0;font-family:sans-serif">${rows.join('')}</body>`);
  await page.screenshot({ path: process.env.PREVIEW || require('os').tmpdir() + '/icons-preview.png' });
  await b.close();
})();
