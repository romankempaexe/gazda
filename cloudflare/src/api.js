// API Gazdu – rovnaké funkcie a odpovede ako vo verzii Apps Script (google.script.run),
// takže aplikácia v prehliadači sa mení len v tom, ako server volá.
//
// Každá funkcia dostane kontext c = { db, email, today, origin, waitUntil } a argumenty z prehliadača.
// Používateľ je prihlásený Google účtom; domácnosti zdieľa podľa e-mailu.
// Zápisy, ktoré patria k sebe, idú jedným db.batch() – D1 ich vykoná ako jednu transakciu.

import { notifyAssigned, rememberOrigin, saveSubscription, sendToUser, vapidKeys } from './notifications.js';
import {
  ALL,
  AppError,
  COLOR_RE,
  DATE_RE,
  EMAIL_RE,
  MAX_ITEMS,
  PERIODICITIES,
  nameKey,
  nextDueDateAfter,
  nowIso,
  parseEmails,
  requireText,
  splitQty,
} from './domain.js';

// ---- Prevod riadkov databázy na objekty pre prehliadač ------------------------

const toHousehold = (r) => ({ id: r.id, name: r.name, createdByEmail: r.created_by_email, createdAt: r.created_at });
const toMember = (r) => ({
  householdId: r.household_id,
  email: r.email,
  role: r.role,
  addedAt: r.added_at,
  joined: Boolean(r.joined), // už sa prihlásil do Gazdu
  nickname: r.nickname || '', // prezývka (prázdna, kým sa neprihlási a nezadá ju)
});
const toPriestor = (r) => ({ id: r.id, householdId: r.household_id, name: r.name, createdAt: r.created_at });
const toItem = (r) => ({
  id: r.id,
  text: r.text,
  qty: r.qty || '',
  done: Boolean(r.done),
  ...(r.missing && !r.done && { missing: true }), // v obchode nemali
  ...(r.has_image && { image: '/api/item-image/' + r.id }), // miniatúra (napr. z letáka)
  ...(r.price && { price: r.price }), // cena v eurách, napr. „2.49“
});

/** Cena položky: „2,49“, „2.49 €“ → „2.49“; prázdna = bez ceny. */
export function cleanPrice(value) {
  const m = String(value ?? '').replace(/\s|€/g, '').match(/^(\d{1,5})(?:[.,](\d{1,2}))?$/);
  if (!m) return '';
  return m[1].replace(/^0+(?=\d)/, '') + '.' + (m[2] || '0').padEnd(2, '0');
}

// Položky aj s príznakom, či majú miniatúru.
const ITEMS_SQL = `SELECT p.*, (i.item_id IS NOT NULL) AS has_image
  FROM polozky p LEFT JOIN item_images i ON i.item_id = p.id`;

// Miniatúry, ktorých položka už neexistuje (pridáva sa do dávok, ktoré mažú položky).
// Miniatúry položiek v histórii ostávajú (história ukazuje, čo sa nakúpilo).
const IMAGES_CLEANUP_SQL = `DELETE FROM item_images
  WHERE NOT EXISTS (SELECT 1 FROM polozky p WHERE p.id = item_images.item_id)
  AND NOT EXISTS (SELECT 1 FROM historia h, json_each(h.items) j
                  WHERE h.household_id = item_images.household_id AND json_extract(j.value, '$.id') = item_images.item_id)`;
const IMAGE_RE = /^data:image\/(jpeg|webp|png);base64,[A-Za-z0-9+/]+=*$/;
export const MAX_IMAGE_LENGTH = 200_000;
const toCinnost = (r, items = []) => ({
  id: r.id,
  householdId: r.household_id,
  priestorId: r.priestor_id,
  name: r.name,
  description: r.description,
  assignedTo: r.assigned_to,
  icon: r.icon,
  color: r.color,
  dueDate: r.due_date,
  periodicity: PERIODICITIES.includes(r.periodicity) ? r.periodicity : 'none',
  repeatInterval: r.repeat_interval ?? null,
  createdAt: r.created_at,
  kind: r.kind,
  store: r.store,
  items,
});

const MEMBERS_SQL = `SELECT m.*, (u.last_login IS NOT NULL AND u.last_login <> '') AS joined,
  COALESCE(u.nickname, '') AS nickname
  FROM members m LEFT JOIN users u ON u.email = m.email`;

export const MAX_NICKNAME = 30;

const uuid = () => crypto.randomUUID();

