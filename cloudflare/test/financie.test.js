import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { setup } from './helpers.js';
import { parseAmount, parseMonth } from '../src/financie/excel.js';

let t;
before(async () => {
  t = await setup();
});
after(() => t.dispose());

async function family(email, share) {
  const u = await t.user(email);
  const { households } = await u.api.createHousehold('Doma', share);
  return { u, householdId: households[households.length - 1].id };
}

const fin = (u) => new Proxy({}, { get: (_, name) => (...args) => t.call(u.cookie, 'financie/' + name, ...args) });
// Tabuľka v tvare ako „Financie.xlsx“ (vyrobená v openpyxl): dva listy, tabuľky vedľa seba,
// vzorce bez uložených výsledkov, dátum ako splatnosť, „Mesačné výdavky“ aj v podkladoch pre grafy.
const xlsx = readFileSync(new URL('./fixtures/financie.xlsx', import.meta.url)).toString('base64');

test('rodinný rozpočet: položky, kategórie, rezerva, prístup', async () => {
  const { u, householdId } = await family('jana@example.com', 'peter@example.com');
  const api = fin(u);
  let data = await api.getData(householdId);
  // nová rodina má predvolené kategórie, sporenie je označené
  assert.deepEqual(data.categories.map((c) => c.name), ['Bývanie', 'Jedlo', 'Doprava', 'Zábava', 'Zdravie', 'Predplatné', 'Ostatné', 'Sporenie']);
  assert.equal(data.categories.find((c) => c.name === 'Sporenie').saving, true);
  assert.equal(data.reserveMonths, 6);
  // druhé otvorenie ich nezdvojí
  assert.equal((await api.getData(householdId)).categories.length, 8);

  const byvanie = data.categories[0].id;
  const salary = await api.saveItem(householdId, { kind: 'income', name: ' Výplata ', amount: 250000 });
  assert.equal(salary.name, 'Výplata');
  const rent = await api.saveItem(householdId, { kind: 'monthly', name: 'Hypotéka', amount: 43100, categoryId: byvanie, dueMonth: 5 });
  assert.equal(rent.categoryId, byvanie);
  assert.equal(rent.dueMonth, 0);
  const car = await api.saveItem(householdId, { kind: 'yearly', name: 'Poistenie auta', amount: 90000, categoryId: byvanie, dueMonth: 3 });
  assert.equal(car.categoryId, '');
  assert.equal(car.dueMonth, 3);
  await api.saveItem(householdId, { kind: 'income', name: 'Prídavky', amount: 12000 });

  // validácie
  await assert.rejects(api.saveItem(householdId, { kind: 'income', name: '', amount: 1 }), /názov/);
  await assert.rejects(api.saveItem(householdId, { kind: 'income', name: 'X', amount: -5 }), /sumu/);
  await assert.rejects(api.saveItem(householdId, { kind: 'income', name: 'X', amount: 1.5 }), /sumu/);
  await assert.rejects(api.saveItem(householdId, { kind: 'iné', name: 'X', amount: 1 }), /druh/);
  // kategória z cudzej rodiny sa nepriradí
  const other = await family('eva@example.com', '');
  const evaCat = (await fin(other.u).getData(other.householdId)).categories[0].id;
  assert.equal((await api.saveItem(householdId, { kind: 'monthly', name: 'Elektrina', amount: 10000, categoryId: evaCat })).categoryId, '');

  // člen rodiny vidí a mení, cudzí nie
  const peter = await t.user('peter@example.com');
  data = await fin(peter).getData(householdId);
  assert.deepEqual(data.items.filter((i) => i.kind === 'income').map((i) => i.name), ['Výplata', 'Prídavky']);
  await fin(peter).saveItem(householdId, { id: salary.id, kind: 'yearly', name: 'Výplata', amount: 260000 });
  data = await api.getData(householdId);
  const s = data.items.find((i) => i.id === salary.id);
  assert.equal(s.amount, 260000);
  assert.equal(s.kind, 'income'); // druh sa úpravou nemení
  await assert.rejects(fin(other.u).getData(householdId), /nemáš prístup/);
  await assert.rejects(fin(other.u).deleteItem(salary.id), /nemáš prístup/);

  // poradie
  await api.moveItem(salary.id, 1);
  data = await api.getData(householdId);
  assert.deepEqual(data.items.filter((i) => i.kind === 'income').map((i) => i.name), ['Prídavky', 'Výplata']);

  // kategórie: jedinečný názov, vymazanie nechá výdavky bez kategórie
  await assert.rejects(api.saveCategory(householdId, { name: 'bývanie' }), /už existuje/);
  const skolka = await api.saveCategory(householdId, { name: 'Škôlka' });
  assert.equal(skolka.saving, false);
  await api.saveCategory(householdId, { id: skolka.id, name: 'Škôlka', saving: true });
  await api.deleteCategory(byvanie);
  data = await api.getData(householdId);
  assert.equal(data.items.find((i) => i.id === rent.id).categoryId, '');
  assert.equal(data.categories.find((c) => c.id === skolka.id).saving, true);

  // rezerva, verzia sa zvýši
  const rev = await api.getRev(householdId);
  assert.deepEqual(await api.setReserve(householdId, 150000, 3), { reserve: 150000, reserveMonths: 3 });
  await assert.rejects(api.setReserve(householdId, 1, 0), /mesiacov/);
  assert.ok((await api.getRev(householdId)) > rev);
  await api.deleteItem(car.id);
  data = await api.getData(householdId);
  assert.equal(data.reserve, 150000);
  assert.equal(data.items.length, 4);

  // dlaždica rozcestníka: zostáva = príjmy − mesačné − ročné / 12 (centy)
  await api.saveItem(householdId, { kind: 'yearly', name: 'Diaľničná', amount: 12000 });
  assert.deepEqual((await u.api.getFamily()).overview.financie, { remaining: 260000 + 12000 - 43100 - 10000 - 1000 });
  assert.deepEqual((await (await t.user('nikto@example.com')).api.getFamily()).overview.financie, {});
});

