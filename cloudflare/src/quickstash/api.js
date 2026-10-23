// QuickStash – API (POST /api/quickstash/<funkcia>): texty, odkazy a heslá na rýchle
// skopírovanie (webová verzia desktopového QuickStashu, teraz podaplikácia Family Grid).
//
// Položky patria rodine (households). Spoločnú položku (owner_email = '') vidí a mení každý
// člen rodiny, súkromnú (owner_email = e-mail) len jej majiteľ. Aplikácia si načíta všetky
// viditeľné položky naraz (getData) a hľadá v nich v prehliadači.

import { requireFamilyMember } from '../family.js';
import { AppError, nowIso, requireText } from '../domain.js';

const uuid = () => crypto.randomUUID();
const MAX_NAME = 80;
const MAX_VALUE = 4000;
const MAX_IMPORT = 1000;
export const TYPES = ['text', 'password'];

const toEntry = (r) => ({
  id: r.id,
  name: r.name,
  value: r.value,
  type: r.type,
  private: Boolean(r.owner_email),
  createdBy: r.created_by,
  updatedAt: r.updated_at,
});

// Položky, ktoré používateľ vidí: spoločné celej rodiny a jeho súkromné.
const VISIBLE = "household_id = ?1 AND (owner_email = '' OR owner_email = ?2)";

// ---- Kontroly -----------------------------------------------------------------------

async function findEntry(c, id) {
  const row = await c.db.prepare('SELECT * FROM quickstash_entries WHERE id = ?').bind(String(id ?? '')).first();
  // cudzia súkromná položka sa tvári ako neexistujúca
  if (!row || (row.owner_email && row.owner_email !== c.email)) {
    throw new AppError('Položka neexistuje (možno ju medzičasom niekto vymazal).', 404);
  }
  await requireFamilyMember(c, row.household_id);
  return row;
}

function cleanName(name) {
  name = requireText(String(name ?? '').replace(/\s+/g, ' '), 'Zadaj názov položky.');
  if (name.length > MAX_NAME) throw new AppError('Názov môže mať najviac ' + MAX_NAME + ' znakov.');
  return name;
}

function cleanValue(value) {
  value = requireText(String(value ?? ''), 'Zadaj text, odkaz alebo heslo.');
  if (value.length > MAX_VALUE) throw new AppError('Hodnota môže mať najviac ' + MAX_VALUE + ' znakov.');
  return value;
}

const cleanType = (type) => (type === 'password' ? 'password' : 'text');

/** Názov musí byť medzi viditeľnými položkami jedinečný (ako kľúč v desktopovom QuickStashi). */
async function checkUniqueName(c, householdId, name, exceptId) {
  const clash = await c.db
    .prepare(`SELECT id FROM quickstash_entries WHERE ${VISIBLE} AND name = ?3 COLLATE NOCASE AND id <> ?4`)
    .bind(householdId, c.email, name, exceptId || '')
    .first();
  if (clash) throw new AppError('Položka s názvom „' + name + '“ už existuje.');
}

// ---- Načítanie ---------------------------------------------------------------------------

export async function getData(c, householdId) {
  await requireFamilyMember(c, householdId);
  const [household, entries] = await c.db.batch([
    c.db.prepare('SELECT quickstash_rev FROM households WHERE id = ?').bind(householdId),
    c.db.prepare(`SELECT * FROM quickstash_entries WHERE ${VISIBLE} ORDER BY name COLLATE NOCASE`).bind(householdId, c.email),
  ]);
  return {
    householdId,
    rev: household.results[0] ? household.results[0].quickstash_rev : 0,
    entries: entries.results.map(toEntry),
  };
}

/** Lacná kontrola zmien (aplikácia sa pýta každých pár sekúnd). */
export async function getRev(c, householdId) {
  await requireFamilyMember(c, householdId);
  const row = await c.db.prepare('SELECT quickstash_rev FROM households WHERE id = ?').bind(householdId).first();
  return row ? row.quickstash_rev : 0;
}

// ---- Zmeny -------------------------------------------------------------------------------

