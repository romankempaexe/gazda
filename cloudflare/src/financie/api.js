// Financie – API (POST /api/financie/<funkcia>): rodinný rozpočet podľa tabuľky „Financie“
// (Excel) ako podaplikácia Family Grid. Príjmy, mesačné výdavky s kategóriou, ročné výdavky
// s mesiacom splatnosti a núdzová rezerva. Patria rodine – vidia a menia ich všetci jej členovia.
//
// Server len ukladá; súčty, percentá a finančné zdravie počíta aplikácia (public/financie/app.js).

import { requireFamilyMember } from '../family.js';
import { AppError, nowIso, requireText } from '../domain.js';
import { fold, parseFinancieXlsx } from './excel.js';

const uuid = () => crypto.randomUUID();
const MAX_NAME = 80;
const MAX_AMOUNT = 100_000_000; // centy = 1 milión €
const MAX_ITEMS = 300;
const MAX_CATEGORIES = 40;
const MAX_XLSX = 700 * 1024;
export const KINDS = ['income', 'monthly', 'yearly'];

// Kategórie novej rodiny (ako v tabuľke Financie) – posledná je sporenie.
const DEFAULT_CATEGORIES = ['Bývanie', 'Jedlo', 'Doprava', 'Zábava', 'Zdravie', 'Predplatné', 'Ostatné', 'Sporenie'];
const looksLikeSaving = (name) => /^(sporen|usporn|invest|dochodok)/.test(fold(name));

const toItem = (r) => ({
  id: r.id,
  kind: r.kind,
  name: r.name,
  amount: r.amount,
  categoryId: r.category_id,
  dueMonth: r.due_month,
  sort: r.sort,
});
const toCategory = (r) => ({ id: r.id, name: r.name, sort: r.sort, saving: Boolean(r.is_saving) });

// ---- Kontroly -----------------------------------------------------------------------

async function findRow(c, table, id, message) {
  const row = await c.db.prepare(`SELECT * FROM ${table} WHERE id = ?`).bind(String(id ?? '')).first();
  if (!row) throw new AppError(message, 404);
  await requireFamilyMember(c, row.household_id);
  return row;
}

function cleanName(name, message) {
  name = requireText(String(name ?? '').replace(/\s+/g, ' '), message);
  if (name.length > MAX_NAME) throw new AppError('Názov môže mať najviac ' + MAX_NAME + ' znakov.');
  return name;
}

/** Suma v centoch (celé číslo 0 … 1 000 000 €). */
function cleanAmount(amount) {
  const n = Number(amount);
  if (!Number.isInteger(n) || n < 0 || n > MAX_AMOUNT) throw new AppError('Zadaj sumu od 0 do 1 000 000 €.');
  return n;
}

function cleanMonth(month) {
  const n = Number(month || 0);
  return Number.isInteger(n) && n >= 1 && n <= 12 ? n : 0;
}

// ---- Načítanie ---------------------------------------------------------------------------

export async function getData(c, householdId) {
  await requireFamilyMember(c, householdId);
  await ensureCategories(c, householdId);
  const [household, categories, items] = await c.db.batch([
    c.db.prepare('SELECT financie_rev, financie_reserve, financie_reserve_months FROM households WHERE id = ?').bind(householdId),
    c.db.prepare('SELECT * FROM financie_categories WHERE household_id = ? ORDER BY sort, name').bind(householdId),
    c.db.prepare('SELECT * FROM financie_items WHERE household_id = ? ORDER BY kind, sort, created_at').bind(householdId),
  ]);
  const h = household.results[0] || {};
  return {
    householdId,
    rev: h.financie_rev || 0,
    reserve: h.financie_reserve || 0,
    reserveMonths: h.financie_reserve_months || 6,
    categories: categories.results.map(toCategory),
    items: items.results.map(toItem),
  };
}

