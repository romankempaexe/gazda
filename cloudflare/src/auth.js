// Prihlásenie: po overení Google účtu dostane zariadenie reláciu v cookie
// (HttpOnly, Secure, SameSite=Lax). V databáze je len SHA-256 hodnoty cookie.

import { AppError, nowIso } from './domain.js';

export const SESSION_COOKIE = 'gazda_session';
const SESSION_DAYS = 365;
export const LOGIN_REQUIRED = 'LOGIN_REQUIRED';

export async function hashToken(token) {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token));
  return [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function randomHex(bytes) {
  return [...crypto.getRandomValues(new Uint8Array(bytes))].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function readCookie(request, name) {
  const header = request.headers.get('cookie') || '';
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === name) return part.slice(i + 1).trim();
  }
  return '';
}

export function sessionCookie(value, maxAge) {
  return `${SESSION_COOKIE}=${value}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`;
}

/** Prihlási používateľa (uloží údaje z Google účtu) a vráti hlavičku Set-Cookie. */
export async function startSession(db, user) {
  const value = randomHex(32);
  const now = new Date();
  const expires = new Date(now.getTime() + SESSION_DAYS * 86400000);
  await db.batch([
    db
      .prepare(
        `INSERT INTO users (email, name, picture, last_login, created_at) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT (email) DO UPDATE SET name = excluded.name, picture = excluded.picture, last_login = excluded.last_login`
      )
      .bind(user.email, user.name, user.picture, now.toISOString(), now.toISOString()),
    db
      .prepare('INSERT INTO sessions (id_hash, email, created_at, expires_at) VALUES (?, ?, ?, ?)')
      .bind(await hashToken(value), user.email, now.toISOString(), expires.toISOString()),
    // Staré relácie upracuj priebežne.
    db.prepare('DELETE FROM sessions WHERE expires_at < ?').bind(now.toISOString()),
  ]);
  return sessionCookie(value, SESSION_DAYS * 86400);
}

/** E-mail prihláseného používateľa podľa cookie, inak chyba 401. */
export async function authenticate(db, request) {
  const value = readCookie(request, SESSION_COOKIE);
  if (/^[0-9a-f]{64}$/.test(value)) {
    const row = await db
      .prepare('SELECT email FROM sessions WHERE id_hash = ? AND expires_at > ?')
      .bind(await hashToken(value), nowIso())
      .first();
    if (row) return row.email;
  }
  throw Object.assign(new AppError('Prihlás sa svojím Google účtom.', 401), { code: LOGIN_REQUIRED });
}

/** Odhlási toto zariadenie a vráti hlavičku Set-Cookie, ktorá cookie zmaže. */
export async function endSession(db, request) {
  const value = readCookie(request, SESSION_COOKIE);
  if (value) await db.prepare('DELETE FROM sessions WHERE id_hash = ?').bind(await hashToken(value)).run();
  return sessionCookie('', 0);
}
