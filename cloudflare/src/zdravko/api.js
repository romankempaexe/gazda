// Zdravko – API (POST /api/zdravko/<funkcia>): členovia rodiny, záznamy choroby (teplota,
// lieky, fyzikálne metódy), udalosti u lekára s pripomienkami a miery dieťaťa.
// Aplikácia si načíta údaje rodiny naraz (getData); zmeny posiela po jednej.
//
// Upozornenia: nová udalosť a podaný liek hneď ostatným členom rodiny, pripomienky udalostí
// (týždeň / deň / hodinu pred) a striedanie liekov proti horúčke (o 4 h iný, o 8 h ten istý)
// sa zapíšu do zdravko_reminders a pošle ich cron.

import { requireFamilyMember } from '../family.js';
import { AppError, DATE_RE, TIME_ZONE, nowIso, requireText } from '../domain.js';
import { sendToUser } from '../notifications.js';

const uuid = () => crypto.randomUUID();

export const RECORD_TYPES = ['temperature', 'medicine', 'rest', 'calendar_event'];
export const EVENT_TYPES = { doctor_visit: 'Návšteva lekára', examination: 'Vyšetrenie', vaccination: 'Očkovanie' };
export const REST_METHODS = {
  rest_telo_na_telo: 'Telo na telo',
  rest_zabal_koncatin: 'Zábal končatín',
  rest_zabal_cekeho_tela: 'Zábal celého tela',
  rest_obklad_na_hlavu: 'Obklad na hlavu',
  'rest_kupeľ': 'Kúpeľ',
  rest_sprcha: 'Sprcha',
  rest_lad_do_podpazusia_ci_slabin: 'Ľad do podpazušia alebo slabín',
  rest_otieranie: 'Otieranie',
};
export const REMINDERS = { week_before: 7 * 86400000, day_before: 86400000, hour_before: 3600000 };
const BLOOD_GROUPS = ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'];
const GENDERS = ['Muž', 'Žena'];
const ANTIPYRETICS = { ibuprofen: 'Ibuprofen', paracetamol: 'Paracetamol' };
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// ---- Prevod riadkov na objekty pre prehliadač -------------------------------------------

const toMember = (r) => ({
  id: r.id,
  name: r.name,
  birthDate: r.birth_date,
  weight: r.weight,
  height: r.height,
  bloodGroup: r.blood_group,
  gender: r.gender,
  email: r.email,
  isChild: Boolean(r.is_child),
});

export function toRecord(r) {
  const base = { id: r.id, memberId: r.member_id, type: r.type, recordedAt: r.recorded_at, createdBy: r.created_by };
  if (r.type === 'temperature') return { ...base, temperature: r.temperature };
  if (r.type === 'medicine') return { ...base, medicineName: r.medicine_name, dosage: r.dosage, substanceId: r.substance_id };
  if (r.type === 'rest') return { ...base, method: r.rest_method, durationHours: r.duration_hours };
  return {
    ...base,
    eventType: r.event_type,
    subtype: r.subtype,
    eventAt: r.event_at,
    notes: r.notes,
    reminders: JSON.parse(r.reminders || '[]'),
    cost: r.cost,
  };
}

const toMeasurement = (r) => ({ id: r.id, memberId: r.member_id, measuredAt: r.measured_at, weight: r.weight, height: r.height, head: r.head });

// ---- Kontroly ---------------------------------------------------------------------------------

async function findMember(c, id) {
  const row = await c.db.prepare('SELECT * FROM zdravko_members WHERE id = ?').bind(String(id ?? '')).first();
  if (!row) throw new AppError('Člen rodiny neexistuje (možno ho medzičasom niekto vymazal).', 404);
  await requireFamilyMember(c, row.household_id);
  return row;
}

async function findRow(c, table, id, what) {
  const row = await c.db.prepare(`SELECT * FROM ${table} WHERE id = ?`).bind(String(id ?? '')).first();
  if (!row) throw new AppError(what + ' neexistuje (možno ho medzičasom niekto vymazal).', 404);
  await requireFamilyMember(c, row.household_id);
  return row;
}

function num(value, min, max, message) {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(String(value).replace(',', '.'));
  if (!Number.isFinite(n) || n < min || n > max) throw new AppError(message);
  return Math.round(n * 100) / 100;
}