// ---- Oprávnenia a vyhľadanie ------------------------------------------------

async function requireMember(c, householdId) {
  const member = await c.db
    .prepare('SELECT * FROM members WHERE household_id = ? AND email = ?')
    .bind(String(householdId ?? ''), c.email)
    .first();
  if (!member) throw new AppError('K tejto domácnosti nemáš prístup.', 403);
  return member;
}

async function findCinnost(c, cinnostId) {
  const row = await c.db.prepare('SELECT * FROM cinnosti WHERE id = ?').bind(String(cinnostId ?? '')).first();
  if (!row) throw new AppError('Činnosť neexistuje (možno ju medzičasom niekto vymazal).', 404);
  await requireMember(c, row.household_id);
  return row;
}

/** Činnosť aj s checklistom (zoradeným podľa poradia). */
async function loadCinnost(c, id) {
  const [task, items] = await c.db.batch([
    c.db.prepare('SELECT * FROM cinnosti WHERE id = ?').bind(id),
    c.db.prepare(ITEMS_SQL + ' WHERE p.cinnost_id = ? ORDER BY p.position, p.rowid').bind(id),
  ]);
  return toCinnost(task.results[0], items.results.map(toItem));
}

// ---- Domácnosti ---------------------------------------------------------------

export async function getHouseholds(c) {
  const [me, households, members] = await c.db.batch([
    c.db.prepare('SELECT nickname, name FROM users WHERE email = ?').bind(c.email),
    c.db
      .prepare(
        `SELECT h.* FROM households h JOIN members m ON m.household_id = h.id
         WHERE m.email = ? ORDER BY h.rowid`
      )
      .bind(c.email),
    c.db
      .prepare(MEMBERS_SQL + ' WHERE m.household_id IN (SELECT household_id FROM members WHERE email = ?) ORDER BY m.rowid')
      .bind(c.email),
  ]);
  const user = me.results[0] || {};
  return {
    email: c.email,
    nickname: user.nickname || '',
    // Návrh prezývky pri prvom prihlásení: krstné meno z Google účtu.
    suggestedNickname: String(user.name || '').trim().split(/\s+/)[0].slice(0, MAX_NICKNAME),
    households: households.results.map((h) => ({
      ...toHousehold(h),
      members: members.results.filter((m) => m.household_id === h.id).map(toMember),
    })),
  };
}

/** Nastaví prezývku prihláseného používateľa (vidia ju ostatní namiesto e-mailu). */
export async function setNickname(c, nickname) {
  nickname = requireText(String(nickname ?? '').replace(/\s+/g, ' '), 'Zadaj prezývku.');
  if (nickname.length > MAX_NICKNAME) throw new AppError('Prezývka môže mať najviac ' + MAX_NICKNAME + ' znakov.');
  await c.db.prepare('UPDATE users SET nickname = ? WHERE email = ?').bind(nickname, c.email).run();
  return { nickname };
}

export async function createHousehold(c, name, emails) {
  name = requireText(name, 'Zadaj názov domácnosti.');
  const shareWith = parseEmails(emails).filter((e) => e !== c.email);
  const id = uuid();
  const now = nowIso();
  const addMember = c.db.prepare('INSERT INTO members (household_id, email, role, added_at) VALUES (?, ?, ?, ?)');
  await c.db.batch([
    c.db.prepare('INSERT INTO households (id, name, created_by_email, created_at) VALUES (?, ?, ?, ?)').bind(id, name, c.email, now),
    addMember.bind(id, c.email, 'owner', now),
    ...shareWith.map((e) => addMember.bind(id, e, 'member', now)),
  ]);
  return getHouseholds(c);
}

export async function shareHousehold(c, householdId, newEmail) {
  await requireMember(c, householdId);
  newEmail = String(newEmail ?? '').trim().toLowerCase();
  if (!EMAIL_RE.test(newEmail)) throw new AppError('Zadaj platný e-mail.');
  const { meta } = await c.db
    .prepare('INSERT INTO members (household_id, email, role, added_at) VALUES (?, ?, ?, ?) ON CONFLICT DO NOTHING')
    .bind(householdId, newEmail, 'member', nowIso())
    .run();
  if (!meta.changes) throw new AppError('Domácnosť je už zdieľaná s ' + newEmail);
  return getHouseholds(c);
}

