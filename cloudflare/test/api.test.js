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

test('domácnosti: vytvorenie a zdieľanie podľa e-mailu', async () => {
  const res = await roman.api.createHousehold('  Byt  ', 'jana@gmail.com, novy@example.com, roman@exe.sk');
  assert.equal(res.households.length, 1);
  const h = res.households[0];
  hid = h.id;
  assert.equal(h.name, 'Byt');
  assert.equal(h.createdByEmail, 'roman@exe.sk');
  // joined = už sa prihlásil do Gazdu
  assert.deepEqual(
    h.members.map((m) => [m.email, m.role, m.joined]),
    [['roman@exe.sk', 'owner', true], ['jana@gmail.com', 'member', true], ['novy@example.com', 'member', false]]
  );
  assert.equal(res.invites, undefined);
  // nový člen sa prihlási svojím Google účtom a domácnosť hneď vidí
  const novy = await t.user('novy@example.com');
  assert.equal((await novy.api.getHouseholds()).households[0].id, hid);

  assert.equal((await jana.api.getHouseholds()).households[0].name, 'Byt');
  assert.deepEqual((await cudzi.api.getHouseholds()).households, []);

  await rejects(roman.api.createHousehold('  ', ''), /Zadaj názov domácnosti/);
  await rejects(roman.api.createHousehold('X', 'zly-email'), /Neplatný e-mail: zly-email/);
  await rejects(roman.api.shareHousehold(hid, 'jana@gmail.com'), /už zdieľaná s jana@gmail.com/);
  await rejects(roman.api.shareHousehold(hid, 'nie'), /platný e-mail/);
  await rejects(cudzi.api.shareHousehold(hid, 'x@y.sk'), /nemáš prístup/, 403);
  const shared = await roman.api.shareHousehold(hid, 'Babka@Example.com');
  assert.deepEqual(
    shared.households[0].members.filter((m) => m.email === 'babka@example.com').map((m) => [m.role, m.joined]),
    [['member', false]]
  );
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
  assert.deepEqual(c.items.map((i) => i.text), ['Citróny', 'Vajcia', 'Zemiaky', 'Mlieko', 'Jabĺk']); // pridané idú na začiatok

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

test('prezývka: po prihlásení prázdna s návrhom z Google mena, potom ju vidia ostatní', async () => {
  const t2 = t;
  const peter = await t2.login(await (await import('./helpers.js')).signIdToken({ email: 'peter@x.sk', name: 'Peter  Novák' }));
  const call = (name, ...args) => t2.call(peter, name, ...args);
  let me = await call('getHouseholds');
  assert.deepEqual([me.nickname, me.suggestedNickname], ['', 'Peter']);
  await rejects(call('setNickname', '   '), /Zadaj prezývku/);
  await rejects(call('setNickname', 'x'.repeat(31)), /najviac 30/);
  assert.deepEqual(await call('setNickname', '  Peťo   N. '), { nickname: 'Peťo N.' });
  me = await call('getHouseholds');
  assert.equal(me.nickname, 'Peťo N.');
  // ostatní vidia prezývku pri členoch domácnosti
  const h = (await call('createHousehold', 'Garáž', 'jana@gmail.com')).households.find((x) => x.name === 'Garáž');
  const seen = await jana.api.getHouseholdData(h.id);
  assert.deepEqual(seen.members.map((m) => [m.email, m.nickname]), [['peter@x.sk', 'Peťo N.'], ['jana@gmail.com', '']]);
});


test('limit D1 (50 dotazov na požiadavku): úloha so 100 položkami potrebuje málo dotazov', async () => {
  const h = (await roman.api.createHousehold('Sklad', '')).households.find((x) => x.name === 'Sklad');
  const realDb = t.env.DB;
  let queries = 0;
  // Počítaj príkazy (aj tie v batch) – každý prepare je jeden dotaz.
  t.env.DB = new Proxy(realDb, {
    get(target, prop) {
      const v = target[prop];
      if (prop === 'prepare') return (...a) => (queries++, v.apply(target, a));
      return typeof v === 'function' ? v.bind(target) : v;
    },
  });
  try {
    const items = Array.from({ length: 100 }, (_, i) => 'Produkt ' + (i + 1) + ' x' + ((i % 3) + 1));
    queries = 0;
    const c = await roman.api.addCinnost(h.id, { name: 'Veľký nákup', dueDate: '2026-10-09', kind: 'nakup', store: 'Metro', items });
    const addQueries = queries;
    assert.equal(c.items.length, 100);
    assert.deepEqual([c.items[0].text, c.items[0].qty, c.items[99].text, c.items[99].qty], ['Produkt 1', '1 ks', 'Produkt 100', '1 ks']);

    // úprava: polovica preč, poradie otočené, jedna zmenená, dve nové
    await roman.api.toggleItem(c.items[10].id, true);
    const kept = c.items.slice(0, 50).reverse().map((i) => ({ id: i.id, text: i.text, qty: i.qty }));
    kept[0].text = 'Zmenený';
    queries = 0;
    const u = await roman.api.updateCinnost(c.id, { ...c, items: [...kept, 'Nový A', 'Nový B'] });
    const updateQueries = queries;
    assert.equal(u.items.length, 52);
    assert.equal(u.items[0].text, 'Zmenený');
    assert.equal(u.items[1].text, 'Produkt 49');
    assert.deepEqual(u.items.slice(-2).map((i) => i.text), ['Nový A', 'Nový B']);
    assert.equal(u.items.find((i) => i.text === 'Produkt 11').done, true); // odškrtnutie ostalo
    const products = (await roman.api.getHouseholdData(h.id)).products;
    assert.equal(products.length, 102);
    assert.ok(addQueries <= 15 && updateQueries <= 15, `dotazy: pridanie ${addQueries}, úprava ${updateQueries}`);
  } finally {
    t.env.DB = realDb;
  }
});

test('nové produkty sa zapamätajú hneď pri písaní, použitie pribudne pri uložení', async () => {
  const h = (await roman.api.createHousehold('Produkty', 'jana@gmail.com')).households.find((x) => x.name === 'Produkty');
  assert.deepEqual(await jana.api.rememberProducts(h.id, [' Kešu orechy ', 'kešu ORECHY', '', 'Ovsené vločky']), { ok: true });
  let d = await roman.api.getHouseholdData(h.id);
  assert.deepEqual([...d.products].sort(), ['Kešu orechy', 'Ovsené vločky']);
  await rejects(cudzi.api.rememberProducts(h.id, ['X']), /nemáš prístup/, 403);
  // uložený nákup s produktom ho posunie dopredu
  await roman.api.addCinnost(h.id, { name: 'Nákup', kind: 'nakup', dueDate: '2026-10-07', assignedTo: 'roman@exe.sk', items: ['Ovsené vločky'] });
  d = await roman.api.getHouseholdData(h.id);
  assert.equal(d.products[0], 'Ovsené vločky');
});

test('verzia domácnosti sa zmení pri každej zmene (nákup naživo)', async () => {
  const h = (await roman.api.createHousehold('Naživo', 'jana@gmail.com')).households.find((x) => x.name === 'Naživo');
  const r0 = await jana.api.getRev(h.id);
  const task = await roman.api.addCinnost(h.id, { name: 'Nákup', kind: 'nakup', dueDate: '2026-10-07', assignedTo: '*', items: ['Mlieko'] });
  const r1 = await jana.api.getRev(h.id);
  assert.ok(r1 > r0);
  await roman.api.toggleItem(task.items[0].id, true);
  const r2 = await jana.api.getRev(h.id);
  assert.ok(r2 > r1);
  assert.equal(await jana.api.getRev(h.id), r2); // bez zmeny rovnaká
  await rejects(cudzi.api.getRev(h.id), /nemáš prístup/, 403);
});