test('import tabuľky Financie z Excelu', async () => {
  const { u, householdId } = await family('mara@example.com', '');
  const api = fin(u);
  await api.saveItem(householdId, { kind: 'income', name: 'Staré', amount: 100 });
  const res = await api.importExcel(householdId, 'data:application/vnd.openxmlformats-officedocument.spreadsheetml.sheet;base64,' + xlsx);
  assert.deepEqual([res.income, res.monthly, res.yearly, res.categories], [2, 5, 4, 5]);
  const d = res.data;
  const items = (kind) => d.items.filter((i) => i.kind === kind).map((i) => [i.name, i.amount, i.kind === 'yearly' ? i.dueMonth : d.categories.find((c) => c.id === i.categoryId)?.name ?? '']);
  assert.deepEqual(items('income'), [['Výplata', 200000, ''], ['Prídavky', 12050, '']]);
  assert.deepEqual(items('monthly'), [
    ['Nájom & energie', 60000, 'Bývanie'],
    ['Obedy', 6000, 'Škôlka'],
    ['Netflix', 1299, 'Predplatné'],
    ['Dôchodkové sporenie', 10000, 'Sporenie'],
    ['Bez kategórie', 500, ''],
  ]);
  assert.deepEqual(items('yearly'), [['Poistenie auta', 90000, 3], ['Daň z nehnuteľnosti', 0, 0], ['Diaľničná', 10500, 7], ['Servis', 30000, 11]]);
  assert.deepEqual(d.categories.map((c) => [c.name, c.saving]), [['Bývanie', false], ['Jedlo', false], ['Predplatné', false], ['Sporenie', true], ['Škôlka', false]]);
  assert.equal(d.reserve, 150050);

  await assert.rejects(api.importExcel(householdId, btoa('toto nie je excel')), /nie je súbor Excel/);
  await assert.rejects(api.importExcel(householdId, ''), /prázdny/);
});

test('vymazanie rodiny zmaže Financie, setLastApp ich pozná', async () => {
  const { u, householdId } = await family('ola@example.com', '');
  await fin(u).saveItem(householdId, { kind: 'income', name: 'Výplata', amount: 1 });
  await u.api.deleteHousehold(householdId);
  for (const table of ['financie_items', 'financie_categories']) {
    const left = await t.env.DB.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE household_id = ?`).bind(householdId).first();
    assert.equal(left.n, 0);
  }
  assert.deepEqual(await u.api.setLastApp('financie'), { lastApp: 'financie' });
});

test('čísla a mesiace z buniek', () => {
  assert.equal(parseAmount(12.345), 1235);
  assert.equal(parseAmount('1 963,00 €'), 196300);
  assert.equal(parseAmount('1.963,50'), 196350);
  assert.equal(parseAmount('2.5'), 250);
  assert.equal(parseAmount('—'), null);
  assert.equal(parseMonth('Júl'), 7);
  assert.equal(parseMonth('jun'), 6);
  assert.equal(parseMonth('MAREC'), 3);
  assert.equal(parseMonth('12.'), 12);
  assert.equal(parseMonth('xyz'), 0);
  assert.equal(parseMonth(46204), 7); // 1. 7. 2026
});