export async function deleteHousehold(c, householdId) {
  const member = await requireMember(c, householdId);
  if (member.role !== 'owner') throw new AppError('Domácnosť môže vymazať len jej zakladateľ.', 403);
  const del = (table, column = 'household_id') => c.db.prepare(`DELETE FROM ${table} WHERE ${column} = ?`).bind(householdId);
  await c.db.batch([
    del('polozky'),
    del('item_images'),
    del('historia'),
    del('obchody'),
    del('produkty'),
    del('cinnosti'),
    del('priestory'),
    del('members'),
    del('households', 'id'),
  ]);
  return getHouseholds(c);
}

/**
 * Údaje pri štarte aplikácie: zoznam domácností a ak má používateľ uloženú
 * naposledy otvorenú domácnosť, rovno aj jej detail.
 */
export async function getStartData(c) {
  const res = await getHouseholds(c);
  const user = await c.db.prepare('SELECT last_household_id FROM users WHERE email = ?').bind(c.email).first();
  const lastId = user && user.last_household_id;
  if (lastId && res.households.some((h) => h.id === lastId)) {
    res.lastDetail = await getHouseholdData(c, lastId);
  }
  return res;
}

export async function getHouseholdData(c, householdId) {
  const member = await requireMember(c, householdId);
  const q = (sql) => c.db.prepare(sql).bind(householdId);
  const [household, members, priestory, cinnosti, polozky, obchody, produkty] = await c.db.batch([
    q('SELECT * FROM households WHERE id = ?'),
    q(MEMBERS_SQL + ' WHERE m.household_id = ? ORDER BY m.rowid'),
    q('SELECT * FROM priestory WHERE household_id = ? ORDER BY rowid'),
    q('SELECT * FROM cinnosti WHERE household_id = ? ORDER BY rowid'),
    q(ITEMS_SQL + ' WHERE p.household_id = ? ORDER BY p.position, p.rowid'),
    q('SELECT name FROM obchody WHERE household_id = ?'),
    q('SELECT name FROM produkty WHERE household_id = ? ORDER BY uses DESC, last_used DESC LIMIT 500'),
    // Zapamätaj naposledy otvorenú domácnosť (pri ďalšom spustení sa otvorí rovno ona).
    c.db
      .prepare('UPDATE users SET last_household_id = ? WHERE email = ? AND last_household_id <> ?')
      .bind(householdId, c.email, householdId),
  ]);
  if (!household.results.length) throw new AppError('Domácnosť neexistuje.', 404);

  const itemsByTask = new Map();
  for (const i of polozky.results) {
    if (!itemsByTask.has(i.cinnost_id)) itemsByTask.set(i.cinnost_id, []);
    itemsByTask.get(i.cinnost_id).push(toItem(i));
  }
  return {
    email: member.email,
    role: member.role,
    household: toHousehold(household.results[0]),
    members: members.results.map(toMember),
    priestory: priestory.results.map(toPriestor),
    cinnosti: cinnosti.results.map((r) => toCinnost(r, itemsByTask.get(r.id) || [])),
    stores: obchody.results.map((o) => o.name).sort((a, b) => a.localeCompare(b, 'sk')),
    products: produkty.results.map((p) => p.name),
  };
}

// ---- Priestory a činnosti ------------------------------------------------------

export async function addPriestor(c, householdId, name) {
  await requireMember(c, householdId);
  name = requireText(name, 'Zadaj názov priestoru.');
  const priestor = { id: uuid(), householdId, name, createdAt: nowIso() };
  await c.db
    .prepare('INSERT INTO priestory (id, household_id, name, created_at) VALUES (?, ?, ?, ?)')
    .bind(priestor.id, householdId, name, priestor.createdAt)
    .run();
  return priestor;
}

