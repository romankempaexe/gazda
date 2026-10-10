// Push notifikácie Gazdu:
// - nová pridelená úloha (hneď, s obchodom, termínom a checklistom),
// - ranný prehľad o 8:00 (úlohy na dnes) a úlohy po termíne (spúšťa cron každých 15 min).

import { ALL, DATE_RE, TIME_ZONE, nowIso, todayYmd } from './domain.js';
import { generateVapidKeys, sendWebPush } from './webpush.js';

const MORNING_HOUR = 8; // prehľad sa posiela od 8:00…
const MORNING_LAST_HOUR = 11; // …zmeškaný (výpadok) najneskôr do 11:59
const MAX_BODY = 1500; // push správa má limit ~4 kB (po zašifrovaní)
const DAY_NAMES_SHORT = ['ne', 'po', 'ut', 'st', 'št', 'pi', 'so'];

// ---- Nastavenia servera (tabuľka config) -------------------------------------

async function getConfig(db, key) {
  const row = await db.prepare('SELECT value FROM config WHERE key = ?').bind(key).first();
  return row ? row.value : null;
}

async function setConfig(db, key, value) {
  await db
    .prepare('INSERT INTO config (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value')
    .bind(key, value)
    .run();
}

/** Kľúče VAPID; pri prvom použití sa vytvoria (súkromný kľúč nikdy neopustí server). */
export async function vapidKeys(db) {
  const stored = await getConfig(db, 'vapid');
  if (stored) return JSON.parse(stored);
  const keys = await generateVapidKeys();
  // Ak ich medzičasom vytvorilo iné spustenie, platia tie prvé.
  await db.prepare('INSERT INTO config (key, value) VALUES (?, ?) ON CONFLICT DO NOTHING').bind('vapid', JSON.stringify(keys)).run();
  return JSON.parse(await getConfig(db, 'vapid'));
}

/** Adresa aplikácie (pre VAPID „sub“ a odkaz v notifikácii); zapamätá sa pri odbere. */
export async function rememberOrigin(db, origin) {
  if ((await getConfig(db, 'origin')) !== origin) await setConfig(db, 'origin', origin);
}

// ---- Odoslanie ---------------------------------------------------------------

/**
 * Všetko potrebné na odoslanie (kľúče, adresa, odbery) – načíta sa raz, aby počet
 * dotazov nerástol s počtom ľudí (D1 free: 50 dotazov na spustenie).
 */
async function pushContext(db, emails) {
  const list = JSON.stringify(emails);
  const [subs, origin] = await db.batch([
    db.prepare('SELECT * FROM push_subscriptions WHERE email IN (SELECT value FROM json_each(?))').bind(list),
    db.prepare("SELECT value FROM config WHERE key = 'origin'"),
  ]);
  const byEmail = new Map();
  for (const sub of subs.results) {
    if (!byEmail.has(sub.email)) byEmail.set(sub.email, []);
    byEmail.get(sub.email).push(sub);
  }
  return {
    byEmail,
    vapid: subs.results.length ? await vapidKeys(db) : null,
    subject: (origin.results[0] && origin.results[0].value) || 'mailto:gazda@example.com',
  };
}

/**
 * Pošle správu na všetky zariadenia používateľa. Neplatné odbery (404/410) zmaže.
 * message = { title, body, tag, url }
 */
