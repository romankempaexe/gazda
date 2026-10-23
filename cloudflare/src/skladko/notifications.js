// Upozornenia Skládka (cron každých 5 minút, cez deň 8:00–20:59):
// - končí trvanlivosť: položka, ktorej dátum spotreby je do 3 dní (každý dátum raz),
// - dochádza: množstvo kleslo na hranicu „dochádza“ (raz, kým sa nedoplní).
// Dostanú ich všetci členovia rodiny so zapnutými upozorneniami, s ikonou Skládka.

import { TIME_ZONE, todayYmd } from '../domain.js';
import { sendToUser } from '../notifications.js';

const FIRST_HOUR = 8;
const LAST_HOUR = 20;
const EXPIRING_DAYS = 3;

function localHour(date) {
  return Number(new Intl.DateTimeFormat('en-GB', { timeZone: TIME_ZONE, hour: 'numeric', hourCycle: 'h23' }).format(date));
}

export function addDays(ymd, days) {
  const [y, m, d] = ymd.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

/** „dnes“, „zajtra“, „o 3 dni“, „prešla 21. 10.“ */
export function expiryLabel(ymd, today) {
  const diff = Math.round((Date.parse(ymd) - Date.parse(today)) / 86400000);
  if (diff < 0) {
    const [, m, d] = ymd.split('-').map(Number);
    return 'prešla ' + d + '. ' + m + '.';
  }
  if (diff === 0) return 'dnes';
  if (diff === 1) return 'zajtra';
  return 'o ' + diff + ' dni';
}

function countLabel(n) {
  return n === 1 ? '1 vec' : n + (n >= 2 && n <= 4 ? ' veci' : ' vecí');
}

export async function sendSkladkoAlerts(db, now = new Date()) {
  const hour = localHour(now);
  if (hour < FIRST_HOUR || hour > LAST_HOUR) return 0;
  const today = todayYmd(now);
  // Najprv sa označia (aby neodišli dvakrát, aj keby cron bežal súčasne).
  const [expiring, low] = await db.batch([
    db
      .prepare(
        `UPDATE skladko_items SET notified_exp = expiration_date
         WHERE expiration_date <> '' AND expiration_date <= ? AND expiration_date >= ? AND notified_exp <> expiration_date
         RETURNING id, household_id, warehouse_id, name, expiration_date`
      )
      .bind(addDays(today, EXPIRING_DAYS), addDays(today, -1)),
    db
      .prepare(
        `UPDATE skladko_items SET notified_low = 1
         WHERE min_qty > 0 AND quantity <= min_qty AND notified_low = 0
         RETURNING id, household_id, warehouse_id, name, quantity`
      ),
  ]);
  const rows = [...expiring.results.map((r) => ({ ...r, kind: 'exp' })), ...low.results.map((r) => ({ ...r, kind: 'low' }))];
  if (!rows.length) return 0;

  const { results: places } = await db
    .prepare(
      `SELECT w.id, w.name, w.household_id, m.email FROM skladko_warehouses w JOIN members m ON m.household_id = w.household_id
       WHERE w.id IN (SELECT value FROM json_each(?)) AND m.email IN (SELECT email FROM push_subscriptions)`
    )
    .bind(JSON.stringify([...new Set(rows.map((r) => r.warehouse_id))]))
    .all();
  const warehouseName = new Map(places.map((p) => [p.id, p.name]));
  const recipients = new Map(); // household → e-maily
  for (const p of places) {
    if (!recipients.has(p.household_id)) recipients.set(p.household_id, new Set());
    recipients.get(p.household_id).add(p.email);
  }

  let sent = 0;
  for (const [householdId, emails] of recipients) {
    const mine = rows.filter((r) => r.household_id === householdId);
    const exp = mine.filter((r) => r.kind === 'exp').sort((a, b) => a.expiration_date.localeCompare(b.expiration_date));
    const lowItems = mine.filter((r) => r.kind === 'low');
    const messages = [];
    if (exp.length) {
      messages.push({
        title: '⏳ Končí trvanlivosť: ' + countLabel(exp.length),
        body: exp.map((r) => '• ' + r.name + ' – ' + expiryLabel(r.expiration_date, today) + ' (' + warehouseName.get(r.warehouse_id) + ')').join('\n'),
        tag: 'expiring',
      });
    }
    if (lowItems.length) {
      messages.push({
        title: '📦 Dochádza: ' + countLabel(lowItems.length),
        body: lowItems.map((r) => '• ' + r.name + ' – ' + r.quantity + ' ks (' + warehouseName.get(r.warehouse_id) + ')').join('\n'),
        tag: 'low',
      });
    }
    for (const email of emails) {
      for (const m of messages) sent += await sendToUser(db, email, { ...m, app: 'skladko', url: '/skladko/' });
    }
  }
  return sent;
}
