// Family Grid – spoločná časť pre všetky podaplikácie (Gazda, Zdravko, Skládko, QuickStash):
// kto je prihlásený, jeho rodiny (= domácnosti z Gazdy), naposledy otvorená
// podaplikácia a krátky prehľad na dlaždice rozcestníka.

import { getHouseholds } from './api.js';
import { ALL, AppError, requireText } from './domain.js';

export const APPS = ['gazda', 'zdravko', 'skladko', 'quickstash'];

/** Člen rodiny (domácnosti)? Inak chyba 403. Spoločné pre Zdravka, Skládko a QuickStash. */
export async function requireFamilyMember(c, householdId) {
  const member = await c.db
    .prepare('SELECT * FROM members WHERE household_id = ? AND email = ?')
    .bind(String(householdId ?? ''), c.email)
    .first();
  if (!member) throw new AppError('K tejto rodine nemáš prístup.', 403);
  return member;
}

/** Údaje pre rozcestník: používateľ, rodiny, posledná podaplikácia a prehľad dlaždíc. */
export async function getFamily(c) {
  const res = await getHouseholds(c);
  const [user, gazda, skladko, zdravko, quickstash] = await c.db.batch([
    c.db.prepare('SELECT last_app, last_household_id FROM users WHERE email = ?').bind(c.email),
    // Gazda: moje úlohy (aj spoločné) na dnes a po termíne – ako „Môj rozpis“.
    c.db
      .prepare(
        `SELECT SUM(c.due_date = ?1) AS today, SUM(c.due_date < ?1) AS overdue
         FROM cinnosti c JOIN members m ON m.household_id = c.household_id AND m.email = ?2
         WHERE c.due_date <> '' AND c.due_date <= ?1 AND (c.assigned_to = ?2 OR c.assigned_to = '${ALL}')`
      )
      .bind(c.today, c.email),
    // Skládko: počet vecí, koľko dochádza a koľkým končí trvanlivosť (do 7 dní alebo už prešla).
    c.db
      .prepare(
        `SELECT COUNT(*) AS items, SUM(i.min_qty > 0 AND i.quantity <= i.min_qty) AS low,
                SUM(i.expiration_date <> '' AND i.expiration_date <= date(?1, '+7 days')) AS expiring
         FROM skladko_items i JOIN members m ON m.household_id = i.household_id AND m.email = ?2`
      )
      .bind(c.today, c.email),
    // Zdravko: najbližšia udalosť (lekár, vyšetrenie, očkovanie) od teraz.
    c.db
      .prepare(
        `SELECT COUNT(*) AS upcoming, MIN(r.event_at) AS next_at FROM zdravko_records r
         JOIN members m ON m.household_id = r.household_id AND m.email = ?2
         WHERE r.type = 'calendar_event' AND r.event_at >= ?1`
      )
      .bind(new Date().toISOString(), c.email),
    // QuickStash: počet položiek, ktoré používateľ vidí (spoločné a jeho súkromné).
    c.db
      .prepare(
        `SELECT COUNT(*) AS entries FROM quickstash_entries q
         JOIN members m ON m.household_id = q.household_id AND m.email = ?1
         WHERE q.owner_email = '' OR q.owner_email = ?1`
      )
      .bind(c.email),
  ]);
  const u = user.results[0] || {};
  const g = gazda.results[0] || {};
  const k = skladko.results[0] || {};
  const z = zdravko.results[0] || {};
  const q = quickstash.results[0] || {};
  return {
    ...res,
    lastApp: APPS.includes(u.last_app) ? u.last_app : '',
    lastHouseholdId: u.last_household_id || '',
    overview: {
      gazda: { today: g.today || 0, overdue: g.overdue || 0 },
      skladko: { items: k.items || 0, low: k.low || 0, expiring: k.expiring || 0 },
      zdravko: { upcoming: z.upcoming || 0, nextAt: z.next_at || '' },
      quickstash: { entries: q.entries || 0 },
    },
  };
}

/** Zapamätá naposledy otvorenú podaplikáciu (na novom zariadení sa po prihlásení otvorí ona). */
export async function setLastApp(c, app) {
  if (!APPS.includes(app)) throw new AppError('Neznáma aplikácia.');
  await c.db.prepare('UPDATE users SET last_app = ? WHERE email = ? AND last_app <> ?').bind(app, c.email, app).run();
  return { lastApp: app };
}

/** Rodina, s ktorou pracujú všetky podaplikácie (Gazda ju otvorí, Zdravko a Skládko ukážu jej údaje). */
export async function setCurrentFamily(c, householdId) {
  await requireFamilyMember(c, householdId);
  await c.db
    .prepare('UPDATE users SET last_household_id = ? WHERE email = ? AND last_household_id <> ?')
    .bind(householdId, c.email, householdId)
    .run();
  return { householdId };
}

export async function renameFamily(c, householdId, name) {
  await requireFamilyMember(c, householdId);
  name = requireText(String(name ?? '').replace(/\s+/g, ' '), 'Zadaj názov rodiny.');
  if (name.length > 60) throw new AppError('Názov môže mať najviac 60 znakov.');
  await c.db.prepare('UPDATE households SET name = ? WHERE id = ?').bind(name, householdId).run();
  return getFamily(c);
}

/**
 * Odobratie člena z rodiny (prestane vidieť Gazdu, Zdravka, Skládko aj QuickStash tejto rodiny).
 * Zakladateľ môže odobrať kohokoľvek okrem seba, ostatní len seba (odísť z rodiny).
 */
export async function removeFamilyMember(c, householdId, email) {
  const me = await requireFamilyMember(c, householdId);
  email = String(email ?? '').trim().toLowerCase();
  const target = await c.db.prepare('SELECT * FROM members WHERE household_id = ? AND email = ?').bind(householdId, email).first();
  if (!target) throw new AppError('Tento človek v rodine nie je.', 404);
  if (target.role === 'owner') throw new AppError('Zakladateľa rodiny nemožno odobrať – rodinu môže len vymazať.', 403);
  if (email !== c.email && me.role !== 'owner') throw new AppError('Iných členov môže odobrať len zakladateľ rodiny.', 403);
  await c.db.batch([
    c.db.prepare('DELETE FROM members WHERE household_id = ? AND email = ?').bind(householdId, email),
    // jeho úlohy v Gazde ostanú nepridelené
    c.db.prepare("UPDATE cinnosti SET assigned_to = '' WHERE household_id = ? AND assigned_to = ?").bind(householdId, email),
    c.db.prepare("UPDATE users SET last_household_id = '' WHERE email = ? AND last_household_id = ?").bind(email, householdId),
    // jeho súkromné položky v QuickStashi tejto rodiny už nikto neuvidí
    c.db.prepare('DELETE FROM quickstash_entries WHERE household_id = ? AND owner_email = ?').bind(householdId, email),
  ]);
  return getFamily(c);
}
