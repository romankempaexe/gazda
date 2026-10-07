// Letáky Lidl (neoficiálne – rovnaké zdroje, aké používa web lidl.sk):
// 1. stránka s letákmi na lidl.sk → identifikátory letákov (slug),
// 2. endpoints.leaflets.schwarz/v4/flyer → stránky letáka s obrázkami a platnosťou.
// Obrázky idú cez náš server (/api/leaflets/image), aby sa z nich v prehliadači
// dali vystrihnúť miniatúry (canvas nesmie byť „zašpinený“ cudzím pôvodom).
//
// Výsledok sa drží v tabuľke config (Cache API na workers.dev nefunguje), takže
// Lidl sa pýtame najviac raz za pár hodín bez ohľadu na počet používateľov.

import { AppError } from './domain.js';

const LIDL = 'https://www.lidl.sk';
const FLYER_API = 'https://endpoints.leaflets.schwarz/v4/flyer';
export const IMAGE_ORIGIN = 'https://imgproxy.leaflets.schwarz';
const HEADERS = {
  'user-agent': 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Mobile Safari/537.36',
  'accept-language': 'sk-SK,sk;q=0.9',
};
const LISTING_RE = /href="((?:https:\/\/www\.lidl\.sk)?\/c\/[^"]*let[aá]k[^"]*\/s\d+[^"]*)"/gi;
const SLUG_RE = /\/l\/sk\/[a-z0-9-]+\/([a-z0-9-]{6,})(?=[/"?])/gi;
const SKIP_SLUG = /brozura/; // informačné brožúry bez tovaru
const MAX_FLYERS = 8;
const LIST_KEY = 'leaflets';
const FLYER_KEY = 'leaflet:';
const REFRESH_MS = 6 * 3600 * 1000;

const fetcher = (c) => c.fetch || fetch;

async function getText(c, url) {
  const res = await fetcher(c)(url, { headers: HEADERS, redirect: 'follow' });
  if (!res.ok) throw new Error('HTTP ' + res.status + ' ' + url);
  return res.text();
}

/** Identifikátory letákov zo stránky lidl.sk (v poradí, ako ich ukazuje Lidl). */
async function findSlugs(c) {
  const home = await getText(c, LIDL + '/');
  const listings = [...new Set([...home.matchAll(LISTING_RE)].map((m) => m[1]))];
  // Prednostne „online leták“ (týždenná ponuka), nie WhatsApp a podobne.
  listings.sort((a, b) => Number(/online/.test(b)) - Number(/online/.test(a)));
  if (!listings.length) throw new Error('Na lidl.sk sa nenašla stránka s letákmi.');
  const listing = await getText(c, new URL(listings[0], LIDL).href);
  return [...new Set([...listing.matchAll(SLUG_RE)].map((m) => m[1]))].filter((s) => !SKIP_SLUG.test(s));
}

/** Adresa obrázka na lidl serveri → cesta (bez servera), ktorú pošleme prehliadaču. */
function imagePath(url) {
  if (typeof url !== 'string' || !url.startsWith(IMAGE_ORIGIN + '/')) return '';
  return url.slice(IMAGE_ORIGIN.length);
}

const ymd = (s) => (typeof s === 'string' && /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : '');

/** Leták z API Schwarz → { slug, title, name, start, end, pages: [{ n, w, h, image, zoom, thumb }] }. */
export function parseFlyer(slug, body) {
  const f = body && body.flyer;
  if (!f || !Array.isArray(f.pages)) return null;
  const pages = f.pages
    .map((p, i) => ({
      n: Number(p.number) || i + 1,
      w: Number(p.width) || 0,
      h: Number(p.height) || 0,
      image: imagePath(p.image),
      zoom: imagePath(p.zoom) || imagePath(p.image),
      thumb: imagePath(p.thumbnail) || imagePath(p.image),
    }))
    .filter((p) => p.image);
  if (!pages.length) return null;
  return {
    slug,
    title: String(f.title || ''),
    name: String(f.name || ''),
    start: ymd(f.offerStartDate) || ymd(f.startDate),
    end: ymd(f.offerEndDate) || ymd(f.endDate),
    pages,
  };
}

async function fetchFlyer(c, slug) {
  const url = FLYER_API + '?flyer_identifier=' + encodeURIComponent(slug) + '&region_id=0&region_code=0';
  const res = await fetcher(c)(url, { headers: { ...HEADERS, accept: 'application/json' } });
  if (!res.ok) return null;
  return parseFlyer(slug, await res.json());
}

async function readConfig(c, key) {
  const row = await c.db.prepare('SELECT value FROM config WHERE key = ?').bind(key).first();
  try {
    return row ? JSON.parse(row.value) : null;
  } catch {
    return null;
  }
}

const upsert = (c, key, value) =>
  c.db
    .prepare('INSERT INTO config (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value')
    .bind(key, JSON.stringify(value));

/** Stiahne aktuálne letáky z Lidlu a uloží ich (zoznam aj stránky každého letáka). */
async function refresh(c) {
  const slugs = (await findSlugs(c)).slice(0, MAX_FLYERS);
  const flyers = (await Promise.all(slugs.map((s) => fetchFlyer(c, s).catch(() => null)))).filter(
    (f) => f && (!f.end || f.end >= c.today)
  );
  if (!flyers.length) throw new Error('Lidl nevrátil žiadny platný leták.');
  // Najprv platné dnes (novšie skôr), potom tie, čo ešte len začnú.
  const current = (f) => !f.start || f.start <= c.today;
  flyers.sort((a, b) => Number(current(b)) - Number(current(a)) || (current(a) ? b.start.localeCompare(a.start) : a.start.localeCompare(b.start)));
  const list = flyers.map((f) => ({
    slug: f.slug,
    title: f.title,
    name: f.name,
    start: f.start,
    end: f.end,
    pageCount: f.pages.length,
    thumb: f.pages[0].thumb,
  }));
  const cached = { fetched: Date.now(), today: c.today, list };
  await c.db.batch([
    // staré letáky preč
    c.db.prepare("DELETE FROM config WHERE key LIKE 'leaflet:%'"),
    upsert(c, LIST_KEY, cached),
    ...flyers.map((f) => upsert(c, FLYER_KEY + f.slug, f)),
  ]);
  return cached;
}

const imageUrl = (path) => (path ? '/api/leaflets/image?p=' + encodeURIComponent(path) : '');

/** Zoznam aktuálnych letákov Lidl (z pamäte, po pár hodinách sa obnoví). */
export async function getLeaflets(c) {
  let cached = await readConfig(c, LIST_KEY);
  if (!cached || cached.today !== c.today || Date.now() - cached.fetched > REFRESH_MS) {
    try {
      cached = await refresh(c);
    } catch (err) {
      console.error('Letáky Lidl: ' + err);
      if (!cached) throw new AppError('Letáky Lidl sa teraz nedajú načítať. Skús to neskôr.', 502);
    }
  }
  return cached.list
    .filter((f) => !f.end || f.end >= c.today)
    .map((f) => ({ ...f, thumb: imageUrl(f.thumb) }));
}

/** Stránky jedného letáka (obrázky cez náš server). */
export async function getLeaflet(c, slug) {
  slug = String(slug ?? '');
  let flyer = await readConfig(c, FLYER_KEY + slug);
  if (!flyer) {
    await getLeaflets(c); // zoznam mohol medzičasom zastarať
    flyer = await readConfig(c, FLYER_KEY + slug);
  }
  if (!flyer) throw new AppError('Leták už neplatí.', 404);
  return {
    ...flyer,
    pages: flyer.pages.map((p) => ({ ...p, image: imageUrl(p.image), zoom: imageUrl(p.zoom), thumb: imageUrl(p.thumb) })),
  };
}

/** GET /api/leaflets/image?p=<cesta> – obrázok letáka z imgproxy.leaflets.schwarz. */
export async function leafletImage(c, path) {
  path = String(path ?? '');
  let url;
  try {
    url = new URL(path, IMAGE_ORIGIN);
  } catch {
    url = null;
  }
  if (!path.startsWith('/') || !url || url.origin !== IMAGE_ORIGIN) throw new AppError('Neplatný obrázok.', 400);
  const res = await fetcher(c)(url.href, {
    headers: { ...HEADERS, accept: 'image/webp,image/jpeg,image/*' },
    cf: { cacheEverything: true, cacheTtl: 7 * 24 * 3600 },
  });
  const type = res.headers.get('content-type') || '';
  if (!res.ok || !type.startsWith('image/')) throw new AppError('Obrázok letáka sa nedá načítať.', 502);
  return new Response(res.body, {
    headers: { 'content-type': type, 'cache-control': 'private, max-age=604800, immutable' },
  });
}

/** DOČASNÁ diagnostika: ktoré modely Workers AI vedia nájsť produkty na strane letáka. */
export async function debugAi(c, ai) {
  const out = { models: null, runs: [] };
  try {
    const list = await ai.models({ per_page: 200 });
    out.models = list
      .map((m) => m.name)
      .filter((n) => /vision|vl|scout|gemma-3|mistral-small|llava|pixtral|kimi|qwen3|maverick|image-to-text/i.test(n));
  } catch (err) {
    out.models = 'chyba: ' + err;
  }
  const slugs = await findSlugs(c);
  const flyer = await fetchFlyer(c, slugs[0]);
  const page = flyer.pages[Number(c.page || 0)];
  const res = await fetcher(c)(IMAGE_ORIGIN + page.image, { headers: { ...HEADERS, accept: 'image/jpeg' } });
  const bytes = new Uint8Array(await res.arrayBuffer());
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  const dataUrl = 'data:' + (res.headers.get('content-type') || 'image/jpeg') + ';base64,' + btoa(bin);
  out.image = { type: res.headers.get('content-type'), bytes: bytes.length, page: page.n, w: page.w, h: page.h };
  const prompt =
    'This is one page of a Slovak Lidl supermarket leaflet. Find every advertised product offer on the page. ' +
    'For each, return its name exactly as printed (Slovak), the main offer price in EUR as a number, and its bounding box ' +
    'covering the whole offer (picture, name and price) as [x1, y1, x2, y2] in coordinates normalized to 0-1000 ' +
    '(0,0 = top-left of the image). Answer with JSON only: {"products":[{"name":"...","price":1.99,"box":[x1,y1,x2,y2]}]}';
  const candidates = [
    '@cf/meta/llama-4-scout-17b-16e-instruct',
    '@cf/google/gemma-3-12b-it',
    '@cf/mistralai/mistral-small-3.1-24b-instruct',
    ...(Array.isArray(out.models) ? out.models.filter((n) => /qwen.*vl|vl.*qwen|kimi|maverick|pixtral/i.test(n)) : []),
  ];
  out.runs = await Promise.all(
    [...new Set(candidates)].slice(0, 6).map(async (model) => {
      const t = Date.now();
      try {
        const r = await ai.run(model, {
          messages: [
            {
              role: 'user',
              content: [
                { type: 'image_url', image_url: { url: dataUrl } },
                { type: 'text', text: prompt },
              ],
            },
          ],
          max_tokens: 2500,
          temperature: 0,
        });
        const text = typeof r.response === 'string' ? r.response : JSON.stringify(r.response ?? r);
        return { model, ms: Date.now() - t, usage: r.usage, text: text.slice(0, 3500) };
      } catch (err) {
        return { model, ms: Date.now() - t, error: String(err).slice(0, 400) };
      }
    })
  );
  return out;
}
