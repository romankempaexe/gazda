import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { setup } from './helpers.js';
import { imageSize, parseProducts, preanalyzeLeaflets, parseKimbinoStore, parseKimbinoFlyer } from '../src/leaflets.js';
import { cleanPrice } from '../src/api.js';

let t, roman, jana, cudzi, hid, nakupId;
const calls = [];
let lidlDown = false;
const aiCalls = [];
let aiAnswer = '';
const fakeAi = {
  async run(model, input) {
    aiCalls.push({ model, input });
    if (aiAnswer instanceof Error) throw aiAnswer;
    return { response: aiAnswer, usage: { neurons: 75.5 } };
  },
};

const IMG = 'https://imgproxy.leaflets.schwarz';
const page = (n) => ({
  number: n,
  width: 1000,
  height: 1400,
  image: `${IMG}/a${n}/rs:fit:1200:1200:1/g:no/x`,
  zoom: `${IMG}/b${n}/rs:fit:2400:2400:1/g:no/x`,
  thumbnail: `${IMG}/c${n}/rs:fit:400:400:1/g:no/x`,
});
const FLYERS = {
  'online-letak-platny-od-05-10-2026': { title: 'Platný od 05. 10. 2026', offerStartDate: '2026-10-05', offerEndDate: '2026-10-11', pages: [page(1), page(2)] },
  'ponuka-platna-od-08-10-2026': { title: 'Ponuka od 08. 10.', offerStartDate: '2026-10-08', offerEndDate: '2026-10-11', pages: [page(1)] },
  'stary-letak-platny-od-28-09-2026': { title: 'Starý', offerStartDate: '2026-09-28', offerEndDate: '2026-10-04', pages: [page(1)] },
};

const KCDN = 'https://eu.kimbicdn.com';
const kimg = (size, leaflet, n) => `${KCDN}/thumbor/sig${n}=/${size}/filters:format(webp):quality(65)/sk/data/2/${leaflet}/${n}.jpg?t=1`;
const KIMBINO_STORE =
  '<a href="https://www.kimbino.sk/tesco/tesco-hypermarket-letak-od-stredy-07-10-2026-6132237/">L</a>' +
  `<img src="${kimg('full-fit-in/240x240', 132237, 0)}">` +
  '<a href="/tesco/tesco-hypermarket-letak-od-stredy-07-10-2026-6132237/">znova</a>' +
  '<a href="https://www.kimbino.sk/tesco/tesco-katalog-hracky-6130001/">K</a>' +
  '<a href="https://www.kimbino.sk/kaufland/kaufland-letak-6139999/">iný obchod</a>';
const KIMBINO_FLYER =
  '<meta property="og:title" content="Tesco hypermarket leták | Kimbino">' +
  '<script type="application/json" data-nuxt-data="nuxt-app" id="__NUXT_DATA__">' +
  JSON.stringify([
    { data: 1 },
    kimg('0x0', 132237, 0),
    kimg('full-fit-in/240x240', 132237, 0),
    kimg('0x0', 132237, 1),
    kimg('full-fit-in/240x240', 132237, 1),
    'thumbor/relativne/0x0/x/sk/data/2/132237/2.jpg',
    kimg('0x0', 132237, 2),
    kimg('0x0', 130001, 0), // odporúčaný iný leták
    '2026-10-07T00:00:00+00:00/2026-10-13T23:59:59+00:00',
    42,
  ]) +
  '</script>';

