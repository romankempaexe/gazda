// Zdravko – dávkovanie liekov: liek z databázy (alebo vlastný), dávka, koľkokrát denne a v aké časy,
// od kedy a koľko dní. Každú dávku pripomenie cron všetkým v rodine (ak ju už niekto nezapísal
// ako podanú). Časy dávok sú v miestnom čase (Bratislava), aj cez zmenu letného času.

import { AppError, DATE_RE, TIME_ZONE, nowIso, requireText, todayYmd } from '../domain.js';
import { sendToUser } from '../notifications.js';
import { displayName, findMember, findRow, localTime, notifyOthers, toCourse } from './api.js';

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const MAX_TIMES = 12;
const MAX_DAYS = 365;
const LATE_MS = 6 * 3600000; // zmeškané o viac ako 6 h (výpadok) sa už nepripomínajú
const GIVEN_MS = 3600000; // dávka zapísaná najviac hodinu pred časom – pripomienka netreba
export const FOLLOWUP_MS = 30 * 60000; // nezapísaná dávka sa pripomína znova každú pol hodinu…
export const FOLLOWUP_MAX = 6; // …najviac 6-krát (a nie po čase ďalšej dávky)

// ---- Čas v Bratislave ---------------------------------------------------------------------------

const zoneParts = new Intl.DateTimeFormat('en-US', {
  timeZone: TIME_ZONE,
  hourCycle: 'h23',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
});

/** O koľko ms je Bratislava pred UTC v danom okamihu (1 alebo 2 h). */
function zoneOffset(ms) {
  const p = Object.fromEntries(zoneParts.formatToParts(new Date(ms)).map((x) => [x.type, x.value]));
  return Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second) - Math.floor(ms / 1000) * 1000;
}

/** Deň (yyyy-MM-dd) a čas (HH:mm) v Bratislave → ms od epochy. */
export function zonedMs(ymd, hm) {
  const [y, m, d] = ymd.split('-').map(Number);
  const [h, mi] = hm.split(':').map(Number);
  const local = Date.UTC(y, m - 1, d, h, mi);
  return local - zoneOffset(local - zoneOffset(local));
}

export function addDaysYmd(ymd, n) {
  const [y, m, d] = ymd.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

const daysBetween = (a, b) => Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 86400000);

/** Najbližšia dávka po okamihu afterMs (ms), alebo null, keď dávkovanie skončilo. course = riadok tabuľky. */
export function nextDoseMs(course, afterMs) {
  const times = [...JSON.parse(course.times || '[]')].sort();
  if (!times.length) return null;
  let day = todayYmd(new Date(afterMs - 86400000)); // aj deň predtým (posun času)
  if (day < course.start_date) day = course.start_date;
  for (let i = 0; i < MAX_DAYS + 3; i++, day = addDaysYmd(day, 1)) {
    if (course.end_date && day > course.end_date) return null;
    for (const t of times) {
      const ms = zonedMs(day, t);
      if (ms > afterMs) return ms;
    }
  }
  return null;
}

const timesText = (times) => times.map((t) => t.replace(/^0(\d)/, '$1')).join(', ');

// jednotky ako vo formulári (app.js UNITS): 1 / 2–4 / 5+ a desatinné
const UNIT_WORDS = {
  tbl: ['tableta', 'tablety', 'tabliet'],
  kvp: ['kvapka', 'kvapky', 'kvapiek'],
  kps: ['kapsula', 'kapsuly', 'kapsúl'],
  'čípok': ['čípok', 'čípky', 'čípkov'],
};

/** „5 ml“, „1 tableta“, „10 kvapiek“, „0,5 tablety“ – dávka zrozumiteľne. */
export function doseText(dosage) {
  const m = /^([\d.,]+)\s*(.*)$/.exec(String(dosage || '').trim());
  if (!m) return String(dosage || '').trim();
  const n = Number(m[1].replace(',', '.'));
  const words = UNIT_WORDS[m[2]];
  const num = m[1].replace('.', ',');
  if (!words || !Number.isFinite(n)) return num + (m[2] ? ' ' + m[2] : '');
  const word = !Number.isInteger(n) ? words[1] : n === 1 ? words[0] : n >= 2 && n <= 4 ? words[1] : words[2];
  return num + ' ' + word;
}

