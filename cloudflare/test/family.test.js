import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { setup } from './helpers.js';

let t;
before(async () => {
  t = await setup();
  t.env.TODAY = '2026-10-23';
});
after(() => t.dispose());

test('rozcestník: rodiny, posledná podaplikácia a prehľad Gazdy', async () => {
  const jana = await t.user('jana@example.com');
  const start = await jana.api.getFamily();
  assert.equal(start.email, 'jana@example.com');
  assert.equal(start.lastApp, '');
  assert.deepEqual(start.overview.gazda, { today: 0, overdue: 0 });
  assert.deepEqual(start.overview.skladko, { items: 0, low: 0, expiring: 0 });

  const { households } = await jana.api.createHousehold('Doma', 'peter@example.com');
  const id = households[0].id;
  await jana.api.addCinnost(id, { name: 'Smeti', dueDate: '2026-10-23', assignedTo: 'jana@example.com', periodicity: 'none', kind: 'nakup' });
  await jana.api.addCinnost(id, { name: 'Okná', dueDate: '2026-10-20', assignedTo: '*', periodicity: 'none', kind: 'nakup' });
  await jana.api.addCinnost(id, { name: 'Peter', dueDate: '2026-10-20', assignedTo: 'peter@example.com', periodicity: 'none', kind: 'nakup' });

  await jana.api.setLastApp('skladko');
  const res = await jana.api.getFamily();
  assert.equal(res.lastApp, 'skladko');
  assert.equal(res.households.length, 1);
  assert.deepEqual(res.overview.gazda, { today: 1, overdue: 1 });
  await assert.rejects(jana.api.setLastApp('nieco'), /Neznáma aplikácia/);
});

test('rozcestník len pre prihlásených', async () => {
  await assert.rejects(t.call('', 'getFamily'), (err) => err.status === 401 && err.code === 'LOGIN_REQUIRED');
});

test('zdieľanie Family Grid: jedna rodina pre všetky podaplikácie, odobratie člena', async () => {
  const eva = await t.user('eva@example.com');
  const { households } = await eva.api.createHousehold('Novákovci', 'adam@example.com');
  const id = households[0].id;
  const second = (await eva.api.createHousehold('Chata', '')).households[1].id;

  await eva.api.setCurrentFamily(second);
  assert.equal((await eva.api.getFamily()).lastHouseholdId, second);
  // Gazda otvorí tú istú rodinu
  assert.equal((await eva.api.getStartData()).lastDetail.household.id, second);
  await eva.api.setCurrentFamily(id);

  const adam = await t.user('adam@example.com');
  // zdieľaná rodina = údaje všetkých podaplikácií
  const w = await t.call(eva.cookie, 'skladko/saveWarehouse', id, { name: 'Špajza' });
  assert.equal((await t.call(adam.cookie, 'skladko/getData', id)).warehouses[0].id, w.id);
  await t.call(eva.cookie, 'zdravko/saveMember', id, { name: 'Janko', birthDate: '2020-01-01' });
  assert.equal((await t.call(adam.cookie, 'zdravko/getData', id)).members.length, 1);

  assert.equal((await eva.api.renameFamily(id, ' Novákovci  doma ')).households[0].name, 'Novákovci doma');
  await assert.rejects(adam.api.removeFamilyMember(id, 'eva@example.com'), /Zakladateľa/);
  await assert.rejects(adam.api.setCurrentFamily(second), /nemáš prístup/);

  // zakladateľ odoberie Adama – stratí prístup ku všetkým podaplikáciám
  await eva.api.removeFamilyMember(id, 'adam@example.com');
  await assert.rejects(t.call(adam.cookie, 'skladko/getData', id), /nemáš prístup/);
  await assert.rejects(t.call(adam.cookie, 'zdravko/getData', id), /nemáš prístup/);
});