/** Nová rodina dostane predvolené kategórie (pevné id – dve otvorenia naraz ich nezdvoja). */
async function ensureCategories(c, householdId) {
  const any = await c.db.prepare('SELECT 1 FROM financie_categories WHERE household_id = ? LIMIT 1').bind(householdId).first();
  if (any) return;
  const has = await c.db.prepare('SELECT 1 FROM financie_items WHERE household_id = ? LIMIT 1').bind(householdId).first();
  if (has) return; // kategórie niekto zmazal všetky – nevnucovať
  await c.db.batch(
    DEFAULT_CATEGORIES.map((name, i) =>
      c.db
        .prepare('INSERT OR IGNORE INTO financie_categories (id, household_id, name, sort, is_saving) VALUES (?, ?, ?, ?, ?)')
        .bind(householdId + ':default:' + i, householdId, name, i, looksLikeSaving(name) ? 1 : 0)
    )
  );
}

/** Lacná kontrola zmien (aplikácia sa pýta každých pár sekúnd). */
export async function getRev(c, householdId) {
  await requireFamilyMember(c, householdId);
  const row = await c.db.prepare('SELECT financie_rev FROM households WHERE id = ?').bind(householdId).first();
  return row ? row.financie_rev : 0;
}

// ---- Položky -----------------------------------------------------------------------------

