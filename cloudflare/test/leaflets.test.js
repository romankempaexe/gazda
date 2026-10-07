import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { setup } from './helpers.js';
import { parseProducts } from '../src/leaflets.js';
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
    return { response: aiAnswer };
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

  // odškrtnuté položky po „Hotové“ a celá činnosť
  const second = await roman.api.addItem(nakupId, 'Prosecco', '', PIXEL);
  await roman.api.toggleItem(second.id, true);
  await roman.api.completeCinnost(nakupId); // jednorazová → vymaže sa celá
  assert.equal(await count(), 0);
});

test('produkty v letáku: odpoveď AI sa vyčistí (tisíciny, pixely, prehodené rohy, nezmysly)', () => {
  const raw =
    'Tu je výsledok:\n```json\n' +
    JSON.stringify([
      { name: ' Mascarpone  500 g ', price: 2.49, box: [0.025, 0.262, 0.331, 0.497] },
      { name: 'Prosecco', price: '2,99', box: [600, 100, 300, 400] }, // tisíciny, prehodené x
      { name: 'Robot', price: 49.99, box: [700, 1200, 1400, 2400] }, // pixely (strana 1415 × 2400)
      { name: 'Bod', price: 1, box: [0.5, 0.5, 0.51, 0.51] }, // príliš malé
      { name: 'Celá strana', price: 1, box: [0, 0, 1, 1] },
      { name: '', price: 1, box: [0.1, 0.1, 0.3, 0.3] },
      { name: 'Bez ceny', box: [0.1, 0.6, 0.3, 0.8] },
      { name: 'Zlá cena', price: -3, box: [0.4, 0.6, 0.6, 0.8] },
    ]) +
    '\n```';
  assert.deepEqual(parseProducts(raw, 1415, 2400), [
    { name: 'Mascarpone 500 g', price: '2.49', box: [0.025, 0.262, 0.331, 0.497] },
    { name: 'Prosecco', price: '2.99', box: [0.3, 0.1, 0.6, 0.4] },
    { name: 'Robot', price: '49.99', box: [0.495, 0.5, 0.989, 1] },
    { name: 'Bez ceny', price: '', box: [0.1, 0.6, 0.3, 0.8] },
    { name: 'Zlá cena', price: '', box: [0.4, 0.6, 0.6, 0.8] },
  ]);
  assert.deepEqual(parseProducts('{"products":[{"name":"Syr","price":1.5,"bbox":[0.1,0.1,0.4,0.3]}]}'), [
    { name: 'Syr', price: '1.50', box: [0.1, 0.1, 0.4, 0.3] },
  ]);
  assert.deepEqual(parseProducts('neviem'), []);
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