/** ISO čas z prehliadača → UTC ISO; nesmie byť ďaleko v budúcnosti (záznamy) / v nezmyselnom rozsahu. */
function instant(value, message, { maxFutureDays = null } = {}) {
  const d = new Date(String(value ?? ''));
  if (Number.isNaN(d.getTime()) || d.getFullYear() < 1900 || d.getFullYear() > 2200) throw new AppError(message);
  if (maxFutureDays !== null && d.getTime() > Date.now() + maxFutureDays * 86400000) throw new AppError('Čas záznamu nemôže byť v budúcnosti.');
  return d.toISOString();
}

function memberFields(data) {
  data = data && typeof data === 'object' ? data : {};
  const name = requireText(String(data.name ?? '').replace(/\s+/g, ' '), 'Zadaj meno člena rodiny.');
  if (name.length > 60) throw new AppError('Meno môže mať najviac 60 znakov.');
  const birthDate = String(data.birthDate ?? '');
  if (!DATE_RE.test(birthDate)) throw new AppError('Vyber dátum narodenia.');
  const email = String(data.email ?? '').trim().toLowerCase();
  if (email && !EMAIL_RE.test(email)) throw new AppError('Zadaj platný e-mail.');
  return {
    name,
    birth_date: birthDate,
    weight: num(data.weight, 0.3, 500, 'Váhu zadaj v kg (napr. 12,5).'),
    height: num(data.height, 20, 260, 'Výšku zadaj v cm.'),
    blood_group: BLOOD_GROUPS.includes(data.bloodGroup) ? data.bloodGroup : '',
    gender: GENDERS.includes(data.gender) ? data.gender : '',
    email,
    is_child: data.isChild ? 1 : 0,
  };
}

// ---- Načítanie ------------------------------------------------------------------------------------

export async function getData(c, householdId) {
  await requireFamilyMember(c, householdId);
  const q = (sql) => c.db.prepare(sql).bind(householdId);
  const [household, members, records, measurements] = await c.db.batch([
    q('SELECT zdravko_rev FROM households WHERE id = ?'),
    q('SELECT * FROM zdravko_members WHERE household_id = ? ORDER BY birth_date, created_at'),
    q('SELECT * FROM zdravko_records WHERE household_id = ? ORDER BY recorded_at'),
    q('SELECT * FROM zdravko_measurements WHERE household_id = ? ORDER BY measured_at'),
  ]);
  return {
    householdId,
    rev: household.results[0] ? household.results[0].zdravko_rev : 0,
    members: members.results.map(toMember),
    records: records.results.map(toRecord),
    measurements: measurements.results.map(toMeasurement),
  };
}

export async function getRev(c, householdId) {
  await requireFamilyMember(c, householdId);
  const row = await c.db.prepare('SELECT zdravko_rev FROM households WHERE id = ?').bind(householdId).first();
  return row ? row.zdravko_rev : 0;
}

// ---- Členovia --------------------------------------------------------------------------------------

