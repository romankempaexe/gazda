import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { setup } from './helpers.js';

let t, roman;
before(async () => {
  t = await setup();
  roman = await t.user('roman.kempa@exe.sk');
  await roman.api.setNickname('Roman');
});
after(() => t.dispose());

// Dáta tak, ako ich pošle stará Gazda (readTable_ z Google tabuľky – všetko text).
const sheets = () => ({
  version: 1,
  households: [
    { id: 'h1', name: 'Byt', createdByEmail: 'roman.kempa@exe.sk', createdAt: '2026-09-01T10:00:00.000Z' },
    { id: 'h2', name: 'Chata', createdByEmail: 'jana@gmail.com', createdAt: '2026-09-02T10:00:00.000Z' },
  ],
  members: [
    { householdId: 'h1', email: 'roman.kempa@exe.sk', role: 'owner', addedAt: '2026-09-01' },
    { householdId: 'h1', email: 'Jana@Gmail.com', role: 'member', addedAt: '2026-09-01' },
    { householdId: 'h2', email: 'jana@gmail.com', role: 'owner', addedAt: '2026-09-02' },
    { householdId: 'zmazana', email: 'x@y.sk', role: 'owner', addedAt: '' }, // domácnosť neexistuje
  ],
  priestory: [{ id: 'p1', householdId: 'h1', name: 'Kuchyňa', createdAt: '2026-09-01' }],
  cinnosti: [
    { id: 'c1', householdId: 'h1', priestorId: 'p1', name: 'Umyť riad', description: 'Aj linku', assignedTo: 'jana@gmail.com',
      icon: 'dishes', color: '#2196F3', dueDate: '2026-10-08', periodicity: 'weekly', repeatInterval: '2', createdAt: '', kind: '', store: '' },
    { id: 'c2', householdId: 'h1', priestorId: '', name: 'Nakúpiť', description: '', assignedTo: 'roman.kempa@exe.sk',
      icon: 'shopping', color: '#4CAF50', dueDate: '2026-10-07', periodicity: 'none', repeatInterval: '', createdAt: '', kind: 'nakup', store: 'Lidl' },
    { id: 'c3', householdId: 'h1', priestorId: 'p1', name: 'Zlý dátum', dueDate: '7.10.2026', periodicity: 'none' },
  ],
  polozky: [
    { id: 'i1', cinnostId: 'c2', householdId: 'h1', text: 'Mlieko', done: '1', position: '1', createdAt: '', createdBy: 'roman.kempa@exe.sk', qty: '2 ks' },
    { id: 'i2', cinnostId: 'c2', householdId: 'h1', text: 'Chlieb', done: '', position: '2', createdAt: '', createdBy: '', qty: '' },
    { id: 'i3', cinnostId: 'c3', householdId: 'h1', text: 'Sirota', done: '', position: '1' }, // činnosť sa nepreniesla
  ],
  obchody: [{ householdId: 'h1', name: 'Lidl', createdAt: '' }, { householdId: 'h1', name: 'LIDL', createdAt: '' }],
  produkty: [
    { householdId: 'h1', name: 'Mlieko', uses: '5', lastUsed: '2026-10-01' },
    { householdId: 'h1', name: 'Šunka', uses: '2', lastUsed: '2026-09-20' },
    { householdId: 'h1', name: 'šunka', uses: '3', lastUsed: '2026-09-21' },
  ],
  users: [
    { email: 'roman.kempa@exe.sk', lastHouseholdId: 'h2', createdAt: '' },
    { email: 'jana@gmail.com', lastHouseholdId: 'h2', createdAt: '' },
  ],
});

const post = async (body) => {
  const res = await t.postJson('/api/import', body);
  return { status: res.status, body: await res.json() };
};

test('kód: len prihlásený, zlý kód neprejde, po 10 pokusoch neplatí', async () => {
  await assert.rejects(t.call('', 'createImportCode'), (e) => e.status === 401);
  const { code, minutes, appUrl } = await roman.api.createImportCode();
  assert.match(code, /^[A-HJ-NP-Z2-9]{8}$/);
  assert.equal(minutes, 30);
  assert.equal(appUrl, 'https://gazda.test');
  assert.equal((await post({ code: 'ZLYKOD12', data: sheets() })).status, 403);
  for (let i = 0; i < 9; i++) await post({ code: 'ZLYKOD12', data: sheets() });
  // po 10 zlých pokusoch neplatí ani správny kód
  const res = await post({ code, data: sheets() });
  assert.equal(res.status, 403);
  assert.match(res.body.error, /neplatí alebo vypršal/);
});

