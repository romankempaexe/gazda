import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { setup, signIdToken, CLIENT_ID } from './helpers.js';

let t;
before(async () => {
  t = await setup();
});
after(() => t.dispose());

const loginStatus = async (credential) => (await t.postJson('/api/auth/google', { credential })).status;

test('config: Client ID pre tlačidlo Google', async () => {
  const res = await t.fetch('/api/auth/config');
  assert.deepEqual(await res.json(), { result: { googleClientId: CLIENT_ID } });
});

test('prihlásenie: platný Google token vytvorí reláciu v bezpečnej cookie', async () => {
  const res = await t.postJson('/api/auth/google', {
    credential: await signIdToken({ email: 'Roman@Exe.sk', name: 'Roman', picture: 'https://p/x.jpg' }),
  });
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { result: { email: 'roman@exe.sk', name: 'Roman' } });
  const cookie = res.headers.get('set-cookie');
  assert.match(cookie, /^gazda_session=[0-9a-f]{64}; Path=\/; HttpOnly; Secure; SameSite=Lax; Max-Age=31536000$/);
  const session = cookie.split(';')[0];
  assert.equal((await t.call(session, 'getHouseholds')).email, 'roman@exe.sk');
  // v databáze nie je hodnota cookie, len jej odtlačok
  const row = await t.env.DB.prepare('SELECT * FROM sessions').first();
  assert.notEqual(row.id_hash, session.split('=')[1]);
  const u = await t.env.DB.prepare("SELECT * FROM users WHERE email = 'roman@exe.sk'").first();
  assert.equal(u.name, 'Roman');
  assert.ok(u.last_login);
});

test('prihlásenie: neplatné tokeny neprejdú', async () => {
  const other = await crypto.subtle.generateKey(
    { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
    true,
    ['sign']
  );
  const now = Math.floor(Date.now() / 1000);
  assert.equal(await loginStatus(await signIdToken({ email: 'a@b.sk', aud: 'iny-klient' })), 401);
  assert.equal(await loginStatus(await signIdToken({ email: 'a@b.sk', iss: 'https://zly.example' })), 401);
  assert.equal(await loginStatus(await signIdToken({ email: 'a@b.sk', exp: now - 3600 })), 401);
  assert.equal(await loginStatus(await signIdToken({ email: 'a@b.sk', email_verified: false })), 401);
  assert.equal(await loginStatus(await signIdToken({ email: 'a@b.sk' }, { key: other.privateKey })), 401); // cudzí podpis
  assert.equal(await loginStatus(await signIdToken({ email: 'a@b.sk' }, { kid: 'neznamy' })), 401);
  assert.equal(await loginStatus('nie.je.jwt'), 401);
  assert.equal(await loginStatus(''), 401);
  // podvrhnutý obsah s pôvodným podpisom
  const [h, , s] = (await signIdToken({ email: 'a@b.sk' })).split('.');
  const forged = Buffer.from(JSON.stringify({ iss: 'accounts.google.com', aud: CLIENT_ID, exp: now + 99, email: 'sef@b.sk', email_verified: true })).toString('base64url');
  assert.equal(await loginStatus(h + '.' + forged + '.' + s), 401);
});

test('bez prihlásenia: 401 s kódom LOGIN_REQUIRED; len JSON; odhlásenie zruší reláciu', async () => {
  await assert.rejects(t.call('', 'getHouseholds'), (e) => e.status === 401 && e.code === 'LOGIN_REQUIRED');
  await assert.rejects(t.call('gazda_session=' + 'f'.repeat(64), 'getHouseholds'), (e) => e.status === 401);

  const roman = await t.user('roman@exe.sk');
  // formulár z cudzej stránky (nie JSON) neprejde ani s cookie
  const form = await t.fetch('/api/createHousehold', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', cookie: roman.cookie },
    body: 'args=x',
  });
  assert.equal(form.status, 415);
  assert.equal((await t.fetch('/api/getHouseholds', { headers: { cookie: roman.cookie } })).status, 405);

  // druhé zariadenie má vlastnú reláciu; odhlásenie jedného neodhlási druhé
  const tablet = await t.user('roman@exe.sk');
  const out = await t.postJson('/api/auth/logout', {}, roman.cookie);
  assert.match(out.headers.get('set-cookie'), /^gazda_session=; .*Max-Age=0$/);
  await assert.rejects(roman.api.getHouseholds(), (e) => e.code === 'LOGIN_REQUIRED');
  assert.equal((await tablet.api.getHouseholds()).email, 'roman@exe.sk');
});

test('prihlásenie nie je nastavené (chýba Client ID)', async () => {
  const id = t.env.GOOGLE_CLIENT_ID;
  t.env.GOOGLE_CLIENT_ID = '';
  try {
    assert.equal(await loginStatus(await signIdToken({ email: 'a@b.sk' })), 503);
    assert.deepEqual(await (await t.fetch('/api/auth/config')).json(), { result: { googleClientId: '' } });
  } finally {
    t.env.GOOGLE_CLIENT_ID = id;
  }
});
