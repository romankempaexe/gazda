// API Gazdu – rovnaké funkcie a odpovede ako vo verzii Apps Script (google.script.run),
// takže aplikácia v prehliadači sa mení len v tom, ako server volá.
//
// Každá funkcia dostane kontext c = { db, email, origin, today } a argumenty z prehliadača.
// Zápisy, ktoré patria k sebe, idú jedným db.batch() – D1 ich vykoná ako jednu transakciu.

import { issueToken, personalLink } from './auth.js';
import { notifyAssigned } from './notifications.js';
import {
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
  hasLink: Boolean(r.has_link),
});
const toPriestor = (r) => ({ id: r.id, householdId: r.household_id, name: r.name, createdAt: r.created_at });
const toItem = (r) => ({ id: r.id, text: r.text, qty: r.qty || '', done: Boolean(r.done) });
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

const MEMBERS_SQL = `SELECT m.*, (u.token_hash IS NOT NULL AND u.token_hash <> '') AS has_link
  FROM members m LEFT JOIN users u ON u.email = m.email`;

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
    c.db.prepare('SELECT * FROM polozky WHERE cinnost_id = ? ORDER BY position, rowid').bind(id),
  ]);
  return toCinnost(task.results[0], items.results.map(toItem));
}

async function inviteFor(c, email) {
  const user = await c.db.prepare('SELECT token_hash FROM users WHERE email = ?').bind(email).first();
  if (user && user.token_hash) return null;
  return { email, link: personalLink(c.origin, await issueToken(c.db, email)) };
}

// ---- Domácnosti ---------------------------------------------------------------

