// Import tabuľky „Financie“ (Excel): na liste nájde nadpisy tabuliek Príjmy, Mesačné výdavky,
// Ročné výdavky a Kategórie výdavkov, pod nimi riadok s hlavičkou („Názov“, „Suma (€)“…) a číta
// riadky až po „Spolu“. Na poradí stĺpcov ani na tom, kde presne tabuľky na liste sú, nezáleží –
// stačí, že nadpis je nad stĺpcom s názvami. Zo súhrnu prečíta aktuálnu núdzovú rezervu.

import { readWorkbook } from './xlsx.js';

export const MONTHS = ['január', 'február', 'marec', 'apríl', 'máj', 'jún', 'júl', 'august', 'september', 'október', 'november', 'december'];

export const fold = (s) =>
  String(s ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();

/** „Marec“, „mar“, 3, „3.“ alebo dátum (číslo dňa z Excelu) → 1–12, inak 0. */
export function parseMonth(value) {
  if (typeof value === 'number') {
    if (Number.isInteger(value) && value >= 1 && value <= 12) return value;
    // dátum v Exceli = počet dní od 30. 12. 1899
    if (value > 59) return new Date(Date.UTC(1899, 11, 30) + Math.round(value) * 86400000).getUTCMonth() + 1;
    return 0;
  }
  const f = fold(value).replace(/\.$/, '');
  if (/^\d{1,2}$/.test(f) && Number(f) >= 1 && Number(f) <= 12) return Number(f);
  if (f.length < 3) return 0;
  const i = MONTHS.findIndex((m) => fold(m).startsWith(f.slice(0, 3)));
  return i + 1;
}

/** Suma z bunky → centy (číslo z Excelu alebo text „1 963,00 €“); prázdna/nečíselná → null. */
export function parseAmount(value) {
  if (typeof value === 'number') return Math.round(value * 100);
  const s = String(value ?? '')
    .replace(/[\s €]|EUR/gi, '')
    .replace(/\.(?=\d{3}(\D|$))/g, '')
    .replace(',', '.');
  if (!/^-?\d+(\.\d+)?$/.test(s)) return null;
  return Math.round(Number(s) * 100);
}

const SECTIONS = {
  income: (f) => f === 'prijmy' || f === 'prijem',
  monthly: (f) => f === 'mesacne vydavky',
  yearly: (f) => f === 'rocne vydavky',
  categories: (f) => f.startsWith('kategorie vydavkov') || f === 'kategorie',
};

/** Bunky listu → mriežka grid[row][col]. */
function toGrid(cells) {
  const grid = new Map();
  for (const c of cells) {
    if (!grid.has(c.row)) grid.set(c.row, new Map());
    grid.get(c.row).set(c.col, c.value);
  }
  return grid;
}

const at = (grid, row, col) => (grid.get(row) || new Map()).get(col);

/**
 * Tabuľka pod nadpisom: hlavička („Názov“, pri kategóriách „Kategória“) je v stĺpci nadpisu
 * najviac 3 riadky pod ním. Vráti { headerRow, cols: { 'suma (€)': col, … } } alebo null.
 */
function findHeader(grid, row, col, first) {
  for (let r = row + 1; r <= row + 3; r++) {
    if (!first.includes(fold(at(grid, r, col)))) continue;
    const cols = {};
    for (const [c, v] of grid.get(r)) if (c >= col && c <= col + 6 && typeof v === 'string') cols[fold(v)] ??= c;
    return { headerRow: r, cols };
  }
  return null;
}

const pick = (cols, test) => {
  const key = Object.keys(cols).find(test);
  return key === undefined ? null : cols[key];
};

/** Riadky tabuľky od hlavičky po „Spolu“ (alebo po 3 prázdne riadky za sebou). */
function rows(grid, header, col, maxRow) {
  const out = [];
  let empty = 0;
  for (let r = header.headerRow + 1; r <= maxRow && empty < 4; r++) {
    const name = at(grid, r, col);
    if (name === undefined) {
      empty++;
      continue;
    }
    empty = 0;
    if (fold(name) === 'spolu') break;
    out.push(r);
  }
  return out;
}

function parseSheet(cells) {
  const grid = toGrid(cells);
  const maxRow = Math.max(0, ...grid.keys());
  const found = {};
  for (const [r, cols] of [...grid].sort((a, b) => a[0] - b[0])) {
    for (const [c, v] of cols) {
      if (typeof v !== 'string') continue;
      const f = fold(v);
      for (const [key, test] of Object.entries(SECTIONS)) {
        if (found[key] || !test(f)) continue;
        const header = findHeader(grid, r, c, key === 'categories' ? ['kategoria', 'nazov'] : ['nazov']); // „Mesačné výdavky“ je aj v podkladoch pre grafy – tam hlavička nie je
        if (header) found[key] = { col: c, header };
      }
    }
  }
  if (!found.income && !found.monthly && !found.yearly) return null;

  const name = (r, col) => String(at(grid, r, col)).replace(/\s+/g, ' ').trim();
  const amountCol = (s) => pick(s.header.cols, (k) => k.startsWith('suma')) ?? s.col + 1;
  const items = [];
  const read = (kind, extra) => {
    const s = found[kind];
    if (!s) return;
    const aCol = amountCol(s);
    for (const r of rows(grid, s.header, s.col, maxRow)) {
      const n = name(r, s.col);
      const amount = parseAmount(at(grid, r, aCol));
      if (!n || typeof at(grid, r, s.col) !== 'string' || (amount !== null && amount < 0)) continue;
      items.push({ kind, name: n, amount: amount || 0, ...extra(r, s) });
    }
  };
  read('income', () => ({}));
  read('monthly', (r, s) => {
    const cCol = pick(s.header.cols, (k) => k.startsWith('kategori'));
    const cat = cCol === null ? '' : at(grid, r, cCol);
    return { category: cat === undefined ? '' : String(cat).trim() };
  });
  read('yearly', (r, s) => {
    const dCol = pick(s.header.cols, (k) => k.startsWith('splatn') || k.startsWith('mesiac'));
    return { dueMonth: dCol === null ? 0 : parseMonth(at(grid, r, dCol)) };
  });

  const categories = [];
  if (found.categories) {
    const s = found.categories;
    for (const r of rows(grid, s.header, s.col, maxRow)) {
      const n = name(r, s.col);
      if (n && typeof at(grid, r, s.col) === 'string' && !categories.some((x) => fold(x) === fold(n))) categories.push(n);
    }
  }

  // Núdzová rezerva: prvé číslo vpravo od „Aktuálna rezerva…“.
  let reserve = null;
  for (const [, cols] of grid) {
    const label = [...cols].find(([, v]) => typeof v === 'string' && fold(v).startsWith('aktualna rezerva'));
    if (!label) continue;
    const value = [...cols].sort((a, b) => a[0] - b[0]).find(([c, v]) => c > label[0] && parseAmount(v) !== null);
    if (value) reserve = Math.max(0, parseAmount(value[1]));
    break;
  }
  return { items, categories, reserve };
}

/** Súbor .xlsx → { items, categories, reserve } z prvého listu, ktorý vyzerá ako tabuľka Financie. */
export async function parseFinancieXlsx(bytes) {
  for (const sheet of await readWorkbook(bytes)) {
    const res = parseSheet(sheet.cells);
    if (res && res.items.length) return res;
  }
  return null;
}
