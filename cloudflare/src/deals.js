// Upozornenie na akcie: raz denne (po 9:00) pozrie, či sú produkty, ktoré domácnosť často
// kupuje, v niektorom platnom letáku, a pošle členom s upozorneniami jednu správu.
import { TIME_ZONE, todayYmd } from './domain.js';
import { getOffers } from './leaflets.js';
import { sendToUser } from './notifications.js';

const DEALS_HOUR = 9;
const DEALS_LAST_HOUR = 12;
const MAX_PRODUCTS = 6; // na deň a domácnosť (každý produkt = najviac 2 požiadavky na Kimbino)
const MIN_USES = 2; // „často kupované“

const norm = (s) => String(s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

function localHour(date) {
  return Number(new Intl.DateTimeFormat('en-GB', { timeZone: TIME_ZONE, hour: 'numeric', hourCycle: 'h23' }).format(date));
}

/** Ponuka naozaj na ten produkt: názov ponuky obsahuje hlavné slovo položky. */
export function matchingOffer(product, offers) {
  const word = norm(product).split(/[^a-z0-9]+/).find((w) => w.length >= 3);
  if (!word) return null;
  const stem = word.slice(0, Math.max(3, word.length - 2)); // mlieko → mlie (mlieko, mliečny…)
  return offers.find((o) => norm(o.name).includes(stem)) || null;
}

export async function sendDealAlerts(c, now = new Date()) {
  const hour = localHour(now);
  if (hour < DEALS_HOUR || hour > DEALS_LAST_HOUR) return 0;
  const today = todayYmd(now);
  const { meta } = await c.db
    .prepare(
      `INSERT INTO config (key, value) VALUES ('last_deals', ?)
       ON CONFLICT (key) DO UPDATE SET value = excluded.value WHERE config.value <> excluded.value`
    )
    .bind(today)
    .run();
  if (!meta.changes) return 0;

  const ctx = { ...c, today };
  const { results: households } = await c.db
    .prepare(
      `SELECT DISTINCT m.household_id AS id FROM members m
       WHERE m.email IN (SELECT email FROM push_subscriptions)`
    )
    .all();
  let sent = 0;
  for (const h of households.slice(0, 3)) {
    const { results: products } = await c.db
      .prepare('SELECT name FROM produkty WHERE household_id = ? AND uses >= ? ORDER BY uses DESC, last_used DESC LIMIT ?')
      .bind(h.id, MIN_USES, MAX_PRODUCTS)
      .all();
    if (!products.length) continue;
    const key = 'deals:' + h.id;
    const row = await c.db.prepare('SELECT value FROM config WHERE key = ?').bind(key).first();
    let notified = {};
    try {
      notified = row ? JSON.parse(row.value) : {};
    } catch {
      notified = {};
    }
    // zabudni na akcie, ktoré už skončili
    for (const k of Object.keys(notified)) if (notified[k] < today) delete notified[k];
    const found = [];
    for (const p of products) {
      let data;
      try {
        data = await getOffers(ctx, p.name);
      } catch {
        continue;
      }
      const o = matchingOffer(p.name, data.offers);
      if (!o) continue;
      const id = o.flyer + ':' + o.name;
      if (notified[id]) continue;
      notified[id] = o.validTo || today;
      found.push({ product: p.name, offer: o });
    }
    if (!found.length) continue;
    await c.db
      .prepare('INSERT INTO config (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value')
      .bind(key, JSON.stringify(notified))
      .run();
    const fmt = (n) => Number(n).toFixed(2).replace('.', ',') + ' €';
    const until = (d) => (d ? ' (do ' + Number(d.slice(8, 10)) + '. ' + Number(d.slice(5, 7)) + '.)' : '');
    const message = {
      title: '🏷 V akcii: ' + found.map((f) => f.product).slice(0, 3).join(', ') + (found.length > 3 ? '…' : ''),
      body: found.map((f) => '• ' + f.product + ' – ' + f.offer.store + ' ' + fmt(f.offer.price) + until(f.offer.validTo)).join('\n'),
      tag: 'deals-' + today,
      url: '/',
    };
    const { results: members } = await c.db
      .prepare('SELECT DISTINCT email FROM members WHERE household_id = ? AND email IN (SELECT email FROM push_subscriptions)')
      .bind(h.id)
      .all();
    for (const m of members) sent += await sendToUser(c.db, m.email, message);
  }
  return sent;
}
