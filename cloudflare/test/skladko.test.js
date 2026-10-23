import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { setup } from './helpers.js';
import { mapSkladko, normalizeIcon, expirationYmd } from '../src/skladko/import.js';
import { sendSkladkoAlerts, expiryLabel } from '../src/skladko/notifications.js';

let t;
before(async () => {
  t = await setup();
  t.env.TODAY = '2026-10-23';
});
after(() => t.dispose());

async function family(email = 'jana@example.com', share = 'peter@example.com') {
  const u = await t.user(email);
  const { households } = await u.api.createHousehold('Doma', share);
  return { u, householdId: households[households.length - 1].id };
}

const sk = (u) => new Proxy({}, { get: (_, name) => (...args) => t.call(u.cookie, 'skladko/' + name, ...args) });

test('sklady, skupiny a položky; zdieľané v rodine', async () => {
  const { u, householdId } = await family();
  const api = sk(u);
  const w = await api.saveWarehouse(householdId, { name: ' Chladnička ', icon: 'kitchen', locationId: 'fridge' });
  assert.equal(w.name, 'Chladnička');
  const g = await api.saveGroup({ warehouseId: w.id, name: 'Mliečne' });
  const sub = await api.saveGroup({ warehouseId: w.id, parentId: g.id, name: 'Syry', icon: 'lunch_dining' });
  const item = await api.saveItem({ warehouseId: w.id, groupId: sub.id, name: 'Eidam', quantity: 2, minQty: 1, expirationDate: '2026-10-30' });
  assert.equal(item.groupId, sub.id);
  assert.equal(item.icon, 'inventory_2');

  // člen rodiny (Peter) vidí to isté
  const peter = await t.user('peter@example.com');
  const data = await sk(peter).getData(householdId);
  assert.deepEqual(data.warehouses.map((x) => x.name), ['Chladnička']);
  assert.equal(data.groups.length, 2);
  assert.equal(data.items[0].name, 'Eidam');

  // cudzí nie
  const eva = await t.user('eva@example.com');
  await assert.rejects(sk(eva).getData(householdId), /nemáš prístup/);
  await assert.rejects(sk(eva).deleteItem(item.id), /nemáš prístup/);

  await assert.rejects(api.saveItem({ warehouseId: w.id, name: '' }), /názov položky/);
  await assert.rejects(api.saveItem({ warehouseId: w.id, name: 'X', quantity: -1 }), /Množstvo/);
  await assert.rejects(api.saveItem({ warehouseId: w.id, name: 'X', expirationDate: 'zajtra' }), /Dátum/);
});

test('množstvo, presun a mazanie skupiny so všetkým vnútri', async () => {
  const { u, householdId } = await family('mara@example.com', '');
  const api = sk(u);
  const w1 = await api.saveWarehouse(householdId, { name: 'Špajza' });
  const w2 = await api.saveWarehouse(householdId, { name: 'Pivnica' });
  const g = await api.saveGroup({ warehouseId: w1.id, name: 'Konzervy' });
  const g2 = await api.saveGroup({ warehouseId: w1.id, parentId: g.id, name: 'Rybie' });
  const a = await api.saveItem({ warehouseId: w1.id, groupId: g2.id, name: 'Tuniak', quantity: 1 });
  const b = await api.saveItem({ warehouseId: w1.id, name: 'Múka', quantity: 3 });

  assert.equal((await api.changeQuantity(a.id, -1)).quantity, 0);
  assert.equal((await api.changeQuantity(a.id, -1)).quantity, 0); // nejde pod nulu
  assert.equal((await api.setQuantity(b.id, 7)).quantity, 7);

  // presun v rámci toho istého skladu (v starom Skládku položku zmazal)
  const moved = await api.moveItem(b.id, w1.id, g.id);
  assert.equal(moved.groupId, g.id);
  // do iného skladu
  assert.equal((await api.moveItem(b.id, w2.id, '')).warehouseId, w2.id);
  await assert.rejects(api.moveItem(b.id, w2.id, g.id), /nie je v tomto sklade/);

  // skupina do vlastnej podskupiny nejde
  await assert.rejects(api.moveGroup(g.id, w1.id, g2.id), /do nej samej/);
  await api.moveGroup(g.id, w2.id, '');
  let data = await api.getData(householdId);
  assert.ok(data.groups.every((x) => x.warehouseId === w2.id));
  assert.equal(data.items.find((x) => x.id === a.id).warehouseId, w2.id);

  await api.deleteGroup(g.id);
  data = await api.getData(householdId);
  assert.equal(data.groups.length, 0);
  assert.deepEqual(data.items.map((x) => x.name), ['Múka']);

  await api.deleteWarehouse(w2.id);
  data = await api.getData(householdId);
  assert.deepEqual(data.warehouses.map((x) => x.name), ['Špajza']);
  assert.equal(data.items.length, 0);
});

