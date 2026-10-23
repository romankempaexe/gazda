// Čítanie starých údajov z Firebase (Firestore) pri prenose Skládka a Zdravka do Family Grid.
//
// Server sa prihlási servisným účtom projektu Firebase (JSON kľúč v tajnej premennej Workera,
// napr. FIREBASE_SKLADKO_SA) a prečíta údaje toho účtu Firebase, ktorý má rovnaký e-mail ako
// prihlásený používateľ Family Grid (Google prihlásenie overuje, že e-mail je jeho).
// Bez knižníc: JWT podpísaný RS256 (WebCrypto) → prístupový token Google → REST API.

import { AppError } from './domain.js';

const SCOPE = 'https://www.googleapis.com/auth/cloud-platform';

function b64url(bytes) {
  let s = '';
  for (const b of new Uint8Array(bytes)) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

const b64urlText = (text) => b64url(new TextEncoder().encode(text));

async function importPrivateKey(pem) {
  const b64 = String(pem).replace(/-----[^-]+-----/g, '').replace(/\s+/g, '');
  const der = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  return crypto.subtle.importKey('pkcs8', der, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']);
}

/** Servisný účet z tajnej premennej (JSON z Firebase → Nastavenia projektu → Servisné účty). */
export function serviceAccount(env, name, label) {
  const raw = env[name];
  if (!raw) {
    throw new AppError(
      'Prenos z mobilného ' + label + ' ešte nie je nastavený (na serveri chýba kľúč ' + name + ' – návod v README).',
      503
    );
  }
  try {
    const sa = JSON.parse(raw);
    if (sa.client_email && sa.private_key && sa.project_id) return sa;
  } catch {
    // spadne do chyby nižšie
  }
  throw new AppError('Kľúč ' + name + ' na serveri je neplatný (čakám JSON servisného účtu Firebase).', 503);
}

/**
 * Klient pre Firebase projekt servisného účtu. fetchFn = globálny fetch (v testoch náhrada).
 * Vráti { projectId, uidByEmail(email), runQuery(parentPath, collectionId), listDocuments(path), download(url) }.
 */
export function firebaseClient(sa, fetchFn = fetch) {
  let token = null;

  async function accessToken() {
    if (token) return token;
    const now = Math.floor(Date.now() / 1000);
    const tokenUri = sa.token_uri || 'https://oauth2.googleapis.com/token';
    const unsigned =
      b64urlText(JSON.stringify({ alg: 'RS256', typ: 'JWT' })) + '.' +
      b64urlText(JSON.stringify({ iss: sa.client_email, scope: SCOPE, aud: tokenUri, iat: now, exp: now + 3600 }));
    const key = await importPrivateKey(sa.private_key);
    const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(unsigned));
    const res = await fetchFn(tokenUri, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: 'grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=' + unsigned + '.' + b64url(sig),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok || !body.access_token) {
      console.error('Firebase token: ' + res.status + ' ' + JSON.stringify(body).slice(0, 300));
      throw new AppError('Prihlásenie servera do Firebase sa nepodarilo (skontroluj kľúč servisného účtu).', 502);
    }
    token = body.access_token;
    return token;
  }

  async function call(url, body) {
    const res = await fetchFn(url, {
      method: body ? 'POST' : 'GET',
      headers: { authorization: 'Bearer ' + (await accessToken()), ...(body && { 'content-type': 'application/json' }) },
      ...(body && { body: JSON.stringify(body) }),
    });
    const data = await res.json().catch(() => null);
    if (!res.ok) {
      console.error('Firebase ' + url + ': ' + res.status + ' ' + JSON.stringify(data).slice(0, 300));
      throw new AppError('Firebase odmietol požiadavku (' + res.status + ').', 502);
    }
    return data;
  }

  const docsRoot = `https://firestore.googleapis.com/v1/projects/${sa.project_id}/databases/(default)/documents`;

  return {
    projectId: sa.project_id,

    /** Firebase uid účtu s daným e-mailom (alebo null). */
    async uidByEmail(email) {
      const data = await call(`https://identitytoolkit.googleapis.com/v1/projects/${sa.project_id}/accounts:lookup`, { email: [email] });
      const user = data && data.users && data.users[0];
      return user ? user.localId : null;
    },

    /** Všetky dokumenty kolekcie collectionId kdekoľvek pod parentPath (napr. users/<uid>). */
    async runQuery(parentPath, collectionId) {
      const rows = await call(`${docsRoot}/${parentPath}:runQuery`, {
        structuredQuery: { from: [{ collectionId, allDescendants: true }] },
      });
      return (rows || []).filter((r) => r.document).map((r) => toDoc(r.document));
    },

    /** Dokumenty jednej kolekcie (napr. users/<uid>/warehouses), po stránkach. */
    async listDocuments(path) {
      const out = [];
      let pageToken = '';
      do {
        const data = await call(`${docsRoot}/${path}?pageSize=300${pageToken ? '&pageToken=' + encodeURIComponent(pageToken) : ''}`);
        for (const d of (data && data.documents) || []) out.push(toDoc(d));
        pageToken = (data && data.nextPageToken) || '';
      } while (pageToken);
      return out;
    },

    /** Jeden dokument (alebo null). */
    async getDocument(path) {
      const res = await fetchFn(`${docsRoot}/${path}`, { headers: { authorization: 'Bearer ' + (await accessToken()) } });
      if (res.status === 404) return null;
      if (!res.ok) throw new AppError('Firebase odmietol požiadavku (' + res.status + ').', 502);
      return toDoc(await res.json());
    },
  };
}

/** Dokument Firestore → { id, path (segmenty od „documents/“), data (obyčajné hodnoty JS) }. */
function toDoc(doc) {
  const path = doc.name.split('/documents/')[1].split('/');
  return { id: path[path.length - 1], path, data: fromFields(doc.fields || {}) };
}

function fromFields(fields) {
  const out = {};
  for (const [k, v] of Object.entries(fields)) out[k] = fromValue(v);
  return out;
}

/** Hodnota Firestore REST → JS. Časové pečiatky ostávajú ako ISO text. */
export function fromValue(v) {
  if (!v || typeof v !== 'object') return null;
  if ('stringValue' in v) return v.stringValue;
  if ('integerValue' in v) return Number(v.integerValue);
  if ('doubleValue' in v) return Number(v.doubleValue);
  if ('booleanValue' in v) return v.booleanValue;
  if ('timestampValue' in v) return v.timestampValue;
  if ('nullValue' in v) return null;
  if ('mapValue' in v) return fromFields(v.mapValue.fields || {});
  if ('arrayValue' in v) return (v.arrayValue.values || []).map(fromValue);
  if ('referenceValue' in v) return v.referenceValue;
  if ('geoPointValue' in v) return v.geoPointValue;
  return null;
}
