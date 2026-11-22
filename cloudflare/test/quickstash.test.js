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

test('synchronizácia so súborom na Google Drive: súbor je hlavný, ručné položky ostanú', async () => {
  const { u, householdId } = await family('sync@example.com');
  const api = qs(u);
  const file = { id: 'drive-file-id-123', name: 'data.json' };
  await api.saveEntry(householdId, { name: 'Ručná', value: 'z aplikácie' });
  let res = await api.syncFile(householdId, file, { 'Wi-Fi': { value: 'heslo1', type: 'password' }, IBAN: { value: 'SK11' } }, true);
  assert.deepEqual([res.added, res.updated, res.removed], [2, 0, 0]);
  assert.deepEqual(res.data.sync, { fileId: file.id, fileName: 'data.json', private: true, syncedAt: res.data.sync.syncedAt });
  assert.ok(res.data.entries.find((e) => e.name === 'Wi-Fi').private);
  assert.ok(res.data.entries.find((e) => e.name === 'Wi-Fi').synced);

  // v súbore zmenené heslo, zmazaný IBAN, nová adresa
  const rev = await api.getRev(householdId);
  res = await api.syncFile(householdId, file, { 'Wi-Fi': { value: 'heslo2', type: 'password' }, Adresa: { value: 'Hlavná 1' } }, true);
  assert.deepEqual([res.added, res.updated, res.removed], [1, 1, 1]);
  assert.deepEqual(res.data.entries.map((e) => e.name), ['Adresa', 'Ručná', 'Wi-Fi']);
  assert.equal(res.data.entries.find((e) => e.name === 'Wi-Fi').value, 'heslo2');
  assert.ok((await api.getRev(householdId)) > rev);

  // rovnaký obsah – nič sa nezmení
  const rev2 = await api.getRev(householdId);
  res = await api.syncFile(householdId, file, { 'Wi-Fi': { value: 'heslo2', type: 'password' }, Adresa: { value: 'Hlavná 1' } }, true);
  assert.deepEqual([res.added, res.updated, res.removed], [0, 0, 0]);
  assert.equal(await api.getRev(householdId), rev2);

  // ručná položka s rovnakým názvom ako v súbore sa prepíše a odvtedy patrí súboru
  res = await api.syncFile(householdId, file, { 'Wi-Fi': { value: 'heslo2', type: 'password' }, Ručná: { value: 'zo súboru' } }, true);
  assert.deepEqual([res.added, res.updated, res.removed], [0, 1, 1]);
  assert.equal(res.data.entries.find((e) => e.name === 'Ručná').value, 'zo súboru');

  await assert.rejects(api.syncFile(householdId, { id: 'x' }, { A: { value: 'b' } }, true), /Neplatný súbor/);
  await assert.rejects(api.syncFile(householdId, file, {}, true), /žiadne položky/);

  // zrušenie prepojenia – položky ostanú, už nie sú zo súboru
  const data = await api.unlinkSync(householdId);
  assert.equal(data.sync, null);
  assert.equal(data.entries.length, 2);
  assert.ok(data.entries.every((e) => !e.synced));
});

// ---- Zámok biometriou (WebAuthn) – softvérový kľúč namiesto odtlačku prsta ----

const b64 = (bytes) => Buffer.from(bytes).toString('base64url');
const enc = new TextEncoder();

function rawToDer(raw) {
  const int = (b) => {
    let i = 0;
    while (i < b.length - 1 && b[i] === 0) i++;
    b = b.subarray(i);
    return b[0] & 0x80 ? [0x02, b.length + 1, 0, ...b] : [0x02, b.length, ...b];
  };
  const body = [...int(raw.subarray(0, 32)), ...int(raw.subarray(32))];
  return new Uint8Array([0x30, body.length, ...body]);
}