const shortDate = (ymd) => Number(ymd.slice(8, 10)) + '. ' + Number(ymd.slice(5, 7)) + '.';

/**
 * Upozornenie na dávku so všetkým, čo treba vedieť: komu, aký liek, koľko, v ktorom čase (koľká dávka dnes),
 * deň liečby, celý rozpis, ďalšia dávka a poznámka. followup = poradie opakovanej pripomienky nezapísanej
 * dávky (1 – 6), 0 = pripomienka v čase dávky.
 */
export function doseMessage(course, doseIso, followup = 0) {
  const doseMs = Date.parse(doseIso);
  const times = [...JSON.parse(course.times || '[]')].sort();
  const at = localTime(doseIso);
  const index = times.indexOf(at);
  const next = nextDoseMs(course, doseMs);
  const amount = course.dosage ? doseText(course.dosage) : '';
  const total = course.end_date ? daysBetween(course.start_date, course.end_date) + 1 : null;
  const day = daysBetween(course.start_date, todayYmd(new Date(doseMs))) + 1;
  const lines = [
    followup ? '⏰ Dávka z ' + at + ' ešte nie je zapísaná ako podaná!' : '',
    'Podaj: ' + (amount || 'dávka nezadaná') + ' – ' + course.medicine_name,
    'Čas: ' + at + (index >= 0 ? ' · ' + (index + 1) + '. dávka z ' + times.length + ' dnes' : ''),
    'Liečba: ' + (total ? 'deň ' + day + '/' + total + ' (do ' + shortDate(course.end_date) + ')' : 'deň ' + day + ', do odvolania'),
    'Rozpis: ' + times.length + '× denne – ' + timesText(times),
    next ? 'Ďalšia dávka: ' + (todayYmd(new Date(next)) === todayYmd(new Date(doseMs)) ? '' : 'zajtra ') + timesText([localTime(new Date(next).toISOString())]) : 'Toto je posledná dávka liečby',
    course.notes ? 'Poznámka: ' + course.notes : '',
  ].filter(Boolean);
  return {
    title: (followup ? '⏰ Ešte nepodané (' + followup + '/' + FOLLOWUP_MAX + ') – ' : '💊 ') + course.member_name + ': ' + course.medicine_name + (amount ? ' · ' + amount : ''),
    body: lines.join('\n'),
    tag: 'course-' + course.id,
    app: 'zdravko',
    url: '/zdravko/',
  };
}

// ---- Uloženie ------------------------------------------------------------------------------------

function courseFields(data) {
  const name = requireText(String(data.medicineName ?? '').replace(/\s+/g, ' '), 'Vyber liek.').slice(0, 80);
  const substanceId = /^[a-z_]{1,40}$/.test(data.substanceId || '') ? data.substanceId : '';
  const dosage = String(data.dosage ?? '').replace(/\s+/g, ' ').trim().slice(0, 40);
  const raw = Array.isArray(data.times) ? data.times.map((t) => String(t).trim()) : [];
  if (!raw.length) throw new AppError('Zadaj, koľkokrát denne a v aké časy sa liek podáva.');
  if (raw.some((t) => !TIME_RE.test(t))) throw new AppError('Časy dávok zadaj ako HH:MM (napr. 08:00).');
  const times = [...new Set(raw)].sort();
  if (times.length !== raw.length) throw new AppError('Dve dávky nemôžu byť v rovnakom čase.');
  if (times.length > MAX_TIMES) throw new AppError('Najviac ' + MAX_TIMES + ' dávok denne.');
  const startDate = String(data.startDate ?? '');
  if (!DATE_RE.test(startDate)) throw new AppError('Vyber, od kedy sa liek podáva.');
  let endDate = '';
  if (data.days !== null && data.days !== undefined && data.days !== '') {
    const days = Number(data.days);
    if (!Number.isInteger(days) || days < 1 || days > MAX_DAYS) throw new AppError('Počet dní zadaj od 1 do ' + MAX_DAYS + '.');
    endDate = addDaysYmd(startDate, days - 1);
  }
  const notes = String(data.notes ?? '').trim().slice(0, 200);
  return { medicine_name: name, substance_id: substanceId, dosage, times: JSON.stringify(times), start_date: startDate, end_date: endDate, notes };
}

