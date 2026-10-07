/**
 * Gazda na Cloudflare Workers.
 *
 * Statické súbory (public/) obsluhuje Cloudflare priamo, sem prichádzajú len
 * požiadavky na /api/*. Údaje sú v databáze D1 (env.DB).
 *
 * Volanie API: POST /api/<funkcia>, telo {"args": [...]}, hlavička
 * Authorization: Bearer <kľúč z osobného odkazu>. Odpoveď {"result": …}
 * alebo pri chybe {"error": "text pre používateľa"}.
 */

import * as api from './api.js';
import { authenticate, hashToken, issueToken, personalLink } from './auth.js';
import { AppError, EMAIL_RE, TOKEN_RE, todayYmd } from './domain.js';

// Funkcie, ktoré smie prehliadač volať (všetky vyžadujú platný osobný kľúč).
const METHODS = {
  getHouseholds: api.getHouseholds,
  getStartData: api.getStartData,
  createHousehold: api.createHousehold,
  shareHousehold: api.shareHousehold,
  createMemberLink: api.createMemberLink,
  regenerateMyLink: api.regenerateMyLink,
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
    if (url.pathname === '/manifest.webmanifest') return manifest(url);
    return env.ASSETS.fetch(request);
  },
};

async function handleApi(request, env, url) {
  try {
    if (url.pathname === '/api/health' && request.method === 'GET') {
      return json({ ok: true, ...(await health(env)) });
    }

    if (url.pathname === '/api/admin/link' && request.method === 'POST') {
      return json({ result: await adminLink(request, env, url) });
    }

    const name = url.pathname.slice('/api/'.length);
    const method = Object.hasOwn(METHODS, name) ? METHODS[name] : null;
    if (!method) return json({ error: 'Neznáma požiadavka.' }, 404);
    if (request.method !== 'POST') return json({ error: 'Použi POST.' }, 405);

    const body = await request.text();
    if (body.length > MAX_BODY) throw new AppError('Požiadavka je príliš veľká.', 413);
    let args = [];
    if (body) {
      try {
        args = JSON.parse(body).args ?? [];
      } catch {
        throw new AppError('Neplatná požiadavka.');
      }
    }
    if (!Array.isArray(args)) throw new AppError('Neplatná požiadavka.');

    const token = (request.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
    const c = {
      db: env.DB,
      email: await authenticate(env.DB, token),
      origin: url.origin,
      today: env.TODAY || todayYmd(), // TODAY len v testoch
    };
    return json({ result: await method(c, ...args) });
  } catch (err) {
    if (err instanceof AppError) return json({ error: err.message }, err.status);
    console.error(err);
    return json({ error: 'Chyba servera. Skús to znova.' }, 500);
  }
}

/**
 * Správca (náhrada funkcie mojOdkaz z Apps Script): vytvorí osobný odkaz pre e-mail.
 * Chránené heslom ADMIN_KEY (Worker secret, nastavuje ho CI z GitHub secretu
 * GAZDA_ADMIN_KEY). Nový odkaz nahradí starý odkaz daného človeka.
 */
async function adminLink(request, env, url) {
  if (!env.ADMIN_KEY || env.ADMIN_KEY.length < 12) {
    throw new AppError('Správca nie je nastavený (chýba heslo ADMIN_KEY).', 404);
  }
  let data;
  try {
    data = await request.json();
  } catch {
    throw new AppError('Neplatná požiadavka.');
  }
  // Porovnanie odtlačkov – nezávisí od toho, koľko znakov hesla sa zhoduje.
  if ((await hashToken(String(data.adminKey ?? ''))) !== (await hashToken(env.ADMIN_KEY))) {
    throw new AppError('Nesprávne heslo správcu.', 403);
  }
  const email = String(data.email ?? '').trim().toLowerCase();
  if (!EMAIL_RE.test(email)) throw new AppError('Zadaj platný e-mail.');
  return { email, link: personalLink(url.origin, await issueToken(env.DB, email)) };
}

/**
 * Manifest na inštaláciu na plochu. Ikona na ploche otvorí start_url – s osobným
 * kľúčom, aby bol používateľ hneď prihlásený (iPhone nezdieľa úložisko so Safari).
 */
function manifest(url) {
  const k = String(url.searchParams.get('k') || '').toLowerCase();
  const body = {
    name: 'Gazda',
    short_name: 'Gazda',
    description: 'Domáce práce a nákupy pre celú domácnosť',
    lang: 'sk',
    start_url: TOKEN_RE.test(k) ? '/?k=' + k : '/',
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

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });
}