/** Nová alebo upravená položka: { id?, kind: income | monthly | yearly, name, amount (centy), categoryId, dueMonth }. */
export async function saveItem(c, householdId, data) {
  data = data && typeof data === 'object' ? data : {};
  const old = data.id ? await findRow(c, 'financie_items', data.id, 'Položka neexistuje (možno ju medzičasom niekto vymazal).') : null;
  const hh = old ? old.household_id : householdId;
  if (!old) await requireFamilyMember(c, hh);
  const kind = old ? old.kind : data.kind;
  if (!KINDS.includes(kind)) throw new AppError('Neznámy druh položky.');
  const name = cleanName(data.name, 'Zadaj názov.');
  const amount = cleanAmount(data.amount);
  let categoryId = kind === 'monthly' ? String(data.categoryId || '') : '';
  if (categoryId) {
    const cat = await c.db.prepare('SELECT id FROM financie_categories WHERE id = ? AND household_id = ?').bind(categoryId, hh).first();
    if (!cat) categoryId = '';
  }
  const dueMonth = kind === 'yearly' ? cleanMonth(data.dueMonth) : 0;
  const now = nowIso();
  if (old) {
    await c.db
      .prepare('UPDATE financie_items SET name = ?, amount = ?, category_id = ?, due_month = ?, updated_at = ? WHERE id = ?')
      .bind(name, amount, categoryId, dueMonth, now, old.id)
      .run();
    return toItem({ ...old, name, amount, category_id: categoryId, due_month: dueMonth });
  }
  const stats = await c.db.prepare('SELECT COUNT(*) AS n, COALESCE(MAX(sort), -1) AS last FROM financie_items WHERE household_id = ?').bind(hh).first();
  if (stats.n >= MAX_ITEMS) throw new AppError('Rodina môže mať najviac ' + MAX_ITEMS + ' položiek.');
  const row = { id: uuid(), household_id: hh, kind, name, amount, category_id: categoryId, due_month: dueMonth, sort: stats.last + 1 };
  await c.db
    .prepare(
      `INSERT INTO financie_items (id, household_id, kind, name, amount, category_id, due_month, sort, created_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(row.id, hh, kind, name, amount, categoryId, dueMonth, row.sort, c.email, now, now)
    .run();
  return toItem(row);
}

export async function deleteItem(c, itemId) {
  const row = await findRow(c, 'financie_items', itemId, 'Položka neexistuje (možno ju medzičasom niekto vymazal).');
  await c.db.prepare('DELETE FROM financie_items WHERE id = ?').bind(row.id).run();
  return { ok: true };
}

/** Posun položky v zozname o jedno miesto (dir = -1 hore, 1 dole) v rámci jej druhu. */
export async function moveItem(c, itemId, dir) {
  const row = await findRow(c, 'financie_items', itemId, 'Položka neexistuje (možno ju medzičasom niekto vymazal).');
  const { results } = await c.db
    .prepare('SELECT id FROM financie_items WHERE household_id = ? AND kind = ? ORDER BY sort, created_at')
    .bind(row.household_id, row.kind)
    .all();
  const ids = results.map((r) => r.id);
  const i = ids.indexOf(row.id);
  const j = i + (Number(dir) < 0 ? -1 : 1);
  if (j < 0 || j >= ids.length) return { ok: true };
  [ids[i], ids[j]] = [ids[j], ids[i]];
  await c.db.batch(ids.map((id, sort) => c.db.prepare('UPDATE financie_items SET sort = ? WHERE id = ? AND sort <> ?').bind(sort, id, sort)));
  return { ok: true };
}

// ---- Kategórie ---------------------------------------------------------------------------

/** Nová alebo upravená kategória mesačných výdavkov: { id?, name, saving }. */
export async function saveCategory(c, householdId, data) {
  data = data && typeof data === 'object' ? data : {};
  const old = data.id ? await findRow(c, 'financie_categories', data.id, 'Kategória neexistuje.') : null;
  const hh = old ? old.household_id : householdId;
  if (!old) await requireFamilyMember(c, hh);
  const name = cleanName(data.name, 'Zadaj názov kategórie.');
  const saving = data.saving ? 1 : 0;
  const clash = await c.db
    .prepare('SELECT id FROM financie_categories WHERE household_id = ? AND name = ? COLLATE NOCASE AND id <> ?')
    .bind(hh, name, old ? old.id : '')
    .first();
  if (clash) throw new AppError('Kategória „' + name + '“ už existuje.');
  if (old) {
    await c.db.prepare('UPDATE financie_categories SET name = ?, is_saving = ? WHERE id = ?').bind(name, saving, old.id).run();
    return toCategory({ ...old, name, is_saving: saving });
  }
  const stats = await c.db.prepare('SELECT COUNT(*) AS n, COALESCE(MAX(sort), -1) AS last FROM financie_categories WHERE household_id = ?').bind(hh).first();
  if (stats.n >= MAX_CATEGORIES) throw new AppError('Najviac ' + MAX_CATEGORIES + ' kategórií.');
  const row = { id: uuid(), household_id: hh, name, sort: stats.last + 1, is_saving: saving };
  await c.db
    .prepare('INSERT INTO financie_categories (id, household_id, name, sort, is_saving) VALUES (?, ?, ?, ?, ?)')
    .bind(row.id, hh, name, row.sort, saving)
    .run();
  return toCategory(row);
}

/** Vymazanie kategórie – jej výdavky ostanú, len bez kategórie. */
export async function deleteCategory(c, categoryId) {
  const row = await findRow(c, 'financie_categories', categoryId, 'Kategória neexistuje.');
  await c.db.batch([
    c.db.prepare("UPDATE financie_items SET category_id = '' WHERE household_id = ? AND category_id = ?").bind(row.household_id, row.id),
    c.db.prepare('DELETE FROM financie_categories WHERE id = ?').bind(row.id),
  ]);
  return { ok: true };
}

// ---- Núdzová rezerva ---------------------------------------------------------------------

/** Aktuálna rezerva (centy) a na koľko mesiacov výdavkov má stačiť (cieľ, predvolene 6). */
export async function setReserve(c, householdId, amount, months) {
  await requireFamilyMember(c, householdId);
  amount = cleanAmount(amount);
  months = Number(months);
  if (!Number.isInteger(months) || months < 1 || months > 36) throw new AppError('Cieľ rezervy: 1 až 36 mesiacov.');
  await c.db
    .prepare('UPDATE households SET financie_reserve = ?, financie_reserve_months = ?, financie_rev = financie_rev + 1 WHERE id = ?')
    .bind(amount, months, householdId)
    .run();
  return { reserve: amount, reserveMonths: months };
}

// ---- Import z Excelu ---------------------------------------------------------------------

/**
 * Import tabuľky Financie (.xlsx ako base64). Nahradí všetky položky a kategórie rodiny
 * (rezervu len ak je v tabuľke vyplnená). Vráti počty a nové údaje.
 */
export async function importExcel(c, householdId, base64) {
  await requireFamilyMember(c, householdId);
  let bytes;
  try {
    bytes = Uint8Array.from(atob(String(base64 || '').replace(/^data:[^,]*,/, '')), (ch) => ch.charCodeAt(0));
  } catch {
    throw new AppError('Súbor sa nepodarilo načítať.');
  }
  if (!bytes.length) throw new AppError('Súbor je prázdny.');
  if (bytes.length > MAX_XLSX) throw new AppError('Súbor je príliš veľký (najviac 700 kB).');
  let parsed;
  try {
    parsed = await parseFinancieXlsx(bytes);
  } catch {
    throw new AppError('Toto nie je súbor Excel (.xlsx). Ulož tabuľku ako „Zošit programu Excel“.');
  }
  if (!parsed) throw new AppError('V súbore som nenašiel tabuľky Príjmy, Mesačné výdavky ani Ročné výdavky.');
  return saveImport(c, householdId, parsed);
}

/** Uloží prečítané údaje (aj pre testy): { items: [{ kind, name, amount, category?, dueMonth? }], categories: [názov], reserve }. */
export async function saveImport(c, householdId, { items, categories, reserve }) {
  items = items.slice(0, MAX_ITEMS);
  // kategórie z tabuľky + tie, ktoré majú výdavky a v zozname nie sú
  const names = [...categories];
  for (const it of items) if (it.kind === 'monthly' && it.category && !names.some((n) => fold(n) === fold(it.category))) names.push(it.category);
  const cats = names.slice(0, MAX_CATEGORIES).map((name, sort) => ({ id: uuid(), name: name.slice(0, MAX_NAME), sort, saving: looksLikeSaving(name) }));
  const catId = (name) => (cats.find((x) => fold(x.name) === fold(name)) || {}).id || '';
  const now = nowIso();
  const sort = { income: 0, monthly: 0, yearly: 0 };
  const statements = [
    c.db.prepare('DELETE FROM financie_items WHERE household_id = ?').bind(householdId),
    c.db.prepare('DELETE FROM financie_categories WHERE household_id = ?').bind(householdId),
    ...cats.map((x) =>
      c.db.prepare('INSERT INTO financie_categories (id, household_id, name, sort, is_saving) VALUES (?, ?, ?, ?, ?)').bind(x.id, householdId, x.name, x.sort, x.saving ? 1 : 0)
    ),
    ...items.map((it) =>
      c.db
        .prepare(
          `INSERT INTO financie_items (id, household_id, kind, name, amount, category_id, due_month, sort, created_by, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .bind(
          uuid(),
          householdId,
          it.kind,
          it.name.slice(0, MAX_NAME),
          Math.min(Math.max(0, it.amount), MAX_AMOUNT),
          it.kind === 'monthly' ? catId(it.category) : '',
          it.kind === 'yearly' ? cleanMonth(it.dueMonth) : 0,
          sort[it.kind]++,
          c.email,
          now,
          now
        )
    ),
  ];
  if (reserve !== null && reserve !== undefined) {
    statements.push(c.db.prepare('UPDATE households SET financie_reserve = ? WHERE id = ?').bind(Math.min(reserve, MAX_AMOUNT), householdId));
  }
  await c.db.batch(statements);
  const count = (k) => items.filter((it) => it.kind === k).length;
  return { income: count('income'), monthly: count('monthly'), yearly: count('yearly'), categories: cats.length, data: await getData(c, householdId) };
}
