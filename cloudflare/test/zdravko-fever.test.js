// Kalkulačka liekov na teplotu (public/zdravko/fever.js) – porovnanie s tabuľkami
// MUDr. Moravčíkovej (https://www.drmoravcikova.sk/teplota-u-dietata/).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const ctx = { window: {} };
vm.runInNewContext(readFileSync(new URL('../public/zdravko/fever.js', import.meta.url), 'utf8'), ctx);
const { calc, ibuprofenSyrup, MEDS } = ctx.window.ZDRAVKO_FEVER;

test('ibuprofen sirup 20 mg/ml – rovnaké čísla ako tabuľka na stránke', () => {
  // váha: [dávka po 8 h, max. denná, max. po 6 h, max. po 8 h] v ml
  const page = {
    6: [2.5, 9, 2.2, 3], 8: [3.3, 12, 3.0, 4], 10: [4.2, 15, 3.7, 5], 12: [5.0, 18, 4.5, 6],
    14: [5.8, 21, 5.2, 7], 16: [6.7, 24, 6.0, 8], 18: [7.5, 27, 6.7, 9],
    20: [8.3, 30, 7.5, 10], // stránka uvádza 8,4 ml, presne 20 × 25 / 3 / 20 = 8,33 ml
  };
  for (const [w, [dose, day, h6, h8]] of Object.entries(page)) {
    const r = ibuprofenSyrup(MEDS.ibuprofen.forms.syrup20, Number(w));
    assert.deepEqual([r.ml, r.maxDayMl, r.max6hMl, r.max8hMl], [dose, day, h6, h8], w + ' kg');
  }
});

test('ibuprofen sirup 40 mg/ml – polovičné dávky', () => {
  const r = calc('ibuprofen', 'syrup40', 12);
  assert.equal(r.record.amount, 2.5);
  assert.match(r.dose, /^2,5 ml/);
  assert.equal(calc('ibuprofen', 'syrup20', 5).ok, false, 'pod 6 kg tabuľka nie je');
  assert.equal(calc('ibuprofen', 'syrup20', 25).ok, false, 'nad 20 kg tabuľka nie je');
});

test('paracetamol – riadky tabuliek, na hranici nižšia dávka', () => {
  const syr = (w) => calc('paracetamol', 'syrup', w).record?.amount;
  assert.deepEqual([6, 7.5, 8, 8.1, 10, 12, 13, 14, 15, 20, 21, 25, 29, 40, 42].map(syr), [4, 4, 4, 5, 5, 7, 7, 9, 9, 10, 10, 14, 14, 20, 20]);
  assert.equal(calc('paracetamol', 'syrup', 5).ok, false);
  assert.equal(calc('paracetamol', 'syrup', 43).ok, false);

  const supp = (w) => calc('paracetamol', 'supp', w).record?.amount;
  assert.deepEqual([4, 5, 5.5, 6, 7, 7.5, 10, 10.5, 11, 14, 14.5].map(supp), [0.5, 0.5, 0.5, 0.75, 0.75, 1, 1, 1, 1.5, 1.5, 1.5]);
  assert.equal(calc('paracetamol', 'supp', 3.5).ok, false);
  assert.equal(calc('paracetamol', 'supp', 15).ok, false);

  const tbl = (w) => calc('paracetamol', 'tablets', w).dose;
  assert.equal(tbl(9), '1 tabletka 125 mg');
  assert.equal(tbl(13), '1½ tabletky 125 mg');
  assert.equal(tbl(20), '2 tabletky 125 mg alebo ½ tabletky 500 mg');
  assert.equal(tbl(32), '¾ tabletky 500 mg (375 mg)');
  assert.equal(tbl(33), '1 tabletka 500 mg');
  assert.equal(calc('paracetamol', 'tablets', 8).ok, false);
});

test('ibuprofen čípky podľa váhy, tablety podľa veku', () => {
  assert.equal(calc('ibuprofen', 'supp', 6).dose, '1 čípok 60 mg');
  assert.equal(calc('ibuprofen', 'supp', 12).dose, '1 čípok 60 mg');
  assert.equal(calc('ibuprofen', 'supp', 12.5).dose, '1 čípok 125 mg');
  assert.equal(calc('ibuprofen', 'supp', 17).dose, '1 čípok 125 mg');
  assert.equal(calc('ibuprofen', 'supp', 18).ok, false);
  assert.equal(calc('ibuprofen', 'tablets', 0, 5).ok, false);
  assert.equal(calc('ibuprofen', 'tablets', 0, 8).dose, '1 tabletka 200 mg');
  assert.equal(calc('ibuprofen', 'tablets', 0, 12).dose, '1 – 2 tabletky 200 mg alebo 1 tabletka 400 mg');
});
