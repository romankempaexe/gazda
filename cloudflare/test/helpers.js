// Testovacie prostredie: lokálna D1 (SQLite cez workerd) s aplikovanými migráciami.
import { getPlatformProxy } from 'wrangler';
import { readdirSync, readFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import worker from '../src/index.js';
import { hashToken } from '../src/auth.js';

const root = new URL('..', import.meta.url).pathname;

export async function setup() {
  // Každý test má vlastnú prázdnu databázu.
  const proxy = await getPlatformProxy({
    configPath: join(root, 'wrangler.json'),
    persist: { path: mkdtempSync(join(tmpdir(), 'gazda-d1-')) },
  });
  const env = { ...proxy.env, ASSETS: { fetch: () => new Response('asset') } };
  for (const file of readdirSync(join(root, 'migrations')).sort()) {
    const sql = readFileSync(join(root, 'migrations', file), 'utf8')
      .replace(/--.*$/gm, '')
      .split(';')
      .map((s) => s.trim())
      .filter(Boolean);
    await env.DB.batch(sql.map((s) => env.DB.prepare(s)));
  }
  const fetch = (path, init) => worker.fetch(new Request('https://gazda.test' + path, init), env);

  /** Zavolá API ako prehliadač; vráti výsledok alebo vyhodí chybu s textom zo servera. */
  const call = async (token, name, ...args) => {
    const res = await fetch('/api/' + name, {
      method: 'POST',
      headers: { authorization: 'Bearer ' + token, 'content-type': 'application/json' },
      body: JSON.stringify({ args }),
    });
    const body = await res.json();
    if (body.error) throw Object.assign(new Error(body.error), { status: res.status });
    return body.result;
  };

  let n = 0;
  /** Vytvorí používateľa s osobným kľúčom a vráti klienta, ktorý volá API v jeho mene. */
  const user = async (email) => {
    const token = (++n).toString(16).padStart(32, 'a');
    await env.DB.prepare('INSERT INTO users (email, token_hash, created_at) VALUES (?, ?, ?)')
      .bind(email, await hashToken(token), new Date().toISOString())
      .run();
    const api = new Proxy({}, { get: (_, name) => (...args) => call(token, name, ...args) });
    return { email, token, api };
  };

  return { env, fetch, call, user, dispose: () => proxy.dispose() };
}
