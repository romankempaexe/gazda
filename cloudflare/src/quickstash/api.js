// QuickStash – API (POST /api/quickstash/<funkcia>): texty, odkazy a heslá na rýchle
// skopírovanie (webová verzia desktopového QuickStashu, teraz podaplikácia Family Grid).
//
// Položky patria rodine (households). Spoločnú položku (owner_email = '') vidí a mení každý
// člen rodiny, súkromnú (owner_email = e-mail) len jej majiteľ. Aplikácia si načíta všetky
// viditeľné položky naraz (getData) a hľadá v nich v prehliadači.

import { requireFamilyMember } from '../family.js';
import { AppError, nowIso, requireText } from '../domain.js';
import { requireUnlocked } from './lock.js';
import { downloadLink, parseFileText } from './file.js';

const uuid = () => crypto.randomUUID();
const MAX_NAME = 80;
const MAX_VALUE = 4000;
const MAX_IMPORT = 1000;
export const TYPES = ['text', 'password'];

const toEntry = (r) => ({
  id: r.id,
  synced: Boolean(r.sync_file), // prišla zo súboru na Google Drive
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
  await requireUnlocked(c);
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
  const lock = await requireUnlocked(c);
  const [household, entries, sync] = await c.db.batch([
    c.db.prepare('SELECT quickstash_rev FROM households WHERE id = ?').bind(householdId),
    c.db.prepare(`SELECT * FROM quickstash_entries WHERE ${VISIBLE} ORDER BY name COLLATE NOCASE`).bind(householdId, c.email),
    c.db.prepare('SELECT * FROM quickstash_sync WHERE email = ? AND household_id = ?').bind(c.email, householdId),
  ]);
  const link = sync.results[0];
  return {
    householdId,
    rev: household.results[0] ? household.results[0].quickstash_rev : 0,
    entries: entries.results.map(toEntry),
    lock, // zámok biometriou zapnutý – aplikácia si údaje neukladá do pamäte telefónu
    // prepojený súbor na Google Drive (synchronizácia), alebo null
    // url = synchronizácia podľa odkazu (server súbor stiahne sám), inak cez Google Drive API v prehliadači
    sync: link ? { fileId: link.file_id, fileName: link.file_name, url: link.url, private: Boolean(link.private), syncedAt: link.synced_at } : null,
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
  await requireUnlocked(c);
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
  await requireUnlocked(c);
  const owner = isPrivate ? c.email : '';
  const incoming = parseEntries(entries);
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

/** Položky zo zálohy / súboru: { "<názov>": { value, type } } → [{ name, value, type }] (bez prázdnych a duplicít). */
export function parseEntries(entries) {
  if (!entries || typeof entries !== 'object' || Array.isArray(entries)) throw new AppError('Neplatný súbor zálohy.');
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
  return incoming;
}

// ---- Synchronizácia so súborom na Google Drive -------------------------------------------------

const FILE_ID_RE = /^[A-Za-z0-9_-]{10,200}$/;

/**
 * Zosúladí položky so súborom na Google Drive (súbor prečíta prehliadač, sem pošle jeho obsah
 * v rovnakom tvare ako záloha). Súbor je hlavný: položka s rovnakým názvom sa prepíše, nová
 * pribudne a tá, ktorá prišla z tohto súboru a v ňom už nie je, sa zmaže. Položky pridané
 * v aplikácii (nie zo súboru) ostanú. Prepojenie sa zapamätá (ďalšia synchronizácia jedným ťuknutím).
 *
 * file = { id, name }, content = obsah súboru (text: JSON alebo tabuľka) alebo už položky,
 * isPrivate = nové položky len pre mňa (inak spoločné v rodine).
 */
export async function syncFile(c, householdId, file, content, isPrivate) {
  return syncEntries(c, householdId, file, content, isPrivate, '');
}

/**
 * Synchronizácia podľa odkazu Google (súbor zdieľaný „Ktokoľvek s odkazom“) – server súbor
 * stiahne sám, netreba žiadne nastavenie Google. Bez url použije uložený odkaz.
 */
export async function syncLink(c, householdId, url, isPrivate) {
  await requireFamilyMember(c, householdId);
  await requireUnlocked(c);
  if (!url) {
    const link = await c.db.prepare('SELECT url, private FROM quickstash_sync WHERE email = ? AND household_id = ?').bind(c.email, householdId).first();
    if (!link || !link.url) throw new AppError('Najprv vlož odkaz na súbor.');
    url = link.url;
    isPrivate = Boolean(link.private);
  }
  url = String(url).trim().slice(0, 1000);
  const file = await downloadLink(c, url);
  return syncEntries(c, householdId, { id: file.id, name: file.name }, file.text, isPrivate, url);
}

async function syncEntries(c, householdId, file, content, isPrivate, url) {
  await requireFamilyMember(c, householdId);
  await requireUnlocked(c);
  file = file && typeof file === 'object' ? file : {};
  const fileId = String(file.id ?? '');
  if (!FILE_ID_RE.test(fileId)) throw new AppError('Neplatný súbor na Google Drive.');
  const fileName = String(file.name ?? '').trim().slice(0, 200);
  const incoming = parseEntries(typeof content === 'string' ? parseFileText(content) : content);
  const owner = isPrivate ? c.email : '';
  const now = nowIso();

  const { results } = await c.db.prepare(`SELECT id, name, value, type, sync_file FROM quickstash_entries WHERE ${VISIBLE}`).bind(householdId, c.email).all();
  const existing = new Map(results.map((r) => [r.name.toLowerCase(), r]));
  const names = new Set(incoming.map((e) => e.name.toLowerCase()));
  const statements = [
    c.db
      .prepare(
        `INSERT INTO quickstash_sync (email, household_id, file_id, file_name, private, synced_at, url) VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (email, household_id) DO UPDATE SET file_id = excluded.file_id, file_name = excluded.file_name,
           private = excluded.private, synced_at = excluded.synced_at, url = excluded.url`
      )
      .bind(c.email, householdId, fileId, fileName, isPrivate ? 1 : 0, now, url),
  ];
  let added = 0;
  let updated = 0;
  let removed = 0;
  for (const e of incoming) {
    const old = existing.get(e.name.toLowerCase());
    if (old) {
      if (old.value === e.value && old.type === e.type && old.sync_file === fileId) continue; // bez zmeny (verzia sa nezvýši)
      if (old.value !== e.value || old.type !== e.type) updated++;
      statements.push(
        c.db.prepare('UPDATE quickstash_entries SET value = ?, type = ?, sync_file = ?, updated_at = ? WHERE id = ?').bind(e.value, e.type, fileId, now, old.id)
      );
    } else {
      added++;
      statements.push(
        c.db
          .prepare(
            `INSERT INTO quickstash_entries (id, household_id, owner_email, name, value, type, created_by, created_at, updated_at, sync_file)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
          )
          .bind(uuid(), householdId, owner, e.name, e.value, e.type, c.email, now, now, fileId)
      );
    }
  }
  for (const r of results) {
    if (r.sync_file === fileId && !names.has(r.name.toLowerCase())) {
      removed++;
      statements.push(c.db.prepare('DELETE FROM quickstash_entries WHERE id = ?').bind(r.id));
    }
  }
  await c.db.batch(statements);
  return { added, updated, removed, data: await getData(c, householdId) };
}

/** Zruší prepojenie so súborom (položky ostanú, len sa už nesynchronizujú). */
export async function unlinkSync(c, householdId) {
  await requireFamilyMember(c, householdId);
  await requireUnlocked(c);
  await c.db.batch([
    c.db.prepare('DELETE FROM quickstash_sync WHERE email = ? AND household_id = ?').bind(c.email, householdId),
    c.db.prepare(`UPDATE quickstash_entries SET sync_file = '' WHERE ${VISIBLE} AND sync_file <> ''`).bind(householdId, c.email),
  ]);
  return getData(c, householdId);
}
