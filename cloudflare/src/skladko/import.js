// Prenos zo starého mobilného Skládka (Firebase projekt skladko-9469f) do Family Grid.
//
// 1. Prihlásený používateľ zvolí rodinu a ťukne „Preniesť z mobilného Skládka“.
// 2. Server nájde vo Firebase účet s rovnakým e-mailom a prečíta jeho sklady, skupiny a položky
//    (users/<uid>/warehouses/…/groups, …/inventory) – päť požiadaviek na Firebase.
// 3. Údaje sa uložia jednou dávkou (json_each); id z Firebase ostávajú (s predponou fb-),
//    takže prenos sa dá zopakovať – nič sa nezdvojí, úpravy z Family Grid sa prepíšu.
//    Prenos do inej rodiny už prenesené veci presunie (id je jedno pre celú databázu).
// 4. Fotky (pôvodne v plnej veľkosti) prenesie prehliadač: stiahne ich cez
//    /api/skladko/import-image/<id>, zmenší a uloží (setItemImage).

import { requireFamilyMember } from '../family.js';
import { AppError, nowIso, todayYmd } from '../domain.js';
import { firebaseClient, serviceAccount } from '../firebase.js';
import { bulk, set } from '../import.js';

const ID = (firebaseId) => 'fb-' + String(firebaseId).slice(0, 60);
const str = (v, max = 500) => String(v ?? '').trim().slice(0, max);
const IMAGE_HOST = 'firebasestorage.googleapis.com';

// Kódy ikon starého Skládka (<kategória>_<číslo>) → názov ikony Material Symbols.
const CODES = {
  food: ['fastfood', 'lunch_dining', 'local_pizza', 'restaurant', 'restaurant_menu', 'icecream', 'cake', 'bakery_dining', 'breakfast_dining', 'rice_bowl', 'soup_kitchen', 'set_meal', 'nutrition', 'egg', 'local_dining'],
  drinks: ['local_drink', 'emoji_food_beverage', 'coffee', 'local_cafe', 'free_breakfast', 'water_drop', 'sports_bar', 'wine_bar', 'local_bar'],
  snacks: ['cookie', 'icecream', 'cake', 'fastfood', 'local_pizza'],
  kitchen: ['kitchen', 'microwave', 'blender', 'soup_kitchen', 'flatware', 'dining', 'local_fire_department', 'inventory_2'],
  cleaning: ['cleaning_services', 'sanitizer', 'kitchen', 'science', 'water_drop', 'air'],
  laundry: ['local_laundry_service', 'dry', 'cleaning_services', 'science', 'water_drop'],
  hygiene: ['health_and_safety', 'sanitizer', 'shower', 'spa', 'air', 'content_cut'],
  medicine: ['medical_services', 'medication', 'healing', 'health_and_safety', 'device_thermostat', 'masks'],
  storage: ['inventory', 'inventory_2', 'warehouse', 'kitchen', 'store', 'home'],
};
const ALIASES = {
  oven: 'kitchen', refrigerator: 'kitchen', dishwasher: 'kitchen', kettle: 'local_cafe', cooking: 'restaurant',
  skiing: 'snowboarding', camping: 'terrain', garage_home: 'garage', apple: 'nutrition',
};

/** Ikona zo starého Skládka → názov ikony Material Symbols. */
export function normalizeIcon(icon, fallback) {
  icon = str(icon, 60);
  const m = icon.match(/^(food|drinks|snacks|kitchen|cleaning|laundry|hygiene|medicine|storage)_(\d+)$/);
  if (m) return (CODES[m[1]] && CODES[m[1]][Number(m[2])]) || fallback;
  if (ALIASES[icon]) return ALIASES[icon];
  return /^[a-z0-9_]{1,40}$/.test(icon) ? icon : fallback;
}

/** Dátum spotreby (Timestamp = polnoc v telefóne) → yyyy-MM-dd v slovenskom čase. */
export function expirationYmd(value) {
  if (!value) return '';
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? '' : todayYmd(d);
}

const iso = (v) => {
  const d = v ? new Date(v) : null;
  return d && !Number.isNaN(d.getTime()) ? d.toISOString() : nowIso();
};

