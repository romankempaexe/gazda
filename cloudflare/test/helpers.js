// Testovacie prostredie: lokálna D1 (SQLite cez workerd) s aplikovanými migráciami.
import { getPlatformProxy } from 'wrangler';
import { readdirSync, readFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import worker from '../src/index.js';

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
  return {
    env,
    fetch: (path, init) => worker.fetch(new Request('https://gazda.test' + path, init), env),
    dispose: () => proxy.dispose(),
  };
}
