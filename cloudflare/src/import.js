// Prenos dát zo starej Gazdy (Google Apps Script / Google tabuľka).
//
// 1. Prihlásený používateľ si v novej Gazde vytvorí jednorazový kód (30 min).
// 2. Stará Gazda (len jej vlastník) pošle všetky listy na POST /api/import s kódom.
// 3. Údaje sa vložia jednou transakciou; opakovaný prenos nič nezdvojí ani nezmaže
//    (podľa id sa aktualizujú), takže sa dá kedykoľvek zopakovať.
//
// Každá tabuľka je jeden príkaz s JSON zoznamom (json_each) – D1 free plán dovolí
// najviac 50 dotazov na požiadavku.

import { AppError, DATE_RE, EMAIL_RE, PERIODICITIES, nameKey, nowIso } from './domain.js';
import { hashToken } from './auth.js';

const CODE_KEY = 'import_code';
const CODE_MINUTES = 30;
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // bez 0/O, 1/I/L
const MAX_ATTEMPTS = 10;
const MAX_TABLE_JSON = 1_900_000; // D1: najviac 2 MB na jednu hodnotu

/** Vytvorí jednorazový kód na prenos (nahradí predchádzajúci). */
export async function createImportCode(c) {
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  const code = [...bytes].map((b) => CODE_ALPHABET[b % CODE_ALPHABET.length]).join('');
  const expires = new Date(Date.now() + CODE_MINUTES * 60000).toISOString();
  const value = JSON.stringify({ hash: await hashToken(code), email: c.email, expires, attempts: 0 });
  await c.db
    .prepare('INSERT INTO config (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value')
    .bind(CODE_KEY, value)
    .run();
  return { code, minutes: CODE_MINUTES, appUrl: c.origin };
}