/** Nová alebo upravená položka: { id?, name, value, type: text | password, private }. */
export async function saveEntry(c, householdId, data) {
  data = data && typeof data === 'object' ? data : {};
  const name = cleanName(data.name);
  const value = cleanValue(data.value);
  const type = cleanType(data.type);
  const owner = data.private ? c.email : '';
  const now = nowIso();
  if (data.id) {
    const old = await findEntry(c, data.id);
    await checkUniqueName(c, old.household_id, name, old.id);
    await c.db
      .prepare('UPDATE quickstash_entries SET name = ?, value = ?, type = ?, owner_email = ?, updated_at = ? WHERE id = ?')
      .bind(name, value, type, owner, now, old.id)
      .run();
    return toEntry({ ...old, name, value, type, owner_email: owner, updated_at: now });
  }
  await requireFamilyMember(c, householdId);
  await checkUniqueName(c, householdId, name);
  const row = { id: uuid(), household_id: householdId, owner_email: owner, name, value, type, created_by: c.email, created_at: now, updated_at: now };
  await c.db
    .prepare(
      `INSERT INTO quickstash_entries (id, household_id, owner_email, name, value, type, created_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(row.id, householdId, owner, name, value, type, c.email, now, now)
    .run();
  return toEntry(row);
}

export async function deleteEntry(c, entryId) {
  const row = await findEntry(c, entryId);
  await c.db.prepare('DELETE FROM quickstash_entries WHERE id = ?').bind(row.id).run();
  return { ok: true };
}

/**
 * Import zálohy (JSON z desktopového QuickStashu – data.json – alebo z webovej verzie):
 * { "<názov>": { "value": "…", "type": "text|password|file|folder" } }, staršie aj
 * { "value": "…", "password": true }. Súbory a priečinky sa prenesú ako text (cesta sa dá skopírovať).
 *
 * mode: 'merge' = rovnaký názov sa prepíše, ostatné pribudnú; 'replace' = najprv sa zmažú
 * všetky položky v cieli (spoločné rodiny, alebo moje súkromné). isPrivate = kam nové položky patria.
 */
export async function importEntries(c, householdId, entries, mode, isPrivate) {
  await requireFamilyMember(c, householdId);
  if (!entries || typeof entries !== 'object' || Array.isArray(entries)) throw new AppError('Neplatný súbor zálohy.');
  const owner = isPrivate ? c.email : '';
  const incoming = [];
  const seen = new Set();
  for (const [key, v] of Object.entries(entries)) {
    if (!v || typeof v !== 'object' || v.value === undefined || v.value === null) continue;
    const name = String(key).replace(/\s+/g, ' ').trim().slice(0, MAX_NAME);
    const value = String(v.value).trim();
    if (!name || !value || value.length > MAX_VALUE || seen.has(name.toLowerCase())) continue;
    seen.add(name.toLowerCase());
    incoming.push({ name, value, type: v.type === 'password' || (v.password === true && !v.isFile) ? 'password' : 'text' });
  }
  if (!incoming.length) throw new AppError('V súbore nie sú žiadne položky.');
  if (incoming.length > MAX_IMPORT) throw new AppError('Naraz sa dá preniesť najviac ' + MAX_IMPORT + ' položiek.');

  const statements = [];
  if (mode === 'replace') {
    statements.push(c.db.prepare('DELETE FROM quickstash_entries WHERE household_id = ? AND owner_email = ?').bind(householdId, owner));
  }
  // Rovnaký názov medzi viditeľnými položkami sa prepíše (pri „replace“ už len v druhom cieli).
  const { results } = await c.db.prepare(`SELECT id, name, owner_email FROM quickstash_entries WHERE ${VISIBLE}`).bind(householdId, c.email).all();
  const existing = new Map(
    results.filter((r) => mode !== 'replace' || r.owner_email !== owner).map((r) => [r.name.toLowerCase(), r.id])
  );
  const now = nowIso();
  let added = 0;
  let updated = 0;
  for (const e of incoming) {
    const id = existing.get(e.name.toLowerCase());
    if (id) {
      updated++;
      statements.push(c.db.prepare('UPDATE quickstash_entries SET value = ?, type = ?, updated_at = ? WHERE id = ?').bind(e.value, e.type, now, id));
    } else {
      added++;
      statements.push(
        c.db
          .prepare(
            `INSERT INTO quickstash_entries (id, household_id, owner_email, name, value, type, created_by, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
          )
          .bind(uuid(), householdId, owner, e.name, e.value, e.type, c.email, now, now)
      );
    }
  }
  await c.db.batch(statements);
  return { added, updated, data: await getData(c, householdId) };
}