/** Náhrada za lidl.sk a servery Schwarz. */
async function fakeFetch(url) {
  url = String(url);
  calls.push(url);
  if (lidlDown) return new Response('down', { status: 503 });
  if (url === 'https://www.lidl.sk/') {
    return new Response('<a href="/c/whatsapp-letak/s10092134">W</a><a href="https://www.lidl.sk/c/online-letak/s10008489">L</a>');
  }
  if (url === 'https://www.lidl.sk/c/online-letak/s10008489') {
    return new Response(
      Object.keys(FLYERS).map((s) => `<a href="/l/sk/letaky/${s}/view/flyer/page/1">x</a>`).join('') +
        '<a href="/l/sk/brozury/online-brozura-lidl-na-slovensku/">b</a>'
    );
  }
  const m = url.match(/flyer_identifier=([^&]+)/);
  if (m) {
    const f = FLYERS[m[1]];
    return f ? Response.json({ success: true, flyer: { id: m[1], ...f } }) : new Response('{}', { status: 404 });
  }
  if (url.startsWith(IMG + '/')) return new Response('JPEG', { headers: { 'content-type': 'image/jpeg' } });
  if (url === 'https://www.kimbino.sk/tesco/') return new Response(KIMBINO_STORE);
  if (url === 'https://www.kimbino.sk/tesco/tesco-hypermarket-letak-od-stredy-07-10-2026-6132237/') return new Response(KIMBINO_FLYER);
  if (url.startsWith(KCDN + '/')) return new Response('WEBP', { headers: { 'content-type': 'image/webp' } });
  return new Response('?', { status: 404 });
}

before(async () => {
  t = await setup();
  t.env.TODAY = '2026-10-07';
  t.env.TEST_FETCH = fakeFetch;
  t.env.TEST_AI = fakeAi;
  roman = await t.user('roman@exe.sk');
  jana = await t.user('jana@gmail.com');
  cudzi = await t.user('cudzi@example.com');
  hid = (await roman.api.createHousehold('Byt', 'jana@gmail.com')).households[0].id;
  nakupId = (
    await roman.api.addCinnost(hid, { name: 'Nákup Lidl', kind: 'nakup', store: 'Lidl', dueDate: '2026-10-07', assignedTo: 'roman@exe.sk' })
  ).id;
});
after(() => t.dispose());

const get = (path, user) => t.fetch(path, { headers: user ? { cookie: user.cookie } : {} });

test('letáky: zoznam platných letákov a ich stránky cez náš server', async () => {
  const list = await roman.api.getLeaflets();
  assert.deepEqual(
    list.map((f) => [f.slug, f.start, f.end, f.pageCount]),
    [
      ['online-letak-platny-od-05-10-2026', '2026-10-05', '2026-10-11', 2],
      ['ponuka-platna-od-08-10-2026', '2026-10-08', '2026-10-11', 1],
    ]
  );
  assert.match(list[0].thumb, /^\/api\/leaflets\/image\?p=%2Fc1%2F/);
  assert.ok(!calls.some((u) => u.includes('brozura')), 'brožúry sa nesťahujú');

  const flyer = await jana.api.getLeaflet('online-letak-platny-od-05-10-2026');
  assert.equal(flyer.pages.length, 2);
  assert.equal(flyer.pages[1].n, 2);
  assert.equal(flyer.pages[1].zoom, '/api/leaflets/image?p=' + encodeURIComponent('/b2/rs:fit:2400:2400:1/g:no/x'));

  // druhé načítanie ide z pamäte, Lidl sa znova nepýta
  const before = calls.length;
  await roman.api.getLeaflets();
  await roman.api.getLeaflet('ponuka-platna-od-08-10-2026');
  assert.equal(calls.length, before);

  await assert.rejects(roman.api.getLeaflet('neexistuje'), /Leták už neplatí/);
  await assert.rejects(t.call('', 'getLeaflets'), (err) => err.status === 401);
});

test('letáky: pri výpadku Lidlu ostane posledný známy zoznam', async () => {
  await t.env.DB.prepare("UPDATE config SET value = json_set(value, '$.fetched', 0) WHERE key = 'leaflets'").run();
  lidlDown = true;
  try {
    assert.equal((await roman.api.getLeaflets()).length, 2);
  } finally {
    lidlDown = false;
  }
});

