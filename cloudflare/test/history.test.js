import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { setup } from './helpers.js';

let t, roman, jana, cudzi, hid;
const PIXEL = 'data:image/jpeg;base64,' + Buffer.from('jpeg-bytes').toString('base64');

before(async () => {
  t = await setup();
  t.env.TODAY = '2026-10-07';
  roman = await t.user('roman@exe.sk');
  jana = await t.user('jana@gmail.com');
  cudzi = await t.user('cudzi@example.com');
  hid = (await roman.api.createHousehold('Byt', 'jana@gmail.com')).households[0].id;
});
after(() => t.dispose());

const nakup = (extra = {}) =>
  roman.api.addCinnost(hid, { name: 'Nákup Lidl', kind: 'nakup', store: 'Lidl', dueDate: '2026-10-07', assignedTo: 'roman@exe.sk', ...extra });

test('nemali: položka sa označí, odškrtnutie to zruší', async () => {
  const task = await nakup({ items: ['Mlieko', 'Chlieb'] });
  const [mlieko, chlieb] = task.items;
  let item = await jana.api.setItemMissing(mlieko.id, true);
  assert.deepEqual([item.done, item.missing], [false, true]);
  item = await roman.api.toggleItem(mlieko.id, true);
  assert.deepEqual([item.done, item.missing], [true, undefined]);
  item = await roman.api.setItemMissing(mlieko.id, true); // aj odškrtnutú – zruší odškrtnutie
  assert.deepEqual([item.done, item.missing], [false, true]);
  assert.equal((await roman.api.setItemMissing(chlieb.id, false)).missing, undefined);
  const detail = await jana.api.getHouseholdData(hid);
  assert.deepEqual(
    detail.cinnosti.find((c) => c.id === task.id).items.map((i) => [i.text, i.done, Boolean(i.missing)]),
    [['Mlieko', false, true], ['Chlieb', false, false]]
  );
  await assert.rejects(cudzi.api.setItemMissing(mlieko.id, true), /nemáš prístup/);
  await assert.rejects(roman.api.setItemMissing('nie', true), /neexistuje/);
  await roman.api.deleteCinnost(task.id);
});

test('história: jednorazový nákup – čo sa kúpilo, čo nemali, aj s obrázkom a cenou', async () => {
  const task = await nakup({ items: ['Mlieko', 'Chlieb', 'Maslo'] });
  const mascarpone = await roman.api.addItem(task.id, 'Mascarpone 500 g', '2', PIXEL, '2,49');
  const [mlieko, chlieb] = task.items;
  await roman.api.toggleItem(mlieko.id, true);
  await roman.api.toggleItem(mascarpone.id, true);
  await roman.api.setItemMissing(chlieb.id, true);
  assert.deepEqual(await jana.api.completeCinnost(task.id), { deleted: true });

  const { entries, more } = await jana.api.getHistory(hid);
  assert.equal(more, false);
  assert.equal(entries.length, 1);
  const e = entries[0];
  assert.deepEqual([e.name, e.kind, e.store, e.completedBy, e.dueDate], ['Nákup Lidl', 'nakup', 'Lidl', 'jana@gmail.com', '2026-10-07']);
  assert.deepEqual(e.items, [
    { text: 'Mlieko', qty: '', state: 'done' },
    { text: 'Chlieb', qty: '', state: 'missing' },
    { text: 'Maslo', qty: '', state: 'open' },
    { text: 'Mascarpone 500 g', qty: '2 ks', price: '2.49', state: 'done', image: mascarpone.image },
  ]);
  // obrázok ostal pre históriu, aj keď položka už neexistuje
  const res = await t.fetch(mascarpone.image, { headers: { cookie: roman.cookie } });
  assert.equal(res.status, 200);
  assert.equal(Buffer.from(await res.arrayBuffer()).toString(), 'jpeg-bytes');
  await assert.rejects(cudzi.api.getHistory(hid), /nemáš prístup/);
});

test('história: opakovaný nákup – kúpené zmiznú, čo nemali ostane na budúce', async () => {
  const task = await nakup({ periodicity: 'weekly', repeatInterval: 1, items: ['Mlieko', 'Chlieb', 'Maslo'] });
  const [mlieko, chlieb] = task.items;
  await roman.api.toggleItem(mlieko.id, true);
  await roman.api.setItemMissing(chlieb.id, true);
  const res = await roman.api.completeCinnost(task.id);
  assert.equal(res.deleted, false);
  assert.equal(res.cinnost.dueDate, '2026-10-14');
  assert.deepEqual(res.cinnost.items.map((i) => [i.text, i.done, Boolean(i.missing)]), [['Chlieb', false, false], ['Maslo', false, false]]);
  const { entries } = await roman.api.getHistory(hid);
  assert.equal(entries[0].name, 'Nákup Lidl');
  assert.deepEqual(entries[0].items.map((i) => i.state), ['done', 'missing', 'open']);
  assert.equal(entries.length, 2);
});

