import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { setup } from './helpers.js';

let t, roman, jana, cudzi, hid, kuchyna;

before(async () => {
  t = await setup();
  t.env.TODAY = '2026-10-07';
  roman = await t.user('roman@exe.sk');
  jana = await t.user('jana@gmail.com');
  cudzi = await t.user('cudzi@example.com');
});
after(() => t.dispose());

const rejects = (promise, re, status) =>
  assert.rejects(promise, (err) => {
    assert.match(err.message, re);
    if (status) assert.equal(err.status, status);
    return true;
  });

test('osobný kľúč: bez kľúča, neplatný a nahradený kľúč neprejdú', async () => {
  await rejects(t.call('', 'getHouseholds'), /^NEPLATNY_ODKAZ:/, 401);
  await rejects(t.call('f'.repeat(32), 'getHouseholds'), /^NEPLATNY_ODKAZ:/, 401);
  await rejects(t.call('<script>', 'getHouseholds'), /^NEPLATNY_ODKAZ:/, 401);
  const res = await roman.api.getHouseholds();
  assert.deepEqual(res, { email: 'roman@exe.sk', households: [] });
  // POST je povinný, neznáma funkcia 404
  assert.equal((await t.fetch('/api/getHouseholds')).status, 405);
  assert.equal((await t.fetch('/api/toString', { method: 'POST' })).status, 404);
  assert.equal((await t.fetch('/api/getHouseholds', { method: 'POST', body: '{zle' })).status, 400);
});

test('domácnosti: vytvorenie, zdieľanie a pozvánky', async () => {
  const res = await roman.api.createHousehold('  Byt  ', 'jana@gmail.com, novy@example.com, roman@exe.sk');
  assert.equal(res.households.length, 1);
  const h = res.households[0];
  hid = h.id;
  assert.equal(h.name, 'Byt');
  assert.equal(h.createdByEmail, 'roman@exe.sk');
  assert.deepEqual(
    h.members.map((m) => [m.email, m.role, m.hasLink]),
    [['roman@exe.sk', 'owner', true], ['jana@gmail.com', 'member', true], ['novy@example.com', 'member', true]]
  );
  // pozvánka len pre toho, kto ešte odkaz nemal
  assert.deepEqual(res.invites.map((i) => i.email), ['novy@example.com']);
  assert.match(res.invites[0].link, /^https:\/\/gazda\.test\/\?k=[0-9a-f]{32}$/);
  // pozvaný sa odkazom prihlási
  const novyToken = res.invites[0].link.split('k=')[1];
  assert.equal((await t.call(novyToken, 'getHouseholds')).households[0].id, hid);

  assert.equal((await jana.api.getHouseholds()).households[0].name, 'Byt');
  assert.deepEqual((await cudzi.api.getHouseholds()).households, []);

  await rejects(roman.api.createHousehold('  ', ''), /Zadaj názov domácnosti/);
  await rejects(roman.api.createHousehold('X', 'zly-email'), /Neplatný e-mail: zly-email/);
  await rejects(roman.api.shareHousehold(hid, 'jana@gmail.com'), /už zdieľaná s jana@gmail.com/);
  await rejects(roman.api.shareHousehold(hid, 'nie'), /platný e-mail/);
  await rejects(cudzi.api.shareHousehold(hid, 'x@y.sk'), /nemáš prístup/, 403);
  const shared = await roman.api.shareHousehold(hid, 'Babka@Example.com');
  assert.deepEqual(shared.invites.map((i) => i.email), ['babka@example.com']);
});

test('osobné odkazy členov a nový vlastný odkaz', async () => {
  // člen bez odkazu – odkaz vytvorí ktokoľvek z domácnosti
  await t.env.DB.prepare("UPDATE users SET token_hash = NULL WHERE email = 'babka@example.com'").run();
  const link = await jana.api.createMemberLink(hid, 'babka@example.com');
  assert.equal(link.replaced, false);
  // člen s odkazom – nový mu vytvorí len zakladateľ alebo on sám
  await rejects(jana.api.createMemberLink(hid, 'babka@example.com'), /len zakladateľ/, 403);
  assert.equal((await roman.api.createMemberLink(hid, 'babka@example.com')).replaced, true);
  await rejects(t.call(link.link.split('k=')[1], 'getHouseholds'), /NEPLATNY_ODKAZ/); // starý prestal platiť
  await rejects(roman.api.createMemberLink(hid, 'nikto@x.sk'), /nie je členom/);

  const fresh = await cudzi.api.regenerateMyLink();
  assert.equal(fresh.email, 'cudzi@example.com');
  assert.equal(fresh.link, 'https://gazda.test/?k=' + fresh.token);
  await rejects(cudzi.api.getHouseholds(), /NEPLATNY_ODKAZ/);
  cudzi.api = new Proxy({}, { get: (_, name) => (...args) => t.call(fresh.token, name, ...args) });
  assert.equal((await cudzi.api.getHouseholds()).email, 'cudzi@example.com');
});

