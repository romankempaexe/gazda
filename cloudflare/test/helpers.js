// Testovacie prostredie: lokálna D1 (SQLite cez workerd) s aplikovanými migráciami
// a vlastný podpisový kľúč namiesto Google, aby sa dalo otestovať celé prihlásenie.
import { getPlatformProxy } from 'wrangler';
import { readdirSync, readFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import worker from '../src/index.js';

const root = new URL('..', import.meta.url).pathname;
export const CLIENT_ID = 'test-client.apps.googleusercontent.com';

const b64url = (bytes) => Buffer.from(bytes).toString('base64url');
const keyPair = await crypto.subtle.generateKey(
  { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
  true,
  ['sign', 'verify']
);
const publicJwk = { ...(await crypto.subtle.exportKey('jwk', keyPair.publicKey)), kid: 'test-key', use: 'sig' };

/** ID token ako od Google (podpísaný testovacím kľúčom); claims prepíšu predvolené. */
export async function signIdToken(claims = {}, { kid = 'test-key', key = keyPair.privateKey } = {}) {
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: 'RS256', kid, typ: 'JWT' }));
  const payload = b64url(
    JSON.stringify({
      iss: 'https://accounts.google.com',
      aud: CLIENT_ID,
      iat: now,
      exp: now + 3600,
      email_verified: true,
      name: 'Test',
      ...claims,
    })
  );
  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(header + '.' + payload));
  return header + '.' + payload + '.' + b64url(new Uint8Array(sig));
}

export async function setup() {
  // Každý test má vlastnú prázdnu databázu.
  const proxy = await getPlatformProxy({
    configPath: join(root, 'wrangler.json'),
    persist: { path: mkdtempSync(join(tmpdir(), 'gazda-d1-')) },
  });
  const env = {
    ...proxy.env,
    ASSETS: { fetch: () => new Response('asset') },
    GOOGLE_CLIENT_ID: CLIENT_ID,
    TEST_GOOGLE_JWKS: JSON.stringify({ keys: [publicJwk] }),
  };
  for (const file of readdirSync(join(root, 'migrations')).sort()) {
    const sql = readFileSync(join(root, 'migrations', file), 'utf8')
      .replace(/--.*$/gm, '')
      .split(';')
      .map((s) => s.trim())
      .filter(Boolean);
    await env.DB.batch(sql.map((s) => env.DB.prepare(s)));
  }
  const fetch = (path, init) => worker.fetch(new Request('https://gazda.test' + path, init), env);
  const postJson = (path, body, cookie) =>
    fetch(path, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(cookie && { cookie }) },
      body: JSON.stringify(body),
    });

  /** Zavolá API ako prehliadač s cookie; vráti výsledok alebo vyhodí chybu s textom zo servera. */
  const call = async (cookie, name, ...args) => {
    const res = await postJson('/api/' + name, { args }, cookie);
    const body = await res.json();
    if (body.error) throw Object.assign(new Error(body.error), { status: res.status, code: body.code });
    return body.result;
  };

  /** Prihlási sa cez Google; vráti cookie relácie (alebo vyhodí chybu). */
  const login = async (credential) => {
    const res = await postJson('/api/auth/google', { credential });
    const body = await res.json();
    if (body.error) throw Object.assign(new Error(body.error), { status: res.status });
    return res.headers.get('set-cookie').split(';')[0];
  };

  /** Prihlásený používateľ: klient, ktorý volá API v jeho mene. */
  const user = async (email) => {
    const cookie = await login(await signIdToken({ email }));
    const api = new Proxy({}, { get: (_, name) => (...args) => call(cookie, name, ...args) });
    return { email, cookie, api };
  };

  return { env, fetch, postJson, call, login, user, dispose: () => proxy.dispose() };
}