test('letáky: obrázky len z imgproxy.leaflets.schwarz a len pre prihlásených', async () => {
  const ok = await get('/api/leaflets/image?p=' + encodeURIComponent('/b2/rs:fit:2400:2400:1/g:no/x'), roman);
  assert.equal(ok.status, 200);
  assert.equal(ok.headers.get('content-type'), 'image/jpeg');
  assert.equal(await ok.text(), 'JPEG');
  assert.equal(calls.at(-1), IMG + '/b2/rs:fit:2400:2400:1/g:no/x');

  for (const p of ['//evil.example/x', 'https://evil.example/x', 'x', '/\\evil.example']) {
    assert.equal((await get('/api/leaflets/image?p=' + encodeURIComponent(p), roman)).status, 400, p);
  }
  assert.equal((await get('/api/leaflets/image?p=%2Fa1', null)).status, 401);
});

const PIXEL = 'data:image/jpeg;base64,' + Buffer.from('jpeg-bytes').toString('base64');

test('miniatúry položiek: uloženie, zobrazenie členom a zmazanie s položkou', async () => {
  const item = await roman.api.addItem(nakupId, 'Mascarpone', '2', PIXEL);
  assert.equal(item.image, '/api/item-image/' + item.id);
  const plain = await roman.api.addItem(nakupId, 'Mlieko');
  assert.equal(plain.image, undefined);

  const detail = await jana.api.getHouseholdData(hid);
  const items = detail.cinnosti.find((c) => c.id === nakupId).items;
  assert.deepEqual(items.map((i) => [i.text, i.qty, Boolean(i.image)]), [['Mascarpone', '2 ks', true], ['Mlieko', '', false]]);
  assert.equal((await roman.api.toggleItem(item.id, true)).image, item.image);

  const res = await get(item.image, jana);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('content-type'), 'image/jpeg');
  assert.equal(Buffer.from(await res.arrayBuffer()).toString(), 'jpeg-bytes');
  assert.equal((await get(item.image, cudzi)).status, 404);
  assert.equal((await get(item.image, null)).status, 401);

  await assert.rejects(roman.api.addItem(nakupId, 'X', '', 'data:text/html;base64,PHA+'), /Neplatný obrázok/);
  await assert.rejects(roman.api.addItem(nakupId, 'X', '', 'data:image/jpeg;base64,' + 'A'.repeat(200_000)), /Neplatný obrázok/);

  // úprava činnosti miniatúru zachová, odstránenie položky ju zmaže
  const task = (await roman.api.getHouseholdData(hid)).cinnosti.find((c) => c.id === nakupId);
  const keep = { name: task.name, kind: 'nakup', store: 'Lidl', dueDate: task.dueDate, assignedTo: task.assignedTo };
  let saved = await roman.api.updateCinnost(nakupId, { ...keep, items: task.items.map((i) => ({ id: i.id, text: i.text + '!', qty: i.qty })) });
  assert.equal(saved.items[0].image, item.image);
  saved = await roman.api.updateCinnost(nakupId, { ...keep, items: [{ id: plain.id, text: 'Mlieko' }] });
  assert.equal(saved.items.length, 1);
  const count = async () => (await t.env.DB.prepare('SELECT COUNT(*) AS n FROM item_images').first()).n;
  assert.equal(await count(), 0);

  // po „Hotové“ obrázok ostane pre históriu; zmazaná činnosť (bez histórie) ho zmaže
  const second = await roman.api.addItem(nakupId, 'Prosecco', '', PIXEL);
  await roman.api.toggleItem(second.id, true);
  await roman.api.completeCinnost(nakupId); // jednorazová → vymaže sa celá, ostane v histórii
  assert.equal(await count(), 1);
  const other = await roman.api.addCinnost(hid, { name: 'Iný', kind: 'nakup', dueDate: '2026-10-07', assignedTo: 'roman@exe.sk' });
  await roman.api.addItem(other.id, 'Syr', '', PIXEL);
  assert.equal(await count(), 2);
  await roman.api.deleteCinnost(other.id);
  assert.equal(await count(), 1);
});