/** Overí údaje činnosti z formulára a vráti hodnoty na uloženie. */
async function validateCinnost(c, householdId, data) {
  data = data && typeof data === 'object' ? data : {};
  const kind = data.kind === 'nakup' ? 'nakup' : '';
  // Nákup nemusí mať priestor, ostatné činnosti áno.
  const priestor = data.priestorId
    ? await c.db.prepare('SELECT * FROM priestory WHERE id = ? AND household_id = ?').bind(String(data.priestorId), householdId).first()
    : null;
  if (!priestor && (data.priestorId || !kind)) throw new AppError('Vyber priestor.');

  const assignedTo = String(data.assignedTo ?? '').trim().toLowerCase();
  // ALL = spoločná činnosť pre všetkých členov domácnosti
  if (assignedTo && assignedTo !== ALL) {
    const isMember = await c.db
      .prepare('SELECT 1 FROM members WHERE household_id = ? AND email = ?')
      .bind(householdId, assignedTo)
      .first();
    if (!isMember) throw new AppError('Činnosť môžeš prideliť len členovi domácnosti.');
  }

  const dueDate = String(data.dueDate ?? '');
  if (!DATE_RE.test(dueDate)) throw new AppError('Zadaj termín.');

  const periodicity = PERIODICITIES.includes(data.periodicity) ? data.periodicity : 'none';
  let repeatInterval = null;
  if (periodicity !== 'none') {
    repeatInterval = parseInt(data.repeatInterval, 10);
    if (!(repeatInterval >= 1)) throw new AppError('Interval opakovania musí byť aspoň 1.');
  }

  const items = (Array.isArray(data.items) ? data.items : [])
    .map((i) => {
      const obj = typeof i === 'object' && i ? i : { text: i };
      return { id: obj.id ? String(obj.id) : '', ...splitQty(obj.text, obj.qty) };
    })
    .filter((i) => i.text);
  if (items.length > MAX_ITEMS) throw new AppError('Činnosť môže mať najviac ' + MAX_ITEMS + ' položiek.');

  return {
    priestor,
    items,
    fields: {
      priestor_id: priestor ? priestor.id : '',
      name: requireText(data.name, 'Zadaj názov činnosti.'),
      description: String(data.description ?? '').trim(),
      assigned_to: assignedTo,
      icon: String(data.icon || 'home'),
      color: COLOR_RE.test(data.color) ? data.color : '#4CAF50',
      due_date: dueDate,
      periodicity,
      repeat_interval: repeatInterval,
      kind,
      store: kind ? String(data.store ?? '').trim().slice(0, 60) : '',
    },
  };
}

// Zoznamy (položky, produkty) idú do databázy ako JSON jedným príkazom – D1 na
// bezplatnom pláne dovolí najviac 50 dotazov na jednu požiadavku.

/** Príkaz, ktorý vloží nové položky checklistu (rows: { id, text, qty, position }). */
function insertItemsStatement(c, cinnost, rows) {
  return c.db
    .prepare(
      `INSERT INTO polozky (id, cinnost_id, household_id, text, qty, done, position, created_at, created_by, price)
       SELECT json_extract(value, '$.id'), ?, ?, json_extract(value, '$.text'), json_extract(value, '$.qty'), 0,
              json_extract(value, '$.position'), ?, ?, coalesce(json_extract(value, '$.price'), '')
       FROM json_each(?)`
    )
    .bind(cinnost.id, cinnost.household_id, nowIso(), c.email, JSON.stringify(rows));
}

/**
 * Príkazy, ktoré zosúladia checklist činnosti so zoznamom z formulára: nové položky
 * pridajú, chýbajúce vymažú, zmenia text, počet a poradie. Stav odškrtnutia ostáva
 * z databázy (formulár ho nemení, aby neprepísal odškrtnutie od iného člena).
 */
async function syncItemsStatements(c, cinnost, items) {
  const { results: existing } = await c.db.prepare('SELECT * FROM polozky WHERE cinnost_id = ?').bind(cinnost.id).all();
  const byId = new Map(existing.map((i) => [i.id, i]));
  const keep = [];
  const changed = [];
  const added = [];
  items.forEach((item, index) => {
    const position = index + 1;
    const current = item.id && byId.get(item.id);
    if (current) {
      keep.push(current.id);
      if (current.text !== item.text || (current.qty || '') !== item.qty || current.position !== position) {
        changed.push({ id: current.id, text: item.text, qty: item.qty, position });
      }
    } else {
      added.push({ id: uuid(), text: item.text, qty: item.qty, position });
    }
  });
  const statements = [];
  if (existing.length > keep.length) {
    statements.push(
      c.db
        .prepare('DELETE FROM polozky WHERE cinnost_id = ? AND id NOT IN (SELECT value FROM json_each(?))')
        .bind(cinnost.id, JSON.stringify(keep)),
      c.db.prepare(IMAGES_CLEANUP_SQL)
    );
  }
  if (changed.length) {
    statements.push(
      c.db
        .prepare(
          `UPDATE polozky SET text = j.text, qty = j.qty, position = j.position
           FROM (SELECT json_extract(value, '$.id') AS id, json_extract(value, '$.text') AS text,
                        json_extract(value, '$.qty') AS qty, json_extract(value, '$.position') AS position
                 FROM json_each(?)) AS j
           WHERE polozky.id = j.id`
        )
        .bind(JSON.stringify(changed))
    );
  }
  if (added.length) statements.push(insertItemsStatement(c, cinnost, added));
  return statements;
}

