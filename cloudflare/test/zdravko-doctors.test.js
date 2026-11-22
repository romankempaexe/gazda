// Databáza lekárov Zdravka (public/zdravko/doctors.js z kódov poskytovateľov ÚDZS, scripts/udzs_lekari.py).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const src = readFileSync(new URL('../public/zdravko/doctors.js', import.meta.url), 'utf8');
const ctx = { window: {} };
vm.runInNewContext(src, ctx);
const { source, categories, spec, names, towns, rows } = ctx.window.ZDRAVKO_DOCTORS;

test('databáza lekárov z ÚDZS má platné záznamy', () => {
  assert.match(source, /ÚDZS/);
  assert.ok(rows.length > 15000, 'tisíce pracovísk');
  const cats = new Set(categories.map((c) => c[0]));
  for (const [code, [name, ...list]] of Object.entries(spec)) {
    assert.match(code, /^\d{3}$/, 'kód odbornosti');
    assert.ok(name, 'názov odbornosti ' + code);
    assert.ok(list.length && list.every((c) => cats.has(c)), 'kategória odbornosti ' + code);
  }
  const seen = new Set();
  for (const r of rows) {
    const [n, code, street, t, psc, er] = r;
    assert.ok(names[n], 'poskytovateľ');
    assert.ok(spec[code], 'odbornosť ' + code);
    assert.ok(street, 'ulica: ' + names[n]);
    assert.ok(towns[t], 'obec: ' + names[n]);
    assert.match(psc, /^\d{3} \d{2}$/, 'PSČ: ' + names[n]);
    assert.ok(er === undefined || er === 1, 'príznak pohotovosti');
    const key = r.join('|');
    assert.ok(!seen.has(key), 'duplicitné pracovisko: ' + key);
    seen.add(key);
  }
});

test('databáza má bežných lekárov rodiny vo veľkých mestách', () => {
  const count = (code, town) => rows.filter((r) => r[1] === code && towns[r[3]].startsWith(town)).length;
  for (const town of ['Bratislava', 'Košice', 'Žilina', 'Banská Bystrica']) {
    assert.ok(count('020', town) > 10, 'všeobecní lekári: ' + town);
    assert.ok(count('008', town) > 5, 'pediatri: ' + town);
    assert.ok(count('802', town) > 10, 'zubári: ' + town);
  }
  assert.equal(JSON.stringify(spec['008']), '["všeobecná starostlivosť o deti a dorast","kids"]');
  assert.equal(JSON.stringify(spec['020']), '["všeobecné lekárstvo","gp"]');
  assert.ok(spec['178'].includes('er') && spec['178'].includes('dent'), 'zubná pohotovosť');
});

test('vynechané sú mobilné odberové miesta, doprava a záchranka', () => {
  for (const code of ['647', '649', '179', '180']) assert.equal(spec[code], undefined, code);
});
