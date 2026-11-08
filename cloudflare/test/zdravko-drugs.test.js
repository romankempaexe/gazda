// Databáza liekov Zdravka (public/zdravko/drugs.js zo zoznamu ŠÚKL, scripts/sukl_lieky.py).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const src = readFileSync(new URL('../public/zdravko/drugs.js', import.meta.url), 'utf8');
const ctx = { window: {} };
vm.runInNewContext(src, ctx);
const { source, categories, atc, drugs } = ctx.window.ZDRAVKO_DRUGS;

test('databáza liekov zo ŠÚKL má platné záznamy', () => {
  assert.match(source, /ŠÚKL/);
  assert.ok(drugs.length > 5000, 'tisíce prípravkov');
  const cats = new Set(categories.map((c) => c[0]));
  for (const [code, [, cat]] of Object.entries(atc)) assert.ok(cats.has(cat), 'oblasť ATC ' + code);
  const names = new Set();
  for (const d of drugs) {
    const [name, code, forms, otc] = d;
    assert.ok(name, 'názov');
    assert.ok(atc[code], 'ATC kód: ' + name);
    assert.ok(forms, 'forma: ' + name);
    assert.ok(otc === 0 || otc === 1, 'výdaj: ' + name);
    assert.ok(!names.has(name), 'duplicitný názov: ' + name);
    names.add(name);
  }
});

test('lieky proti horúčke majú látku pre pripomienky', () => {
  const by = Object.fromEntries(drugs.map((d) => [d[0], d]));
  assert.equal(by['Nurofen pre deti'][4], 'ibuprofen');
  assert.equal(by['Nurofen pre deti'][3], 1);
  const para = drugs.filter((d) => d[4] === 'paracetamol');
  assert.ok(para.length > 20, 'prípravky s paracetamolom');
  assert.ok(drugs.filter((d) => d[4] === 'ibuprofen').length > 20, 'prípravky s ibuprofénom');
});