test('produkty v letáku: odpoveď AI sa vyčistí (zlomky, tisíciny, pixely, odrezaná odpoveď)', () => {
  const raw =
    'Tu je výsledok:\n```json\n' +
    JSON.stringify([
      { name: ' Mascarpone  500 g ', price: 2.49, box: [0.025, 0.262, 0.331, 0.497] },
      { name: 'Prehodené', price: '2,99', box: [0.6, 0.1, 0.3, 0.4] },
      { name: 'Bod', price: 1, box: [0.5, 0.5, 0.51, 0.51] }, // príliš malé
      { name: 'Celá strana', price: 1, box: [0, 0, 1, 1] },
      { name: '', price: 1, box: [0.1, 0.1, 0.3, 0.3] },
      { name: 'Bez ceny', box: [0.1, 0.6, 0.3, 0.8] },
      { name: 'Zlá cena', price: -3, box: [0.4, 0.6, 0.6, 0.8] },
    ]) +
    '\n```';
  assert.deepEqual(parseProducts(raw, 707, 1200), [
    { name: 'Mascarpone 500 g', price: '2.49', box: [0.025, 0.262, 0.331, 0.497] },
    { name: 'Prehodené', price: '2.99', box: [0.3, 0.1, 0.6, 0.4] },
    { name: 'Bez ceny', price: '', box: [0.1, 0.6, 0.3, 0.8] },
    { name: 'Zlá cena', price: '', box: [0.4, 0.6, 0.6, 0.8] },
  ]);
  // tisíciny (siahajú za šírku obrázka 707 px)
  assert.deepEqual(parseProducts('[{"name":"Prosecco","price":2.99,"box":[300,100,600,400]},{"name":"Syr","price":1,"box":[660,700,980,950]}]', 707, 1200), [
    { name: 'Prosecco', price: '2.99', box: [0.3, 0.1, 0.6, 0.4] },
    { name: 'Syr', price: '1.00', box: [0.66, 0.7, 0.98, 0.95] },
  ]);
  // pixely obrázka 707 × 1200, všetko pod 1000 – nesmú sa čítať ako tisíciny (posun doľava)
  assert.deepEqual(parseProducts('[{"name":"A","price":1,"box":[10,100,350,400]},{"name":"B","price":1,"box":[360,600,700,950]}]', 707, 1200), [
    { name: 'A', price: '1.00', box: [0.014, 0.083, 0.495, 0.333] },
    { name: 'B', price: '1.00', box: [0.509, 0.5, 0.99, 0.792] },
  ]);
  // veľký obrázok (1240 px): tisíciny sa nepomýlia s pixelmi
  assert.deepEqual(parseProducts('[{"name":"C","price":1,"box":[500,500,990,980]}]', 1240, 1754), [
    { name: 'C', price: '1.00', box: [0.5, 0.5, 0.99, 0.98] },
  ]);
  // pixely obrázka, ktorý model videl (707 × 1200)
  assert.deepEqual(
    parseProducts('[{"name":"Robot","price":49.99,"box":[350,600,700,1200]},{"name":"Syr","price":1,"box":[0,0,353,300]}]', 707, 1200),
    [
      { name: 'Robot', price: '49.99', box: [0.495, 0.5, 0.99, 1] },
      { name: 'Syr', price: '1.00', box: [0, 0, 0.499, 0.25] },
    ]
  );
  // odrezaná odpoveď (došli tokeny) – celé záznamy sa zachránia
  assert.deepEqual(
    parseProducts('[{"name":"A","price":1,"box":[0.1,0.1,0.3,0.3]}, {"name":"B","price":2,"box":[0.4,0.1,0.6,0.3],}, {"name":"C","pri'),
    [
      { name: 'A', price: '1.00', box: [0.1, 0.1, 0.3, 0.3] },
      { name: 'B', price: '2.00', box: [0.4, 0.1, 0.6, 0.3] },
    ]
  );
  assert.deepEqual(parseProducts('{"products":[{"name":"Syr","price":1.5,"bbox":[0.1,0.1,0.4,0.3]}]}'), [
    { name: 'Syr', price: '1.50', box: [0.1, 0.1, 0.4, 0.3] },
  ]);
  assert.deepEqual(parseProducts([{ name: 'Objekt', price: 3, box: [0.1, 0.1, 0.4, 0.3] }]), [
    { name: 'Objekt', price: '3.00', box: [0.1, 0.1, 0.4, 0.3] },
  ]);
  assert.deepEqual(parseProducts('neviem'), []);
  // skutočná odpoveď Llama 4 Scout: súradnice uzavreté značkou </BBOX> namiesto ]
  const llama =
    '[{"name":"Maslov\\u00fd croissant 57 g","price":0.29,"box":[0.582,0.243,0.979,0.497</BBOX>},' +
    '{"name":"Kaizerka 55 g","price":0.09,"box":[0.667,0.670,0.994,0.951</BBOX>},' +
    '{"name":"Zemiakov\\u00fd chlieb 500 g","price":1.05,"box":[0.667,0.853,0.994,1.000</BBOX]}]';
  assert.deepEqual(parseProducts(llama, 707, 1200), [
    { name: 'Maslový croissant 57 g', price: '0.29', box: [0.582, 0.243, 0.979, 0.497] },
    { name: 'Kaizerka 55 g', price: '0.09', box: [0.667, 0.67, 0.994, 0.951] },
    { name: 'Zemiakový chlieb 500 g', price: '1.05', box: [0.667, 0.853, 0.994, 1] },
  ]);
  assert.deepEqual(parseProducts('[{"name":"Med 900 g","price":3.29,"box":[0.5,0.038,0.77,0.331</bbox>}, {"name":"Vajcia \\"M\\"","price":2.39,"box":[0.042,0.338,0.249,0.623</bbox>}]'), [
    { name: 'Med 900 g', price: '3.29', box: [0.5, 0.038, 0.77, 0.331] },
    { name: 'Vajcia "M"', price: '2.39', box: [0.042, 0.338, 0.249, 0.623] },
  ]);
  // skutočná odpoveď: súradnice bez hranatých zátvoriek
  assert.deepEqual(parseProducts('[{"name":"Donut 53 g","price":0.29,"box":0.591,0.384,0.969,0.658},{"name":"Kaizerka","price":0.09,"box":[0.591,0.670,0.969,0.953]}]'), [
    { name: 'Donut 53 g', price: '0.29', box: [0.591, 0.384, 0.969, 0.658] },
    { name: 'Kaizerka', price: '0.09', box: [0.591, 0.67, 0.969, 0.953] },
  ]);
  // úplne rozbitý zápis – po kúskoch
  assert.deepEqual(parseProducts('{"name":"Syr", "price": "1,5", "box": [0.1, 0.1, 0.4, 0.3)) {"name":"Bez boxu"}'), [
    { name: 'Syr', price: '1.50', box: [0.1, 0.1, 0.4, 0.3] },
  ]);
});

