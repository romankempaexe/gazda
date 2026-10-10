// Doménová logika Gazdu (prenesená z apps_script/Code.gs, správanie je rovnaké).

export const PERIODICITIES = ['none', 'weekly', 'monthly', 'annually'];
export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
/** Hodnota assigned_to spoločnej činnosti – patrí všetkým členom domácnosti. */
export const ALL = '*';

export const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
export const COLOR_RE = /^#[0-9A-Fa-f]{6}$/;
export const MAX_ITEMS = 100;
export const MAX_ITEM_LENGTH = 100;
export const TIME_ZONE = 'Europe/Bratislava';

/** Chyba, ktorej text sa ukáže používateľovi (status = HTTP kód odpovede). */
export class AppError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

export function requireText(value, message) {
  const text = String(value ?? '').trim();
  if (!text) throw new AppError(message);
  return text;
}

export function parseEmails(value) {
  const list = Array.isArray(value) ? value : String(value ?? '').split(/[\s,;]+/);
  const emails = list.map((e) => String(e).trim().toLowerCase()).filter(Boolean);
  const invalid = emails.filter((e) => !EMAIL_RE.test(e));
  if (invalid.length) throw new AppError('Neplatný e-mail: ' + invalid.join(', '));
  return [...new Set(emails)];
}

export function nowIso() {
  return new Date().toISOString();
}

/** Dnešný dátum (yyyy-MM-dd) v časovej zóne domácností. */
export function todayYmd(date = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
}

// ---- Opakovanie ------------------------------------------------------------

/** Vypočíta ďalší termín opakovanej činnosti (dátumy vo formáte yyyy-MM-dd). */
export function nextDueDate(dueDate, periodicity, interval) {
  const [y, m, d] = dueDate.split('-').map(Number);
  let next;
  switch (periodicity) {
    case 'weekly':
      next = new Date(Date.UTC(y, m - 1, d + 7 * interval));
      break;
    case 'monthly':
      next = addMonthsClamped(y, m, d, interval);
      break;
    case 'annually':
      next = addMonthsClamped(y, m, d, 12 * interval);
      break;
    default:
      return dueDate;
  }
  return next.toISOString().slice(0, 10);
}

/** Pridá mesiace; ak deň v cieľovom mesiaci neexistuje (31. 2.), použije posledný deň. */
function addMonthsClamped(y, m, d, months) {
  const first = new Date(Date.UTC(y, m - 1 + months, 1));
  const lastDay = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate();
  return new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth(), Math.min(d, lastDay)));
}

/** Prvý termín po dnešku (aby hotová úloha po termíne nebola hneď znova po termíne). */
export function nextDueDateAfter(dueDate, periodicity, interval, today) {
  let next = nextDueDate(dueDate, periodicity, interval);
  for (let i = 0; next <= today && i < 1000; i++) next = nextDueDate(next, periodicity, interval);
  return next;
}

// ---- Položky checklistu a počet ----------------------------------------------

export function cleanItemText(text) {
  return String(text ?? '').replace(/\s+/g, ' ').trim().slice(0, MAX_ITEM_LENGTH);
}

// Jednotky počtu; „x“, „krát“ a samotné číslo znamenajú kusy.
const QTY_UNITS = {
  x: 'ks', '×': 'ks', 'krát': 'ks', ks: 'ks', kus: 'ks', kusy: 'ks', kusov: 'ks',
  kg: 'kg', dkg: 'dkg', g: 'g', l: 'l', dl: 'dl', ml: 'ml',
  bal: 'bal.', 'bal.': 'bal.', balenie: 'bal.', balenia: 'bal.', balení: 'bal.',
};
const QTY_NUM = '(\\d+(?:[.,]\\d+)?)';
const QTY_UNIT = '(x|×|krát|ks|kusy|kusov|kus|kg|dkg|g|l|dl|ml|bal\\.?|balenie|balenia|balení)';
const QTY_ONLY = new RegExp('^' + QTY_NUM + '\\s*' + QTY_UNIT + '$', 'i');
const QTY_PREFIX = new RegExp('^' + QTY_NUM + '\\s*' + QTY_UNIT + '?\\s+(.+)$', 'i');
const QTY_SUFFIX = new RegExp('^(.+?)\\s+' + QTY_NUM + '\\s*' + QTY_UNIT + '?$', 'i');
const QTY_TIMES = new RegExp('^(.+?)\\s+[x×]\\s*(\\d+)$', 'i');

function formatQty(num, unit) {
  return num.replace('.', ',') + ' ' + QTY_UNITS[String(unit || 'ks').toLowerCase()];
}

/**
 * Oddelí počet od názvu položky: „2x mlieko“, „mlieko 2 ks“, „1,5 kg zemiaky“,
 * „mlieko x2“ → { text: 'Mlieko', qty: '2 ks' }. Ak je počet zadaný zvlášť, má prednosť.
 */
export function splitQty(text, qty) {
  text = cleanItemText(text);
  qty = String(qty ?? '').replace(/\s+/g, ' ').trim().slice(0, 20);
  if (/^\d+(?:[.,]\d+)?$/.test(qty)) qty = formatQty(qty, 'ks');
  else if (qty) {
    const m = qty.match(QTY_ONLY);
    if (m) qty = formatQty(m[1], m[2]);
  }
  if (!qty) {
    let m = text.match(QTY_PREFIX);
    if (m) {
      qty = formatQty(m[1], m[2]);
      text = m[3];
    } else if ((m = text.match(QTY_TIMES))) {
      qty = formatQty(m[2], 'ks');
      text = m[1];
    } else if ((m = text.match(QTY_SUFFIX))) {
      qty = formatQty(m[2], m[3]);
      text = m[1];
    }
    if (qty) text = text.charAt(0).toUpperCase() + text.slice(1);
  }
  return { text, qty };
}

/** Kľúč pre porovnanie obchodov a produktov bez ohľadu na veľkosť písmen (aj s diakritikou). */
export function nameKey(name) {
  return String(name).trim().toLocaleLowerCase('sk');
}
