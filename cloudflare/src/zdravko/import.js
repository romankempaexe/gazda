// Prenos zo starého mobilného Zdravka (Firebase projekt zdravko-f4ac5) do Family Grid.
//
// Server nájde vo Firebase účet s rovnakým e-mailom ako prihlásený používateľ a prečíta
// users/<uid>/family_members, medical_records a child_measurements. Údaje sa uložia do
// zvolenej rodiny jednou dávkou (json_each); id z Firebase ostávajú (fb-<id>), takže
// prenos sa dá zopakovať bez zdvojenia. Budúcim udalostiam sa naplánujú pripomienky.
//
// Časy v mobilnom Zdravkovi sú text z Dart toIso8601String(): väčšinou miestny čas bez
// pásma (Bratislava), niekedy UTC so „Z“ – oboje sa prevedie na UTC.

import { requireFamilyMember } from '../family.js';
import { AppError, TIME_ZONE, nowIso } from '../domain.js';
import { firebaseClient, serviceAccount } from '../firebase.js';
import { bulk, set } from '../import.js';
import { EVENT_TYPES, REMINDERS, REST_METHODS, localDay, localTime } from './api.js';

const ID = (firebaseId) => 'fb-' + String(firebaseId).slice(0, 80);
const str = (v, max = 500) => String(v ?? '').trim().slice(0, max);
const numOrNull = (v, min, max) => {
  const n = Number(v);
  return Number.isFinite(n) && n >= min && n <= max ? Math.round(n * 100) / 100 : null;
};

/** Posun Bratislavy voči UTC v milisekundách v danom okamihu. */
function zoneOffset(utcMs) {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat('en-GB', { timeZone: TIME_ZONE, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' })
      .formatToParts(new Date(utcMs))
      .map((x) => [x.type, x.value])
  );
  return Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second) - Math.floor(utcMs / 1000) * 1000;
}

/** Text z Dart (miestny čas bez pásma alebo so „Z“/posunom) → UTC ISO; neplatný → ''. */
export function dartToUtc(value) {
  const s = str(value, 40);
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,6}))?)?)?(Z|[+-]\d{2}:?\d{2})?$/);
  if (!m) {
    const d = new Date(s); // napr. Timestamp Firestore (už ISO so „Z“)
    return s && !Number.isNaN(d.getTime()) ? d.toISOString() : '';
  }
  const [, y, mo, d, h = '0', mi = '0', se = '0', frac = '0', zone] = m;
  const ms = Math.floor(Number((frac + '000').slice(0, 3)));
  const wall = Date.UTC(+y, +mo - 1, +d, +h, +mi, +se, ms);
  if (zone) return new Date(wall - (zone === 'Z' ? 0 : (zone[0] === '-' ? -1 : 1) * (Number(zone.slice(1, 3)) * 60 + Number(zone.slice(-2))) * 60000)).toISOString();
  // miestny čas: odhad posunu a overenie (prechod letného času)
  let utc = wall - zoneOffset(wall);
  utc = wall - zoneOffset(utc);
  return new Date(utc).toISOString();
}