test('fotka položky: uloženie, načítanie a zmazanie', async () => {
  const { u, householdId } = await family('foto@example.com', '');
  const api = sk(u);
  const w = await api.saveWarehouse(householdId, { name: 'Garáž' });
  const jpeg = 'data:image/jpeg;base64,' + Buffer.from('JPEGDATA').toString('base64');
  const item = await api.saveItem({ warehouseId: w.id, name: 'Vŕtačka', image: jpeg });
  assert.match(item.image, /^\/api\/skladko\/image\/.+\?v=\d+$/);
  const res = await t.fetch(item.image, { headers: { cookie: u.cookie } });
  assert.equal(res.headers.get('content-type'), 'image/jpeg');
  assert.equal(Buffer.from(await res.arrayBuffer()).toString(), 'JPEGDATA');
  assert.equal((await t.fetch(item.image)).status, 401);

  // úprava bez image fotku ponechá, image: null ju zmaže
  assert.ok((await api.saveItem({ id: item.id, name: 'Vŕtačka Bosch' })).image);
  assert.equal((await api.saveItem({ id: item.id, name: 'Vŕtačka Bosch', image: null })).image, undefined);
  await assert.rejects(api.saveItem({ id: item.id, name: 'X', image: 'data:text/html;base64,AAAA' }), /Neplatná fotka/);
});

test('do nákupu v Gazde', async () => {
  const { u, householdId } = await family('nakup@example.com', '');
  const api = sk(u);
  const w = await api.saveWarehouse(householdId, { name: 'Špajza' });
  const item = await api.saveItem({ warehouseId: w.id, name: 'Ryža', quantity: 0 });
  const res = await api.addToShopping(item.id);
  assert.equal(res.name, 'Nákup'); // žiadny nákup nebol – vytvoril sa
  const detail = await u.api.getHouseholdData(householdId);
  const nakup = detail.cinnosti.find((x) => x.id === res.cinnostId);
  assert.equal(nakup.kind, 'nakup');
  assert.deepEqual(nakup.items.map((i) => i.text), ['Ryža']);
  // druhý raz do toho istého nákupu
  assert.equal((await api.addToShopping(item.id, res.cinnostId)).cinnostId, res.cinnostId);
  assert.equal((await api.getData(householdId)).shopping.length, 1);
});

test('upozornenia: končí trvanlivosť a dochádza – každé raz', async () => {
  const { u, householdId } = await family('alert@example.com', '');
  const api = sk(u);
  const w = await api.saveWarehouse(householdId, { name: 'Chladnička' });
  await api.saveItem({ warehouseId: w.id, name: 'Mlieko', expirationDate: '2026-10-24' });
  await api.saveItem({ warehouseId: w.id, name: 'Syr', expirationDate: '2026-11-30' });
  const egg = await api.saveItem({ warehouseId: w.id, name: 'Vajcia', quantity: 2, minQty: 2 });

  // odber s neplatnými kľúčmi – odoslanie zlyhá, ale položky sa označia (každá raz)
  await t.env.DB.prepare("INSERT INTO push_subscriptions (endpoint, email, p256dh, auth, created_at) VALUES ('https://push.example/a', 'alert@example.com', 'x', 'y', '')").run();
  {
    const morning = new Date('2026-10-23T07:30:00Z'); // 9:30 v Bratislave
    await sendSkladkoAlerts(t.env.DB, morning);
    const rows = (await t.env.DB.prepare('SELECT name, notified_exp, notified_low FROM skladko_items WHERE household_id = ? ORDER BY name').bind(householdId).all()).results;
    assert.deepEqual(rows, [
      { name: 'Mlieko', notified_exp: '2026-10-24', notified_low: 0 },
      { name: 'Syr', notified_exp: '', notified_low: 0 },
      { name: 'Vajcia', notified_exp: '', notified_low: 1 },
    ]);
    // doplnenie zruší príznak „dochádza“
    await api.changeQuantity(egg.id, 1);
    const egg2 = await t.env.DB.prepare('SELECT notified_low FROM skladko_items WHERE id = ?').bind(egg.id).first();
    assert.equal(egg2.notified_low, 0);
    // v noci nič
    assert.equal(await sendSkladkoAlerts(t.env.DB, new Date('2026-10-23T22:00:00Z')), 0);
  }
  assert.equal(expiryLabel('2026-10-24', '2026-10-23'), 'zajtra');
  assert.equal(expiryLabel('2026-10-21', '2026-10-23'), 'prešla 21. 10.');

  const overview = (await u.api.getFamily()).overview.skladko;
  assert.deepEqual(overview, { items: 3, low: 0, expiring: 1 });
});