test('produkty v letáku: AI raz na stranu, potom z pamäte; chyby a limit', async () => {
  const slug = 'online-letak-platny-od-05-10-2026';
  aiAnswer = '[{"name":"Mascarpone 500 g","price":2.49,"box":[0.025,0.262,0.331,0.497]}]';
  const products = await roman.api.analyzeLeafletPage(slug, 1);
  assert.deepEqual(products, [{ name: 'Mascarpone 500 g', price: '2.49', box: [0.025, 0.262, 0.331, 0.497] }]);
  assert.equal(aiCalls.length, 1);
  assert.equal(aiCalls[0].model, '@cf/meta/llama-4-scout-17b-16e-instruct');
  const image = aiCalls[0].input.messages[0].content[0].image_url.url;
  assert.equal(image, 'data:image/jpeg;base64,' + Buffer.from('JPEG').toString('base64'));
  assert.equal(calls.at(-1), IMG + '/a2/rs:fit:1200:1200:1/g:no/x'); // strana 2 (index 1)

  assert.deepEqual(await jana.api.analyzeLeafletPage(slug, 1), products); // z pamäte
  assert.equal(aiCalls.length, 1);

  aiAnswer = new Error('AiError: 4006: you have used up your daily free allocation of 10,000 neurons');
  await assert.rejects(roman.api.analyzeLeafletPage(slug, 0), /bezplatný limit/);
  aiAnswer = new Error('AiError: 3040: capacity');
  await assert.rejects(roman.api.analyzeLeafletPage(slug, 0), /nepodarilo rozpoznať/);
  await assert.rejects(roman.api.analyzeLeafletPage(slug, 9), /Leták už neplatí/);
  await assert.rejects(cudzi.api.analyzeLeafletPage('neexistuje', 0), /Leták už neplatí/);

  // nič nenájdené: chvíľu sa vracia prázdny zoznam, potom sa strana skúsi znova
  aiAnswer = 'Na strane nevidím žiadne produkty.';
  const before = aiCalls.length;
  assert.deepEqual(await roman.api.analyzeLeafletPage(slug, 0), []);
  assert.deepEqual(await roman.api.analyzeLeafletPage(slug, 0), []);
  assert.equal(aiCalls.length, before + 1);
  const stored = JSON.parse((await t.env.DB.prepare("SELECT value FROM config WHERE key = ?").bind('products:' + slug + ':1').first()).value);
  assert.equal(stored.raw, 'Na strane nevidím žiadne produkty.');
  await t.env.DB.prepare("UPDATE config SET value = json_set(value, '$.at', '2026-01-01T00:00:00Z') WHERE key = ?").bind('products:' + slug + ':1').run();
  aiAnswer = '[{"name":"Prosecco","price":2.99,"box":[0.3,0.1,0.6,0.4]}]';
  assert.equal((await roman.api.analyzeLeafletPage(slug, 0))[0].name, 'Prosecco');
  assert.equal(aiCalls.length, before + 2);

  // výsledok staršej verzie čítania sa rozpozná znova
  await t.env.DB.prepare("UPDATE config SET value = json_set(value, '$.v', 1) WHERE key = ?").bind('products:' + slug + ':1').run();
  await roman.api.analyzeLeafletPage(slug, 0);
  assert.equal(aiCalls.length, before + 3);
  await roman.api.analyzeLeafletPage(slug, 0);
  assert.equal(aiCalls.length, before + 3);
  await assert.rejects(t.call('', 'analyzeLeafletPage', slug, 1), (err) => err.status === 401);
});