/**
 * Nové alebo upravené dávkovanie.
 * data = { id?, medicineName, substanceId, dosage, times: ['08:00', …], startDate, days (null = do odvolania), notes }
 */
export async function saveCourse(c, memberId, data) {
  data = data && typeof data === 'object' ? data : {};
  const m = await findMember(c, memberId);
  let old = null;
  if (data.id) {
    old = await findRow(c, 'zdravko_courses', data.id, 'Dávkovanie');
    if (old.member_id !== m.id) throw new AppError('Dávkovanie patrí inému členovi rodiny.', 403);
  }
  const f = courseFields(data);
  const next = nextDoseMs(f, Date.now());
  if (!next) throw new AppError('Dávkovanie by už skončilo – skontroluj začiatok a počet dní.');
  const now = nowIso();
  const id = old ? old.id : crypto.randomUUID();
  const row = { ...f, next_at: new Date(next).toISOString(), stopped_at: '', followup_at: '', followup_dose: '', followup_count: 0 };
  if (old) {
    const cols = Object.keys(row);
    await c.db
      .prepare(`UPDATE zdravko_courses SET ${cols.map((k) => k + ' = ?').join(', ')}, updated_at = ? WHERE id = ?`)
      .bind(...cols.map((k) => row[k]), now, id)
      .run();
  } else {
    const full = { id, household_id: m.household_id, member_id: m.id, ...row, created_by: c.email, created_at: now, updated_at: now };
    const cols = Object.keys(full);
    await c.db
      .prepare(`INSERT INTO zdravko_courses (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`)
      .bind(...cols.map((k) => full[k]))
      .run();
    const who = await displayName(c);
    const times = JSON.parse(f.times);
    await notifyOthers(c, m.household_id, {
      title: '💊 Nové dávkovanie pre ' + m.name,
      body:
        f.medicine_name + (f.dosage ? ' ' + f.dosage : '') + ' · ' + times.length + '× denne (' + timesText(times) + ')' +
        (f.end_date ? ' · ' + (daysBetween(f.start_date, f.end_date) + 1) + ' dní' : '') + ' (zapísal(a) ' + who + ')',
      tag: 'course-' + id,
    });
  }
  return toCourse(await c.db.prepare('SELECT * FROM zdravko_courses WHERE id = ?').bind(id).first());
}

/** Ukončiť dávkovanie predčasne (ostane v histórii, ďalšie pripomienky už neprídu). */
export async function stopCourse(c, courseId) {
  const row = await findRow(c, 'zdravko_courses', courseId, 'Dávkovanie');
  const now = nowIso();
  await c.db.prepare("UPDATE zdravko_courses SET next_at = '', followup_at = '', stopped_at = ?, updated_at = ? WHERE id = ?").bind(now, now, row.id).run();
  return toCourse({ ...row, next_at: '', stopped_at: now });
}

export async function deleteCourse(c, courseId) {
  const row = await findRow(c, 'zdravko_courses', courseId, 'Dávkovanie');
  await c.db.batch([
    // podané dávky ostanú v záznamoch choroby ako obyčajné lieky
    c.db.prepare("UPDATE zdravko_records SET course_id = '' WHERE course_id = ?").bind(row.id),
    c.db.prepare('DELETE FROM zdravko_courses WHERE id = ?').bind(row.id),
  ]);
  return { ok: true };
}

// ---- Pripomienky (cron) ------------------------------------------------------------------------------

const recipientsOf = async (db, householdId) =>
  (
    await db
      .prepare('SELECT email FROM members WHERE household_id = ? AND email IN (SELECT email FROM push_subscriptions)')
      .bind(householdId)
      .all()
  ).results;