// ---- Prenos z Firebase -------------------------------------------------------------------

const fsDoc = (path, fields) => ({ name: 'projects/skladko-test/databases/(default)/documents/' + path, fields });
const S = (v) => ({ stringValue: v });

test('prevod ikon a dátumov zo starého Skládka', () => {
  assert.equal(normalizeIcon('snacks_3', 'inventory_2'), 'fastfood');
  assert.equal(normalizeIcon('food_bank', 'inventory_2'), 'food_bank'); // nie kód kategórie
  assert.equal(normalizeIcon('oven', 'inventory_2'), 'kitchen');
  assert.equal(normalizeIcon('<script>', 'inventory_2'), 'inventory_2');
  // polnoc v telefóne (SEČ) = 23:00 UTC predchádzajúceho dňa
  assert.equal(expirationYmd('2026-11-04T23:00:00Z'), '2026-11-05');
  assert.equal(expirationYmd(null), '');
});

test('mapovanie: vymazané skupiny, staré položky', () => {
  const doc = (path, data) => ({ id: path.split('/').pop(), path: path.split('/'), data });
  const d = mapSkladko('H', 'a@b.c', {
    warehouses: [doc('users/U/warehouses/W1', { locationName: 'Špajza', icon: 'storage_1' })],
    groups: [
      doc('users/U/warehouses/W1/groups/G1', { name: 'Konzervy', parentGroupId: null }),
      doc('users/U/warehouses/W1/groups/G2', { name: 'Stratená', parentGroupId: 'VYMAZANA' }),
    ],
    items: [
      doc('users/U/warehouses/W1/inventory/I1', { name: 'Fazuľa', quantity: 2, groupId: 'G1' }),
      doc('users/U/warehouses/W1/inventory/I2', { name: 'Sirota', quantity: 1, groupId: 'VYMAZANA' }),
      doc('users/U/warehouses/W1/inventory/I3', { name: 'Stará', quantity: 1, category: 'Mliečne výrobky' }),
      doc('users/U/inventory/I4', { name: 'Prototyp', quantity: 5 }),
      doc('users/U/warehouses/WX/inventory/I5', { name: 'Z vymazaného skladu' }),
    ],
  });
  assert.deepEqual(d.warehouses.map((w) => [w.name, w.icon]), [['Špajza', 'inventory_2'], ['Staré položky', 'inventory']]);
  const found = d.groups.find((g) => g.name === 'Nájdené pri prenose');
  assert.ok(found);
  assert.equal(d.groups.find((g) => g.name === 'Stratená').parent_id, found.id);
  const byName = Object.fromEntries(d.items.map((i) => [i.name, i]));
  assert.equal(byName.Fazuľa.group_id, 'fb-G1');
  assert.equal(byName.Sirota.group_id, found.id);
  assert.equal(byName.Stará.group_id, ''); // bez groupId = priamo v sklade (v starom Skládku neviditeľná)
  assert.equal(byName.Stará.description, 'Kategória: Mliečne výrobky');
  assert.equal(byName.Prototyp.warehouse_id, 'fb-legacy');
  assert.equal(byName['Z vymazaného skladu'], undefined);
  assert.equal(d.orphans, 2);
});