/** Firestore dokumenty → riadky tabuliek Skládka v rodine householdId. */
export function mapSkladko(householdId, email, { warehouses, groups, items }) {
  const out = { warehouses: [], groups: [], items: [], orphans: 0 };
  const now = nowIso();
  const wIds = new Set();
  warehouses.forEach((w, i) => {
    wIds.add(w.id);
    out.warehouses.push({
      id: ID(w.id),
      household_id: householdId,
      name: str(w.data.locationName || w.data.name, 80) || 'Sklad',
      icon: normalizeIcon(w.data.icon, 'inventory_2'),
      location_id: str(w.data.locationId, 40),
      position: i + 1,
      created_at: iso(w.data.createdAt),
      updated_at: now,
    });
  });

  // Skupiny: users/<uid>/warehouses/<w>/groups/<g>
  const gWarehouse = new Map();
  for (const g of groups) {
    if (g.path.length === 6 && g.path[2] === 'warehouses' && wIds.has(g.path[3])) gWarehouse.set(g.id, g.path[3]);
  }
  // Položky a skupiny, ktorých skupina bola vymazaná (starý Skládko ich nechal „visieť“),
  // pôjdu do skupiny „Nájdené pri prenose“ v ich sklade.
  const found = new Map();
  const foundGroup = (wId) => {
    if (!found.has(wId)) {
      const id = ID('found-' + wId);
      found.set(wId, id);
      out.groups.push({ id, household_id: householdId, warehouse_id: ID(wId), parent_id: '', name: 'Nájdené pri prenose', icon: 'help', created_at: now, updated_at: now });
    }
    return found.get(wId);
  };
  for (const g of groups) {
    const wId = gWarehouse.get(g.id);
    if (!wId) continue;
    const parent = str(g.data.parentGroupId, 100);
    let parentId = '';
    if (parent) {
      if (gWarehouse.get(parent) === wId) parentId = ID(parent);
      else {
        parentId = foundGroup(wId);
        out.orphans++;
      }
    }
    out.groups.push({
      id: ID(g.id),
      household_id: householdId,
      warehouse_id: ID(wId),
      parent_id: parentId,
      name: str(g.data.name, 80) || 'Skupina',
      icon: normalizeIcon(g.data.icon, 'folder'),
      created_at: iso(g.data.createdAt),
      updated_at: now,
    });
  }

  // Položky: users/<uid>/warehouses/<w>/inventory/<i>; najstaršie (users/<uid>/inventory/<i>) do skladu „Staré položky“.
  let legacyWarehouse = null;
  for (const it of items) {
    let wId;
    if (it.path.length === 6 && it.path[2] === 'warehouses') {
      wId = it.path[3];
      if (!wIds.has(wId)) continue; // sklad vymazaný
    } else if (it.path.length === 4 && it.path[2] === 'inventory') {
      if (!legacyWarehouse) {
        legacyWarehouse = 'legacy';
        wIds.add(legacyWarehouse);
        out.warehouses.push({ id: ID(legacyWarehouse), household_id: householdId, name: 'Staré položky', icon: 'inventory', location_id: '', position: warehouses.length + 1, created_at: now, updated_at: now });
      }
      wId = legacyWarehouse;
    } else continue;
    const d = it.data;
    const g = str(d.groupId, 100);
    let groupId = '';
    if (g) {
      if (gWarehouse.get(g) === wId) groupId = ID(g);
      else {
        groupId = foundGroup(wId);
        out.orphans++;
      }
    }
    const url = str(d.imageUrl, 2000);
    let imageOk = false;
    try {
      imageOk = new URL(url).hostname === IMAGE_HOST;
    } catch {
      // bez fotky
    }
    out.items.push({
      id: ID(it.id),
      household_id: householdId,
      warehouse_id: ID(wId),
      group_id: groupId,
      name: str(d.name, 80) || 'Položka',
      quantity: Math.max(0, Math.min(100000, Math.round(Number(d.quantity) || 0))),
      description: str(d.description, 500) || (d.category ? 'Kategória: ' + str(d.category, 80) : ''),
      icon: normalizeIcon(d.icon, 'inventory_2'),
      expiration_date: expirationYmd(d.expirationDate),
      import_image_url: imageOk ? url : '',
      created_by: email,
      created_at: iso(d.createdAt),
      updated_at: iso(d.updatedAt || d.createdAt),
    });
  }
  return out;
}

