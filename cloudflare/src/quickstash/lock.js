// QuickStash – zámok biometriou (WebAuthn: odtlačok prsta, tvár, Windows Hello, prístupový kľúč).
//
// Kto si zámok zapne, má v D1 aspoň jeden verejný kľúč (webauthn_credentials). Potom server
// položky QuickStashu (getData, zmeny, import, synchronizácia) vydá len relácii (zariadeniu),
// ktorá je odomknutá – overí podpis výzvy kľúčom zariadenia. Odomknutie platí UNLOCK_MS od
// posledného použitia; aplikácia sa navyše sama zamkne, keď je dlhšie na pozadí.
// Odomknúť sa dá ktorýmkoľvek kľúčom používateľa (aj prístupovým kľúčom z telefónu cez QR).

import { AppError, nowIso } from '../domain.js';

export const UNLOCK_MS = 15 * 60000;
const EXTEND_MS = 5 * 60000; // predĺži sa, keď zostáva menej ako UNLOCK_MS - EXTEND_MS
const CHALLENGE_MS = 5 * 60000;
const MAX_CREDENTIALS = 10;
export const LOCKED = 'QS_LOCKED';

const enc = new TextEncoder();
const b64url = (bytes) => btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

function fromB64url(text, what) {
  if (typeof text !== 'string' || !/^[A-Za-z0-9_-]*$/.test(text) || text.length > 8192) throw new AppError('Neplatné údaje ' + what + '.');
  const bin = atob(text.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((text.length + 3) % 4));
  return Uint8Array.from(bin, (ch) => ch.charCodeAt(0));
}

const sha256 = async (bytes) => new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));

function requireSession(c) {
  if (!c.session) throw new AppError('Prihlás sa znova.', 401);
}

// ---- Stav zámku -----------------------------------------------------------------------------------

async function credentialsOf(c) {
  const { results } = await c.db.prepare('SELECT id, device, created_at, last_used_at FROM webauthn_credentials WHERE email = ? ORDER BY created_at').bind(c.email).all();
  return results;
}

/**
 * Pustí ďalej, ak používateľ zámok nemá alebo je táto relácia odomknutá (a odomknutie predĺži).
 * Inak chyba s kódom QS_LOCKED. Vráti true, keď má používateľ zámok zapnutý.
 */
export async function requireUnlocked(c) {
  const [creds, session] = await c.db.batch([
    c.db.prepare('SELECT COUNT(*) AS n FROM webauthn_credentials WHERE email = ?').bind(c.email),
    c.db.prepare('SELECT qs_unlocked_until FROM sessions WHERE id_hash = ?').bind(c.session || ''),
  ]);
  if (!creds.results[0].n) return false;
  const until = (session.results[0] && session.results[0].qs_unlocked_until) || '';
  const now = Date.now();
  if (!until || Date.parse(until) <= now) {
    throw Object.assign(new AppError('QuickStash je zamknutý – odomkni ho odtlačkom prsta.', 403), { code: LOCKED });
  }
  if (Date.parse(until) - now < UNLOCK_MS - EXTEND_MS) {
    await c.db.prepare('UPDATE sessions SET qs_unlocked_until = ? WHERE id_hash = ?').bind(new Date(now + UNLOCK_MS).toISOString(), c.session).run();
  }
  return true;
}

/** Stav zámku pre aplikáciu: { enabled, unlocked, devices: [{ id, device, createdAt, lastUsedAt }] }. */
export async function getLock(c) {
  const creds = await credentialsOf(c);
  let unlocked = true;
  if (creds.length) {
    const row = await c.db.prepare('SELECT qs_unlocked_until FROM sessions WHERE id_hash = ?').bind(c.session || '').first();
    unlocked = Boolean(row && row.qs_unlocked_until && Date.parse(row.qs_unlocked_until) > Date.now());
  }
  return {
    enabled: creds.length > 0,
    unlocked,
    devices: unlocked ? creds.map((r) => ({ id: r.id, device: r.device, createdAt: r.created_at, lastUsedAt: r.last_used_at })) : [],
  };
}

/** Zamkne QuickStash na tomto zariadení (napr. keď bola aplikácia dlhšie na pozadí). */
export async function lockNow(c) {
  if (c.session) await c.db.prepare("UPDATE sessions SET qs_unlocked_until = '' WHERE id_hash = ?").bind(c.session).run();
  return { ok: true };
}