/** Zapísal už niekto dávku z času doseMs (najviac hodinu vopred alebo kedykoľvek neskôr)? */
const doseGiven = (db, courseId, doseMs) =>
  db
    .prepare('SELECT 1 FROM zdravko_records WHERE course_id = ? AND recorded_at >= ? LIMIT 1')
    .bind(courseId, new Date(doseMs - GIVEN_MS).toISOString())
    .first();

/**
 * Pripomenie dávky, ktorých čas nastal, a posunie dávkovanie na ďalšiu dávku. Ak dávku do pol hodiny
 * nikto nezapíše ako podanú, pripomína ju každú pol hodinu, najviac 6-krát. Vráti počet odoslaných upozornení.
 */
export async function sendCourseReminders(db, now = new Date()) {
  const nowMs = now.getTime();
  let sent = 0;

  // 1) opakované pripomienky nezapísaných dávok
  const { results: late } = await db
    .prepare(
      `SELECT c.*, m.name AS member_name FROM zdravko_courses c JOIN zdravko_members m ON m.id = c.member_id
       WHERE c.followup_at <> '' AND c.followup_at <= ?`
    )
    .bind(now.toISOString())
    .all();
  for (const course of late) {
    const claimed = await db
      .prepare("UPDATE zdravko_courses SET followup_at = '' WHERE id = ? AND followup_at = ?")
      .bind(course.id, course.followup_at)
      .run();
    if (!claimed.meta.changes || course.stopped_at || Date.parse(course.followup_at) < nowMs - LATE_MS) continue;
    const doseMs = Date.parse(course.followup_dose);
    if (await doseGiven(db, course.id, doseMs)) continue;
    const count = course.followup_count + 1;
    // ďalšia o pol hodiny – kým nie je 6 opakovaní a kým nepríde čas ďalšej dávky
    const again = Date.parse(course.followup_at) + FOLLOWUP_MS;
    if (count < FOLLOWUP_MAX && (!course.next_at || again < Date.parse(course.next_at))) {
      await db
        .prepare("UPDATE zdravko_courses SET followup_at = ?, followup_count = ? WHERE id = ? AND followup_at = '' AND followup_dose = ?")
        .bind(new Date(again).toISOString(), count, course.id, course.followup_dose)
        .run();
    }
    const message = doseMessage(course, course.followup_dose, count);
    for (const r of await recipientsOf(db, course.household_id)) sent += await sendToUser(db, r.email, message);
  }

  // 2) dávky, ktorých čas nastal
  const { results: due } = await db
    .prepare(
      `SELECT c.*, m.name AS member_name FROM zdravko_courses c JOIN zdravko_members m ON m.id = c.member_id
       WHERE c.next_at <> '' AND c.next_at <= ?`
    )
    .bind(now.toISOString())
    .all();
  for (const course of due) {
    const doseMs = Date.parse(course.next_at);
    const next = nextDoseMs(course, nowMs);
    // posun len raz (aj keby cron bežal súčasne)
    const moved = await db
      .prepare('UPDATE zdravko_courses SET next_at = ? WHERE id = ? AND next_at = ?')
      .bind(next ? new Date(next).toISOString() : '', course.id, course.next_at)
      .run();
    if (!moved.meta.changes || doseMs < nowMs - LATE_MS) continue;
    if (await doseGiven(db, course.id, doseMs)) continue;
    // o pol hodiny znova (a potom každú pol hodinu), ak ju dovtedy nikto nezapíše – nie však po ďalšej dávke
    const followup = doseMs + FOLLOWUP_MS;
    if (!next || followup < next) {
      await db
        .prepare('UPDATE zdravko_courses SET followup_at = ?, followup_dose = ?, followup_count = 0 WHERE id = ?')
        .bind(new Date(Math.max(followup, nowMs + 60000)).toISOString(), course.next_at, course.id)
        .run();
    }
    const message = doseMessage(course, course.next_at);
    for (const r of await recipientsOf(db, course.household_id)) sent += await sendToUser(db, r.email, message);
  }
  return sent;
}
