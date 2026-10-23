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
