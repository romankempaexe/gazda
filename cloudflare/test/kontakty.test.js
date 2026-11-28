import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { setup } from './helpers.js';

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

const kt = (u) => new Proxy({}, { get: (_, name) => (...args) => t.call(u.cookie, 'kontakty/' + name, ...args) });

test('kontakty: pridanie, úprava, hviezdička, vymazanie a prístup rodiny', async () => {
  const { u, householdId } = await family('jana@example.com', 'peter@example.com');
  const api = kt(u);
  let data = await api.getData(householdId);
  assert.deepEqual(data.contacts, []);
  const rev0 = data.rev;

  const doc = await api.saveContact(householdId, { name: '  Detská   lekárka ', phone: ' +421 905 123 456 ', note: 'Po–Pi 7–12' });
  assert.equal(doc.name, 'Detská lekárka');
  assert.equal(doc.phone, '+421 905 123 456');
  assert.equal(doc.email, '');
  assert.equal(doc.favorite, false);
  await api.saveContact(householdId, { name: 'Škola', email: 'skola@example.sk' }); // len e-mail stačí
  await api.saveContact(householdId, { name: 'Záchranka', phone: '155', favorite: true });
  assert.ok((await api.getRev(householdId)) > rev0);

  // dôležité navrchu, ostatné podľa mena
  data = await api.getData(householdId);
  assert.deepEqual(data.contacts.map((c) => c.name), ['Záchranka', 'Detská lekárka', 'Škola']);

  // validácie
  await assert.rejects(api.saveContact(householdId, { name: '', phone: '123' }), /meno/);
  await assert.rejects(api.saveContact(householdId, { name: 'X' }), /číslo alebo e-mail/);
  await assert.rejects(api.saveContact(householdId, { name: 'X', phone: 'abc' }), /číslice/);
  await assert.rejects(api.saveContact(householdId, { name: 'X', phone: '12' }), /3 až 16/);
  await assert.rejects(api.saveContact(householdId, { name: 'X', phone: '123', email: 'zle' }), /E-mail/);

  // člen rodiny vidí a mení, cudzí nie
  const peter = await t.user('peter@example.com');
  const edited = await kt(peter).saveContact(householdId, { id: doc.id, name: 'MUDr. Nová', phone: '0905 123 456', email: 'nova@example.sk' });
  assert.equal(edited.email, 'nova@example.sk');
  await kt(peter).setFavorite(doc.id, true);
  data = await api.getData(householdId);
  assert.deepEqual(data.contacts.map((c) => c.name), ['MUDr. Nová', 'Záchranka', 'Škola']);

  const eva = await t.user('eva@example.com');
  await assert.rejects(kt(eva).getData(householdId), (e) => e.status === 403);
  await assert.rejects(kt(eva).deleteContact(doc.id), (e) => e.status === 403);
  await assert.rejects(kt(eva).saveContact(householdId, { name: 'X', phone: '123' }), (e) => e.status === 403);

  // dlaždica na rozcestníku
  const fam = await u.api.getFamily();
  assert.deepEqual(fam.overview.kontakty, { contacts: 3 });

  await kt(peter).deleteContact(doc.id);
  await assert.rejects(api.deleteContact(doc.id), (e) => e.status === 404);
  assert.equal((await api.getData(householdId)).contacts.length, 2);

  // vymazanie rodiny zmaže aj kontakty
  await u.api.deleteHousehold(householdId);
  const left = await t.env.DB.prepare('SELECT COUNT(*) AS n FROM kontakty_entries WHERE household_id = ?').bind(householdId).first();
  assert.equal(left.n, 0);
});

test('Family Grid pozná podaplikáciu Kontakty', async () => {
  const u = await t.user('ivo@example.com');
  assert.deepEqual(await u.api.setLastApp('kontakty'), { lastApp: 'kontakty' });
  const manifest = await (await t.fetch('/manifest.webmanifest')).json();
  assert.ok(manifest.shortcuts.some((s) => s.url === '/kontakty/'));
});