test('cena položky: uloží sa vyčistená a zostane pri úprave činnosti', async () => {
  assert.equal(cleanPrice('2,49 €'), '2.49');
  assert.equal(cleanPrice('15'), '15.00');
  assert.equal(cleanPrice('007.5'), '7.50');
  assert.equal(cleanPrice('abc'), '');
  assert.equal(cleanPrice(''), '');
  const task = await roman.api.addCinnost(hid, { name: 'Lidl', kind: 'nakup', store: 'Lidl', dueDate: '2026-10-07', assignedTo: 'roman@exe.sk' });
  const item = await roman.api.addItem(task.id, 'Mascarpone 500 g', '1', PIXEL, '2,49');
  assert.deepEqual([item.text, item.qty, item.price], ['Mascarpone 500 g', '1 ks', '2.49']);
  const plain = await roman.api.addItem(task.id, 'Chlieb', '', '', 'zle');
  assert.equal(plain.price, undefined);
  const saved = await roman.api.updateCinnost(task.id, {
    name: 'Lidl', kind: 'nakup', store: 'Lidl', dueDate: '2026-10-07', assignedTo: 'roman@exe.sk',
    items: [{ id: item.id, text: 'Mascarpone', qty: '2' }, { id: plain.id, text: 'Chlieb' }],
  });
  assert.deepEqual(saved.items.map((i) => [i.text, i.qty, i.price]), [['Mascarpone', '2 ks', '2.49'], ['Chlieb', '', undefined]]);
});