export async function sendToUser(db, email, message, context) {
  const ctx = context || (await pushContext(db, [email]));
  const subs = ctx.byEmail.get(email) || [];
  if (!subs.length) return 0;
  const { vapid, subject } = ctx;
  const payload = JSON.stringify({ ...message, body: truncate(message.body || '', MAX_BODY) });
  let sent = 0;
  for (const s of subs) {
    try {
      const status = await sendWebPush({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload, vapid, subject);
      if (status === 404 || status === 410) {
        await db.prepare('DELETE FROM push_subscriptions WHERE endpoint = ?').bind(s.endpoint).run();
      } else if (status >= 200 && status < 300) {
        sent++;
      } else {
        console.warn('Push služba odmietla správu: ' + status + ' ' + new URL(s.endpoint).host);
      }
    } catch (err) {
      console.warn('Push sa nepodarilo odoslať: ' + err);
    }
  }
  return sent;
}

function truncate(text, max) {
  return text.length > max ? text.slice(0, max - 1) + '…' : text;
}

function tasksLabel(n) {
  if (n === 1) return '1 úloha';
  return n + (n >= 2 && n <= 4 ? ' úlohy' : ' úloh');
}

export function formatShortDate(ymd) {
  const [y, m, d] = ymd.split('-').map(Number);
  return DAY_NAMES_SHORT[new Date(Date.UTC(y, m - 1, d)).getUTCDay()] + ' ' + d + '. ' + m + '.';
}

async function displayName(db, email) {
  const row = await db.prepare('SELECT nickname FROM users WHERE email = ?').bind(email).first();
  return (row && row.nickname) || email.split('@')[0];
}

// ---- Nová pridelená úloha ------------------------------------------------------

/** Text upozornenia o pridelenej činnosti (cinnost s items, ako ju vracia API). */
export async function assignedMessage(db, cinnost, priestor, fromEmail) {
  const household = await db.prepare('SELECT name FROM households WHERE id = ?').bind(cinnost.householdId).first();
  const lines = [];
  if (cinnost.kind === 'nakup') lines.push('🛒 Nákup' + (cinnost.store ? ': ' + cinnost.store : ''));
  const place = [priestor && priestor.name, household && household.name].filter(Boolean).join(' · ');
  if (place) lines.push(place);
  let when = 'Termín: ' + formatShortDate(cinnost.dueDate);
  if (cinnost.periodicity !== 'none') {
    const labels = { weekly: 'týždenne', monthly: 'mesačne', annually: 'ročne' };
    const n = Number(cinnost.repeatInterval) || 1;
    when += ' · ' + labels[cinnost.periodicity] + (n > 1 ? ' (každých ' + n + ')' : '');
  }
  lines.push(when);
  if (cinnost.description) lines.push(cinnost.description);
  const items = cinnost.items || [];
  if (items.length) {
    lines.push((cinnost.kind === 'nakup' ? 'Nakúpiť' : 'Checklist') + ' (' + items.length + '):');
    items.slice(0, 30).forEach((i) => lines.push((i.done ? '☑ ' : '☐ ') + i.text + (i.qty ? ' – ' + i.qty : '')));
    if (items.length > 30) lines.push('… a ďalších ' + (items.length - 30));
  }
  return {
    title: '📝 ' + (await displayName(db, fromEmail)) + ': ' + cinnost.name,
    body: lines.join('\n'),
    tag: 'assigned-' + cinnost.id,
    url: '/',
  };
}

/** Upozorní riešiteľa, že mu niekto pridelil činnosť (na pozadí – nezdrží uloženie). */
export async function notifyAssigned(c, cinnost, priestor) {
  const work = assignedMessage(c.db, cinnost, priestor, c.email)
    .then(async (message) => {
      if (cinnost.assignedTo !== ALL) return sendToUser(c.db, cinnost.assignedTo, message);
      // spoločná činnosť – dostanú ju všetci členovia okrem toho, kto ju pridelil
      const { results } = await c.db
        .prepare('SELECT email FROM members WHERE household_id = ? AND email <> ?')
        .bind(cinnost.householdId, c.email)
        .all();
      for (const m of results) await sendToUser(c.db, m.email, message);
    })
    .catch((err) => console.warn('Upozornenie o pridelení sa nepodarilo odoslať: ' + err));
  if (c.waitUntil) c.waitUntil(work);
  else await work;
}

// ---- Ranný prehľad --------------------------------------------------------------

function localHour(date) {
  return Number(new Intl.DateTimeFormat('en-GB', { timeZone: TIME_ZONE, hour: 'numeric', hourCycle: 'h23' }).format(date));
}

/** Spúšťa cron každých 15 minút: ranný prehľad raz denne medzi 8:00 a 11:59. */
export async function scheduledTick(db, now = new Date()) {
  const hour = localHour(now);
  if (hour < MORNING_HOUR || hour > MORNING_LAST_HOUR) return 0;
  const today = todayYmd(now);
  // Raz denne – aj keď cron beží viackrát (zápis pred odoslaním, aby sa neposlalo dvakrát).
  const { meta } = await db
    .prepare(
      `INSERT INTO config (key, value) VALUES ('last_digest', ?)
       ON CONFLICT (key) DO UPDATE SET value = excluded.value WHERE config.value <> excluded.value`
    )
    .bind(today)
    .run();
  if (!meta.changes) return 0;
  return sendMorningDigest(db, today);
}

export async function sendMorningDigest(db, today) {
  // Len úlohy ľudí, ktorí majú zapnuté upozornenia a sú členmi domácnosti.
  const { results } = await db
    .prepare(
      `SELECT c.*, m.email AS recipient, h.name AS household_name, p.name AS priestor_name,
              (SELECT COUNT(*) FROM polozky i WHERE i.cinnost_id = c.id) AS items_total,
              (SELECT COUNT(*) FROM polozky i WHERE i.cinnost_id = c.id AND i.done = 1) AS items_done
       FROM cinnosti c
       JOIN households h ON h.id = c.household_id
       JOIN members m ON m.household_id = c.household_id AND (m.email = c.assigned_to OR c.assigned_to = '${ALL}')
       LEFT JOIN priestory p ON p.id = c.priestor_id
       WHERE c.assigned_to <> '' AND c.due_date <= ?
         AND m.email IN (SELECT email FROM push_subscriptions)
       ORDER BY c.due_date, c.name`
    )
    .bind(today)
    .all();

  const where = (c) => {
    const parts = [];
    if (c.kind === 'nakup' && c.store) parts.push('🛒 ' + c.store);
    if (c.items_total) parts.push(c.items_done + '/' + c.items_total);
    parts.push((c.priestor_name ? c.priestor_name + ' · ' : '') + c.household_name);
    return parts.join(' · ');
  };

  const byUser = new Map();
  for (const c of results) {
    if (!DATE_RE.test(c.due_date)) continue;
    if (!byUser.has(c.recipient)) byUser.set(c.recipient, { today: [], overdue: [] });
    byUser.get(c.recipient)[c.due_date === today ? 'today' : 'overdue'].push(c);
  }

  const ctx = await pushContext(db, [...byUser.keys()]);
  let sent = 0;
  for (const [email, tasks] of byUser) {
    if (tasks.today.length) {
      sent += await sendToUser(db, email, {
        title: '🏠 Dnes ťa čaká ' + tasksLabel(tasks.today.length),
        body: tasks.today.map((c) => '• ' + c.name + ' (' + where(c) + ')').join('\n'),
        tag: 'digest-today',
        url: '/',
      }, ctx);
    }
    if (tasks.overdue.length) {
      sent += await sendToUser(db, email, {
        title: '⚠️ Po termíne: ' + tasksLabel(tasks.overdue.length),
        body: tasks.overdue.map((c) => '• ' + c.name + ' – od ' + formatShortDate(c.due_date) + ' (' + where(c) + ')').join('\n'),
        tag: 'digest-overdue',
        url: '/',
      }, ctx);
    }
  }
  return sent;
}

// ---- Odbery (volá API) ---------------------------------------------------------

export async function saveSubscription(db, email, subscription) {
  const endpoint = String(subscription?.endpoint || '');
  const keys = subscription?.keys || {};
  if (!/^https:\/\//.test(endpoint) || !keys.p256dh || !keys.auth) throw new Error('INVALID');
  await db
    .prepare(
      `INSERT INTO push_subscriptions (endpoint, email, p256dh, auth, created_at) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT (endpoint) DO UPDATE SET email = excluded.email, p256dh = excluded.p256dh, auth = excluded.auth`
    )
    .bind(endpoint, email, String(keys.p256dh), String(keys.auth), nowIso())
    .run();
}
