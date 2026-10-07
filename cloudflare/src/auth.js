// Osobné odkazy: …/?k=<32 hex znakov>. V databáze je len SHA-256 odtlačok kľúča
// (rovnaký ako vo verzii Apps Script, takže prenesené odkazy fungujú ďalej).

import { AppError, INVALID_LINK, TOKEN_RE, nowIso } from './domain.js';

export async function hashToken(token) {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token));
  return [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function newToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Overí kľúč z odkazu a vráti e-mail používateľa, ktorému patrí. */
export async function authenticate(db, token) {
  token = String(token ?? '').toLowerCase();
  if (TOKEN_RE.test(token)) {
    const user = await db.prepare('SELECT email FROM users WHERE token_hash = ?').bind(await hashToken(token)).first();
    if (user) return user.email;
  }
  throw new AppError(INVALID_LINK + ': Tento odkaz je neplatný alebo bol nahradený novým.', 401);
}

/** Vytvorí nový kľúč pre používateľa (uloží len odtlačok; starý kľúč prestane platiť). */
export async function issueToken(db, email) {
  const token = newToken();
  await db
    .prepare(
      `INSERT INTO users (email, token_hash, created_at) VALUES (?, ?, ?)
       ON CONFLICT (email) DO UPDATE SET token_hash = excluded.token_hash`
    )
    .bind(email, await hashToken(token), nowIso())
    .run();
  return token;
}

export function personalLink(origin, token) {
  return origin + '/?k=' + token;
}
