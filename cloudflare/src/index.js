/**
 * Gazda na Cloudflare Workers.
 *
 * Statické súbory (public/) obsluhuje Cloudflare priamo, sem prichádzajú len
 * požiadavky na /api/* a manifest. Údaje sú v databáze D1 (env.DB).
 *
 * Prihlásenie: tlačidlo Google v prehliadači pošle ID token na /api/auth/google,
 * server ho overí a nastaví reláciu v cookie. Ostatné volania:
 * POST /api/<funkcia>, telo {"args": [...]} (Content-Type: application/json).
 * Odpoveď {"result": …} alebo pri chybe {"error": "text pre používateľa"}
 * (neprihlásený: HTTP 401 a "code": "LOGIN_REQUIRED").
 */

import * as api from './api.js';
import { authenticate, endSession, startSession } from './auth.js';
import { AppError, todayYmd } from './domain.js';
import { verifyGoogleIdToken } from './google.js';

// Funkcie, ktoré smie prehliadač volať (všetky vyžadujú prihlásenie).
const METHODS = {
  getHouseholds: api.getHouseholds,
  getStartData: api.getStartData,
  createHousehold: api.createHousehold,
  shareHousehold: api.shareHousehold,
  deleteHousehold: api.deleteHousehold,
  getHouseholdData: api.getHouseholdData,
  addPriestor: api.addPriestor,
  addCinnost: api.addCinnost,
  updateCinnost: api.updateCinnost,
  addItem: api.addItem,
  toggleItem: api.toggleItem,
  deleteCinnost: api.deleteCinnost,
  completeCinnost: api.completeCinnost,
};

const MAX_BODY = 256 * 1024;

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname.startsWith('/api/')) return handleApi(request, env, url);
    if (url.pathname === '/manifest.webmanifest') return manifest();
    return env.ASSETS.fetch(request);
  },
};

async function handleApi(request, env, url) {
  try {
    if (url.pathname === '/api/health' && request.method === 'GET') {
      return json({ ok: true, ...(await health(env)) });
    }
    // Nastavenie pre tlačidlo „Prihlásiť sa cez Google“ (Client ID je verejný).
    if (url.pathname === '/api/auth/config' && request.method === 'GET') {
      return json({ result: { googleClientId: env.GOOGLE_CLIENT_ID || '' } });
    }

    const name = url.pathname.slice('/api/'.length);
    const isAuth = name === 'auth/google' || name === 'auth/logout';
    const method = Object.hasOwn(METHODS, name) ? METHODS[name] : null;
    if (!method && !isAuth) return json({ error: 'Neznáma požiadavka.' }, 404);
    if (request.method !== 'POST') return json({ error: 'Použi POST.' }, 405);
    // Len JSON: cudzia stránka ho nemôže poslať bez súhlasu (CORS), takže
    // spolu s cookie SameSite=Lax to bráni zneužitiu prihlásenia (CSRF).
    if (!(request.headers.get('content-type') || '').startsWith('application/json')) {
      throw new AppError('Neplatná požiadavka.', 415);
    }
    const body = await readJson(request);

    if (name === 'auth/google') {
      const user = await verifyGoogleIdToken(env, body.credential);
      const cookie = await startSession(env.DB, user);
      return json({ result: { email: user.email, name: user.name } }, 200, { 'set-cookie': cookie });
    }
    if (name === 'auth/logout') {
      return json({ result: { ok: true } }, 200, { 'set-cookie': await endSession(env.DB, request) });
    }

    const args = body.args ?? [];
    if (!Array.isArray(args)) throw new AppError('Neplatná požiadavka.');
    const c = {
      db: env.DB,
      email: await authenticate(env.DB, request),
      today: env.TODAY || todayYmd(), // TODAY len v testoch
    };
    return json({ result: await method(c, ...args) });
  } catch (err) {
    if (err instanceof AppError) return json({ error: err.message, ...(err.code && { code: err.code }) }, err.status);
    console.error(err);
    return json({ error: 'Chyba servera. Skús to znova.' }, 500);
  }
}

async function readJson(request) {
  const text = await request.text();
  if (text.length > MAX_BODY) throw new AppError('Požiadavka je príliš veľká.', 413);
  if (!text) return {};
  try {
    const data = JSON.parse(text);
    if (data && typeof data === 'object') return data;
  } catch {
    // spadne do chyby nižšie
  }
  throw new AppError('Neplatná požiadavka.');
}

/** Manifest na inštaláciu na plochu. */
function manifest() {
  const body = {
    name: 'Gazda',
    short_name: 'Gazda',
    description: 'Domáce práce a nákupy pre celú domácnosť',
    lang: 'sk',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    background_color: '#f4f6f3',
    theme_color: '#16a34a',
    icons: [
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
      { src: '/icons/maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  };
  return new Response(JSON.stringify(body), {
    headers: { 'content-type': 'application/manifest+json; charset=utf-8', 'cache-control': 'no-store' },
  });
}

/** Overí spojenie s databázou a že sú v nej tabuľky (migrácie prebehli). */
async function health(env) {
  const { results } = await env.DB.prepare(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE '\\_%' ESCAPE '\\' AND name NOT LIKE 'sqlite%' AND name NOT LIKE 'd1_%' ORDER BY name"
  ).all();
  return { tables: results.map((r) => r.name) };
}

function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers },
  });
}
