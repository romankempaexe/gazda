// Kalendár Family Grid pre Google Kalendár / kalendár v iPhone (iCalendar, RFC 5545).
//
// Každý používateľ si môže vytvoriť súkromnú adresu GET /api/calendar/<token>.ics
// (v databáze je len SHA-256 tokenu). Kalendár sa do Google Kalendára pridá cez
// „Pridať z webovej adresy“ a na plochu sa potom dá widget Google Kalendára.
// Obsahuje udalosti Zdravka (lekár, vyšetrenie, očkovanie) a úlohy Gazdy s termínom
// zo všetkých rodín používateľa. ?gazda=mine (predvolené) | all | none.

import { hashToken } from './auth.js';
import { ALL, AppError, nowIso } from './domain.js';

const PAST_DAYS = 60; // udalosti Zdravka trochu do minulosti, nech kalendár nie je prázdny
const EVENT_TYPES = { doctor_visit: ['🩺', 'Návšteva lekára'], examination: ['🔬', 'Vyšetrenie'], vaccination: ['💉', 'Očkovanie'] };
const FREQ = { weekly: 'WEEKLY', monthly: 'MONTHLY', annually: 'YEARLY' };

function randomToken() {
  return [...crypto.getRandomValues(new Uint8Array(24))].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Vytvorí novú súkromnú adresu kalendára (stará prestane platiť). */
export async function createCalendarFeed(c) {
  const token = randomToken();
  await c.db.batch([
    c.db.prepare('DELETE FROM calendar_feeds WHERE email = ?').bind(c.email),
    c.db.prepare('INSERT INTO calendar_feeds (token_hash, email, created_at) VALUES (?, ?, ?)').bind(await hashToken(token), c.email, nowIso()),
  ]);
  return { url: c.origin + '/api/calendar/' + token + '.ics' };
}

/** Má používateľ adresu kalendára? (samotnú adresu server nepozná – len jej odtlačok) */
export async function getCalendarFeed(c) {
  const row = await c.db.prepare('SELECT created_at, last_access FROM calendar_feeds WHERE email = ?').bind(c.email).first();
  return row ? { active: true, createdAt: row.created_at, lastAccess: row.last_access } : { active: false };
}

export async function deleteCalendarFeed(c) {
  await c.db.prepare('DELETE FROM calendar_feeds WHERE email = ?').bind(c.email).run();
  return { active: false };
}

// ---- iCalendar -------------------------------------------------------------------------------

/** Text pre iCalendar (\\, ;, , a nové riadky). */
const text = (s) => String(s ?? '').replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');

/** Riadky dlhšie ako 75 bajtov sa zalamujú (pokračovanie začína medzerou), nerozdelí UTF-8 znak. */
export function fold(line) {
  const enc = new TextEncoder();
  if (enc.encode(line).length <= 75) return line;
  const out = [];
  let cur = '';
  let bytes = 0;
  for (const ch of line) {
    const n = enc.encode(ch).length;
    if (bytes + n > (out.length ? 74 : 75)) {
      out.push(cur);
      cur = '';
      bytes = 0;
    }
    cur += ch;
    bytes += n;
  }
  out.push(cur);
  return out.join('\r\n ');
}

const utc = (iso) => new Date(iso).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
const ymd = (s) => s.replace(/-/g, '');
const addDays = (s, n) => {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
};

const VTIMEZONE = [
  'BEGIN:VTIMEZONE',
  'TZID:Europe/Bratislava',
  'BEGIN:DAYLIGHT',
  'TZOFFSETFROM:+0100',
  'TZOFFSETTO:+0200',
  'TZNAME:CEST',
  'DTSTART:19700329T020000',
  'RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=-1SU',
  'END:DAYLIGHT',
  'BEGIN:STANDARD',
  'TZOFFSETFROM:+0200',
  'TZOFFSETTO:+0100',
  'TZNAME:CET',
  'DTSTART:19701025T030000',
  'RRULE:FREQ=YEARLY;BYMONTH=10;BYDAY=-1SU',
  'END:STANDARD',
  'END:VTIMEZONE',
];

/** Udalosť Zdravka (čas v UTC, 1 hodina). */
function zdravkoEvent(r, stamp) {
  const [emoji, name] = EVENT_TYPES[r.event_type] || EVENT_TYPES.doctor_visit;
  const end = new Date(Date.parse(r.event_at) + 3600000).toISOString();
  const desc = [name + ' – ' + r.member_name, r.notes, r.cost ? 'Cena: ' + String(r.cost).replace('.', ',') + ' €' : '', 'Zdravko · ' + r.household_name]
    .filter(Boolean)
    .join('\n');
  return [
    'BEGIN:VEVENT',
    'UID:zdravko-' + r.id + '@family-grid',
    'DTSTAMP:' + stamp,
    'DTSTART:' + utc(r.event_at),
    'DTEND:' + utc(end),
    'SUMMARY:' + text(emoji + ' ' + r.member_name + ': ' + r.subtype),
    'DESCRIPTION:' + text(desc),
    'CATEGORIES:Zdravko',
    'END:VEVENT',
  ];
}

/** Úloha Gazdy: celý deň alebo v zadaný čas (30 min); opakovaná ako séria (RRULE). */
function gazdaTask(t, stamp) {
  const lines = ['BEGIN:VEVENT', 'UID:gazda-' + t.id + '@family-grid', 'DTSTAMP:' + stamp];
  if (t.due_time) {
    const [h, m] = t.due_time.split(':').map(Number);
    const endMin = h * 60 + m + 30;
    const end = endMin >= 24 * 60 ? '235900' : String(Math.floor(endMin / 60)).padStart(2, '0') + String(endMin % 60).padStart(2, '0') + '00';
    lines.push('DTSTART;TZID=Europe/Bratislava:' + ymd(t.due_date) + 'T' + t.due_time.replace(':', '') + '00');
    lines.push('DTEND;TZID=Europe/Bratislava:' + ymd(t.due_date) + 'T' + end);
  } else {
    lines.push('DTSTART;VALUE=DATE:' + ymd(t.due_date), 'DTEND;VALUE=DATE:' + ymd(addDays(t.due_date, 1)));
  }
  if (FREQ[t.periodicity]) {
    const day = Number(t.due_date.slice(8, 10));
    lines.push(
      'RRULE:FREQ=' + FREQ[t.periodicity] + ';INTERVAL=' + (Number(t.repeat_interval) || 1) +
        // Gazda pri 31. dni v kratšom mesiaci použije posledný deň mesiaca
        (t.periodicity === 'monthly' && day === 31 ? ';BYMONTHDAY=-1' : '')
    );
  }
  const who = t.assigned_to === ALL ? 'všetci' : t.assignee || '';
  const title = t.kind === 'nakup' ? '🛒 ' + (t.store ? 'Nákup: ' + t.store : t.name) : '🏠 ' + t.name;
  const items = t.items ? ' (' + t.items + ' ' + (t.kind === 'nakup' ? 'položiek' : 'v checkliste') + ')' : '';
  const desc = [who ? 'Kto: ' + who : '', t.description, (t.priestor ? t.priestor + ' · ' : '') + 'Gazda · ' + t.household_name].filter(Boolean).join('\n');
  lines.push('SUMMARY:' + text(title + items), 'DESCRIPTION:' + text(desc), 'CATEGORIES:Gazda', 'TRANSP:TRANSPARENT', 'END:VEVENT');
  return lines;
}

/** GET /api/calendar/<token>.ics – bez prihlásenia, overí sa tokenom v adrese. */
export async function calendarFeed(db, token, gazda = 'mine', today) {
  if (!/^[0-9a-f]{48}$/.test(token)) throw new AppError('Kalendár neexistuje.', 404);
  const hash = await hashToken(token);
  const feed = await db.prepare('SELECT email FROM calendar_feeds WHERE token_hash = ?').bind(hash).first();
  if (!feed) throw new AppError('Kalendár neexistuje (adresa bola zrušená).', 404);
  const email = feed.email;
  const since = new Date(Date.now() - PAST_DAYS * 86400000).toISOString();
  const mode = ['all', 'none'].includes(gazda) ? gazda : 'mine';

  const [events, tasks] = await db.batch([
    db
      .prepare(
        `SELECT r.*, z.name AS member_name, h.name AS household_name FROM zdravko_records r
         JOIN members m ON m.household_id = r.household_id AND m.email = ?
         JOIN zdravko_members z ON z.id = r.member_id
         JOIN households h ON h.id = r.household_id
         WHERE r.type = 'calendar_event' AND r.event_at >= ? ORDER BY r.event_at`
      )
      .bind(email, since),
    db
      .prepare(
        `SELECT c.*, h.name AS household_name, p.name AS priestor,
                COALESCE(NULLIF(u.nickname, ''), c.assigned_to) AS assignee,
                (SELECT COUNT(*) FROM polozky i WHERE i.cinnost_id = c.id AND i.done = 0) AS items
         FROM cinnosti c
         JOIN members m ON m.household_id = c.household_id AND m.email = ?1
         JOIN households h ON h.id = c.household_id
         LEFT JOIN priestory p ON p.id = c.priestor_id
         LEFT JOIN users u ON u.email = c.assigned_to
         WHERE c.due_date <> '' AND ?2 <> 'none' AND (?2 = 'all' OR c.assigned_to = ?1 OR c.assigned_to = '${ALL}')
         ORDER BY c.due_date`
      )
      .bind(email, mode),
    db.prepare('UPDATE calendar_feeds SET last_access = ? WHERE token_hash = ?').bind(nowIso(), hash),
  ]);

  const stamp = utc(new Date().toISOString());
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Family Grid//Gazda a Zdravko//SK',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'X-WR-CALNAME:Family Grid',
    'X-WR-CALDESC:Udalosti Zdravka a úlohy Gazdy',
    'X-WR-TIMEZONE:Europe/Bratislava',
    'REFRESH-INTERVAL;VALUE=DURATION:PT1H',
    'X-PUBLISHED-TTL:PT1H',
    ...VTIMEZONE,
    ...events.results.flatMap((r) => zdravkoEvent(r, stamp)),
    // neopakované úlohy dávno po termíne nemá zmysel ukazovať
    ...tasks.results
      .filter((t) => FREQ[t.periodicity] || !today || t.due_date >= addDays(today, -PAST_DAYS))
      .flatMap((t) => gazdaTask(t, stamp)),
    'END:VCALENDAR',
  ];
  return lines.map(fold).join('\r\n') + '\r\n';
}