test('produkty v letáku: príprava vopred (cron) v rámci denného limitu', async () => {
  const c = { db: t.env.DB, today: '2026-10-07', ai: fakeAi, fetch: fakeFetch };
  const budget = async () => JSON.parse((await t.env.DB.prepare("SELECT value FROM config WHERE key = 'ai_neurons'").first()).value);
  await t.env.DB.prepare("DELETE FROM config WHERE key LIKE 'products:%' OR key = 'ai_neurons'").run();
  aiAnswer = '[{"name":"Syr","price":1.5,"box":[0.1,0.1,0.4,0.3]}]';
  const before = aiCalls.length;
  // letáky majú spolu 3 strany (2 + 1); po 2 na beh
  assert.equal(await preanalyzeLeaflets(c, 2), 2);
  assert.equal(await preanalyzeLeaflets(c, 2), 1);
  assert.equal(await preanalyzeLeaflets(c, 2), 0);
  assert.equal(aiCalls.length, before + 3);
  const b = await budget();
  assert.equal(b.neurons, 3 * 75.5);
  assert.equal(b.day, new Date().toISOString().slice(0, 10));
  // otvorenie strany už AI nevolá
  assert.equal((await roman.api.analyzeLeafletPage('ponuka-platna-od-08-10-2026', 0))[0].name, 'Syr');
  assert.equal(aiCalls.length, before + 3);

  // limit na prípravu vopred minutý: na pozadí nič, otvorenú stranu rozpozná aj tak
  await t.env.DB.prepare("DELETE FROM config WHERE key LIKE 'products:%'").run();
  await t.env.DB.prepare("UPDATE config SET value = json_set(value, '$.neurons', 7000) WHERE key = 'ai_neurons'").run();
  assert.equal(await preanalyzeLeaflets(c, 2), 0);
  assert.equal(await roman.api.analyzeLeafletPage('ponuka-platna-od-08-10-2026', 0, true), null);
  assert.equal(aiCalls.length, before + 3);
  assert.equal((await roman.api.analyzeLeafletPage('ponuka-platna-od-08-10-2026', 0))[0].name, 'Syr');
  assert.equal(aiCalls.length, before + 4);
  // včerajší súčet sa nepočíta
  await t.env.DB.prepare("UPDATE config SET value = json_set(value, '$.day', '2000-01-01') WHERE key = 'ai_neurons'").run();
  assert.equal(await preanalyzeLeaflets(c, 5), 2);
  assert.equal((await budget()).neurons, 2 * 75.5);
});