test('priestory a validácia činnosti', async () => {
  kuchyna = await roman.api.addPriestor(hid, ' Kuchyňa ');
  assert.equal(kuchyna.name, 'Kuchyňa');
  await rejects(roman.api.addPriestor(hid, ''), /Zadaj názov priestoru/);
  await rejects(cudzi.api.addPriestor(hid, 'X'), /nemáš prístup/, 403);

  const base = { name: 'Umyť riad', priestorId: kuchyna.id, dueDate: '2026-10-07' };
  await rejects(roman.api.addCinnost(hid, { ...base, priestorId: '' }), /Vyber priestor/);
  await rejects(roman.api.addCinnost(hid, { ...base, priestorId: 'zly' }), /Vyber priestor/);
  await rejects(roman.api.addCinnost(hid, { ...base, kind: 'nakup', priestorId: 'zly' }), /Vyber priestor/);
  await rejects(roman.api.addCinnost(hid, { ...base, assignedTo: 'cudzi@example.com' }), /len členovi/);
  await rejects(roman.api.addCinnost(hid, { ...base, dueDate: '7.10.2026' }), /Zadaj termín/);
  await rejects(roman.api.addCinnost(hid, { ...base, name: ' ' }), /Zadaj názov činnosti/);
  await rejects(roman.api.addCinnost(hid, { ...base, periodicity: 'weekly', repeatInterval: 0 }), /aspoň 1/);
  await rejects(
    roman.api.addCinnost(hid, { ...base, items: Array.from({ length: 101 }, (_, i) => 'p' + i) }),
    /najviac 100/
  );
  await rejects(cudzi.api.addCinnost(hid, base), /nemáš prístup/, 403);

  const c = await roman.api.addCinnost(hid, { ...base, assignedTo: ' Jana@Gmail.com ', color: 'red', icon: 'dishes' });
  assert.deepEqual(
    { ...c, id: undefined, createdAt: undefined },
    {
      id: undefined, householdId: hid, priestorId: kuchyna.id, name: 'Umyť riad', description: '',
      assignedTo: 'jana@gmail.com', icon: 'dishes', color: '#4CAF50', dueDate: '2026-10-07',
      periodicity: 'none', repeatInterval: null, createdAt: undefined, kind: '', store: '', items: [],
    }
  );
});

test('nákup: bez priestoru, checklist s počtom, obchody a produkty na našepkávanie', async () => {
  const n = await jana.api.addCinnost(hid, {
    name: 'Nakúpiť', dueDate: '2026-10-07', kind: 'nakup', store: ' Lidl ', assignedTo: 'roman@exe.sk',
    items: ['2x mlieko', { text: 'Zemiaky', qty: '2kg' }, { text: '' }, 'Šunka', 'Mlieko 1,5%'],
  });
  assert.equal(n.priestorId, '');
  assert.equal(n.store, 'Lidl');
  assert.deepEqual(n.items.map((i) => [i.text, i.qty, i.done]), [
    ['Mlieko', '2 ks', false], ['Zemiaky', '2 kg', false], ['Šunka', '', false], ['Mlieko 1,5%', '', false],
  ]);
  // druhý nákup: obchod a produkty bez ohľadu na veľkosť písmen (aj s diakritikou)
  await roman.api.addCinnost(hid, { name: 'Nakúpiť', dueDate: '2026-10-08', kind: 'nakup', store: 'LIDL', items: ['šunka', 'Chlieb'] });
  await roman.api.addCinnost(hid, { name: 'Upratať', priestorId: kuchyna.id, dueDate: '2026-10-08', store: 'Tesco', items: ['Linka'] });

  const d = await roman.api.getHouseholdData(hid);
  assert.deepEqual(d.stores, ['Lidl']); // obchod sa pri bežnej činnosti nepamätá
  assert.equal(d.products[0], 'Šunka'); // najčastejšie prvé
  assert.deepEqual([...d.products].sort((a, b) => a.localeCompare(b, 'sk')), ['Chlieb', 'Linka', 'Mlieko', 'Mlieko 1,5%', 'Šunka', 'Zemiaky']);
  assert.equal(d.role, 'owner');
  assert.equal(d.household.name, 'Byt');
  assert.deepEqual(d.priestory.map((p) => p.name), ['Kuchyňa']);
  assert.equal(d.cinnosti.length, 4);
  assert.equal(d.cinnosti.find((x) => x.id === n.id).items.length, 4);
});