export async function getHouseholds(c) {
  const [households, members] = await c.db.batch([
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
  return {
    email: c.email,
    households: households.results.map((h) => ({
      ...toHousehold(h),
      members: members.results.filter((m) => m.household_id === h.id).map(toMember),
    })),
  };
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

  // Novým používateľom (bez odkazu) rovno vytvor pozývací odkaz.
  const invites = [];
  for (const e of shareWith) {
    const invite = await inviteFor(c, e);
    if (invite) invites.push(invite);
  }
  return { ...(await getHouseholds(c)), invites };
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

  const invite = await inviteFor(c, newEmail);
  return { ...(await getHouseholds(c)), invites: invite ? [invite] : [] };
}

/**
 * Vytvorí osobný odkaz pre člena domácnosti. Člen bez odkazu ho môže dostať od
 * hocikoho z domácnosti; nový odkaz pre člena, ktorý už odkaz má, môže vytvoriť
 * len on sám alebo zakladateľ domácnosti (starý odkaz tým prestane fungovať).
 */
export async function createMemberLink(c, householdId, memberEmail) {
  const me = await requireMember(c, householdId);
  memberEmail = String(memberEmail ?? '').trim().toLowerCase();
  const target = await c.db
    .prepare('SELECT 1 FROM members WHERE household_id = ? AND email = ?')
    .bind(householdId, memberEmail)
    .first();
  if (!target) throw new AppError('Tento človek nie je členom domácnosti.');

  const user = await c.db.prepare('SELECT token_hash FROM users WHERE email = ?').bind(memberEmail).first();
  const hasLink = Boolean(user && user.token_hash);
  if (hasLink && memberEmail !== c.email && me.role !== 'owner') {
    throw new AppError('Nový odkaz pre iného člena môže vytvoriť len zakladateľ domácnosti.', 403);
  }
  return { email: memberEmail, link: personalLink(c.origin, await issueToken(c.db, memberEmail)), replaced: hasLink };
}

/** Vytvorí nový osobný odkaz pre prihláseného používateľa; starý prestane fungovať. */
export async function regenerateMyLink(c) {
  const token = await issueToken(c.db, c.email);
  return { email: c.email, token, link: personalLink(c.origin, token) };
}

export async function deleteHousehold(c, householdId) {
  const member = await requireMember(c, householdId);
  if (member.role !== 'owner') throw new AppError('Domácnosť môže vymazať len jej zakladateľ.', 403);
  const del = (table, column = 'household_id') => c.db.prepare(`DELETE FROM ${table} WHERE ${column} = ?`).bind(householdId);
  await c.db.batch([
    del('polozky'),
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
    q('SELECT * FROM polozky WHERE household_id = ? ORDER BY position, rowid'),
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
  if (assignedTo) {
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

const insertItem = (c) =>
  c.db.prepare(
    `INSERT INTO polozky (id, cinnost_id, household_id, text, qty, done, position, created_at, created_by)
     VALUES (?, ?, ?, ?, ?, 0, ?, ?, ?)`
  );

/**
 * Príkazy, ktoré zosúladia checklist činnosti so zoznamom z formulára: nové položky
 * pridajú, chýbajúce vymažú, zmenia text, počet a poradie. Stav odškrtnutia ostáva
 * z databázy (formulár ho nemení, aby neprepísal odškrtnutie od iného člena).
 */
async function syncItemsStatements(c, cinnost, items) {
  const { results: existing } = await c.db.prepare('SELECT * FROM polozky WHERE cinnost_id = ?').bind(cinnost.id).all();
  const byId = new Map(existing.map((i) => [i.id, i]));
  const keep = new Set();
  const statements = [];
  const now = nowIso();
  items.forEach((item, index) => {
    const position = index + 1;
    const current = item.id && byId.get(item.id);
    if (current) {
      keep.add(current.id);
      if (current.text !== item.text || (current.qty || '') !== item.qty || current.position !== position) {
        statements.push(
          c.db.prepare('UPDATE polozky SET text = ?, qty = ?, position = ? WHERE id = ?').bind(item.text, item.qty, position, current.id)
        );
      }
    } else {
      statements.push(insertItem(c).bind(uuid(), cinnost.id, cinnost.household_id, item.text, item.qty, position, now, c.email));
    }
  });
  for (const i of existing) {
    if (!keep.has(i.id)) statements.push(c.db.prepare('DELETE FROM polozky WHERE id = ?').bind(i.id));
  }
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
  const seen = new Set();
  for (const text of texts) {
    const key = nameKey(text);
    if (!text || seen.has(key)) continue;
    seen.add(key);
    statements.push(
      c.db
        .prepare(
          `INSERT INTO produkty (household_id, name_key, name, uses, last_used) VALUES (?, ?, ?, 1, ?)
           ON CONFLICT (household_id, name_key) DO UPDATE SET uses = uses + 1, last_used = excluded.last_used`
        )
        .bind(householdId, key, text, now)
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
export async function addItem(c, cinnostId, text, qty) {
  ({ text, qty } = splitQty(text, qty));
  if (!text) throw new AppError('Zadaj položku.');
  const cinnost = await findCinnost(c, cinnostId);
  const stats = await c.db
    .prepare('SELECT COUNT(*) AS n, COALESCE(MAX(position), 0) AS last FROM polozky WHERE cinnost_id = ?')
    .bind(cinnost.id)
    .first();
  if (stats.n >= MAX_ITEMS) throw new AppError('Činnosť môže mať najviac ' + MAX_ITEMS + ' položiek.');
  const item = { id: uuid(), text, qty, done: false };
  await c.db.batch([
    insertItem(c).bind(item.id, cinnost.id, cinnost.household_id, text, qty, stats.last + 1, nowIso(), c.email),
    ...rememberShoppingStatements(c, cinnost.household_id, '', [text]),
  ]);
  return item;
}

/** Odškrtne / zruší odškrtnutie položky. */
export async function toggleItem(c, itemId, done) {
  const item = await c.db.prepare('SELECT * FROM polozky WHERE id = ?').bind(String(itemId ?? '')).first();
  if (!item) throw new AppError('Položka neexistuje (možno ju medzičasom niekto vymazal).', 404);
  await requireMember(c, item.household_id);
  await c.db.prepare('UPDATE polozky SET done = ? WHERE id = ?').bind(done ? 1 : 0, item.id).run();
  return toItem({ ...item, done: done ? 1 : 0 });
}

export async function deleteCinnost(c, cinnostId) {
  const cinnost = await findCinnost(c, cinnostId);
  await c.db.batch([
    c.db.prepare('DELETE FROM polozky WHERE cinnost_id = ?').bind(cinnost.id),
    c.db.prepare('DELETE FROM cinnosti WHERE id = ?').bind(cinnost.id),
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
  if (!PERIODICITIES.includes(cinnost.periodicity) || cinnost.periodicity === 'none') {
    return deleteCinnost(c, cinnostId);
  }
  const next = nextDueDateAfter(cinnost.due_date, cinnost.periodicity, cinnost.repeat_interval || 1, c.today);
  await c.db.batch([
    c.db.prepare('DELETE FROM polozky WHERE cinnost_id = ? AND done = 1').bind(cinnost.id),
    c.db.prepare('UPDATE cinnosti SET due_date = ? WHERE id = ?').bind(next, cinnost.id),
  ]);
  return { deleted: false, cinnost: await loadCinnost(c, cinnost.id) };
}