/** Prenesie Skládko z Firebase do rodiny householdId. Vráti počty a fotky, ktoré treba ešte preniesť. */
export async function importFirebase(c, householdId) {
  await requireFamilyMember(c, householdId);
  const fb = firebaseClient(serviceAccount(c.env, 'FIREBASE_SKLADKO_SA', 'Skládka'), c.fetch || fetch);
  const uid = await fb.uidByEmail(c.email);
  if (!uid) {
    throw new AppError('V mobilnom Skládku nie je účet s e-mailom ' + c.email + '. Prihlás sa sem tým Google účtom, ktorý si používal v Skládku.', 404);
  }
  const [warehouses, groups, items] = await Promise.all([
    fb.listDocuments(`users/${uid}/warehouses`),
    fb.runQuery(`users/${uid}`, 'groups'),
    fb.runQuery(`users/${uid}`, 'inventory'),
  ]);
  const d = mapSkladko(householdId, c.email, { warehouses, groups, items });
  if (!d.warehouses.length) return { warehouses: 0, groups: 0, items: 0, orphans: 0, images: [] };

  // Opakovaný prenos: položka už s fotkou ju nestráca; inak sa fotka prenesie znova.
  await c.db.batch([
    bulk(c.db, 'skladko_warehouses', Object.keys(d.warehouses[0]), d.warehouses, 'ON CONFLICT (id) ' + set(['household_id', 'name', 'icon', 'updated_at'])),
    ...(d.groups.length
      ? [bulk(c.db, 'skladko_groups', Object.keys(d.groups[0]), d.groups, 'ON CONFLICT (id) ' + set(['household_id', 'warehouse_id', 'parent_id', 'name', 'icon', 'updated_at']))]
      : []),
    ...(d.items.length
      ? [
          bulk(
            c.db,
            'skladko_items',
            Object.keys(d.items[0]),
            d.items,
            'ON CONFLICT (id) ' +
              set(['household_id', 'warehouse_id', 'group_id', 'name', 'quantity', 'description', 'icon', 'expiration_date', 'updated_at']) +
              ", import_image_url = CASE WHEN skladko_items.image_rev = '' THEN excluded.import_image_url ELSE '' END"
          ),
        ]
      : []),
  ]);
  return {
    householdId,
    warehouses: d.warehouses.length,
    groups: d.groups.length,
    items: d.items.length,
    orphans: d.orphans,
    images: await pendingImages(c, householdId),
  };
}

/** Položky rodiny, ktorých fotka z Firebase ešte nie je prenesená. */
export async function pendingImages(c, householdId) {
  await requireFamilyMember(c, householdId);
  const { results } = await c.db
    .prepare("SELECT id, name FROM skladko_items WHERE household_id = ? AND import_image_url <> '' ORDER BY rowid")
    .bind(householdId)
    .all();
  return results;
}

/** GET /api/skladko/import-image/<id> – pôvodná fotka z Firebase Storage (cez náš server kvôli CORS). */
export async function importImage(c, itemId) {
  const row = await c.db
    .prepare(
      `SELECT i.import_image_url FROM skladko_items i JOIN members m ON m.household_id = i.household_id AND m.email = ?
       WHERE i.id = ?`
    )
    .bind(c.email, String(itemId ?? ''))
    .first();
  if (!row || !row.import_image_url) throw new AppError('Fotka na prenos neexistuje.', 404);
  const url = new URL(row.import_image_url);
  if (url.hostname !== IMAGE_HOST) throw new AppError('Neplatná adresa fotky.', 400);
  const res = await (c.fetch || fetch)(url.href);
  if (!res.ok) throw new AppError('Fotku sa z Firebase nepodarilo stiahnuť (' + res.status + ').', 502);
  return new Response(res.body, {
    headers: { 'content-type': res.headers.get('content-type') || 'image/jpeg', 'cache-control': 'no-store' },
  });
}

/** Fotku sa nepodarilo preniesť (napr. vo Firebase už nie je) – položka ostane bez nej. */
export async function skipImportImage(c, itemId) {
  const row = await c.db.prepare('SELECT household_id FROM skladko_items WHERE id = ?').bind(String(itemId ?? '')).first();
  if (!row) throw new AppError('Položka neexistuje.', 404);
  await requireFamilyMember(c, row.household_id);
  await c.db.prepare("UPDATE skladko_items SET import_image_url = '' WHERE id = ?").bind(String(itemId)).run();
  return { ok: true };
}