test('história: aj bežná činnosť, stránkovanie a zmazanie s domácnosťou', async () => {
  const kuchyna = await roman.api.addPriestor(hid, 'Kuchyňa');
  for (let i = 0; i < 41; i++) {
    const c = await roman.api.addCinnost(hid, { name: 'Utrieť prach ' + i, priestorId: kuchyna.id, dueDate: '2026-10-07', assignedTo: 'roman@exe.sk' });
    await roman.api.completeCinnost(c.id);
  }
  const first = await roman.api.getHistory(hid);
  assert.equal(first.entries.length, 40);
  assert.equal(first.more, true);
  assert.equal(first.entries[0].priestor, 'Kuchyňa');
  const second = await roman.api.getHistory(hid, first.entries.at(-1).completedAt);
  assert.equal(second.more, false);
  const all = [...first.entries, ...second.entries];
  assert.equal(new Set(all.map((e) => e.id)).size, all.length);
  assert.equal(all.length, 43);

  await roman.api.deleteHousehold(hid);
  const left = await t.env.DB.prepare('SELECT COUNT(*) AS n FROM historia').first();
  assert.equal(left.n, 0);
  assert.equal((await t.env.DB.prepare('SELECT COUNT(*) AS n FROM item_images').first()).n, 0);
});

// vlastná domácnosť – predošlý test tú pôvodnú zmazal
const chata = async () => (await roman.api.createHousehold('Chata', 'jana@gmail.com')).households.find((h) => h.name === 'Chata').id;

test('vrátenie z histórie: jednorazová činnosť sa vráti so všetkým, aj s obrázkom', async () => {
  const hid = await chata();
  const kuchyna = await roman.api.addPriestor(hid, 'Kuchyňa');
  const task = await roman.api.addCinnost(hid, {
    name: 'Upratať', priestorId: kuchyna.id, dueDate: '2026-10-06', assignedTo: '*', description: 'Aj linku', items: ['Riad', 'Podlaha'],
  });
  const fotka = await roman.api.addItem(task.id, 'Handra', '1', PIXEL, '');
  await roman.api.toggleItem(task.items[0].id, true);
  await jana.api.completeCinnost(task.id);
  const entry = (await roman.api.getHistory(hid)).entries.find((e) => e.name === 'Upratať');
  await assert.rejects(cudzi.api.restoreHistory(entry.id), /nemáš prístup/);

  const back = await roman.api.restoreHistory(entry.id);
  assert.deepEqual(
    [back.id, back.name, back.priestorId, back.assignedTo, back.description, back.dueDate, back.periodicity],
    [task.id, 'Upratať', kuchyna.id, '*', 'Aj linku', '2026-10-06', 'none']
  );
  assert.deepEqual(back.items.map((i) => [i.text, i.done]), [['Riad', true], ['Podlaha', false], ['Handra', false]]);
  assert.equal(back.items[2].image, fotka.image);
  const res = await t.fetch(fotka.image, { headers: { cookie: roman.cookie } });
  assert.equal(res.status, 200);
  assert.equal((await roman.api.getHistory(hid)).entries.some((e) => e.id === entry.id), false);
  await assert.rejects(roman.api.restoreHistory(entry.id), /neexistuje/);
  // dá sa znova dokončiť
  assert.deepEqual(await roman.api.completeCinnost(task.id), { deleted: true });
});

test('vrátenie z histórie: opakovaná činnosť dostane späť termín a kúpené položky', async () => {
  const hid = await chata();
  const task = await roman.api.addCinnost(hid, { kind: 'nakup', store: 'Lidl', dueDate: '2026-10-07', assignedTo: 'roman@exe.sk', name: 'Týždenný', periodicity: 'weekly', repeatInterval: 1, items: ['Mlieko', 'Chlieb', 'Maslo'] });
  const [mlieko, chlieb] = task.items;
  await roman.api.toggleItem(mlieko.id, true);
  await roman.api.setItemMissing(chlieb.id, true);
  await roman.api.completeCinnost(task.id);
  await roman.api.addItem(task.id, 'Káva', '', '', ''); // pridané po dokončení ostane
  await roman.api.completeCinnost(task.id);
  const entries = (await roman.api.getHistory(hid)).entries.filter((e) => e.name === 'Týždenný');
  assert.equal(entries.length, 2);
  // staršie sa nedá vrátiť skôr ako novšie
  await assert.rejects(roman.api.restoreHistory(entries[1].id), /novšie/);
  await roman.api.restoreHistory(entries[0].id);
  const back = await roman.api.restoreHistory(entries[1].id);
  assert.equal(back.dueDate, '2026-10-07');
  assert.deepEqual(
    back.items.map((i) => [i.text, i.done, Boolean(i.missing)]),
    [['Mlieko', true, false], ['Chlieb', false, true], ['Maslo', false, false], ['Káva', false, false]]
  );
});