// ---- Výzvy ------------------------------------------------------------------------------------------

async function newChallenge(c, kind) {
  requireSession(c);
  const challenge = b64url(crypto.getRandomValues(new Uint8Array(32)));
  await c.db.batch([
    c.db.prepare('DELETE FROM webauthn_challenges WHERE created_at < ?').bind(new Date(Date.now() - CHALLENGE_MS).toISOString()),
    c.db.prepare('INSERT INTO webauthn_challenges (challenge, session_hash, kind, created_at) VALUES (?, ?, ?, ?)').bind(challenge, c.session, kind, nowIso()),
  ]);
  return challenge;
}

/** Overí clientDataJSON (typ, výzva tejto relácie, adresa) a výzvu spotrebuje. */
async function checkClientData(c, clientDataBytes, kind) {
  let data;
  try {
    data = JSON.parse(new TextDecoder().decode(clientDataBytes));
  } catch {
    throw new AppError('Neplatná odpoveď overenia.');
  }
  if (data.type !== (kind === 'create' ? 'webauthn.create' : 'webauthn.get')) throw new AppError('Neplatná odpoveď overenia.');
  if (data.origin !== c.origin) throw new AppError('Overenie prišlo z inej adresy.');
  const used = await c.db
    .prepare('DELETE FROM webauthn_challenges WHERE challenge = ? AND session_hash = ? AND kind = ? AND created_at >= ? RETURNING challenge')
    .bind(String(data.challenge || ''), c.session, kind, new Date(Date.now() - CHALLENGE_MS).toISOString())
    .first();
  if (!used) throw new AppError('Overenie vypršalo – skús to znova.');
}

/** authenticatorData: hash rpId (adresa aplikácie), prítomný používateľ a overený (biometria / PIN). */
async function checkAuthData(c, authData) {
  if (authData.length < 37) throw new AppError('Neplatná odpoveď overenia.');
  const rpHash = await sha256(enc.encode(new URL(c.origin).hostname));
  if (!rpHash.every((b, i) => authData[i] === b)) throw new AppError('Overenie patrí inej aplikácii.');
  const flags = authData[32];
  if (!(flags & 0x01) || !(flags & 0x04)) throw new AppError('Zariadenie neoverilo odtlačok prsta ani tvár.');
}

// ---- Zapnutie (nový kľúč tohto zariadenia) ---------------------------------------------------------

/** Údaje pre navigator.credentials.create (prehliadač vytvorí kľúč chránený biometriou). */
export async function lockBegin(c) {
  const creds = await credentialsOf(c);
  // nový kľúč smie pridať len odomknuté zariadenie (inak by zámok obišiel ktokoľvek s reláciou)
  if (creds.length) await requireUnlocked(c);
  if (creds.length >= MAX_CREDENTIALS) throw new AppError('Najviac ' + MAX_CREDENTIALS + ' zariadení – najprv nejaké odober.');
  return {
    challenge: await newChallenge(c, 'create'),
    rpId: new URL(c.origin).hostname,
    userId: b64url(await sha256(enc.encode('fg-user:' + c.email))),
    userName: c.email,
    exclude: creds.map((r) => r.id),
  };
}

/**
 * Uloží kľúč zariadenia. data = { id, publicKey (SPKI, base64url), alg, clientDataJSON,
 * authenticatorData (base64url), device (názov) }. Zariadenie ostane odomknuté.
 */
export async function lockEnable(c, data) {
  data = data && typeof data === 'object' ? data : {};
  const creds = await credentialsOf(c);
  if (creds.length) await requireUnlocked(c);
  const id = data.id;
  fromB64url(id, 'kľúča');
  if (!id || id.length > 1400) throw new AppError('Neplatné id kľúča.');
  const alg = Number(data.alg);
  if (alg !== -7 && alg !== -257) throw new AppError('Toto zariadenie používa nepodporovaný typ kľúča.');
  const spki = fromB64url(data.publicKey, 'kľúča');
  await importKey(spki, alg); // musí sa dať načítať
  await checkClientData(c, fromB64url(data.clientDataJSON, 'overenia'), 'create');
  await checkAuthData(c, fromB64url(data.authenticatorData, 'overenia'));
  const now = nowIso();
  const device = String(data.device || '').replace(/\s+/g, ' ').trim().slice(0, 60) || 'Zariadenie';
  await c.db.batch([
    c.db
      .prepare(
        `INSERT INTO webauthn_credentials (id, email, public_key, alg, device, created_at, last_used_at) VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (id) DO NOTHING`
      )
      .bind(id, c.email, b64url(spki), alg, device, now, now),
    c.db.prepare('UPDATE sessions SET qs_unlocked_until = ? WHERE id_hash = ?').bind(new Date(Date.now() + UNLOCK_MS).toISOString(), c.session),
  ]);
  return getLock(c);
}

