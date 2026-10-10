import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { setup } from './helpers.js';
import { b64urlDecode, b64urlEncode, encryptPayload, vapidAuthorization, generateVapidKeys } from '../src/webpush.js';
import { scheduledTick } from '../src/notifications.js';
import { sendDealAlerts, matchingOffer } from '../src/deals.js';

const enc = new TextEncoder();

/** Zariadenie odberateľa: kľúče ako v prehliadači (pushManager.subscribe). */
async function fakeDevice(name) {
  const pair = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const publicRaw = new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey));
  const auth = crypto.getRandomValues(new Uint8Array(16));
  return {
    pair,
    publicRaw,
    auth,
    subscription: {
      endpoint: 'https://push.example/' + name,
      keys: { p256dh: b64urlEncode(publicRaw), auth: b64urlEncode(auth) },
    },
  };
}

async function hkdf(salt, ikm, info, length) {
  const key = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info }, key, length * 8));
}

/** Dešifrovanie ako v prehliadači (RFC 8291) – overí, že obsah ide prečítať. */
async function decrypt(device, body) {
  body = new Uint8Array(body);
  const salt = body.slice(0, 16);
  assert.equal(new DataView(body.buffer).getUint32(16), 4096);
  const idlen = body[20];
  const asPublic = body.slice(21, 21 + idlen);
  const ciphertext = body.slice(21 + idlen);
  const asKey = await crypto.subtle.importKey('raw', asPublic, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const secret = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: asKey }, device.pair.privateKey, 256));
  const info = new Uint8Array([...enc.encode('WebPush: info\0'), ...device.publicRaw, ...asPublic]);
  const ikm = await hkdf(device.auth, secret, info, 32);
  const cek = await hkdf(salt, ikm, enc.encode('Content-Encoding: aes128gcm\0'), 16);
  const nonce = await hkdf(salt, ikm, enc.encode('Content-Encoding: nonce\0'), 12);
  const key = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['decrypt']);
  const plain = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: nonce }, key, ciphertext));
  assert.equal(plain[plain.length - 1], 2); // oddeľovač posledného záznamu
  return new TextDecoder().decode(plain.slice(0, -1));
}

// Zachytí požiadavky na push službu (ostatné, napr. lokálna D1, idú normálne).
const sent = [];
let pushStatus = 201;
const realFetch = globalThis.fetch;
globalThis.fetch = async (input, init) => {
  const url = typeof input === 'string' ? input : input.url;
  if (!url.startsWith('https://push.example/')) return realFetch(input, init);
  sent.push({ url, headers: init.headers, body: init.body });
  return new Response(null, { status: pushStatus });
};

let t, roman, jana, hid, romanPhone, janaPhone;
before(async () => {
  t = await setup();
  roman = await t.user('roman@exe.sk');
  jana = await t.user('jana@gmail.com');
  await roman.api.setNickname('Romi');
  await jana.api.setNickname('Janka');
  hid = (await roman.api.createHousehold('Byt', 'jana@gmail.com')).households[0].id;
  romanPhone = await fakeDevice('roman');
  janaPhone = await fakeDevice('jana');
});
after(() => {
  globalThis.fetch = realFetch;
  return t.dispose();
});

