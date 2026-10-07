import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setup } from './helpers.js';

test('health: databáza má všetky tabuľky', async () => {
  const t = await setup();
  try {
    const res = await t.fetch('/api/health');
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('cache-control'), 'no-store');
    const body = await res.json();
    assert.equal(body.ok, true);
    assert.deepEqual(body.tables, ['cinnosti', 'households', 'members', 'obchody', 'polozky', 'priestory', 'produkty', 'users']);
  } finally {
    await t.dispose();
  }
});

test('neznáma API cesta vráti 404, ostatné ide na statické súbory', async () => {
  const t = await setup();
  try {
    const res = await t.fetch('/api/nieco');
    assert.equal(res.status, 404);
    assert.match((await res.json()).error, /Neznáma/);
    assert.equal(await (await t.fetch('/')).text(), 'asset');
  } finally {
    await t.dispose();
  }
});

test('manifest: start_url s platným kľúčom, inak bez neho', async () => {
  const t = await setup();
  try {
    const k = 'ab'.repeat(16);
    let res = await t.fetch('/manifest.webmanifest?k=' + k);
    assert.equal(res.headers.get('content-type'), 'application/manifest+json; charset=utf-8');
    const m = await res.json();
    assert.equal(m.start_url, '/?k=' + k);
    assert.equal(m.display, 'standalone');
    assert.equal(m.icons.length, 3);
    res = await t.fetch('/manifest.webmanifest?k=<script>');
    assert.equal((await res.json()).start_url, '/');
  } finally {
    await t.dispose();
  }
});

test('správca: odkaz len so správnym heslom', async () => {
  const t = await setup();
  try {
    const post = (body) =>
      t.fetch('/api/admin/link', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    let res = await post({ adminKey: 'x', email: 'roman@exe.sk' });
    assert.equal(res.status, 404); // heslo nie je nastavené
    t.env.ADMIN_KEY = 'velmi-tajne-heslo-123';
    res = await post({ adminKey: 'zle-heslo', email: 'roman@exe.sk' });
    assert.equal(res.status, 403);
    res = await post({ adminKey: 'velmi-tajne-heslo-123', email: 'nie-email' });
    assert.equal(res.status, 400);
    res = await post({ adminKey: 'velmi-tajne-heslo-123', email: ' Roman@Exe.sk ' });
    const { result } = await res.json();
    assert.equal(result.email, 'roman@exe.sk');
    const token = result.link.split('k=')[1];
    assert.match(token, /^[0-9a-f]{32}$/);
    // odkaz funguje
    const me = await t.call(token, 'getHouseholds');
    assert.equal(me.email, 'roman@exe.sk');
  } finally {
    await t.dispose();
  }
});