/** Dátum (deň) v Bratislave z textu Dart. */
export function dartToYmd(value) {
  const iso = dartToUtc(value);
  if (!iso) return '';
  return new Intl.DateTimeFormat('en-CA', { timeZone: TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(iso));
}

/** Firestore dokumenty → riadky tabuliek Zdravka v rodine householdId. */
export function mapZdravko(householdId, email, { members, records, measurements }) {
  const now = nowIso();
  const out = { members: [], records: [], measurements: [], skipped: 0 };
  const ids = new Set();
  for (const doc of members) {
    const d = doc.data;
    const name = str(d.name, 60);
    if (!name) continue;
    ids.add(doc.id);
    out.members.push({
      id: ID(doc.id),
      household_id: householdId,
      name,
      birth_date: dartToYmd(d.dateOfBirth) || '2000-01-01',
      weight: numOrNull(d.weight, 0.3, 500),
      height: numOrNull(d.height, 20, 260),
      blood_group: ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'].includes(d.bloodGroup) ? d.bloodGroup : '',
      gender: ['Muž', 'Žena'].includes(d.gender) ? d.gender : '',
      email: str(d.email, 120).toLowerCase(),
      is_child: d.isChild ? 1 : 0,
      created_at: now,
      updated_at: now,
    });
  }
  // Záznamy bez člena (najstaršie verzie): ak je v rodine jediný člen, patria jemu.
  const only = out.members.length === 1 ? [...ids][0] : null;
  const memberOf = (d) => {
    const id = str(d.memberId, 100);
    if (ids.has(id)) return id;
    return !id && only ? only : null;
  };

  for (const doc of records) {
    const d = doc.data;
    const memberId = memberOf(d);
    const recordedAt = dartToUtc(d.timestamp);
    if (!memberId || !recordedAt) {
      out.skipped++;
      continue;
    }
    const r = {
      id: ID(doc.id),
      household_id: householdId,
      member_id: ID(memberId),
      type: '',
      recorded_at: recordedAt,
      temperature: null,
      medicine_name: '',
      dosage: '',
      substance_id: '',
      rest_method: '',
      duration_hours: null,
      event_type: '',
      subtype: '',
      event_at: '',
      notes: '',
      reminders: '[]',
      cost: null,
      created_by: email,
      created_at: now,
      updated_at: now,
    };
    if (d.type === 'temperature') {
      r.temperature = numOrNull(d.temperature, 30, 45);
      if (r.temperature === null) {
        out.skipped++;
        continue;
      }
    } else if (d.type === 'medicine') {
      r.medicine_name = str(d.medicineName, 80) || 'Liek';
      r.dosage = str(d.dosage, 40);
      r.substance_id = /^[a-z_]{1,40}$/.test(d.substanceId || '') ? d.substanceId : '';
    } else if (d.type === 'rest') {
      r.rest_method = Object.hasOwn(REST_METHODS, d.method) ? d.method : 'rest_telo_na_telo';
      const hours = d.durationHours ?? (d.durationMinutes !== undefined ? Number(d.durationMinutes) / 60 : 1);
      r.duration_hours = numOrNull(hours, 0, 24) ?? 1;
    } else if (d.type === 'calendar_event') {
      r.event_type = Object.hasOwn(EVENT_TYPES, d.eventType) ? d.eventType : 'doctor_visit';
      r.subtype = str(d.subtype, 120) || EVENT_TYPES[r.event_type];
      r.event_at = dartToUtc(d.appointmentTime) || recordedAt;
      r.notes = str(d.notes, 1000);
      r.reminders = JSON.stringify((Array.isArray(d.reminders) ? d.reminders : []).filter((k) => Object.hasOwn(REMINDERS, k)));
      r.cost = numOrNull(d.cost, 0, 100000);
    } else {
      out.skipped++;
      continue;
    }
    r.type = d.type;
    out.records.push(r);
  }

  for (const doc of measurements) {
    const d = doc.data;
    const memberId = memberOf(d);
    const measuredAt = dartToYmd(d.date);
    if (!memberId || !measuredAt) {
      out.skipped++;
      continue;
    }
    out.measurements.push({
      id: ID(doc.id),
      household_id: householdId,
      member_id: ID(memberId),
      measured_at: measuredAt,
      weight: numOrNull(d.weight, 0.3, 200),
      height: numOrNull(d.height, 20, 260),
      head: numOrNull(d.headCircumference, 20, 80),
      created_at: now,
      updated_at: now,
    });
  }
  return out;
}

/** Pripomienky budúcich udalostí z prenosu. */
function remindersFor(d) {
  const names = new Map(d.members.map((m) => [m.id, m.name]));
  const out = [];
  for (const r of d.records) {
    if (r.type !== 'calendar_event') continue;
    for (const kind of JSON.parse(r.reminders)) {
      const fire = Date.parse(r.event_at) - REMINDERS[kind];
      if (fire <= Date.now()) continue;
      const time = localTime(r.event_at);
      const when = kind === 'week_before' ? 'o týždeň (' + localDay(r.event_at) + ' o ' + time + ')' : kind === 'day_before' ? 'zajtra o ' + time : 'o hodinu (' + time + ')';
      out.push({
        household_id: r.household_id,
        record_id: r.id,
        kind,
        fire_at: new Date(fire).toISOString(),
        title: '📅 ' + names.get(r.member_id) + ': ' + EVENT_TYPES[r.event_type],
        body: r.subtype + ' – ' + when,
      });
    }
  }
  return out;
}

export async function importFirebase(c, householdId) {
  await requireFamilyMember(c, householdId);
  const fb = firebaseClient(serviceAccount(c.env, 'FIREBASE_ZDRAVKO_SA', 'Zdravka'), c.fetch || fetch);
  const uid = await fb.uidByEmail(c.email);
  if (!uid) {
    throw new AppError('V mobilnom Zdravkovi nie je účet s e-mailom ' + c.email + '. Prihlás sa sem tým Google účtom, ktorý si používal v Zdravkovi.', 404);
  }
  const [members, records, measurements] = await Promise.all([
    fb.listDocuments(`users/${uid}/family_members`),
    fb.listDocuments(`users/${uid}/medical_records`),
    fb.listDocuments(`users/${uid}/child_measurements`),
  ]);
  const d = mapZdravko(householdId, c.email, { members, records, measurements });
  if (!d.members.length) return { members: 0, records: 0, measurements: 0, skipped: d.skipped };
  const reminders = remindersFor(d);
  const recordCols = Object.keys(d.records[0] || {});
  await c.db.batch([
    bulk(c.db, 'zdravko_members', Object.keys(d.members[0]), d.members,
      'ON CONFLICT (id) ' + set(['household_id', 'name', 'birth_date', 'weight', 'height', 'blood_group', 'gender', 'email', 'is_child', 'updated_at'])),
    ...(d.records.length
      ? [bulk(c.db, 'zdravko_records', recordCols, d.records,
          'ON CONFLICT (id) ' + set(recordCols.filter((k) => !['id', 'created_by', 'created_at'].includes(k))))]
      : []),
    ...(d.measurements.length
      ? [bulk(c.db, 'zdravko_measurements', Object.keys(d.measurements[0]), d.measurements,
          'ON CONFLICT (id) ' + set(['household_id', 'member_id', 'measured_at', 'weight', 'height', 'head', 'updated_at']))]
      : []),
    c.db
      .prepare("DELETE FROM zdravko_reminders WHERE sent_at = '' AND record_id IN (SELECT value FROM json_each(?))")
      .bind(JSON.stringify(d.records.filter((r) => r.type === 'calendar_event').map((r) => r.id))),
    ...(reminders.length ? [bulk(c.db, 'zdravko_reminders', Object.keys(reminders[0]), reminders, '')] : []),
  ]);
  return { householdId, members: d.members.length, records: d.records.length, measurements: d.measurements.length, skipped: d.skipped };
}
