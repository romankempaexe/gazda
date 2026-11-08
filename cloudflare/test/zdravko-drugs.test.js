// Databáza liekov Zdravka (public/zdravko/drugs.js): platný formát, jedinečné názvy, známe oblasti.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const src = readFileSync(new URL('../public/zdravko/drugs.js', import.meta.url), 'utf8');
const ctx = { window: {} };
vm.runInNewContext(src, ctx);
const { categories, drugs } = ctx.window.ZDRAVKO_DRUGS;

test('databáza liekov je veľká a má platné záznamy', () => {
  assert.ok(drugs.length > 1000, 'aspoň 1000 prípravkov');
  const cats = new Set(categories.map((c) => c[0]));
  const names = new Set();
  for (const d of drugs) {
    assert.equal(d.length, 4, JSON.stringify(d));
    const [name, , forms, cat] = d;
    assert.ok(name && name.length <= 80, 'názov sa zmestí do záznamu: ' + name);
    assert.ok(forms, 'forma: ' + name);
    assert.ok(cats.has(cat), 'oblasť: ' + name);
    assert.ok(!names.has(name.toLowerCase()), 'duplicitný názov: ' + name);
    names.add(name.toLowerCase());
  }
  for (const c of cats) assert.ok(drugs.some((d) => d[3] === c), 'prázdna oblasť: ' + c);
});

test('bežné lieky proti horúčke sú v databáze s látkou', () => {
  const by = Object.fromEntries(drugs.map((d) => [d[0], d]));
  assert.match(by['Nurofen pre deti'][1], /ibuprofén/);
  assert.match(by['Paralen'][1], /paracetamol/);
  assert.match(by['Panadol Baby'][1], /paracetamol/);
});