export async function saveMember(c, householdId, data) {
  const f = memberFields(data);
  const now = nowIso();
  if (data.id) {
    const m = await findMember(c, data.id);
    await c.db
      .prepare(
        `UPDATE zdravko_members SET name = ?, birth_date = ?, weight = ?, height = ?, blood_group = ?, gender = ?, email = ?,
           is_child = ?, updated_at = ? WHERE id = ?`
      )
      .bind(f.name, f.birth_date, f.weight, f.height, f.blood_group, f.gender, f.email, f.is_child, now, m.id)
      .run();
    return toMember({ ...m, ...f });
  }
  await requireFamilyMember(c, householdId);
  const id = uuid();
  await c.db
    .prepare(
      `INSERT INTO zdravko_members (id, household_id, name, birth_date, weight, height, blood_group, gender, email, is_child, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(id, householdId, f.name, f.birth_date, f.weight, f.height, f.blood_group, f.gender, f.email, f.is_child, now, now)
    .run();
  return toMember({ id, ...f });
}

export async function deleteMember(c, memberId) {
  const m = await findMember(c, memberId);
  await c.db.batch([
    c.db.prepare('DELETE FROM zdravko_reminders WHERE record_id IN (SELECT id FROM zdravko_records WHERE member_id = ?)').bind(m.id),
    c.db.prepare('DELETE FROM zdravko_records WHERE member_id = ?').bind(m.id),
    c.db.prepare('DELETE FROM zdravko_measurements WHERE member_id = ?').bind(m.id),
    c.db.prepare('DELETE FROM zdravko_members WHERE id = ?').bind(m.id),
  ]);
  return { ok: true };
}

// ---- Záznamy choroby ---------------------------------------------------------------------------------

/** Čas v Bratislave: „14:30“, „pi 24. 10.“ */
export function localTime(iso) {
  return new Intl.DateTimeFormat('sk-SK', { timeZone: TIME_ZONE, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(iso));
}
export function localDay(iso) {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: TIME_ZONE, weekday: 'short', day: 'numeric', month: 'numeric' }).formatToParts(new Date(iso));
  const get = (t) => parts.find((p) => p.type === t).value;
  const days = { Mon: 'po', Tue: 'ut', Wed: 'st', Thu: 'št', Fri: 'pi', Sat: 'so', Sun: 'ne' };
  return days[get('weekday')] + ' ' + get('day') + '. ' + get('month') + '.';
}

async function displayName(c) {
  const row = await c.db.prepare('SELECT nickname FROM users WHERE email = ?').bind(c.email).first();
  return (row && row.nickname) || c.email.split('@')[0];
}

/** Pošle správu ostatným členom rodiny (na pozadí – nezdrží uloženie). */
function notifyOthers(c, householdId, message) {
  const work = (async () => {
    const { results } = await c.db
      .prepare('SELECT email FROM members WHERE household_id = ? AND email <> ? AND email IN (SELECT email FROM push_subscriptions)')
      .bind(householdId, c.email)
      .all();
    for (const m of results) await sendToUser(c.db, m.email, { ...message, app: 'zdravko', url: '/zdravko/' });
  })().catch((err) => console.warn('Upozornenie Zdravka sa nepodarilo odoslať: ' + err));
  if (c.waitUntil) c.waitUntil(work);
  else return work;
}

/**
 * Nové záznamy pre člena v jednom čase (dialóg „Pridať záznam“ – teplota, liek a fyzikálna metóda naraz).
 * data = { recordedAt, temperature?, medicine?: { name, dosage, substanceId }, rest?: { method, durationHours } }
 */
export async function addRecords(c, memberId, data) {
  const m = await findMember(c, memberId);
  data = data && typeof data === 'object' ? data : {};
  const recordedAt = instant(data.recordedAt, 'Zadaj čas záznamu.', { maxFutureDays: 1 });
  const now = nowIso();
  const rows = [];
  const base = { household_id: m.household_id, member_id: m.id, recorded_at: recordedAt, created_by: c.email, created_at: now, updated_at: now };
  if (data.temperature !== undefined && data.temperature !== null && data.temperature !== '') {
    rows.push({ ...base, id: uuid(), type: 'temperature', temperature: num(data.temperature, 30, 45, 'Teplota musí byť medzi 30 a 45 °C.') });
  }
  let medicine = null;
  if (data.medicine && typeof data.medicine === 'object') {
    const name = requireText(String(data.medicine.name ?? '').replace(/\s+/g, ' '), 'Zadaj názov lieku.').slice(0, 80);
    const substanceId = /^[a-z_]{1,40}$/.test(data.medicine.substanceId || '') ? data.medicine.substanceId : '';
    medicine = { ...base, id: uuid(), type: 'medicine', medicine_name: name, dosage: String(data.medicine.dosage ?? '').trim().slice(0, 40), substance_id: substanceId };
    rows.push(medicine);
  }
  if (data.rest && typeof data.rest === 'object') {
    if (!Object.hasOwn(REST_METHODS, data.rest.method)) throw new AppError('Vyber fyzikálnu metódu.');
    rows.push({ ...base, id: uuid(), type: 'rest', rest_method: data.rest.method, duration_hours: num(data.rest.durationHours ?? 1, 0, 24, 'Trvanie zadaj v hodinách (0 – 24).') });
  }
  if (!rows.length) throw new AppError('Zadaj teplotu, liek alebo fyzikálnu metódu.');
  const temperature = rows.find((r) => r.type === 'temperature');

  const statements = rows.map((r) => {
    const cols = Object.keys(r);
    return c.db.prepare(`INSERT INTO zdravko_records (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`).bind(...cols.map((k) => r[k]));
  });
  // Liek proti horúčke: o 4 h sa smie podať ten druhý, o 8 h znova ten istý (staré pripomienky nahradí).
  if (medicine && ANTIPYRETICS[medicine.substance_id]) {
    const same = ANTIPYRETICS[medicine.substance_id];
    const other = medicine.substance_id === 'ibuprofen' ? 'Paracetamol' : 'Ibuprofen';
    const given = Date.parse(recordedAt);
    statements.push(
      c.db
        .prepare(
          `DELETE FROM zdravko_reminders WHERE sent_at = '' AND kind IN ('alt_4h', 'alt_8h')
           AND record_id IN (SELECT id FROM zdravko_records WHERE member_id = ?)`
        )
        .bind(m.id)
    );
    const add = c.db.prepare('INSERT INTO zdravko_reminders (household_id, record_id, kind, fire_at, title, body) VALUES (?, ?, ?, ?, ?, ?)');
    for (const [kind, hours, title, body] of [
      ['alt_4h', 4, '💊 ' + m.name + ': môžeš podať ' + other, '4 hodiny od ' + same + ' (' + localTime(recordedAt) + ')'],
      ['alt_8h', 8, '💊 ' + m.name + ': znova ' + same, '8 hodín od posledného podania ' + same + ' (' + localTime(recordedAt) + ')'],
    ]) {
      const fire = given + hours * 3600000;
      if (fire > Date.now()) statements.push(add.bind(m.household_id, medicine.id, kind, new Date(fire).toISOString(), title, body));
    }
  }
  await c.db.batch(statements);

  const message = recordMessage(medicine || temperature ? await displayName(c) : '', m, recordedAt, temperature, medicine);
  if (message) await notifyOthers(c, m.household_id, message);
  return rows.map(toRecord);
}

const tempText = (t) => String(t).replace('.', ',') + ' °C';

/**
 * Upozornenie ostatným v rodine na nový záznam: podaný liek (aj s nameranou teplotou) alebo
 * nameraná teplota. Fyzikálna metóda sama upozornenie nemá. Vráti správu alebo null.
 */
export function recordMessage(who, member, recordedAt, temperature, medicine) {
  const t = temperature ? temperature.temperature : null;
  if (medicine) {
    return {
      title: '💊 ' + who + ' podal(a) ' + medicine.medicine_name + (medicine.dosage ? ' ' + medicine.dosage : ''),
      body: member.name + (t !== null ? ' · ' + tempText(t) : '') + ' · ' + localTime(recordedAt),
      tag: 'medicine-' + member.id,
    };
  }
  if (t === null) return null;
  // farba ako v aplikácii: do 37,2 v poriadku, do 38 zvýšená, nad 38 horúčka
  const icon = t <= 37.2 ? '🌡️' : t <= 38 ? '🟠' : '🔴';
  return {
    title: icon + ' ' + member.name + ': ' + tempText(t),
    body: who + ' zmeral(a) teplotu · ' + localTime(recordedAt),
    tag: 'temperature-' + member.id,
  };
}

export async function deleteRecord(c, recordId) {
  const r = await findRow(c, 'zdravko_records', recordId, 'Záznam');
  await c.db.batch([
    c.db.prepare('DELETE FROM zdravko_reminders WHERE record_id = ?').bind(r.id),
    c.db.prepare('DELETE FROM zdravko_records WHERE id = ?').bind(r.id),
  ]);
  return { ok: true };
}

// ---- Udalosti (lekár, vyšetrenie, očkovanie) ------------------------------------------------------

function reminderText(kind, eventAt) {
  const time = localTime(eventAt);
  if (kind === 'week_before') return 'o týždeň (' + localDay(eventAt) + ' o ' + time + ')';
  if (kind === 'day_before') return 'zajtra o ' + time;
  return 'o hodinu (' + time + ')';
}

/** Nová alebo upravená udalosť. data = { id?, eventType, subtype, eventAt, notes, reminders[], cost } */
export async function saveEvent(c, memberId, data) {
  data = data && typeof data === 'object' ? data : {};
  let m = await findMember(c, memberId);
  let old = null;
  if (data.id) {
    old = await findRow(c, 'zdravko_records', data.id, 'Udalosť');
    if (old.type !== 'calendar_event') throw new AppError('Toto nie je udalosť.');
    if (old.household_id !== m.household_id) throw new AppError('Člen patrí inej rodine.', 403);
  }
  if (!Object.hasOwn(EVENT_TYPES, data.eventType)) throw new AppError('Vyber typ udalosti.');
  const subtype = requireText(String(data.subtype ?? ''), 'Najprv vyber podtyp.').slice(0, 120);
  const eventAt = instant(data.eventAt, 'Zadaj dátum a čas udalosti.');
  const reminders = [...new Set((Array.isArray(data.reminders) ? data.reminders : []).filter((k) => Object.hasOwn(REMINDERS, k)))];
  const cost = num(data.cost, 0, 100000, 'Cenu zadaj v eurách (napr. 12,50).');
  const notes = String(data.notes ?? '').trim().slice(0, 1000);
  const now = nowIso();
  const id = old ? old.id : uuid();

  const statements = [];
  if (old) {
    statements.push(
      c.db
        .prepare(
          `UPDATE zdravko_records SET member_id = ?, event_type = ?, subtype = ?, event_at = ?, notes = ?, reminders = ?, cost = ?, updated_at = ?
           WHERE id = ?`
        )
        .bind(m.id, data.eventType, subtype, eventAt, notes, JSON.stringify(reminders), cost, now, id)
    );
  } else {
    statements.push(
      c.db
        .prepare(
          `INSERT INTO zdravko_records (id, household_id, member_id, type, recorded_at, event_type, subtype, event_at, notes, reminders, cost,
             created_by, created_at, updated_at) VALUES (?, ?, ?, 'calendar_event', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .bind(id, m.household_id, m.id, now, data.eventType, subtype, eventAt, notes, JSON.stringify(reminders), cost, c.email, now, now)
    );
  }
  // Pripomienky nanovo podľa aktuálneho času udalosti (pri úprave či presune sa staré zrušia).
  statements.push(c.db.prepare("DELETE FROM zdravko_reminders WHERE record_id = ? AND sent_at = ''").bind(id));
  const add = c.db.prepare('INSERT INTO zdravko_reminders (household_id, record_id, kind, fire_at, title, body) VALUES (?, ?, ?, ?, ?, ?)');
  const title = '📅 ' + m.name + ': ' + EVENT_TYPES[data.eventType];
  for (const kind of reminders) {
    const fire = Date.parse(eventAt) - REMINDERS[kind];
    if (fire > Date.now()) statements.push(add.bind(m.household_id, id, kind, new Date(fire).toISOString(), title, subtype + ' – ' + reminderText(kind, eventAt)));
  }
  await c.db.batch(statements);

  if (!old) {
    const who = await displayName(c);
    await notifyOthers(c, m.household_id, {
      title: '📅 Nová udalosť pre ' + m.name,
      body: EVENT_TYPES[data.eventType] + ' – ' + subtype + ' · ' + localDay(eventAt) + ' o ' + localTime(eventAt) + ' (zapísal(a) ' + who + ')',
      tag: 'event-' + id,
    });
  }
  return toRecord(await c.db.prepare('SELECT * FROM zdravko_records WHERE id = ?').bind(id).first());
}

// ---- Miery dieťaťa ---------------------------------------------------------------------------------

export async function saveMeasurement(c, memberId, data) {
  data = data && typeof data === 'object' ? data : {};
  const m = await findMember(c, memberId);
  const measuredAt = String(data.measuredAt ?? '');
  if (!DATE_RE.test(measuredAt)) throw new AppError('Zadaj dátum merania.');
  const f = {
    weight: num(data.weight, 0.3, 200, 'Váhu zadaj v kg (0,3 – 200).'),
    height: num(data.height, 20, 260, 'Výšku zadaj v cm (20 – 260).'),
    head: num(data.head, 20, 80, 'Obvod hlavičky zadaj v cm (20 – 80).'),
  };
  if (f.weight === null && f.height === null && f.head === null) throw new AppError('Zadaj aspoň jednu mieru.');
  const now = nowIso();
  let id = data.id;
  if (id) {
    const old = await findRow(c, 'zdravko_measurements', id, 'Miera');
    await c.db
      .prepare('UPDATE zdravko_measurements SET measured_at = ?, weight = ?, height = ?, head = ?, updated_at = ? WHERE id = ?')
      .bind(measuredAt, f.weight, f.height, f.head, now, old.id)
      .run();
  } else {
    id = uuid();
    await c.db
      .prepare(
        `INSERT INTO zdravko_measurements (id, household_id, member_id, measured_at, weight, height, head, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(id, m.household_id, m.id, measuredAt, f.weight, f.height, f.head, now, now)
      .run();
  }
  return toMeasurement({ id, member_id: m.id, measured_at: measuredAt, ...f });
}

export async function deleteMeasurement(c, id) {
  const row = await findRow(c, 'zdravko_measurements', id, 'Miera');
  await c.db.prepare('DELETE FROM zdravko_measurements WHERE id = ?').bind(row.id).run();
  return { ok: true };
}

/** „Nastaviť ako aktuálne“ – váha a výška z merania sa prepíšu do údajov dieťaťa. */
export async function setCurrentMeasurement(c, id) {
  const row = await findRow(c, 'zdravko_measurements', id, 'Miera');
  await c.db
    .prepare('UPDATE zdravko_members SET weight = COALESCE(?, weight), height = COALESCE(?, height), updated_at = ? WHERE id = ?')
    .bind(row.weight, row.height, nowIso(), row.member_id)
    .run();
  return toMember(await c.db.prepare('SELECT * FROM zdravko_members WHERE id = ?').bind(row.member_id).first());
}