/** Príkazy, ktoré zapamätajú obchod a produkty domácnosti pre našepkávanie. */
function rememberShoppingStatements(c, householdId, store, texts) {
  const now = nowIso();
  const statements = [];
  if (store) {
    statements.push(
      c.db
        .prepare('INSERT INTO obchody (household_id, name_key, name, created_at) VALUES (?, ?, ?, ?) ON CONFLICT DO NOTHING')
        .bind(householdId, nameKey(store), store, now)
    );
  }
  const products = new Map();
  for (const text of texts) if (text && !products.has(nameKey(text))) products.set(nameKey(text), text);
  if (products.size) {
    statements.push(
      c.db
        .prepare(
          // „WHERE true“ je nutné, aby SQLite nebralo ON CONFLICT ako súčasť SELECT.
          `INSERT INTO produkty (household_id, name_key, name, uses, last_used)
           SELECT ?, json_extract(value, '$[0]'), json_extract(value, '$[1]'), 1, ? FROM json_each(?) WHERE true
           ON CONFLICT (household_id, name_key) DO UPDATE SET uses = uses + 1, last_used = excluded.last_used`
        )
        .bind(householdId, now, JSON.stringify([...products]))
    );
  }
  return statements;
}

export async function addCinnost(c, householdId, data) {
  await requireMember(c, householdId);
  const { priestor, fields, items } = await validateCinnost(c, householdId, data);
  const cinnost = { id: uuid(), household_id: householdId, ...fields, created_at: nowIso() };
  const columns = Object.keys(cinnost);
  await c.db.batch([
    c.db
      .prepare(`INSERT INTO cinnosti (${columns.join(', ')}) VALUES (${columns.map(() => '?').join(', ')})`)
      .bind(...columns.map((k) => cinnost[k])),
    ...(await syncItemsStatements(c, cinnost, items)),
    ...rememberShoppingStatements(c, householdId, cinnost.store, items.map((i) => i.text)),
  ]);
  const saved = await loadCinnost(c, cinnost.id);
  if (saved.assignedTo && saved.assignedTo !== c.email) await notifyAssigned(c, saved, priestor);
  return saved;
}

/** Uloží zmeny činnosti (názov, popis, priestor, pridelenie, termín, opakovanie, ikona, farba, checklist). */
export async function updateCinnost(c, cinnostId, data) {
  const previous = await findCinnost(c, cinnostId);
  const { priestor, fields, items } = await validateCinnost(c, previous.household_id, data);
  const columns = Object.keys(fields);
  await c.db.batch([
    c.db
      .prepare(`UPDATE cinnosti SET ${columns.map((k) => k + ' = ?').join(', ')} WHERE id = ?`)
      .bind(...columns.map((k) => fields[k]), previous.id),
    ...(await syncItemsStatements(c, previous, items)),
    ...rememberShoppingStatements(c, previous.household_id, fields.store, items.filter((i) => !i.id).map((i) => i.text)),
  ]);
  const saved = await loadCinnost(c, previous.id);
  // Upozorni len nového riešiteľa (nie seba ani toho, kto ju už mal).
  if (saved.assignedTo && saved.assignedTo !== c.email && saved.assignedTo !== previous.assigned_to) {
    await notifyAssigned(c, saved, priestor);
  }
  return saved;
}

/** Pridá položku do checklistu činnosti (môže ktokoľvek z domácnosti). */
export async function addItem(c, cinnostId, text, qty, image, price) {
  price = cleanPrice(price);
  ({ text, qty } = splitQty(text, qty));
  if (!text) throw new AppError('Zadaj položku.');
  image = image ? String(image) : '';
  if (image && (image.length > MAX_IMAGE_LENGTH || !IMAGE_RE.test(image))) throw new AppError('Neplatný obrázok položky.');
  const cinnost = await findCinnost(c, cinnostId);
  const stats = await c.db
    .prepare('SELECT COUNT(*) AS n, COALESCE(MIN(position), 1) AS first FROM polozky WHERE cinnost_id = ?')
    .bind(cinnost.id)
    .first();
  if (stats.n >= MAX_ITEMS) throw new AppError('Činnosť môže mať najviac ' + MAX_ITEMS + ' položiek.');
  const item = toItem({ id: uuid(), text, qty, done: 0, has_image: Boolean(image), price });
  await c.db.batch([
    // nová položka ide na začiatok zoznamu (netreba posúvať)
    insertItemsStatement(c, cinnost, [{ id: item.id, text, qty, price, position: stats.first - 1 }]),
    ...rememberShoppingStatements(c, cinnost.household_id, '', [text]),
    ...(image
      ? [
          c.db
            .prepare('INSERT INTO item_images (item_id, household_id, data, created_at) VALUES (?, ?, ?, ?)')
            .bind(item.id, cinnost.household_id, image, nowIso()),
        ]
      : []),
  ]);
  return item;
}