test('prenos: všetky listy, čistenie dát, jednorazový kód', async () => {
  const { code } = await roman.api.createImportCode();
  const res = await post({ code: code.toLowerCase().slice(0, 4) + '-' + code.slice(4), data: sheets() }); // tolerantný zápis
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.deepEqual(res.body.result, {
    households: 2, members: 3, priestory: 1, cinnosti: 2, polozky: 2, obchody: 1, produkty: 2, users: 2,
  });
  // kód sa nedá použiť znova
  assert.equal((await post({ code, data: sheets() })).status, 403);

  // Roman vidí svoje domácnosti a otvorí sa mu tá, ktorú mal otvorenú naposledy
  const start = await roman.api.getStartData();
  assert.deepEqual(start.households.map((h) => h.name), ['Byt']);
  const d = await roman.api.getHouseholdData('h1');
  assert.deepEqual(d.members.map((m) => [m.email, m.role, m.joined]), [['roman.kempa@exe.sk', 'owner', true], ['jana@gmail.com', 'member', false]]);
  const c1 = d.cinnosti.find((c) => c.id === 'c1');
  assert.deepEqual([c1.priestorId, c1.periodicity, c1.repeatInterval, c1.color, c1.assignedTo], ['p1', 'weekly', 2, '#2196F3', 'jana@gmail.com']);
  const c2 = d.cinnosti.find((c) => c.id === 'c2');
  assert.deepEqual(c2.items.map((i) => [i.text, i.qty, i.done]), [['Mlieko', '2 ks', true], ['Chlieb', '', false]]);
  assert.deepEqual([c2.kind, c2.store, c2.repeatInterval], ['nakup', 'Lidl', null]);
  assert.deepEqual(d.stores, ['Lidl']);
  assert.deepEqual(d.products, ['Mlieko', 'šunka']);

  // Jana sa prihlási Google účtom a hneď má obe domácnosti, otvorí sa jej Chata
  const jana = await t.user('jana@gmail.com');
  const js = await jana.api.getStartData();
  assert.deepEqual(js.households.map((h) => h.name).sort(), ['Byt', 'Chata']);
  assert.equal(js.lastDetail.household.name, 'Chata');
  assert.equal(js.nickname, ''); // prezývku si zvolí po prihlásení
});

test('opakovaný prenos nič nezdvojí ani nezmaže, zmeny v novej Gazde zostanú', async () => {
  // v novej Gazde medzitým: nová úloha a odškrtnutie
  const extra = await roman.api.addCinnost('h1', { name: 'Nová', dueDate: '2026-10-10', kind: 'nakup' });
  await roman.api.toggleItem('i2', true);
  const data = sheets();
  data.cinnosti[0].name = 'Umyť riad a linku'; // zmena v starej Gazde
  const { code } = await roman.api.createImportCode();
  const res = await post({ code, data });
  assert.equal(res.status, 200);
  const d = await roman.api.getHouseholdData('h1');
  assert.equal(d.cinnosti.filter((c) => c.id === 'c1').length, 1);
  assert.equal(d.cinnosti.find((c) => c.id === 'c1').name, 'Umyť riad a linku');
  assert.ok(d.cinnosti.some((c) => c.id === extra.id));
  // prenos prepíše stav položky podľa starej Gazdy (tam Chlieb nie je odškrtnutý)
  assert.equal(d.cinnosti.find((c) => c.id === 'c2').items.find((i) => i.id === 'i2').done, false);
  assert.equal(d.members.length, 2);
  assert.deepEqual(d.products, ['Mlieko', 'šunka']);
});

test('prenos bez vlastného členstva sa odmietne', async () => {
  const cudzi = await t.user('cudzi@example.com');
  const { code } = await cudzi.api.createImportCode();
  const res = await post({ code, data: sheets() });
  assert.equal(res.status, 403);
  assert.match(res.body.error, /nie si \(cudzi@example.com\) členom/);
  assert.equal((await post({ code: 'X', data: null })).status, 403);
});
