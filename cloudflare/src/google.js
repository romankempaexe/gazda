// Overenie Google ID tokenu (JWT z tlačidla „Prihlásiť sa cez Google“).
// Podpis RS256 sa overí verejnými kľúčmi Google; skontroluje sa vydavateľ,
// adresát (náš Client ID), platnosť a overený e-mail.

import { AppError } from './domain.js';

const CERTS_URL = 'https://www.googleapis.com/oauth2/v3/certs';
const ISSUERS = ['accounts.google.com', 'https://accounts.google.com'];
const CLOCK_SKEW_S = 60;

let cachedKeys = null; // { keys, expires }

/** Verejné kľúče Google (držia sa v pamäti podľa Cache-Control). */
async function googleKeys(env) {
  if (env.TEST_GOOGLE_JWKS) return JSON.parse(env.TEST_GOOGLE_JWKS).keys; // len testy
  if (cachedKeys && cachedKeys.expires > Date.now()) return cachedKeys.keys;
  const res = await fetch(CERTS_URL);
  if (!res.ok) throw new AppError('Google je dočasne nedostupný, skús to o chvíľu.', 503);
  const maxAge = Number((res.headers.get('cache-control') || '').match(/max-age=(\d+)/)?.[1] || 3600);
  cachedKeys = { keys: (await res.json()).keys, expires: Date.now() + maxAge * 1000 };
  return cachedKeys.keys;
}

function base64UrlBytes(part) {
  const b64 = part.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(part.length / 4) * 4, '=');
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
}

const decodeJson = (part) => JSON.parse(new TextDecoder().decode(base64UrlBytes(part)));

/** Vráti { email, name, picture } z platného tokenu, inak vyhodí chybu. */
export async function verifyGoogleIdToken(env, idToken) {
  const invalid = () => new AppError('Prihlásenie cez Google sa nepodarilo. Skús to znova.', 401);
  const clientId = env.GOOGLE_CLIENT_ID;
  if (!clientId) throw new AppError('Prihlásenie Google účtom ešte nie je nastavené.', 503);

  const parts = String(idToken ?? '').split('.');
  if (parts.length !== 3) throw invalid();
  let header, claims;
  try {
    header = decodeJson(parts[0]);
    claims = decodeJson(parts[1]);
  } catch {
    throw invalid();
  }
  if (header.alg !== 'RS256') throw invalid();

  let jwk = (await googleKeys(env)).find((k) => k.kid === header.kid);
  if (!jwk && cachedKeys) {
    cachedKeys = null; // Google mohol medzičasom vymeniť kľúče
    jwk = (await googleKeys(env)).find((k) => k.kid === header.kid);
  }
  if (!jwk) throw invalid();
  const key = await crypto.subtle.importKey(
    'jwk',
    { kty: jwk.kty, n: jwk.n, e: jwk.e, alg: 'RS256', ext: true },
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['verify']
  );
  const ok = await crypto.subtle.verify(
    'RSASSA-PKCS1-v1_5',
    key,
    base64UrlBytes(parts[2]),
    new TextEncoder().encode(parts[0] + '.' + parts[1])
  );
  if (!ok) throw invalid();

  const now = Date.now() / 1000;
  if (!ISSUERS.includes(claims.iss) || claims.aud !== clientId) throw invalid();
  if (!(claims.exp + CLOCK_SKEW_S > now) || (claims.iat && claims.iat - CLOCK_SKEW_S > now)) throw invalid();
  if (!claims.email || claims.email_verified !== true) {
    throw new AppError('Tento Google účet nemá overený e-mail.', 401);
  }
  return {
    email: String(claims.email).toLowerCase(),
    name: String(claims.name || ''),
    picture: String(claims.picture || ''),
  };
}