/** Odškrtne / zruší odškrtnutie položky. */
export async function toggleItem(c, itemId, done) {
  const item = await c.db.prepare(ITEMS_SQL + ' WHERE p.id = ?').bind(String(itemId ?? '')).first();
  if (!item) throw new AppError('Položka neexistuje (možno ju medzičasom niekto vymazal).', 404);
  await requireMember(c, item.household_id);
  await c.db.prepare('UPDATE polozky SET done = ?, missing = 0 WHERE id = ?').bind(done ? 1 : 0, item.id).run();
  return toItem({ ...item, done: done ? 1 : 0, missing: 0 });
}

/** Položka nákupu, ktorú v obchode nemali (alebo zrušenie toho). */
export async function setItemMissing(c, itemId, missing) {
  const item = await c.db.prepare(ITEMS_SQL + ' WHERE p.id = ?').bind(String(itemId ?? '')).first();
  if (!item) throw new AppError('Položka neexistuje (možno ju medzičasom niekto vymazal).', 404);
  await requireMember(c, item.household_id);
  await c.db.prepare('UPDATE polozky SET missing = ?, done = 0 WHERE id = ?').bind(missing ? 1 : 0, item.id).run();
  return toItem({ ...item, done: 0, missing: missing ? 1 : 0 });
}

export async function deleteCinnost(c, cinnostId) {
  const cinnost = await findCinnost(c, cinnostId);
  await c.db.batch([
    c.db.prepare('DELETE FROM polozky WHERE cinnost_id = ?').bind(cinnost.id),
    c.db.prepare('DELETE FROM cinnosti WHERE id = ?').bind(cinnost.id),
    c.db.prepare(IMAGES_CLEANUP_SQL),
  ]);
  return { deleted: true };
}

/**
 * Označí činnosť za hotovú. Jednorazová činnosť sa vymaže, opakovaná sa posunie
 * na ďalší termín – pri úlohe po termíne na najbližší termín po dnešku, aby
 * hneď znova nebola po termíne. Odškrtnuté položky zmiznú, neodškrtnuté zostanú.
 */
export async function completeCinnost(c, cinnostId) {
  const cinnost = await findCinnost(c, cinnostId);
  const history = await historyStatement(c, cinnost);
  if (!PERIODICITIES.includes(cinnost.periodicity) || cinnost.periodicity === 'none') {
    await c.db.batch([
      history,
      c.db.prepare('DELETE FROM polozky WHERE cinnost_id = ?').bind(cinnost.id),
      c.db.prepare('DELETE FROM cinnosti WHERE id = ?').bind(cinnost.id),
      c.db.prepare(IMAGES_CLEANUP_SQL),
    ]);
    return { deleted: true };
  }
  const next = nextDueDateAfter(cinnost.due_date, cinnost.periodicity, cinnost.repeat_interval || 1, c.today);
  await c.db.batch([
    history,
    c.db.prepare('DELETE FROM polozky WHERE cinnost_id = ? AND done = 1').bind(cinnost.id),
    // čo nemali, ostáva na zozname na budúci nákup
    c.db.prepare('UPDATE polozky SET missing = 0 WHERE cinnost_id = ? AND missing = 1').bind(cinnost.id),
    c.db.prepare(IMAGES_CLEANUP_SQL),
    c.db.prepare('UPDATE cinnosti SET due_date = ? WHERE id = ?').bind(next, cinnost.id),
  ]);
  return { deleted: false, cinnost: await loadCinnost(c, cinnost.id) };
}