async function authenticator() {
  const keys = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  const rpHash = new Uint8Array(await crypto.subtle.digest('SHA-256', enc.encode('gazda.test')));
  const authData = (flags = 0x05) => new Uint8Array([...rpHash, flags, 0, 0, 0, 1]);
  const id = b64(crypto.getRandomValues(new Uint8Array(16)));
  return {
    id,
    async create(begin, extra = {}) {
      const clientData = enc.encode(JSON.stringify({ type: 'webauthn.create', challenge: begin.challenge, origin: 'https://gazda.test' }));
      return {
        id,
        alg: -7,
        publicKey: b64(new Uint8Array(await crypto.subtle.exportKey('spki', keys.publicKey))),
        clientDataJSON: b64(clientData),
        authenticatorData: b64(authData()),
        device: 'Test telefón',
        ...extra,
      };
    },
    async get(begin, { flags, origin = 'https://gazda.test', challenge = begin.challenge } = {}) {
      const clientData = enc.encode(JSON.stringify({ type: 'webauthn.get', challenge, origin }));
      const ad = authData(flags);
      const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', clientData));
      const sig = new Uint8Array(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, keys.privateKey, new Uint8Array([...ad, ...hash])));
      return { id, clientDataJSON: b64(clientData), authenticatorData: b64(ad), signature: b64(rawToDer(sig)) };
    },
  };
}

test('zámok biometriou: bez odomknutia server položky nevydá', async () => {
  const { u, householdId } = await family('lock@example.com');
  const api = qs(u);
  await api.saveEntry(householdId, { name: 'PIN', value: '1234', type: 'password' });
  assert.deepEqual(await api.getLock(), { enabled: false, unlocked: true, devices: [] });
  assert.equal(await api.lockNow().then(() => api.getData(householdId)).then((d) => d.entries.length), 1); // bez zámku nič

  const key = await authenticator();
  const lock = await api.lockEnable(await key.create(await api.lockBegin()));
  assert.equal(lock.enabled, true);
  assert.equal(lock.unlocked, true);
  assert.equal(lock.devices[0].device, 'Test telefón');
  // výzva sa nedá použiť druhýkrát
  await assert.rejects(api.lockEnable(await key.create({ challenge: 'stara' })), /vypršalo/);

  // zamknuté → nič nevydá, ani zmeny
  await api.lockNow();
  assert.deepEqual(await api.getLock(), { enabled: true, unlocked: false, devices: [] });
  await assert.rejects(api.getData(householdId), (err) => err.code === 'QS_LOCKED' && err.status === 403);
  await assert.rejects(api.saveEntry(householdId, { name: 'X', value: 'Y' }), (err) => err.code === 'QS_LOCKED');
  await assert.rejects(api.syncFile(householdId, { id: 'drive-file-id-123' }, { A: { value: 'b' } }, true), (err) => err.code === 'QS_LOCKED');
  // nový kľúč ani vypnutie bez odomknutia
  await assert.rejects(api.lockBegin(), (err) => err.code === 'QS_LOCKED');
  await assert.rejects(api.lockDisable(), (err) => err.code === 'QS_LOCKED');
  assert.equal(typeof (await api.getRev(householdId)), 'number'); // len číslo verzie smie

  // zlé odomknutia
  await assert.rejects(api.unlock(await key.get(await api.unlockBegin(), { flags: 0x01 })), /neoverilo/);
  await assert.rejects(api.unlock(await key.get(await api.unlockBegin(), { origin: 'https://zla.test' })), /inej adresy/);
  await assert.rejects(api.unlock(await key.get(await api.unlockBegin(), { challenge: 'vymyslena' })), /vypršalo/);
  const other = await authenticator();
  await assert.rejects(api.unlock(await other.get(await api.unlockBegin())), /nepatrí/);
  const bad = await key.get(await api.unlockBegin());
  bad.signature = (await key.get({ challenge: 'iny' })).signature;
  await assert.rejects(api.unlock(bad), /nepodarilo/);

  // iné zariadenie (relácia) toho istého človeka je tiež zamknuté
  const second = await t.user('lock@example.com');
  await assert.rejects(qs(second).getData(householdId), (err) => err.code === 'QS_LOCKED');

  // správne odomknutie – len toto zariadenie
  assert.deepEqual(await api.unlock(await key.get(await api.unlockBegin())), { ok: true });
  assert.equal((await api.getData(householdId)).entries.length, 1);
  await assert.rejects(qs(second).getData(householdId), (err) => err.code === 'QS_LOCKED');
  // druhé zariadenie sa odomkne tým istým kľúčom (prístupový kľúč z telefónu)
  await qs(second).unlock(await key.get(await qs(second).unlockBegin()));
  assert.equal((await qs(second).getData(householdId)).entries.length, 1);

  // člen rodiny bez zámku nie je ovplyvnený; vypnutie zámku
  const off = await api.lockDisable();
  assert.equal(off.enabled, false);
  await api.lockNow();
  assert.equal((await api.getData(householdId)).entries.length, 1);
});