test('letáky ďalších obchodov (Kimbino): zoznam, strany s platnosťou, obrázky a rozpoznanie', async () => {
  const store = { id: 'tesco', name: 'Tesco', kimbino: 'tesco' };
  assert.deepEqual(parseKimbinoStore(KIMBINO_STORE, store), [
    {
      slug: 'k-tesco-6132237',
      store: 'tesco',
      title: 'Tesco hypermarket leták od stredy 07.10.2026',
      path: '/tesco/tesco-hypermarket-letak-od-stredy-07-10-2026-6132237/',
      thumb: kimg('full-fit-in/240x240', 132237, 0),
    },
    { slug: 'k-tesco-6130001', store: 'tesco', title: 'Tesco katalog hracky', path: '/tesco/tesco-katalog-hracky-6130001/', thumb: '' },
  ]);
  const flyer = parseKimbinoFlyer(KIMBINO_FLYER, { slug: 'k-tesco-6132237', store: 'tesco', title: 'T' });
  assert.deepEqual([flyer.name, flyer.start, flyer.end], ['Tesco hypermarket leták', '2026-10-07', '2026-10-13']);
  assert.deepEqual(flyer.pages.map((p) => [p.n, p.image, p.thumb]), [
    [1, kimg('0x0', 132237, 0), kimg('full-fit-in/240x240', 132237, 0)],
    [2, kimg('0x0', 132237, 1), kimg('full-fit-in/240x240', 132237, 1)],
    [3, kimg('0x0', 132237, 2), kimg('0x0', 132237, 2)],
  ]);
  assert.equal(parseKimbinoFlyer('<html>nič</html>', { slug: 'k-tesco-1', store: 'tesco', title: '' }), null);

  // cez API: zoznam (platnosť až po otvorení), leták, obrázok cez náš server
  let list = await roman.api.getLeaflets('tesco');
  assert.deepEqual(list.map((f) => [f.slug, f.pageCount, f.end]), [['k-tesco-6132237', null, ''], ['k-tesco-6130001', null, '']]);
  assert.equal(list[0].thumb, '/api/leaflets/image?p=' + encodeURIComponent(kimg('full-fit-in/240x240', 132237, 0)));
  const opened = await jana.api.getLeaflet('k-tesco-6132237');
  assert.equal(opened.pages.length, 3);
  assert.equal(opened.pages[1].image, '/api/leaflets/image?p=' + encodeURIComponent(kimg('0x0', 132237, 1)));
  list = await roman.api.getLeaflets('tesco');
  assert.deepEqual([list[0].pageCount, list[0].start, list[0].end], [3, '2026-10-07', '2026-10-13']);
  await assert.rejects(roman.api.getLeaflet('k-tesco-6130001'), /nepodarilo načítať/); // stránka letáka neodpovedá
  await assert.rejects(roman.api.getLeaflets('neznamy'), /nepoznám/);

  const img = await get(opened.pages[0].image, roman);
  assert.equal(img.status, 200);
  assert.equal(img.headers.get('content-type'), 'image/webp');
  for (const bad of ['https://eu.kimbicdn.com.evil.com/x.jpg', 'http://eu.kimbicdn.com/x.jpg', 'https://evil.com/x', 'https://user@eu.kimbicdn.com/x']) {
    assert.equal((await get('/api/leaflets/image?p=' + encodeURIComponent(bad), roman)).status, 400, bad);
  }

  aiAnswer = '[{"name":"Mlieko 1 l","price":0.89,"box":[0.1,0.1,0.4,0.3]}]';
  assert.equal((await roman.api.analyzeLeafletPage('k-tesco-6132237', 1))[0].name, 'Mlieko 1 l');
  const sent = aiCalls.at(-1).input.messages[0].content[0].image_url.url;
  assert.equal(sent, 'data:image/webp;base64,' + Buffer.from('WEBP').toString('base64'));

  // obnova Lidlu letáky iných obchodov nezmaže
  await t.env.DB.prepare("UPDATE config SET value = json_set(value, '$.fetched', 0) WHERE key = 'leaflets'").run();
  await roman.api.getLeaflets();
  assert.equal((await roman.api.getLeaflet('k-tesco-6132237')).pages.length, 3);
  assert.ok(await t.env.DB.prepare("SELECT 1 FROM config WHERE key = 'products:k-tesco-6132237:2'").first());
});

test('veľkosť obrázka z hlavičky (JPEG, PNG, WebP)', () => {
  const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x04, 0, 0, 0xff, 0xc0, 0x00, 0x11, 0x08, 0x04, 0xb0, 0x02, 0xc3, 0x03, 0, 0, 0, 0, 0, 0]);
  assert.deepEqual(imageSize(jpeg), { w: 707, h: 1200 });
  const png = new Uint8Array(32);
  png.set([0x89, 0x50, 0x4e, 0x47], 0);
  png.set([0, 0, 0x04, 0xd8, 0, 0, 0x06, 0xda], 16);
  assert.deepEqual(imageSize(png), { w: 1240, h: 1754 });
  const webp = new Uint8Array(40);
  webp.set([...Buffer.from('RIFF')], 0);
  webp.set([...Buffer.from('WEBPVP8X')], 8);
  webp.set([0xd7, 0x04, 0x00, 0xd9, 0x06, 0x00], 24); // 1240 - 1, 1754 - 1
  assert.deepEqual(imageSize(webp), { w: 1240, h: 1754 });
  const vp8 = new Uint8Array(40);
  vp8.set([...Buffer.from('RIFF')], 0);
  vp8.set([...Buffer.from('WEBPVP8 ')], 8);
  vp8.set([0xc3, 0x02, 0xb0, 0x04], 26);
  assert.deepEqual(imageSize(vp8), { w: 707, h: 1200 });
  assert.equal(imageSize(new Uint8Array([1, 2, 3])), null);
});
