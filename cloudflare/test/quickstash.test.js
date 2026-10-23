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

const qs = (u) => new Proxy({}, { get: (_, name) => (...args) => t.call(u.cookie, 'quickstash/' + name, ...args) });

test('spoločné a súkromné položky v rodine', async () => {
  const { u, householdId } = await family('jana@example.com', 'peter@example.com');
  const api = qs(u);
  const wifi = await api.saveEntry(householdId, { name: ' Wi-Fi  doma ', value: 'tajne123', type: 'password' });
  assert.equal(wifi.name, 'Wi-Fi doma');
  assert.equal(wifi.type, 'password');
  assert.equal(wifi.private, false);
  const pin = await api.saveEntry(householdId, { name: 'PIN karta', value: '1234', type: 'password', private: true });
  await api.saveEntry(householdId, { name: 'IBAN', value: 'SK00 1100 0000 0000 0000 0000', type: 'iné' });

  let data = await api.getData(householdId);
  assert.deepEqual(data.entries.map((e) => e.name), ['IBAN', 'PIN karta', 'Wi-Fi doma']);
  assert.equal(data.entries[0].type, 'text');

  // člen rodiny vidí spoločné, nie Janine súkromné
  const peter = await t.user('peter@example.com');
  const pApi = qs(peter);
  data = await pApi.getData(householdId);
  assert.deepEqual(data.entries.map((e) => e.name), ['IBAN', 'Wi-Fi doma']);
  await assert.rejects(pApi.deleteEntry(pin.id), /neexistuje/);
  await assert.rejects(pApi.saveEntry(householdId, { id: pin.id, name: 'X', value: 'Y' }), /neexistuje/);
  // spoločnú môže meniť
  const changed = await pApi.saveEntry(householdId, { id: wifi.id, name: 'Wi-Fi doma', value: 'nove-heslo', type: 'password' });
  assert.equal(changed.value, 'nove-heslo');
  // Peter môže mať súkromnú s rovnakým názvom ako Janina súkromná (navzájom ich nevidia)
  await pApi.saveEntry(householdId, { name: 'PIN karta', value: '9999', private: true });

  // cudzí nič
  const eva = await t.user('eva@example.com');
  await assert.rejects(qs(eva).getData(householdId), /nemáš prístup/);
  await assert.rejects(qs(eva).deleteEntry(wifi.id), /nemáš prístup/);

  // validácie a jedinečný názov
  await assert.rejects(api.saveEntry(householdId, { name: '', value: 'x' }), /názov/);
  await assert.rejects(api.saveEntry(householdId, { name: 'X', value: '  ' }), /odkaz alebo heslo/);
  await assert.rejects(api.saveEntry(householdId, { name: 'wi-fi DOMA', value: 'x' }), /už existuje/);

  // verzia sa zvýši pri zmene
  const rev = await api.getRev(householdId);
  await api.deleteEntry(pin.id);
  assert.ok((await api.getRev(householdId)) > rev);

  // prehľad na dlaždici rozcestníka
  assert.deepEqual((await u.api.getFamily()).overview.quickstash, { entries: 2 });
  assert.deepEqual((await peter.api.getFamily()).overview.quickstash, { entries: 3 });
});

test('import zálohy z desktopového QuickStashu', async () => {
  const { u, householdId } = await family('mara@example.com', '');
  const api = qs(u);
  await api.saveEntry(householdId, { name: 'Wifi', value: 'stare', type: 'password', private: true });
  const backup = {
    wifi: { value: 'nove', password: true },
    gemini: { value: 'https://aistudio.google.com', password: false },
    dovolenky: { value: 'C:/Users/x/Dovolenka.xlsx', isFile: true, password: false },
    priecinok: { value: 'C:/Work', type: 'folder' },
    heslo: { value: 'abc', type: 'password' },
    prazdne: { value: '' },
    zle: 'nie je objekt',
  };
  let res = await api.importEntries(householdId, backup, 'merge', false);
  assert.equal(res.added, 4);
  assert.equal(res.updated, 1); // Wifi = wifi, ostane súkromná
  const byName = Object.fromEntries(res.data.entries.map((e) => [e.name, e]));
  assert.equal(byName.Wifi.value, 'nove');
  assert.equal(byName.Wifi.private, true);
  assert.equal(byName.dovolenky.type, 'text');
  assert.equal(byName.priecinok.type, 'text');
  assert.equal(byName.heslo.type, 'password');
  assert.equal(byName.gemini.private, false);

  // nahradenie súkromných: spoločné ostanú
  res = await api.importEntries(householdId, { nova: { value: 'x', type: 'text' } }, 'replace', true);
  assert.deepEqual(res.data.entries.map((e) => e.name).sort(), ['dovolenky', 'gemini', 'heslo', 'nova', 'priecinok']);
  assert.equal(res.data.entries.find((e) => e.name === 'nova').private, true);

  await assert.rejects(api.importEntries(householdId, { a: 'b' }, 'merge', true), /žiadne položky/);
  await assert.rejects(api.importEntries(householdId, [], 'merge', true), /Neplatný/);
});

test('odchod z rodiny zmaže súkromné položky, vymazanie rodiny všetko', async () => {
  const { u, householdId } = await family('ola@example.com', 'ivo@example.com');
  const ivo = await t.user('ivo@example.com');
  await qs(ivo).saveEntry(householdId, { name: 'Moje', value: 'x', private: true });
  await qs(ivo).saveEntry(householdId, { name: 'Spoločné', value: 'y' });
  await ivo.api.removeFamilyMember(householdId, 'ivo@example.com');
  assert.deepEqual((await qs(u).getData(householdId)).entries.map((e) => e.name), ['Spoločné']);
  const left = await t.env.DB.prepare("SELECT COUNT(*) AS n FROM quickstash_entries WHERE owner_email = 'ivo@example.com'").first();
  assert.equal(left.n, 0);

  await u.api.deleteHousehold(householdId);
  const rest = await t.env.DB.prepare('SELECT COUNT(*) AS n FROM quickstash_entries WHERE household_id = ?').bind(householdId).first();
  assert.equal(rest.n, 0);
});

test('setLastApp pozná QuickStash', async () => {
  const u = await t.user('nina@example.com');
  assert.deepEqual(await u.api.setLastApp('quickstash'), { lastApp: 'quickstash' });
  assert.equal((await u.api.getFamily()).lastApp, 'quickstash');
});