test('šifrovanie: obsah sa dá dešifrovať kľúčmi zariadenia, VAPID podpis sedí', async () => {
  const device = await fakeDevice('x');
  const body = await encryptPayload(device.subscription.keys, 'Ahoj Gazda 🏠');
  assert.equal(await decrypt(device, body), 'Ahoj Gazda 🏠');

  const vapid = await generateVapidKeys();
  const auth = await vapidAuthorization('https://push.example/abc', vapid, 'https://gazda.test');
  const [, jwt, k] = auth.match(/^vapid t=([^,]+), k=(.+)$/);
  assert.equal(k, vapid.publicKey);
  const [h, p, sig] = jwt.split('.');
  const claims = JSON.parse(new TextDecoder().decode(b64urlDecode(p)));
  assert.equal(claims.aud, 'https://push.example');
  assert.equal(claims.sub, 'https://gazda.test');
  assert.ok(claims.exp > Date.now() / 1000);
  const pub = await crypto.subtle.importKey('raw', b64urlDecode(vapid.publicKey), { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
  assert.ok(await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, pub, b64urlDecode(sig), enc.encode(h + '.' + p)));
});

test('odber: kľúč VAPID je stály, neplatný odber neprejde', async () => {
  const k1 = await roman.api.getPushKey();
  const k2 = await jana.api.getPushKey();
  assert.equal(k1.publicKey, k2.publicKey);
  assert.equal(b64urlDecode(k1.publicKey).length, 65);
  await assert.rejects(roman.api.subscribePush({ endpoint: 'http://zle', keys: {} }), /Neplatný odber/);
  assert.deepEqual(await roman.api.subscribePush(romanPhone.subscription), { ok: true });
  assert.deepEqual(await jana.api.subscribePush(janaPhone.subscription), { ok: true });
  assert.deepEqual(await jana.api.subscribePush(janaPhone.subscription), { ok: true }); // opakovane nevadí
});

test('nová pridelená úloha: Jane príde zašifrovaná správa s prezývkou, obchodom a checklistom', async () => {
  sent.length = 0;
  const c = await roman.api.addCinnost(hid, {
    name: 'Nakúpiť', dueDate: '2026-10-09', kind: 'nakup', store: 'Lidl', assignedTo: 'jana@gmail.com',
    items: ['2x mlieko', 'Chlieb'],
  });
  assert.equal(sent.length, 1);
  assert.equal(sent[0].url, janaPhone.subscription.endpoint);
  assert.equal(sent[0].headers['content-encoding'], 'aes128gcm');
  assert.match(sent[0].headers.authorization, /^vapid t=.+, k=.+$/);
  const msg = JSON.parse(await decrypt(janaPhone, sent[0].body));
  assert.equal(msg.title, '📝 Romi: Nakúpiť');
  assert.equal(msg.body, '🛒 Nákup: Lidl\nByt\nTermín: pi 9. 10.\nNakúpiť (2):\n☐ Mlieko – 2 ks\n☐ Chlieb');
  assert.equal(msg.tag, 'assigned-' + c.id);

  // sebe pridelená úloha ani úprava bez zmeny riešiteľa neupozorňuje
  sent.length = 0;
  await jana.api.addCinnost(hid, { name: 'Moja', dueDate: '2026-10-09', kind: 'nakup', assignedTo: 'jana@gmail.com' });
  await roman.api.updateCinnost(c.id, { ...c, name: 'Nakúpiť veľa' });
  assert.equal(sent.length, 0);
  // prehodenie na Romana -> upozornenie Romanovi
  await jana.api.updateCinnost(c.id, { ...c, assignedTo: 'roman@exe.sk' });
  assert.deepEqual(sent.map((s) => s.url), [romanPhone.subscription.endpoint]);
  assert.equal(JSON.parse(await decrypt(romanPhone, sent[0].body)).title, '📝 Janka: Nakúpiť');
});

test('skúšobná notifikácia a neplatný odber (410) sa zmaže', async () => {
  sent.length = 0;
  assert.deepEqual(await roman.api.testPush(), { sent: 1 });
  assert.match(JSON.parse(await decrypt(romanPhone, sent[0].body)).title, /Upozornenia fungujú/);
  pushStatus = 410;
  assert.deepEqual(await roman.api.testPush(), { sent: 0 });
  pushStatus = 201;
  const row = await t.env.DB.prepare('SELECT COUNT(*) AS n FROM push_subscriptions WHERE email = ?').bind('roman@exe.sk').first();
  assert.equal(row.n, 0);
  await roman.api.subscribePush(romanPhone.subscription);
});

test('ranný prehľad: o 8:00 raz denne, dnešné aj po termíne, len členom s upozorneniami', async () => {
  await jana.api.addCinnost(hid, { name: 'Smeti', dueDate: '2026-10-05', kind: 'nakup', assignedTo: 'roman@exe.sk' });
  await jana.api.addCinnost(hid, { name: 'Zajtra', dueDate: '2026-10-10', kind: 'nakup', assignedTo: 'roman@exe.sk' });
  sent.length = 0;
  // 7:59 v Bratislave (letný čas UTC+2) – ešte nič
  assert.equal(await scheduledTick(t.env.DB, new Date('2026-10-09T05:59:00Z')), 0);
  assert.equal(sent.length, 0);
  // 8:00 – Roman dostane dnešné aj po termíne, Jana svoju dnešnú „Moja“
  const n = await scheduledTick(t.env.DB, new Date('2026-10-09T06:00:00Z'));
  assert.equal(n, 3);
  const forRoman = await Promise.all(sent.filter((s) => s.url === romanPhone.subscription.endpoint).map((s) => decrypt(romanPhone, s.body)));
  const msgs = forRoman.map((m) => JSON.parse(m));
  assert.deepEqual(msgs.map((m) => m.title), ['🏠 Dnes ťa čaká 1 úloha', '⚠️ Po termíne: 1 úloha']);
  assert.equal(msgs[0].body, '• Nakúpiť (🛒 Lidl · 0/2 · Byt)'); // názov vrátila Janina úprava
  assert.equal(msgs[1].body, '• Smeti – od po 5. 10. (Byt)');
  // druhý beh v ten istý deň nič nepošle, ďalší deň áno
  sent.length = 0;
  assert.equal(await scheduledTick(t.env.DB, new Date('2026-10-09T06:15:00Z')), 0);
  assert.equal(await scheduledTick(t.env.DB, new Date('2026-10-10T06:00:00Z')) > 0, true);
});

test('spoločná činnosť (Všetci): upozornenie ostatným členom, v rannom prehľade u každého', async () => {
  sent.length = 0;
  const c = await roman.api.addCinnost(hid, { name: 'Spoločný nákup', dueDate: '2026-10-12', kind: 'nakup', assignedTo: '*', items: ['Mlieko'] });
  assert.equal(c.assignedTo, '*');
  assert.deepEqual(sent.map((s) => s.url), [janaPhone.subscription.endpoint]);
  assert.equal(JSON.parse(await decrypt(janaPhone, sent[0].body)).title, '📝 Romi: Spoločný nákup');
  // checklist môže plniť ktokoľvek
  await jana.api.toggleItem(c.items[0].id, true);
  sent.length = 0;
  await scheduledTick(t.env.DB, new Date('2026-10-12T06:00:00Z'));
  for (const [device, url] of [[romanPhone, romanPhone.subscription.endpoint], [janaPhone, janaPhone.subscription.endpoint]]) {
    const today = (await Promise.all(sent.filter((s) => s.url === url).map((s) => decrypt(device, s.body))))
      .map((m) => JSON.parse(m)).find((m) => m.tag === 'digest-today');
    assert.match(today.body, /Spoločný nákup \(1\/1 · Byt\)/);
  }
});

test('pripomienka v zadaný čas: raz, v čase termínu; zmena času ju znova zapne', async () => {
  await assert.rejects(roman.api.addCinnost(hid, { name: 'X', kind: 'nakup', dueDate: '2026-10-13', dueTime: '25:00', assignedTo: 'roman@exe.sk' }), /HH:MM/);
  const c = await roman.api.addCinnost(hid, { name: 'Vyniesť smeti', kind: 'nakup', dueDate: '2026-10-13', dueTime: '18:00', assignedTo: 'roman@exe.sk' });
  assert.equal(c.dueTime, '18:00');
  sent.length = 0;
  assert.equal(await scheduledTick(t.env.DB, new Date('2026-10-13T15:59:00Z')), 0); // 17:59 v Bratislave
  assert.equal(await scheduledTick(t.env.DB, new Date('2026-10-13T16:00:00Z')), 1);
  const msg = JSON.parse(await decrypt(romanPhone, sent[0].body));
  assert.equal(msg.title, '⏰ Vyniesť smeti');
  assert.match(msg.body, /^18:00 · 🛒 Nákup · Byt/);
  assert.equal(await scheduledTick(t.env.DB, new Date('2026-10-13T16:15:00Z')), 0); // len raz
  await roman.api.updateCinnost(c.id, { ...c, dueTime: '18:30' });
  assert.equal(await scheduledTick(t.env.DB, new Date('2026-10-13T16:30:00Z')), 1);
});

test('akcie na často kupované produkty: raz denne, každú akciu len raz', async () => {
  for (let i = 0; i < 2; i++) await roman.api.addCinnost(hid, { name: 'Nákup ' + i, kind: 'nakup', dueDate: '2026-10-20', assignedTo: 'roman@exe.sk', items: ['Mlieko'] });
  // stránka produktu na Kimbine (__NUXT_DATA__ sploštené ako v Nuxte)
  const flat = [];
  const add = (v) => {
    const i = flat.length;
    flat.push(null);
    flat[i] = v !== null && typeof v === 'object' ? (Array.isArray(v) ? v.map(add) : Object.fromEntries(Object.entries(v).map(([k, x]) => [k, add(x)]))) : v;
    return i;
  };
  add({ pinia: { products: { product: { name: 'Mlieko', shops: [{ id: 3, name: 'Billa', sef: 'billa' }] } }, brochures: { primaryGrid: [
    { id: 1, shop_id: 3, name: 'Rajo mlieko 1 l', price: '0,99 €', page: 2, sef: 'billa-letak-6132219', dateEnd: '2026-10-21T23:59:59Z' },
  ] } } });
  const html = '<script id="__NUXT_DATA__" type="application/json">' + JSON.stringify(flat) + '</script>';
  const kimbino = [];
  const fakeFetch = async (url, init) => {
    if (String(url).startsWith('https://www.kimbino.sk/')) {
      kimbino.push(String(url));
      return new Response(String(url).includes('mlieko') ? html : 'nič');
    }
    return globalThis.fetch(url, init);
  };
  sent.length = 0;
  const c = { db: t.env.DB, fetch: fakeFetch };
  assert.equal(await sendDealAlerts(c, new Date('2026-10-20T05:00:00Z')), 0); // 7:00 – ešte nie
  const n = await sendDealAlerts(c, new Date('2026-10-20T07:00:00Z')); // 9:00
  assert.ok(n >= 1);
  const msg = JSON.parse(await decrypt(romanPhone, sent.find((x) => x.url === romanPhone.subscription.endpoint).body));
  assert.equal(msg.title, '🏷 V akcii: Mlieko');
  assert.equal(msg.body, '• Mlieko – Billa 0,99 € (do 21. 10.)');
  assert.equal(await sendDealAlerts(c, new Date('2026-10-20T07:15:00Z')), 0); // raz denne
  sent.length = 0;
  assert.equal(await sendDealAlerts(c, new Date('2026-10-21T07:00:00Z')), 0); // tá istá akcia sa neopakuje
  assert.equal(matchingOffer('Maslo', [{ name: 'Arašidové maslo' }, { name: 'Rajo maslo' }]).name, 'Arašidové maslo');
  assert.equal(matchingOffer('Mlieko', [{ name: 'Syr' }]), null);
});

test('vypnutie upozornení na zariadení', async () => {
  await jana.api.unsubscribePush(janaPhone.subscription.endpoint);
  sent.length = 0;
  await roman.api.addCinnost(hid, { name: 'Pre Janu', dueDate: '2026-10-11', kind: 'nakup', assignedTo: 'jana@gmail.com' });
  assert.equal(sent.length, 0);
});
