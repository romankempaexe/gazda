// Kalkulačka liekov na teplotu (public/zdravko/fever.js) – porovnanie s tabuľkami
// MUDr. Moravčíkovej (https://www.drmoravcikova.sk/teplota-u-dietata/).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const ctx = { window: {} };
vm.runInNewContext(readFileSync(new URL('../public/zdravko/fever.js', import.meta.url), 'utf8'), ctx);
const { calc } = ctx.window.ZDRAVKO_FEVER;

test('ibuprofen sirup 20 mg/ml – presne tabuľka zo stránky', () => {
  // váha: [dávka po 8 h, text max. dennej dávky]
  const page = {
    6: ['2,5', '9,0 ml (2,2 ml á 6 hod alebo 3,0 ml á 8 hod)'],
    8: ['3,3', '12,0 ml (3,0 ml á 6 hod alebo 4,0 ml á 8 hod)'],
    10: ['4,2', '15,0 ml (3,7 ml á 6 hod alebo 5,0 ml á 8 hod)'],
    12: ['5,0', '18,0 ml (4,5 ml á 6 hod alebo 6,0 ml á 8 hod)'],
    14: ['5,8', '21,0 ml (5,2 ml á 6 hod alebo 7,0 ml á 8 hod)'],
    16: ['6,7', '24,0 ml (6,0 ml á 6 hod alebo 8,0 ml á 8 hod)'],
    18: ['7,5', '27,0 ml (6,7 ml á 6 hod alebo 9,0 ml á 8 hod)'],
    20: ['8,4', '30,0 ml (7,5 ml á 6 hod alebo 10,0 ml á 8 hod)'],
  };
  for (const [w, [dose, max]] of Object.entries(page)) {
    const r = calc('ibuprofen', 'syrup20', Number(w));
    assert.equal(r.dose, dose + ' ml sirupu po 8 hod.', w + ' kg');
    assert.equal(r.lines[0], 'Max. denná dávka ' + max + '.', w + ' kg');
  }
  // medzi riadkami nižší riadok, mimo tabuľky nič
  assert.equal(calc('ibuprofen', 'syrup20', 7).dose, '2,5 ml sirupu po 8 hod.');
  assert.equal(calc('ibuprofen', 'syrup20', 15.9).dose, '5,8 ml sirupu po 8 hod.');
  assert.equal(calc('ibuprofen', 'syrup20', 20.5).dose, '8,4 ml sirupu po 8 hod.');
  assert.equal(calc('ibuprofen', 'syrup20', 5.9).ok, false);
  assert.equal(calc('ibuprofen', 'syrup20', 21).ok, false);
});

test('ibuprofen sirup 40 mg/ml – polovičné dávky', () => {
  assert.equal(calc('ibuprofen', 'syrup40', 8).dose, '1,65 ml sirupu po 8 hod.');
  assert.equal(calc('ibuprofen', 'syrup40', 12).record.amount, 2.5);
  assert.equal(calc('ibuprofen', 'syrup40', 20).dose, '4,2 ml sirupu po 8 hod.');
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
