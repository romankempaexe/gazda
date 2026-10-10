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
import { scheduledTick } from './notifications.js';
import { sendDealAlerts } from './deals.js';
import { createImportCode, importData } from './import.js';
import { analyzeLeafletPage, getLeaflet, getOffers, identifyLeafletProduct, getLeaflets, leafletImage } from './leaflets.js';

// Funkcie, ktoré smie prehliadač volať (všetky vyžadujú prihlásenie).
const METHODS = {
  getHouseholds: api.getHouseholds,
  setNickname: api.setNickname,
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
  setItemMissing: api.setItemMissing,
  getHistory: api.getHistory,
  rememberProducts: api.rememberProducts,
  getRev: api.getRev,
  getOffers,
  setItemPrice: api.setItemPrice,
  restoreHistory: api.restoreHistory,
  deleteCinnost: api.deleteCinnost,
  completeCinnost: api.completeCinnost,
  getPushKey: api.getPushKey,
  subscribePush: api.subscribePush,
  unsubscribePush: api.unsubscribePush,
  testPush: api.testPush,
  createImportCode,
  getLeaflets,
  getLeaflet,
  analyzeLeafletPage,
  identifyLeafletProduct,
};

const MAX_BODY = 256 * 1024;
const MAX_IMPORT_BODY = 5 * 1024 * 1024; // prenos celej starej Gazdy

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname.startsWith('/api/')) return handleApi(request, env, url, ctx);
    if (url.pathname === '/manifest.webmanifest') return manifest();
    return env.ASSETS.fetch(request);
  },

  // Cron (wrangler.json „triggers“): každých 15 minút – ranný prehľad raz denne o 8:00.
  async scheduled(event, env, ctx) {
    const now = new Date(event.scheduledTime);
    ctx.waitUntil(
      scheduledTick(env.DB, now)
        .catch((err) => console.error('Ranný prehľad: ' + err))
        // akcie na často kupované produkty – raz denne po 9:00 (vlastný beh, mimo prehľadu)
        .then(() => sendDealAlerts({ db: env.DB, fetch: env.TEST_FETCH }, now))
        .catch((err) => console.error('Akcie: ' + err))
    );
  },
};

async function handleApi(request, env, url, ctx) {
  try {
    if (url.pathname === '/api/health' && request.method === 'GET') {
      return json({ ok: true, ...(await health(env)) });
    }
    // Obrázky (prehliadač ich načíta cez <img>, preto GET): miniatúry položiek a stránky letákov.
    if (request.method === 'GET' && url.pathname.startsWith('/api/item-image/')) {
      const c = await context(request, env, url, ctx);
      return await api.itemImage(c, decodeURIComponent(url.pathname.slice('/api/item-image/'.length)));
    }
    if (request.method === 'GET' && url.pathname === '/api/leaflets/image') {
      return await leafletImage(await context(request, env, url, ctx), url.searchParams.get('p'));
    }
    // Nastavenie pre tlačidlo „Prihlásiť sa cez Google“ (Client ID je verejný).
    if (url.pathname === '/api/auth/config' && request.method === 'GET') {
      return json({ result: { googleClientId: env.GOOGLE_CLIENT_ID || '' } });
    }

    const name = url.pathname.slice('/api/'.length);
    const isAuth = name === 'auth/google' || name === 'auth/logout' || name === 'import';
    const method = Object.hasOwn(METHODS, name) ? METHODS[name] : null;
    if (!method && !isAuth) return json({ error: 'Neznáma požiadavka.' }, 404);
    if (request.method !== 'POST') return json({ error: 'Použi POST.' }, 405);
    // Len JSON: cudzia stránka ho nemôže poslať bez súhlasu (CORS), takže
    // spolu s cookie SameSite=Lax to bráni zneužitiu prihlásenia (CSRF).
    if (!(request.headers.get('content-type') || '').startsWith('application/json')) {
      throw new AppError('Neplatná požiadavka.', 415);
    }
    const body = await readJson(request, name === 'import' ? MAX_IMPORT_BODY : MAX_BODY);

    // Prenos zo starej Gazdy: overí sa jednorazovým kódom (nie prihlásením).
    if (name === 'import') return json({ result: await importData(env.DB, body) });

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
    const c = await context(request, env, url, ctx);
    return json({ result: await method(c, ...args) });
  } catch (err) {
    if (err instanceof AppError) return json({ error: err.message, ...(err.code && { code: err.code }) }, err.status);
    console.error(err);
    return json({ error: 'Chyba servera. Skús to znova.' }, 500);
  }
}

/** Kontext prihláseného používateľa pre funkcie API (neprihlásený → chyba 401). */
async function context(request, env, url, ctx) {
  return {
    db: env.DB,
    email: await authenticate(env.DB, request),
    today: env.TODAY || todayYmd(), // TODAY len v testoch
    origin: url.origin,
    // Upozornenia sa posielajú až po odoslaní odpovede (nezdržia aplikáciu).
    waitUntil: ctx && ctx.waitUntil ? ctx.waitUntil.bind(ctx) : null,
    fetch: env.TEST_FETCH, // v testoch náhrada za Lidl; inak globálny fetch
    ai: env.TEST_AI || env.AI, // Workers AI (rozpoznávanie produktov v letákoch)
  };
}

async function readJson(request, max) {
  const text = await request.text();
  if (text.length > max) throw new AppError('Požiadavka je príliš veľká.', 413);
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
    id: '/',
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
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/icons/maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
    // dlhé podržanie ikony (Android) – skratky; dajú sa aj pretiahnuť na plochu
    shortcuts: [
      {
        name: 'Pridať do nákupu',
        short_name: 'Do nákupu',
        url: '/?akcia=nakup',
        icons: [{ src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' }],
      },
      {
        name: 'Nová činnosť',
        short_name: 'Nová činnosť',
        url: '/?akcia=nova',
        icons: [{ src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' }],
      },
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
