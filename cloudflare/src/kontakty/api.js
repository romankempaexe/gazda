// Kontakty – API (POST /api/kontakty/<funkcia>): telefónny zoznam dôležitých čísel rodiny
// ako podaplikácia Family Grid. Kontakt má meno, telefónne číslo, voliteľne e-mail a poznámku.
// Patria rodine – vidia a menia ich všetci jej členovia.

import { requireFamilyMember } from '../family.js';
import { AppError, nowIso, requireText } from '../domain.js';

const uuid = () => crypto.randomUUID();
const MAX_NAME = 80;
const MAX_NOTE = 500;
const MAX_CONTACTS = 500;

const toContact = (r) => ({
  id: r.id,
  name: r.name,
  phone: r.phone,
  email: r.email,
  note: r.note,
  favorite: Boolean(r.favorite),
  createdBy: r.created_by,
  updatedAt: r.updated_at,
});

// ---- Kontroly -----------------------------------------------------------------------

async function findContact(c, id) {
  const row = await c.db.prepare('SELECT * FROM kontakty_entries WHERE id = ?').bind(String(id ?? '')).first();
  if (!row) throw new AppError('Kontakt neexistuje (možno ho medzičasom niekto vymazal).', 404);
  await requireFamilyMember(c, row.household_id);
  return row;
}

function cleanName(name) {
  name = requireText(String(name ?? '').replace(/\s+/g, ' '), 'Zadaj meno.');
  if (name.length > MAX_NAME) throw new AppError('Meno môže mať najviac ' + MAX_NAME + ' znakov.');
  return name;
}

/** Telefónne číslo: číslice, na začiatku môže byť +, medzery/pomlčky/lomky/zátvorky sa ponechajú. */
export function cleanPhone(phone) {
  phone = String(phone ?? '').replace(/\s+/g, ' ').trim();
  if (!phone) return '';
  if (!/^\+?[\d\s\-/().]+$/.test(phone)) throw new AppError('Telefónne číslo môže obsahovať len číslice, medzery a + na začiatku.');
  const digits = phone.replace(/\D/g, '');
  if (digits.length < 3 || digits.length > 16) throw new AppError('Telefónne číslo má mať 3 až 16 číslic.');
  return phone;
}

export function cleanEmail(email) {
  email = String(email ?? '').trim();
  if (!email) return '';
  if (email.length > 120 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new AppError('E-mail nie je platný.');
  return email;
}

function cleanNote(note) {
  note = String(note ?? '').trim();
  if (note.length > MAX_NOTE) throw new AppError('Poznámka môže mať najviac ' + MAX_NOTE + ' znakov.');
  return note;
}

// ---- Načítanie ---------------------------------------------------------------------------

export async function getData(c, householdId) {
  await requireFamilyMember(c, householdId);
  const [household, contacts] = await c.db.batch([
    c.db.prepare('SELECT kontakty_rev FROM households WHERE id = ?').bind(householdId),
    c.db.prepare('SELECT * FROM kontakty_entries WHERE household_id = ? ORDER BY favorite DESC, name COLLATE NOCASE').bind(householdId),
  ]);
  return {
    householdId,
    rev: (household.results[0] || {}).kontakty_rev || 0,
    contacts: contacts.results.map(toContact),
  };
}

/** Lacná kontrola zmien (aplikácia sa pýta každých pár sekúnd). */
export async function getRev(c, householdId) {
  await requireFamilyMember(c, householdId);
  const row = await c.db.prepare('SELECT kontakty_rev FROM households WHERE id = ?').bind(householdId).first();
  return row ? row.kontakty_rev : 0;
}

// ---- Úpravy ------------------------------------------------------------------------------

/** Nový alebo upravený kontakt: { id?, name, phone, email, note, favorite }. Treba číslo alebo e-mail. */
export async function saveContact(c, householdId, data) {
  data = data && typeof data === 'object' ? data : {};
  const old = data.id ? await findContact(c, data.id) : null;
  const hh = old ? old.household_id : householdId;
  if (!old) await requireFamilyMember(c, hh);
  const row = {
    name: cleanName(data.name),
    phone: cleanPhone(data.phone),
    email: cleanEmail(data.email),
    note: cleanNote(data.note),
    favorite: data.favorite ? 1 : 0,
  };
  if (!row.phone && !row.email) throw new AppError('Zadaj telefónne číslo alebo e-mail.');
  const now = nowIso();
  if (old) {
    await c.db
      .prepare('UPDATE kontakty_entries SET name = ?, phone = ?, email = ?, note = ?, favorite = ?, updated_at = ? WHERE id = ?')
      .bind(row.name, row.phone, row.email, row.note, row.favorite, now, old.id)
      .run();
    return toContact({ ...old, ...row, updated_at: now });
  }
  const stats = await c.db.prepare('SELECT COUNT(*) AS n FROM kontakty_entries WHERE household_id = ?').bind(hh).first();
  if (stats.n >= MAX_CONTACTS) throw new AppError('Rodina môže mať najviac ' + MAX_CONTACTS + ' kontaktov.');
  const id = uuid();
  await c.db
    .prepare(
      `INSERT INTO kontakty_entries (id, household_id, name, phone, email, note, favorite, created_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(id, hh, row.name, row.phone, row.email, row.note, row.favorite, c.email, now, now)
    .run();
  return toContact({ id, ...row, created_by: c.email, updated_at: now });
}

export async function deleteContact(c, contactId) {
  const row = await findContact(c, contactId);
  await c.db.prepare('DELETE FROM kontakty_entries WHERE id = ?').bind(row.id).run();
  return { ok: true };
}

/** Označí / zruší označenie dôležitého kontaktu (hviezdička – zobrazí sa navrchu). */
export async function setFavorite(c, contactId, favorite) {
  const row = await findContact(c, contactId);
  await c.db.prepare('UPDATE kontakty_entries SET favorite = ?, updated_at = ? WHERE id = ?').bind(favorite ? 1 : 0, nowIso(), row.id).run();
  return { ok: true };
}
