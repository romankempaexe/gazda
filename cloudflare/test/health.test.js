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
