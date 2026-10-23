// Family Grid – spoločná časť pre všetky podaplikácie (Gazda, Zdravko, Skládko):
// kto je prihlásený, jeho rodiny (= domácnosti z Gazdy), naposledy otvorená
// podaplikácia a krátky prehľad na dlaždice rozcestníka.

import { getHouseholds } from './api.js';
import { ALL, AppError } from './domain.js';

export const APPS = ['gazda', 'zdravko', 'skladko'];

/** Člen rodiny (domácnosti)? Inak chyba 403. Spoločné pre Zdravka a Skládko. */
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
  const [user, gazda] = await c.db.batch([
    c.db.prepare('SELECT last_app, last_household_id FROM users WHERE email = ?').bind(c.email),
    // Gazda: moje úlohy (aj spoločné) na dnes a po termíne – ako „Môj rozpis“.
    c.db
      .prepare(
        `SELECT SUM(c.due_date = ?1) AS today, SUM(c.due_date < ?1) AS overdue
         FROM cinnosti c JOIN members m ON m.household_id = c.household_id AND m.email = ?2
         WHERE c.due_date <> '' AND c.due_date <= ?1 AND (c.assigned_to = ?2 OR c.assigned_to = '${ALL}')`
      )
      .bind(c.today, c.email),
  ]);
  const u = user.results[0] || {};
  const g = gazda.results[0] || {};
  return {
    ...res,
    lastApp: APPS.includes(u.last_app) ? u.last_app : '',
    lastHouseholdId: u.last_household_id || '',
    overview: {
      gazda: { today: g.today || 0, overdue: g.overdue || 0 },
    },
  };
}

/** Zapamätá naposledy otvorenú podaplikáciu (na novom zariadení sa po prihlásení otvorí ona). */
export async function setLastApp(c, app) {
  if (!APPS.includes(app)) throw new AppError('Neznáma aplikácia.');
  await c.db.prepare('UPDATE users SET last_app = ? WHERE email = ? AND last_app <> ?').bind(app, c.email, app).run();
  return { lastApp: app };
}
