// Skládko – API (POST /api/skladko/<funkcia>): sklady, skupiny (ľubovoľne vnorené) a položky
// rodiny. Aplikácia si načíta celý inventár rodiny naraz (getData) a hľadá, filtruje a
// prechádza ho v prehliadači; zmeny posiela po jednej.
//
// Kontext c = { db, email, today, … } ako v Gazde. Všetko patrí rodine (households) –
// smie to čítať a meniť každý jej člen.

import { addItem as gazdaAddItem } from '../api.js';
import { requireFamilyMember } from '../family.js';
import { AppError, DATE_RE, nowIso, requireText } from '../domain.js';

const uuid = () => crypto.randomUUID();
const MAX_NAME = 80;
const MAX_DESCRIPTION = 500;
const MAX_QTY = 100000;
export const MAX_IMAGE_BYTES = 600_000; // fotka zmenšená v prehliadači (~1200 px JPEG)
const ICON_RE = /^[a-z0-9_]{1,40}$/;
const IMAGE_RE = /^data:(image\/(?:jpeg|webp|png));base64,([A-Za-z0-9+/]+=*)$/;

// ---- Prevod riadkov na objekty pre prehliadač -------------------------------------

const toWarehouse = (r) => ({ id: r.id, name: r.name, icon: r.icon, locationId: r.location_id, createdAt: r.created_at });
const toGroup = (r) => ({ id: r.id, warehouseId: r.warehouse_id, parentId: r.parent_id, name: r.name, icon: r.icon });
const toItem = (r) => ({
  id: r.id,
  warehouseId: r.warehouse_id,
  groupId: r.group_id,
  name: r.name,
  quantity: r.quantity,
  minQty: r.min_qty,
  description: r.description,
  icon: r.icon,
  expirationDate: r.expiration_date,
  ...(r.image_rev && { image: '/api/skladko/image/' + r.id + '?v=' + r.image_rev }),
  ...(r.import_image_url && { importImage: true }), // fotka z Firebase čaká na prenos
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

// ---- Vyhľadanie a oprávnenia ------------------------------------------------------

async function find(c, table, id, what) {
  const row = await c.db.prepare(`SELECT * FROM ${table} WHERE id = ?`).bind(String(id ?? '')).first();
  if (!row) throw new AppError(what + ' neexistuje (možno ho medzičasom niekto vymazal).', 404);
  await requireFamilyMember(c, row.household_id);
  return row;
}

const findWarehouse = (c, id) => find(c, 'skladko_warehouses', id, 'Sklad');
const findGroup = (c, id) => find(c, 'skladko_groups', id, 'Skupina');
const findItem = (c, id) => find(c, 'skladko_items', id, 'Položka');

/** Cieľ (sklad a skupina) v tej istej rodine; skupina musí patriť do skladu. */
async function checkPlace(c, householdId, warehouseId, groupId) {
  const w = await findWarehouse(c, warehouseId);
  if (w.household_id !== householdId) throw new AppError('Sklad patrí inej rodine.', 403);
  if (groupId) {
    const g = await findGroup(c, groupId);
    if (g.warehouse_id !== w.id) throw new AppError('Skupina nie je v tomto sklade.');
  }
  return w;
}

function cleanIcon(icon, fallback) {
  icon = String(icon ?? '').trim();
  return ICON_RE.test(icon) ? icon : fallback;
}

function cleanName(name, message) {
  name = requireText(String(name ?? '').replace(/\s+/g, ' '), message);
  if (name.length > MAX_NAME) throw new AppError('Názov môže mať najviac ' + MAX_NAME + ' znakov.');
  return name;
}

function cleanQty(value, min, message) {
  const n = Number(value);
  if (!Number.isInteger(n) || n < min || n > MAX_QTY) throw new AppError(message);
  return n;
}

// ---- Načítanie ---------------------------------------------------------------------

export async function getData(c, householdId) {
  await requireFamilyMember(c, householdId);
  const q = (sql) => c.db.prepare(sql).bind(householdId);
  const [household, warehouses, groups, items, shopping] = await c.db.batch([
    q('SELECT skladko_rev FROM households WHERE id = ?'),
    q('SELECT * FROM skladko_warehouses WHERE household_id = ? ORDER BY position, created_at'),
    q('SELECT * FROM skladko_groups WHERE household_id = ? ORDER BY name COLLATE NOCASE'),
    q('SELECT * FROM skladko_items WHERE household_id = ? ORDER BY name COLLATE NOCASE'),
    // Otvorené nákupy v Gazde (položku z Skládka sa dá pridať do nákupu).
    q("SELECT id, name, store FROM cinnosti WHERE household_id = ? AND kind = 'nakup' ORDER BY due_date = '', due_date, rowid"),
  ]);
  return {
    householdId,
    rev: household.results[0] ? household.results[0].skladko_rev : 0,
    warehouses: warehouses.results.map(toWarehouse),
    groups: groups.results.map(toGroup),
    items: items.results.map(toItem),
    shopping: shopping.results.map((s) => ({ id: s.id, name: s.name, store: s.store })),
  };
}

/** Lacná kontrola zmien (aplikácia sa pýta každých pár sekúnd). */
export async function getRev(c, householdId) {
  await requireFamilyMember(c, householdId);
  const row = await c.db.prepare('SELECT skladko_rev FROM households WHERE id = ?').bind(householdId).first();
  return row ? row.skladko_rev : 0;
}

// ---- Sklady ---------------------------------------------------------------------------

export async function saveWarehouse(c, householdId, data) {
  data = data && typeof data === 'object' ? data : {};
  const name = cleanName(data.name, 'Zadaj názov skladu.');
  const icon = cleanIcon(data.icon, 'inventory_2');
  const now = nowIso();
  if (data.id) {
    const w = await findWarehouse(c, data.id);
    await c.db.prepare('UPDATE skladko_warehouses SET name = ?, icon = ?, updated_at = ? WHERE id = ?').bind(name, icon, now, w.id).run();
    return toWarehouse({ ...w, name, icon });
  }
  await requireFamilyMember(c, householdId);
  const row = {
    id: uuid(),
    household_id: householdId,
    name,
    icon,
    location_id: String(data.locationId ?? '').slice(0, 40),
    created_at: now,
  };
  await c.db
    .prepare(
      `INSERT INTO skladko_warehouses (id, household_id, name, icon, location_id, position, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, (SELECT COALESCE(MAX(position), 0) + 1 FROM skladko_warehouses WHERE household_id = ?), ?, ?)`
    )
    .bind(row.id, householdId, name, icon, row.location_id, householdId, now, now)
    .run();
  return toWarehouse(row);
}

export async function deleteWarehouse(c, warehouseId) {
  const w = await findWarehouse(c, warehouseId);
  await c.db.batch([
    c.db.prepare('DELETE FROM skladko_images WHERE item_id IN (SELECT id FROM skladko_items WHERE warehouse_id = ?)').bind(w.id),
    c.db.prepare('DELETE FROM skladko_items WHERE warehouse_id = ?').bind(w.id),
    c.db.prepare('DELETE FROM skladko_groups WHERE warehouse_id = ?').bind(w.id),
    c.db.prepare('DELETE FROM skladko_warehouses WHERE id = ?').bind(w.id),
  ]);
  return { ok: true };
}

// ---- Skupiny -----------------------------------------------------------------------------

export async function saveGroup(c, data) {
  data = data && typeof data === 'object' ? data : {};
  const name = cleanName(data.name, 'Zadaj názov skupiny.');
  const icon = cleanIcon(data.icon, 'folder');
  const now = nowIso();
  if (data.id) {
    const g = await findGroup(c, data.id);
    await c.db.prepare('UPDATE skladko_groups SET name = ?, icon = ?, updated_at = ? WHERE id = ?').bind(name, icon, now, g.id).run();
    return toGroup({ ...g, name, icon });
  }
  const w = await findWarehouse(c, data.warehouseId);
  const parentId = String(data.parentId ?? '');
  if (parentId) await checkPlace(c, w.household_id, w.id, parentId);
  const row = { id: uuid(), household_id: w.household_id, warehouse_id: w.id, parent_id: parentId, name, icon };
  await c.db
    .prepare(
      `INSERT INTO skladko_groups (id, household_id, warehouse_id, parent_id, name, icon, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(row.id, row.household_id, row.warehouse_id, parentId, name, icon, now, now)
    .run();
  return toGroup(row);
}

// Skupina so všetkými podskupinami (do ľubovoľnej hĺbky).
const SUBTREE_SQL = `WITH RECURSIVE tree(id) AS (
    SELECT ?1 UNION SELECT g.id FROM skladko_groups g JOIN tree t ON g.parent_id = t.id
  )`;

/** Vymaže skupinu aj so všetkými podskupinami a položkami v nich. */
export async function deleteGroup(c, groupId) {
  const g = await findGroup(c, groupId);
  await c.db.batch([
    c.db.prepare(`${SUBTREE_SQL} DELETE FROM skladko_images WHERE item_id IN (SELECT id FROM skladko_items WHERE group_id IN tree)`).bind(g.id),
    c.db.prepare(`${SUBTREE_SQL} DELETE FROM skladko_items WHERE group_id IN tree`).bind(g.id),
    c.db.prepare(`${SUBTREE_SQL} DELETE FROM skladko_groups WHERE id IN tree`).bind(g.id),
  ]);
  return { ok: true };
}

/** Presunie skupinu (aj s obsahom) inam v tom istom sklade alebo do iného skladu rodiny. */
export async function moveGroup(c, groupId, warehouseId, parentId) {
  const g = await findGroup(c, groupId);
  parentId = String(parentId ?? '');
  const w = await checkPlace(c, g.household_id, warehouseId, parentId);
  if (parentId) {
    const inside = await c.db.prepare(`${SUBTREE_SQL} SELECT 1 FROM tree WHERE id = ?2`).bind(g.id, parentId).first();
    if (inside) throw new AppError('Skupinu nemôžeš presunúť do nej samej.');
  }
  const now = nowIso();
  await c.db.batch([
    c.db.prepare('UPDATE skladko_groups SET warehouse_id = ?, parent_id = ?, updated_at = ? WHERE id = ?').bind(w.id, parentId, now, g.id),
    c.db.prepare(`${SUBTREE_SQL} UPDATE skladko_groups SET warehouse_id = ?2, updated_at = ?3 WHERE id IN tree AND id <> ?1`).bind(g.id, w.id, now),
    c.db.prepare(`${SUBTREE_SQL} UPDATE skladko_items SET warehouse_id = ?2, updated_at = ?3 WHERE group_id IN tree`).bind(g.id, w.id, now),
  ]);
  return { ok: true };
}

// ---- Položky ----------------------------------------------------------------------------

function decodeImage(image) {
  const m = String(image).match(IMAGE_RE);
  if (!m) throw new AppError('Neplatná fotka.');
  const bytes = Uint8Array.from(atob(m[2]), (ch) => ch.charCodeAt(0));
  if (bytes.length > MAX_IMAGE_BYTES) throw new AppError('Fotka je príliš veľká.', 413);
  return { type: m[1], bytes };
}

/**
 * Nová alebo upravená položka. data.image: data URL = nová fotka, null = bez fotky,
 * vynechané = fotka ostáva.
 */
export async function saveItem(c, data) {
  data = data && typeof data === 'object' ? data : {};
  const name = cleanName(data.name, 'Zadaj názov položky.');
  const quantity = cleanQty(data.quantity ?? 1, 0, 'Množstvo musí byť celé číslo 0 alebo viac.');
  const minQty = cleanQty(data.minQty ?? 0, 0, 'Hranica „dochádza“ musí byť celé číslo 0 alebo viac.');
  const description = String(data.description ?? '').trim().slice(0, MAX_DESCRIPTION);
  const icon = cleanIcon(data.icon, 'inventory_2');
  const expirationDate = String(data.expirationDate ?? '');
  if (expirationDate && !DATE_RE.test(expirationDate)) throw new AppError('Dátum spotreby zadaj ako dátum.');
  const image = data.image === undefined ? undefined : data.image ? decodeImage(data.image) : null;
  const now = nowIso();
  const imageRev = image ? String(Date.now()) : '';

  let id = data.id;
  const statements = [];
  if (id) {
    const old = await findItem(c, id);
    statements.push(
      c.db
        .prepare(
          `UPDATE skladko_items SET name = ?1, quantity = ?2, min_qty = ?3, description = ?4, icon = ?5,
             notified_exp = CASE WHEN expiration_date = ?6 THEN notified_exp ELSE '' END, expiration_date = ?6,
             notified_low = CASE WHEN ?2 > ?3 THEN 0 ELSE notified_low END,
             ${image === undefined ? '' : "image_rev = ?7, import_image_url = '',"} updated_at = ?8 WHERE id = ?9`
        )
        .bind(name, quantity, minQty, description, icon, expirationDate, imageRev, now, old.id)
    );
    if (image === null) statements.push(c.db.prepare('DELETE FROM skladko_images WHERE item_id = ?').bind(old.id));
    data.householdId = old.household_id;
  } else {
    const groupId = String(data.groupId ?? '');
    const w = await findWarehouse(c, data.warehouseId);
    await checkPlace(c, w.household_id, w.id, groupId);
    id = uuid();
    data.householdId = w.household_id;
    statements.push(
      c.db
        .prepare(
          `INSERT INTO skladko_items (id, household_id, warehouse_id, group_id, name, quantity, min_qty, description, icon,
             expiration_date, image_rev, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .bind(id, w.household_id, w.id, groupId, name, quantity, minQty, description, icon, expirationDate, imageRev, c.email, now, now)
    );
  }
  if (image) {
    statements.push(
      c.db
        .prepare(
          `INSERT INTO skladko_images (item_id, household_id, content_type, data) VALUES (?, ?, ?, ?)
           ON CONFLICT (item_id) DO UPDATE SET content_type = excluded.content_type, data = excluded.data`
        )
        .bind(id, data.householdId, image.type, image.bytes)
    );
  }
  await c.db.batch(statements);
  return loadItem(c, id);
}

async function loadItem(c, id) {
  return toItem(await c.db.prepare('SELECT * FROM skladko_items WHERE id = ?').bind(id).first());
}

/** Zmena množstva o delta (−1 / +1 na karte) – bez prepisovania súčasných zmien od iných. */
export async function changeQuantity(c, itemId, delta) {
  const item = await findItem(c, itemId);
  delta = Number(delta);
  if (!Number.isInteger(delta) || Math.abs(delta) > MAX_QTY) throw new AppError('Neplatná zmena množstva.');
  await c.db
    .prepare(
      `UPDATE skladko_items SET quantity = MIN(MAX(quantity + ?1, 0), ${MAX_QTY}),
         notified_low = CASE WHEN MAX(quantity + ?1, 0) > min_qty THEN 0 ELSE notified_low END, updated_at = ?2
       WHERE id = ?3`
    )
    .bind(delta, nowIso(), item.id)
    .run();
  return loadItem(c, item.id);
}

export async function setQuantity(c, itemId, quantity) {
  const item = await findItem(c, itemId);
  quantity = cleanQty(quantity, 0, 'Množstvo musí byť celé číslo 0 alebo viac.');
  await c.db
    .prepare('UPDATE skladko_items SET quantity = ?1, notified_low = CASE WHEN ?1 > min_qty THEN 0 ELSE notified_low END, updated_at = ?2 WHERE id = ?3')
    .bind(quantity, nowIso(), item.id)
    .run();
  return loadItem(c, item.id);
}

/** Presun položky (vystrihni → vlož) do iného skladu alebo skupiny tej istej rodiny. */
export async function moveItem(c, itemId, warehouseId, groupId) {
  const item = await findItem(c, itemId);
  groupId = String(groupId ?? '');
  const w = await checkPlace(c, item.household_id, warehouseId, groupId);
  await c.db
    .prepare('UPDATE skladko_items SET warehouse_id = ?, group_id = ?, updated_at = ? WHERE id = ?')
    .bind(w.id, groupId, nowIso(), item.id)
    .run();
  return loadItem(c, item.id);
}

export async function deleteItem(c, itemId) {
  const item = await findItem(c, itemId);
  await c.db.batch([
    c.db.prepare('DELETE FROM skladko_images WHERE item_id = ?').bind(item.id),
    c.db.prepare('DELETE FROM skladko_items WHERE id = ?').bind(item.id),
  ]);
  return { ok: true };
}

/**
 * Pridá položku do nákupu v Gazde (cinnostId = existujúci nákup; prázdne = prvý nákup rodiny,
 * a keď žiadny nie je, vytvorí sa „Nákup“). Vráti názov nákupu.
 */
export async function addToShopping(c, itemId, cinnostId) {
  const item = await findItem(c, itemId);
  let task = null;
  if (cinnostId) {
    task = await c.db
      .prepare("SELECT id, name FROM cinnosti WHERE id = ? AND household_id = ? AND kind = 'nakup'")
      .bind(String(cinnostId), item.household_id)
      .first();
    if (!task) throw new AppError('Nákup v Gazde neexistuje.', 404);
  } else {
    task = await c.db
      .prepare("SELECT id, name FROM cinnosti WHERE household_id = ? AND kind = 'nakup' ORDER BY due_date = '', due_date, rowid LIMIT 1")
      .bind(item.household_id)
      .first();
    if (!task) {
      task = { id: uuid(), name: 'Nákup' };
      await c.db
        .prepare(
          `INSERT INTO cinnosti (id, household_id, priestor_id, name, assigned_to, icon, color, due_date, periodicity, kind, store, created_at)
           VALUES (?, ?, '', 'Nákup', '', 'shopping', '#FF9800', '', 'none', 'nakup', '', ?)`
        )
        .bind(task.id, item.household_id, nowIso())
        .run();
    }
  }
  await gazdaAddItem(c, task.id, item.name, '');
  return { cinnostId: task.id, name: task.name };
}

// ---- Fotky -------------------------------------------------------------------------------

/** GET /api/skladko/image/<id> – fotka položky (len pre členov rodiny). */
export async function itemImage(c, itemId) {
  const row = await c.db
    .prepare(
      `SELECT i.content_type, i.data FROM skladko_images i JOIN members m ON m.household_id = i.household_id AND m.email = ?
       WHERE i.item_id = ?`
    )
    .bind(c.email, String(itemId ?? ''))
    .first();
  if (!row) throw new AppError('Fotka neexistuje.', 404);
  // Adresa obsahuje verziu (?v=…), takže obrázok sa smie držať dlho.
  return new Response(new Uint8Array(row.data), {
    headers: { 'content-type': row.content_type, 'cache-control': 'private, max-age=31536000, immutable' },
  });
}

/** Fotka položky zvlášť (prenos fotiek z Firebase – prehliadač ju zmenší a pošle sem). */
export async function setItemImage(c, itemId, image) {
  const item = await findItem(c, itemId);
  const { type, bytes } = decodeImage(image);
  await c.db.batch([
    c.db
      .prepare(
        `INSERT INTO skladko_images (item_id, household_id, content_type, data) VALUES (?, ?, ?, ?)
         ON CONFLICT (item_id) DO UPDATE SET content_type = excluded.content_type, data = excluded.data`
      )
      .bind(item.id, item.household_id, type, bytes),
    c.db
      .prepare("UPDATE skladko_items SET image_rev = ?, import_image_url = '', updated_at = ? WHERE id = ?")
      .bind(String(Date.now()), nowIso(), item.id),
  ]);
  return loadItem(c, item.id);
}
