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
