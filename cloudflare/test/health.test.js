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
    assert.deepEqual(body.tables, [
      'calendar_feeds', 'cinnosti', 'config', 'historia', 'households', 'item_images', 'komentare', 'members', 'obchody', 'polozky', 'priestory', 'produkty',
      'push_subscriptions', 'quickstash_entries', 'sessions', 'skladko_groups', 'skladko_images', 'skladko_items', 'skladko_warehouses', 'users', 'zdravko_measurements', 'zdravko_members', 'zdravko_records', 'zdravko_reminders',
    ]);
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

test('manifest na inštaláciu na plochu', async () => {
  const t = await setup();
  try {
    const res = await t.fetch('/manifest.webmanifest');
    assert.equal(res.headers.get('content-type'), 'application/manifest+json; charset=utf-8');
    const m = await res.json();
    assert.equal(m.start_url, '/');
    assert.equal(m.display, 'standalone');
    assert.equal(m.icons.length, 3);
    assert.equal(m.id, '/'); // nainštalovaná Gazda sa zmení na Family Grid
    assert.equal(m.name, 'Family Grid');
    assert.ok(m.shortcuts.some((x) => x.url === '/gazda/?akcia=nakup'));
  } finally {
    await t.dispose();
  }
});

test('staré skratky Gazdy sa presmerujú na /gazda/', async () => {
  const t = await setup();
  try {
    const res = await t.fetch('/?akcia=nakup', { redirect: 'manual' });
    assert.equal(res.status, 302);
    assert.equal(res.headers.get('location'), 'https://gazda.test/gazda/?akcia=nakup');
  } finally {
    await t.dispose();
  }
});