/** Príkaz, ktorý zapíše dokončenú činnosť do histórie (aj s položkami a ich stavom). */
async function historyStatement(c, cinnost) {
  const [items, priestor] = await c.db.batch([
    c.db.prepare(ITEMS_SQL + ' WHERE p.cinnost_id = ? ORDER BY p.position, p.rowid').bind(cinnost.id),
    c.db.prepare('SELECT name FROM priestory WHERE id = ?').bind(cinnost.priestor_id),
  ]);
  const list = items.results.map((i) => ({
    id: i.id,
    text: i.text,
    qty: i.qty || '',
    price: i.price || '',
    state: i.done ? 'done' : i.missing ? 'missing' : 'open',
    img: Boolean(i.has_image),
  }));
  return c.db
    .prepare(
      `INSERT INTO historia (id, household_id, cinnost_id, name, kind, store, icon, color, priestor, due_date,
                             completed_by, completed_at, items, task)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(
      uuid(),
      cinnost.household_id,
      cinnost.id,
      cinnost.name,
      cinnost.kind || '',
      cinnost.store || '',
      cinnost.icon || 'home',
      cinnost.color || '#4CAF50',
      priestor.results[0] ? priestor.results[0].name : '',
      cinnost.due_date,
      c.email,
      nowIso(),
      JSON.stringify(list),
      JSON.stringify(cinnost)
    );
}

/**
 * Vráti dokončenú činnosť z histórie späť: jednorazová sa znova vytvorí (s rovnakým id),
 * opakovanej sa vráti pôvodný termín. Položky dostanú stav, aký mali pri dokončení
 * (odškrtnuté sa vrátia, aj s obrázkami). Záznam z histórie sa vymaže.
 */
export async function restoreHistory(c, historyId) {
  const h = await c.db.prepare('SELECT * FROM historia WHERE id = ?').bind(String(historyId ?? '')).first();
  if (!h) throw new AppError('Záznam v histórii neexistuje (možno ho už niekto vrátil).', 404);
  await requireMember(c, h.household_id);
  const newer = await c.db
    .prepare('SELECT 1 FROM historia WHERE household_id = ? AND cinnost_id = ? AND completed_at > ? LIMIT 1')
    .bind(h.household_id, h.cinnost_id, h.completed_at)
    .first();
  if (newer) throw new AppError('Najprv vráť novšie dokončenie tejto činnosti.');

  const id = h.cinnost_id || uuid();
  const existing = await c.db.prepare('SELECT * FROM cinnosti WHERE id = ?').bind(id).first();
  if (existing && existing.household_id !== h.household_id) throw new AppError('Činnosť sa nedá vrátiť.');
  const statements = [];
  if (existing) {
    statements.push(c.db.prepare('UPDATE cinnosti SET due_date = ? WHERE id = ?').bind(h.due_date, id));
  } else {
    let task = {};
    try {
      task = JSON.parse(h.task || '{}') || {};
    } catch {
      task = {};
    }
    // priestor mohol medzičasom zaniknúť; staré záznamy majú len jeho názov
    const priestor = await c.db
      .prepare('SELECT id FROM priestory WHERE household_id = ? AND (id = ? OR name = ?) ORDER BY id = ? DESC LIMIT 1')
      .bind(h.household_id, String(task.priestor_id || ''), h.priestor, String(task.priestor_id || ''))
      .first();
    const row = {
      id,
      household_id: h.household_id,
      priestor_id: priestor ? priestor.id : '',
      name: h.name,
      description: String(task.description || ''),
      assigned_to: task.assigned_to ?? h.completed_by,
      icon: h.icon,
      color: h.color,
      due_date: h.due_date,
      periodicity: PERIODICITIES.includes(task.periodicity) ? task.periodicity : 'none',
      repeat_interval: task.repeat_interval ?? null,
      kind: h.kind,
      store: h.store,
      created_at: task.created_at || nowIso(),
    };
    const columns = Object.keys(row);
    statements.push(
      c.db
        .prepare(`INSERT INTO cinnosti (${columns.join(', ')}) VALUES (${columns.map(() => '?').join(', ')})`)
        .bind(...columns.map((k) => row[k]))
    );
  }
  const items = JSON.parse(h.items || '[]')
    .filter((i) => i && i.id && i.text)
    .map((i, index) => ({
      id: String(i.id),
      text: String(i.text),
      qty: String(i.qty || ''),
      price: String(i.price || ''),
      done: i.state === 'done' ? 1 : 0,
      missing: i.state === 'missing' ? 1 : 0,
      position: index + 1,
    }));
  if (items.length) {
    // položky, ktoré na opakovanej činnosti ostali, dostanú späť svoj stav
    statements.push(
      c.db
        .prepare(
          `INSERT INTO polozky (id, cinnost_id, household_id, text, qty, done, missing, position, created_at, created_by, price)
           SELECT json_extract(value, '$.id'), ?, ?, json_extract(value, '$.text'), json_extract(value, '$.qty'),
                  json_extract(value, '$.done'), json_extract(value, '$.missing'), json_extract(value, '$.position'),
                  ?, ?, json_extract(value, '$.price')
           FROM json_each(?) WHERE true
           ON CONFLICT (id) DO UPDATE SET done = excluded.done, missing = excluded.missing
             WHERE polozky.cinnost_id = excluded.cinnost_id`
        )
        .bind(id, h.household_id, nowIso(), c.email, JSON.stringify(items))
    );
  }
  statements.push(c.db.prepare('DELETE FROM historia WHERE id = ?').bind(h.id));
  await c.db.batch(statements);
  return loadCinnost(c, id);
}

const HISTORY_PAGE = 40;

/** História domácnosti od najnovších; before = completedAt posledného načítaného záznamu. */
export async function getHistory(c, householdId, before) {
  await requireMember(c, householdId);
  const { results } = await c.db
    .prepare('SELECT * FROM historia WHERE household_id = ? AND completed_at < ? ORDER BY completed_at DESC LIMIT ?')
    .bind(householdId, String(before || '9999'), HISTORY_PAGE + 1)
    .all();
  return {
    entries: results.slice(0, HISTORY_PAGE).map((r) => ({
      id: r.id,
      name: r.name,
      kind: r.kind,
      store: r.store,
      icon: r.icon,
      color: r.color,
      priestor: r.priestor,
      dueDate: r.due_date,
      completedBy: r.completed_by,
      completedAt: r.completed_at,
      items: JSON.parse(r.items || '[]').map((i) => ({
        text: i.text,
        qty: i.qty,
        ...(i.price && { price: i.price }),
        state: i.state,
        ...(i.img && { image: '/api/item-image/' + i.id }),
      })),
    })),
    more: results.length > HISTORY_PAGE,
  };
}

// ---- Push notifikácie ------------------------------------------------------------

/** Verejný kľúč VAPID pre pushManager.subscribe v prehliadači. */
export async function getPushKey(c) {
  return { publicKey: (await vapidKeys(c.db)).publicKey };
}

/** Zapne upozornenia na tomto zariadení (odber z pushManager.subscribe). */
export async function subscribePush(c, subscription) {
  try {
    await saveSubscription(c.db, c.email, subscription);
  } catch {
    throw new AppError('Neplatný odber upozornení.');
  }
  await rememberOrigin(c.db, c.origin);
  return { ok: true };
}

/** Vypne upozornenia na zariadení s daným odberom. */
export async function unsubscribePush(c, endpoint) {
  await c.db.prepare('DELETE FROM push_subscriptions WHERE endpoint = ? AND email = ?').bind(String(endpoint ?? ''), c.email).run();
  return { ok: true };
}

/** Skúšobná notifikácia na všetky moje zariadenia. */
export async function testPush(c) {
  const sent = await sendToUser(c.db, c.email, {
    title: '✅ Upozornenia fungujú',
    body: 'Takto ti Gazda dá vedieť o nových úlohách a ráno o 8:00 o dnešných úlohách.',
    tag: 'test',
    url: '/',
  });
  return { sent };
}


// ---- Miniatúry položiek ------------------------------------------------------------

/** GET /api/item-image/<id> – miniatúra položky (len pre členov domácnosti). */
export async function itemImage(c, itemId) {
  const row = await c.db
    .prepare(
      `SELECT i.data FROM item_images i JOIN members m ON m.household_id = i.household_id AND m.email = ?
       WHERE i.item_id = ?`
    )
    .bind(c.email, String(itemId ?? ''))
    .first();
  if (!row) throw new AppError('Obrázok neexistuje.', 404);
  const [, type, b64] = row.data.match(/^data:([^;]+);base64,(.*)$/);
  const bytes = Uint8Array.from(atob(b64), (ch) => ch.charCodeAt(0));
  // Obrázok položky sa nemení (nová miniatúra = nová položka), smie sa držať dlho.
  return new Response(bytes, { headers: { 'content-type': type, 'cache-control': 'private, max-age=31536000, immutable' } });
}
