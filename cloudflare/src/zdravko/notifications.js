// Pripomienky Zdravka (cron): udalosti u lekára (týždeň / deň / hodinu pred) a striedanie
// liekov proti horúčke. Dostanú ich všetci členovia rodiny so zapnutými upozorneniami.

import { sendToUser } from '../notifications.js';

const LATE_MS = 6 * 3600000; // zmeškané o viac ako 6 h (výpadok) sa už neposielajú

export async function sendZdravkoReminders(db, now = new Date()) {
  const nowIso = now.toISOString();
  // Najprv sa označia (aby neodišli dvakrát, aj keby cron bežal súčasne).
  const [due] = await db.batch([
    db
      .prepare(
        `UPDATE zdravko_reminders SET sent_at = ?1 WHERE sent_at = '' AND fire_at <= ?1 AND fire_at >= ?2
         RETURNING household_id, record_id, kind, title, body`
      )
      .bind(nowIso, new Date(now.getTime() - LATE_MS).toISOString()),
    db.prepare("UPDATE zdravko_reminders SET sent_at = 'missed' WHERE sent_at = '' AND fire_at < ?").bind(new Date(now.getTime() - LATE_MS).toISOString()),
  ]);
  if (!due.results.length) return 0;
  const { results: recipients } = await db
    .prepare(
      `SELECT household_id, email FROM members
       WHERE household_id IN (SELECT value FROM json_each(?)) AND email IN (SELECT email FROM push_subscriptions)`
    )
    .bind(JSON.stringify([...new Set(due.results.map((r) => r.household_id))]))
    .all();
  let sent = 0;
  for (const r of due.results) {
    for (const m of recipients.filter((x) => x.household_id === r.household_id)) {
      sent += await sendToUser(db, m.email, {
        title: r.title,
        body: r.body,
        tag: r.kind + '-' + r.record_id,
        app: 'zdravko',
        url: '/zdravko/',
      });
    }
  }
  return sent;
}