test('prenos z Firebase: servisný účet, účet podľa e-mailu, opakovateľný', async () => {
  const { u, householdId } = await family('fb@example.com', '');
  const keys = await crypto.subtle.generateKey(
    { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
    true,
    ['sign', 'verify']
  );
  const pkcs8 = Buffer.from(await crypto.subtle.exportKey('pkcs8', keys.privateKey)).toString('base64');
  t.env.FIREBASE_SKLADKO_SA = JSON.stringify({
    type: 'service_account',
    project_id: 'skladko-test',
    client_email: 'import@skladko-test.iam.gserviceaccount.com',
    private_key: '-----BEGIN PRIVATE KEY-----\n' + pkcs8 + '\n-----END PRIVATE KEY-----\n',
    token_uri: 'https://oauth2.googleapis.com/token',
  });
  const calls = [];
  const img = 'https://firebasestorage.googleapis.com/v0/b/skladko-test/o/users%2FU%2Fitems%2F1.jpg?alt=media&token=t';
  t.env.TEST_FETCH = async (url, init = {}) => {
    url = String(url);
    calls.push(url);
    if (url === 'https://oauth2.googleapis.com/token') {
      assert.match(init.body, /assertion=/);
      return Response.json({ access_token: 'TOKEN' });
    }
    if (url.endsWith(':lookup') || url.endsWith('accounts:lookup')) {
      assert.equal(init.headers.authorization, 'Bearer TOKEN');
      const email = JSON.parse(init.body).email[0];
      return Response.json(email === 'fb@example.com' ? { users: [{ localId: 'U' }] } : {});
    }
    if (url.includes('/documents/users/U/warehouses?')) {
      return Response.json({ documents: [fsDoc('users/U/warehouses/W1', { locationName: S('Chladnička'), icon: S('kitchen'), createdAt: { timestampValue: '2026-01-10T10:00:00Z' } })] });
    }
    if (url.endsWith('/documents/users/U:runQuery')) {
      const what = JSON.parse(init.body).structuredQuery.from[0].collectionId;
      if (what === 'groups') return Response.json([{ document: fsDoc('users/U/warehouses/W1/groups/G1', { name: S('Mliečne'), parentGroupId: { nullValue: null } }) }, { readTime: 'x' }]);
      return Response.json([
        { document: fsDoc('users/U/warehouses/W1/inventory/I1', { name: S('Mlieko'), quantity: { integerValue: '3' }, groupId: S('G1'), expirationDate: { timestampValue: '2026-11-04T23:00:00Z' }, imageUrl: S(img) }) },
      ]);
    }
    if (url === img) return new Response('ORIGINAL', { headers: { 'content-type': 'image/jpeg' } });
    throw new Error('neočakávaná požiadavka ' + url);
  };
  try {
    const res = await sk(u).importFirebase(householdId);
    assert.deepEqual([res.warehouses, res.groups, res.items, res.orphans], [1, 1, 1, 0]);
    assert.deepEqual(res.images, [{ id: 'fb-I1', name: 'Mlieko' }]);
    let data = await sk(u).getData(householdId);
    assert.equal(data.items[0].expirationDate, '2026-11-05');
    assert.equal(data.items[0].quantity, 3);
    assert.equal(data.items[0].importImage, true);

    // fotka cez náš server → prehliadač ju zmenší a uloží
    const orig = await t.fetch('/api/skladko/import-image/fb-I1', { headers: { cookie: u.cookie } });
    assert.equal(await orig.text(), 'ORIGINAL');
    await sk(u).setItemImage('fb-I1', 'data:image/jpeg;base64,' + Buffer.from('SMALL').toString('base64'));
    assert.deepEqual(await sk(u).pendingImages(householdId), []);

    // opakovaný prenos nič nezdvojí a fotku nestratí
    await sk(u).setQuantity('fb-I1', 1);
    const again = await sk(u).importFirebase(householdId);
    assert.deepEqual(again.images, []);
    data = await sk(u).getData(householdId);
    assert.equal(data.items.length, 1);
    assert.equal(data.items[0].quantity, 3); // prepíše sa údajmi z Firebase
    assert.ok(data.items[0].image);

    // iný e-mail vo Firebase nie je
    const { u: other, householdId: h2 } = await family('nikto@example.com', '');
    await assert.rejects(sk(other).importFirebase(h2), /nie je účet s e-mailom nikto@example.com/);
  } finally {
    delete t.env.TEST_FETCH;
  }
  delete t.env.FIREBASE_SKLADKO_SA;
  await assert.rejects(sk(u).importFirebase(householdId), /nie je nastavený/);
});