test('úprava činnosti: checklist zachová odškrtnutie, zmení počet a poradie', async () => {
  let c = (await roman.api.getHouseholdData(hid)).cinnosti.find((x) => x.store === 'Lidl' && x.dueDate === '2026-10-07');
  const [mlieko, zemiaky, sunka] = c.items;
  assert.equal((await jana.api.toggleItem(mlieko.id, true)).done, true);
  await rejects(cudzi.api.toggleItem(mlieko.id, true), /nemáš prístup/, 403);
  await rejects(jana.api.toggleItem('neexistuje', true), /Položka neexistuje/, 404);

  const updated = await roman.api.updateCinnost(c.id, {
    ...c,
    name: 'Veľký nákup',
    items: [{ id: zemiaky.id, text: 'Zemiaky', qty: '3' }, { id: mlieko.id, text: 'Mlieko', qty: '2 ks' }, '1 kg jabĺk'],
  });
  assert.equal(updated.name, 'Veľký nákup');
  assert.deepEqual(updated.items.map((i) => [i.text, i.qty, i.done]), [
    ['Zemiaky', '3 ks', false], ['Mlieko', '2 ks', true], ['Jabĺk', '1 kg', false],
  ]);
  assert.ok(!updated.items.some((i) => i.id === sunka.id)); // vymazaná

  const item = await jana.api.addItem(c.id, 'Vajcia', '10');
  assert.deepEqual({ ...item, id: undefined }, { id: undefined, text: 'Vajcia', qty: '10 ks', done: false });
  assert.equal((await jana.api.addItem(c.id, '3 citróny')).qty, '3 ks');
  await rejects(jana.api.addItem(c.id, '  '), /Zadaj položku/);
  c = (await roman.api.getHouseholdData(hid)).cinnosti.find((x) => x.id === c.id);
  assert.deepEqual(c.items.map((i) => i.text), ['Zemiaky', 'Mlieko', 'Jabĺk', 'Vajcia', 'Citróny']);

  await rejects(cudzi.api.updateCinnost(c.id, c), /nemáš prístup/, 403);
  await rejects(roman.api.updateCinnost('nie', c), /Činnosť neexistuje/, 404);
  await rejects(roman.api.updateCinnost(c.id, { ...c, kind: '' }), /Vyber priestor/);
});

test('hotové: jednorazová sa vymaže, opakovaná sa posunie za dnešok a odškrtnuté položky zmiznú', async () => {
  const once = await roman.api.addCinnost(hid, { name: 'Raz', priestorId: kuchyna.id, dueDate: '2026-10-07', items: ['a'] });
  assert.deepEqual(await roman.api.completeCinnost(once.id), { deleted: true });
  const left = await t.env.DB.prepare('SELECT COUNT(*) AS n FROM polozky WHERE cinnost_id = ?').bind(once.id).first();
  assert.equal(left.n, 0);

  // týždenná, po termíne (dnes je 7. 10.) -> prvý termín po dnešku
  const weekly = await roman.api.addCinnost(hid, {
    name: 'Smeti', priestorId: kuchyna.id, dueDate: '2026-09-20', periodicity: 'weekly', repeatInterval: 1, items: ['Vrecia', 'Kôš'],
  });
  await roman.api.toggleItem(weekly.items[0].id, true);
  const res = await jana.api.completeCinnost(weekly.id);
  assert.equal(res.deleted, false);
  assert.equal(res.cinnost.dueDate, '2026-10-11');
  assert.deepEqual(res.cinnost.items.map((i) => i.text), ['Kôš']);

  // mesačná 31. 1. -> posledný deň februára
  const monthly = await roman.api.addCinnost(hid, {
    name: 'Nájom', priestorId: kuchyna.id, dueDate: '2026-12-31', periodicity: 'monthly', repeatInterval: 2,
  });
  assert.equal((await roman.api.completeCinnost(monthly.id)).cinnost.dueDate, '2027-02-28');

  await rejects(cudzi.api.completeCinnost(monthly.id), /nemáš prístup/, 403);
  assert.deepEqual(await roman.api.deleteCinnost(monthly.id), { deleted: true });
  await rejects(roman.api.deleteCinnost(monthly.id), /Činnosť neexistuje/, 404);
});

test('štart: posledná otvorená domácnosť sa načíta rovno', async () => {
  const h2 = (await jana.api.createHousehold('Chata', '')).households.find((h) => h.name === 'Chata');
  await jana.api.getHouseholdData(h2.id);
  let start = await jana.api.getStartData();
  assert.equal(start.lastDetail.household.name, 'Chata');
  await jana.api.getHouseholdData(hid);
  start = await jana.api.getStartData();
  assert.equal(start.lastDetail.household.name, 'Byt');
  assert.equal(start.households.length, 2);
  assert.equal((await cudzi.api.getStartData()).lastDetail, undefined);
  await rejects(cudzi.api.getHouseholdData(hid), /nemáš prístup/, 403);
});

test('vymazanie domácnosti: len zakladateľ, zmaže všetko', async () => {
  await rejects(jana.api.deleteHousehold(hid), /len jej zakladateľ/, 403);
  const res = await roman.api.deleteHousehold(hid);
  assert.deepEqual(res.households, []);
  for (const table of ['households', 'members', 'priestory', 'cinnosti', 'polozky', 'obchody', 'produkty']) {
    const col = table === 'households' ? 'id' : 'household_id';
    const row = await t.env.DB.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE ${col} = ?`).bind(hid).first();
    assert.equal(row.n, 0, table);
  }
  // Janina druhá domácnosť zostala
  assert.deepEqual((await jana.api.getHouseholds()).households.map((h) => h.name), ['Chata']);
});
