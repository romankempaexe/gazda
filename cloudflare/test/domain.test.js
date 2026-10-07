import { test } from 'node:test';
import assert from 'node:assert/strict';
import { nameKey, nextDueDate, nextDueDateAfter, parseEmails, splitQty, todayYmd } from '../src/domain.js';

test('počet pri položke: rovnaké správanie ako vo verzii Apps Script', () => {
  const cases = [
    [['2x mlieko'], ['Mlieko', '2 ks']],
    [['mlieko 2 ks'], ['Mlieko', '2 ks']],
    [['1,5 kg zemiaky'], ['Zemiaky', '1,5 kg']],
    [['mlieko x2'], ['Mlieko', '2 ks']],
    [['Rožky 10'], ['Rožky', '10 ks']],
    [['Mlieko 1,5%'], ['Mlieko 1,5%', '']],
    [['7up'], ['7up', '']],
    [['2 balenia múky'], ['Múky', '2 bal.']],
    [['Coca cola 2l'], ['Coca cola', '2 l']],
    [['Chlieb'], ['Chlieb', '']],
    [['Mlieko', '3'], ['Mlieko', '3 ks']],
    [['Mlieko', '2kg'], ['Mlieko', '2 kg']],
    [['Mlieko', 'pol kila'], ['Mlieko', 'pol kila']],
    [['Vitamín B12'], ['Vitamín B12', '']],
    [['3 citróny'], ['Citróny', '3 ks']],
    [['mlieko', ''], ['mlieko', '']],
    [['Pivo 0.5 l'], ['Pivo', '0,5 l']],
    [['  veľa   medzier  '], ['veľa medzier', '']],
  ];
  for (const [args, [text, qty]] of cases) assert.deepEqual(splitQty(...args), { text, qty }, args.join(' | '));
  assert.equal(splitQty('x'.repeat(150)).text.length, 100);
});

test('opakovanie: týždenne, mesačne (koniec mesiaca), ročne (priestupný rok)', () => {
  assert.equal(nextDueDate('2026-10-07', 'weekly', 2), '2026-10-21');
  assert.equal(nextDueDate('2026-01-31', 'monthly', 1), '2026-02-28');
  assert.equal(nextDueDate('2028-01-31', 'monthly', 1), '2028-02-29');
  assert.equal(nextDueDate('2028-02-29', 'annually', 1), '2029-02-28');
  assert.equal(nextDueDate('2026-10-07', 'none', 1), '2026-10-07');
  assert.equal(nextDueDateAfter('2026-09-20', 'weekly', 1, '2026-10-07'), '2026-10-11');
  assert.equal(nextDueDateAfter('2026-10-06', 'weekly', 1, '2026-10-07'), '2026-10-13');
});

test('pomocné funkcie', () => {
  assert.deepEqual(parseEmails('A@b.sk; c@d.sk  a@B.sk'), ['a@b.sk', 'c@d.sk']);
  assert.throws(() => parseEmails('zle'), /Neplatný e-mail: zle/);
  assert.equal(nameKey(' ŠUNKA '), 'šunka');
  // polnoc v Bratislave je ešte predchádzajúci deň v UTC
  assert.equal(todayYmd(new Date('2026-10-06T22:30:00Z')), '2026-10-07');
  assert.equal(todayYmd(new Date('2026-01-15T22:30:00Z')), '2026-01-15');
});