/** Odoberie kľúč (zariadenie); keď je posledný, zámok sa vypne. Len z odomknutého zariadenia. */
export async function lockRemove(c, credentialId) {
  await requireUnlocked(c);
  await c.db.prepare('DELETE FROM webauthn_credentials WHERE id = ? AND email = ?').bind(String(credentialId ?? ''), c.email).run();
  return getLock(c);
}

/** Vypne zámok (zmaže všetky kľúče). Len z odomknutého zariadenia. */
export async function lockDisable(c) {
  await requireUnlocked(c);
  await c.db.prepare('DELETE FROM webauthn_credentials WHERE email = ?').bind(c.email).run();
  return getLock(c);
}

// ---- Odomknutie ----------------------------------------------------------------------------------------

/** Údaje pre navigator.credentials.get. */
export async function unlockBegin(c) {
  const creds = await credentialsOf(c);
  if (!creds.length) throw new AppError('Zámok nie je zapnutý.');
  return { challenge: await newChallenge(c, 'get'), rpId: new URL(c.origin).hostname, allow: creds.map((r) => r.id) };
}

/** data = { id, clientDataJSON, authenticatorData, signature } (base64url) → odomkne toto zariadenie. */
export async function unlock(c, data) {
  data = data && typeof data === 'object' ? data : {};
  const row = await c.db.prepare('SELECT * FROM webauthn_credentials WHERE id = ? AND email = ?').bind(String(data.id ?? ''), c.email).first();
  if (!row) throw new AppError('Tento kľúč nepatrí k tvojmu účtu (možno bol odobratý). Skús iný.');
  const clientData = fromB64url(data.clientDataJSON, 'overenia');
  const authData = fromB64url(data.authenticatorData, 'overenia');
  await checkClientData(c, clientData, 'get');
  await checkAuthData(c, authData);
  const key = await importKey(fromB64url(row.public_key, 'kľúča'), row.alg);
  const signed = new Uint8Array([...authData, ...(await sha256(clientData))]);
  let signature = fromB64url(data.signature, 'podpisu');
  if (row.alg === -7) signature = derToRaw(signature);
  const params = row.alg === -7 ? { name: 'ECDSA', hash: 'SHA-256' } : { name: 'RSASSA-PKCS1-v1_5' };
  if (!signature || !(await crypto.subtle.verify(params, key, signature, signed))) throw new AppError('Overenie sa nepodarilo.');
  const now = nowIso();
  await c.db.batch([
    c.db.prepare('UPDATE webauthn_credentials SET last_used_at = ? WHERE id = ?').bind(now, row.id),
    c.db.prepare('UPDATE sessions SET qs_unlocked_until = ? WHERE id_hash = ?').bind(new Date(Date.now() + UNLOCK_MS).toISOString(), c.session),
  ]);
  return { ok: true };
}

// ---- Kryptografia --------------------------------------------------------------------------------------

function importKey(spki, alg) {
  const params = alg === -7 ? { name: 'ECDSA', namedCurve: 'P-256' } : { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' };
  return crypto.subtle.importKey('spki', spki, params, false, ['verify']).catch(() => {
    throw new AppError('Kľúč zariadenia sa nedá načítať.');
  });
}

/** Podpis ECDSA z WebAuthn je v DER (SEQUENCE { r, s }); WebCrypto chce r‖s po 32 bajtov. */
export function derToRaw(der) {
  if (der[0] !== 0x30) return null;
  let i = 2;
  if (der[1] & 0x80) i = 2 + (der[1] & 0x7f);
  const out = new Uint8Array(64);
  for (let k = 0; k < 2; k++) {
    if (der[i] !== 0x02) return null;
    const len = der[i + 1];
    let n = der.subarray(i + 2, i + 2 + len);
    while (n.length > 32 && n[0] === 0) n = n.subarray(1);
    if (n.length > 32) return null;
    out.set(n, k * 32 + 32 - n.length);
    i += 2 + len;
  }
  return out;
}