/** Over kód; vráti e-mail toho, kto ho vytvoril. Po 10 zlých pokusoch kód prestane platiť. */
async function checkCode(db, code) {
  const row = await db.prepare('SELECT value FROM config WHERE key = ?').bind(CODE_KEY).first();
  const stored = row ? JSON.parse(row.value) : null;
  if (!stored || stored.expires < nowIso()) {
    throw new AppError('Kód neplatí alebo vypršal. V novej Gazde si vytvor nový (Môj účet → Preniesť zo starej Gazdy).', 403);
  }
  const normalized = String(code ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  if ((await hashToken(normalized)) !== stored.hash) {
    stored.attempts = (stored.attempts || 0) + 1;
    if (stored.attempts >= MAX_ATTEMPTS) await db.prepare('DELETE FROM config WHERE key = ?').bind(CODE_KEY).run();
    else await db.prepare('UPDATE config SET value = ? WHERE key = ?').bind(JSON.stringify(stored), CODE_KEY).run();
    throw new AppError('Nesprávny kód.', 403);
  }
  return stored.email;
}

const str = (v, max = 500) => String(v ?? '').trim().slice(0, max);
const list = (v) => (Array.isArray(v) ? v : []);

/** Vyčistí a skontroluje dáta zo starej Gazdy (názvy polí ako v Google tabuľke). */
export function cleanData(data) {
  const households = new Map();
  for (const h of list(data.households)) {
    const id = str(h.id, 100);
    if (id && str(h.name)) {
      households.set(id, { id, name: str(h.name, 80), created_by_email: str(h.createdByEmail).toLowerCase(), created_at: str(h.createdAt) || nowIso() });
    }
  }
  const members = new Map();
  for (const m of list(data.members)) {
    const email = str(m.email).toLowerCase();
    if (households.has(m.householdId) && EMAIL_RE.test(email)) {
      members.set(m.householdId + '|' + email, {
        household_id: m.householdId,
        email,
        role: m.role === 'owner' ? 'owner' : 'member',
        added_at: str(m.addedAt) || nowIso(),
      });
    }
  }
  const priestory = new Map();
  for (const p of list(data.priestory)) {
    const id = str(p.id, 100);
    if (id && households.has(p.householdId) && str(p.name)) {
      priestory.set(id, { id, household_id: p.householdId, name: str(p.name, 80), created_at: str(p.createdAt) || nowIso() });
    }
  }
  const cinnosti = new Map();
  for (const c of list(data.cinnosti)) {
    const id = str(c.id, 100);
    const dueDate = str(c.dueDate, 10);
    if (!id || !households.has(c.householdId) || !str(c.name) || !DATE_RE.test(dueDate)) continue;
    const periodicity = PERIODICITIES.includes(c.periodicity) ? c.periodicity : 'none';
    const interval = parseInt(c.repeatInterval, 10);
    const kind = c.kind === 'nakup' ? 'nakup' : '';
    cinnosti.set(id, {
      id,
      household_id: c.householdId,
      priestor_id: priestory.has(c.priestorId) ? c.priestorId : '',
      name: str(c.name, 80),
      description: str(c.description, 2000),
      assigned_to: str(c.assignedTo).toLowerCase(),
      icon: str(c.icon, 40) || 'home',
      color: /^#[0-9A-Fa-f]{6}$/.test(c.color) ? c.color : '#4CAF50',
      due_date: dueDate,
      periodicity,
      repeat_interval: periodicity === 'none' ? null : interval >= 1 ? interval : 1,
      kind,
      store: kind ? str(c.store, 60) : '',
      created_at: str(c.createdAt) || nowIso(),
    });
  }
  const polozky = new Map();
  for (const i of list(data.polozky)) {
    const id = str(i.id, 100);
    const task = cinnosti.get(i.cinnostId);
    if (!id || !task || !str(i.text)) continue;
    polozky.set(id, {
      id,
      cinnost_id: task.id,
      household_id: task.household_id,
      text: str(i.text, 100),
      qty: str(i.qty, 20),
      done: i.done === true || i.done === '1' ? 1 : 0,
      position: parseInt(i.position, 10) || 0,
      created_at: str(i.createdAt) || nowIso(),
      created_by: str(i.createdBy).toLowerCase(),
    });
  }
  const obchody = new Map();
  for (const o of list(data.obchody)) {
    const name = str(o.name, 60);
    if (households.has(o.householdId) && name) {
      const key = o.householdId + '|' + nameKey(name);
      if (!obchody.has(key)) obchody.set(key, { household_id: o.householdId, name_key: nameKey(name), name, created_at: str(o.createdAt) || nowIso() });
    }
  }
  const produkty = new Map();
  for (const p of list(data.produkty)) {
    const name = str(p.name, 100);
    if (!households.has(p.householdId) || !name) continue;
    const key = p.householdId + '|' + nameKey(name);
    const uses = Math.max(1, parseInt(p.uses, 10) || 1);
    const prev = produkty.get(key);
    if (!prev || prev.uses < uses) {
      produkty.set(key, { household_id: p.householdId, name_key: nameKey(name), name, uses, last_used: str(p.lastUsed) || nowIso() });
    }
  }
  const users = new Map();
  for (const u of list(data.users)) {
    const email = str(u.email).toLowerCase();
    if (EMAIL_RE.test(email)) {
      users.set(email, {
        email,
        last_household_id: households.has(u.lastHouseholdId) ? u.lastHouseholdId : '',
        created_at: str(u.createdAt) || nowIso(),
      });
    }
  }
  const values = (m) => [...m.values()];
  return {
    households: values(households),
    members: values(members),
    priestory: values(priestory),
    cinnosti: values(cinnosti),
    polozky: values(polozky),
    obchody: values(obchody),
    produkty: values(produkty),
    users: values(users),
  };
}

/** INSERT … SELECT z JSON zoznamu; columns = stĺpce tabuľky (rovnako pomenované kľúče v JSON). */
function bulk(db, table, columns, rows, onConflict) {
  const json = JSON.stringify(rows);
  if (json.length > MAX_TABLE_JSON) throw new AppError('Príliš veľa dát v jednej tabuľke (' + table + ').', 413);
  const select = columns.map((col) => `json_extract(value, '$.${col}')`).join(', ');
  return db
    .prepare(`INSERT INTO ${table} (${columns.join(', ')}) SELECT ${select} FROM json_each(?) WHERE true ${onConflict}`)
    .bind(json);
}

const set = (cols) => 'DO UPDATE SET ' + cols.map((col) => `${col} = excluded.${col}`).join(', ');

/** POST /api/import – volá stará Gazda. Vráti počty prenesených záznamov. */
export async function importData(db, body) {
  const ownerEmail = await checkCode(db, body && body.code);
  if (!body.data || typeof body.data !== 'object') throw new AppError('Chýbajú dáta na prenos.');
  const d = cleanData(body.data);
  if (!d.members.some((m) => m.email === ownerEmail)) {
    throw new AppError(
      'V prenesených dátach nie si (' + ownerEmail + ') členom žiadnej domácnosti. Kód si vytvor tým istým ' +
        'Google účtom, s ktorým používaš starú Gazdu.',
      403
    );
  }

  await db.batch([
    bulk(db, 'households', ['id', 'name', 'created_by_email', 'created_at'], d.households, 'ON CONFLICT (id) ' + set(['name'])),
    bulk(db, 'members', ['household_id', 'email', 'role', 'added_at'], d.members, 'ON CONFLICT (household_id, email) ' + set(['role'])),
    bulk(db, 'priestory', ['id', 'household_id', 'name', 'created_at'], d.priestory, 'ON CONFLICT (id) ' + set(['name'])),
    bulk(
      db,
      'cinnosti',
      ['id', 'household_id', 'priestor_id', 'name', 'description', 'assigned_to', 'icon', 'color', 'due_date', 'periodicity', 'repeat_interval', 'kind', 'store', 'created_at'],
      d.cinnosti,
      'ON CONFLICT (id) ' +
        set(['priestor_id', 'name', 'description', 'assigned_to', 'icon', 'color', 'due_date', 'periodicity', 'repeat_interval', 'kind', 'store'])
    ),
    bulk(
      db,
      'polozky',
      ['id', 'cinnost_id', 'household_id', 'text', 'qty', 'done', 'position', 'created_at', 'created_by'],
      d.polozky,
      'ON CONFLICT (id) ' + set(['text', 'qty', 'done', 'position'])
    ),
    bulk(db, 'obchody', ['household_id', 'name_key', 'name', 'created_at'], d.obchody, 'ON CONFLICT DO NOTHING'),
    bulk(
      db,
      'produkty',
      ['household_id', 'name_key', 'name', 'uses', 'last_used'],
      d.produkty,
      'ON CONFLICT (household_id, name_key) DO UPDATE SET uses = max(uses, excluded.uses), last_used = max(last_used, excluded.last_used)'
    ),
    // Používatelia: nový záznam, alebo len doplnená posledná domácnosť (prezývku a prihlásenie nemení).
    bulk(
      db,
      'users',
      ['email', 'last_household_id', 'created_at'],
      d.users,
      "ON CONFLICT (email) DO UPDATE SET last_household_id = CASE WHEN users.last_household_id = '' THEN excluded.last_household_id ELSE users.last_household_id END"
    ),
    db.prepare('DELETE FROM config WHERE key = ?').bind(CODE_KEY), // kód je jednorazový
  ]);

  const counts = {};
  for (const [table, rows] of Object.entries(d)) counts[table] = rows.length;
  return counts;
}
