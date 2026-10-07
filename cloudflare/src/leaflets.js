// Letáky obchodov (neoficiálne – rovnaké zdroje, aké používajú ich weby):
// Lidl:
// 1. stránka s letákmi na lidl.sk → identifikátory letákov (slug),
// 2. endpoints.leaflets.schwarz/v4/flyer → stránky letáka s obrázkami a platnosťou.
// Ostatné obchody (Tesco, Kaufland, Billa, …) z agregátora kimbino.sk: stránka obchodu
// → odkazy na letáky, stránka letáka → adresy obrázkov strán (dáta Nuxt) a platnosť.
// Obrázky idú cez náš server (/api/leaflets/image), aby sa z nich v prehliadači
// dali vystrihnúť miniatúry (canvas nesmie byť „zašpinený“ cudzím pôvodom).
//
// Výsledok sa drží v tabuľke config (Cache API na workers.dev nefunguje), takže
// Lidl sa pýtame najviac raz za pár hodín bez ohľadu na počet používateľov.

import { AppError } from './domain.js';

const LIDL = 'https://www.lidl.sk';
const FLYER_API = 'https://endpoints.leaflets.schwarz/v4/flyer';
export const IMAGE_ORIGIN = 'https://imgproxy.leaflets.schwarz';
const KIMBINO = 'https://www.kimbino.sk';
// Servery, z ktorých smie /api/leaflets/image brať obrázky.
const IMAGE_HOSTS = ['imgproxy.leaflets.schwarz', 'eu.kimbicdn.com'];

/** Obchody s letákmi (id = parameter pre getLeaflets). */
export const STORES = [
  { id: 'lidl', name: 'Lidl' },
  { id: 'tesco', name: 'Tesco', kimbino: 'tesco' },
  { id: 'kaufland', name: 'Kaufland', kimbino: 'kaufland' },
  { id: 'billa', name: 'Billa', kimbino: 'billa' },
  { id: 'coop', name: 'Coop Jednota', kimbino: 'coop-jednota' },
  { id: 'terno', name: 'Terno', kimbino: 'terno' },
  { id: 'fresh', name: 'Fresh', kimbino: 'fresh' },
  { id: 'kraj', name: 'Kraj', kimbino: 'kraj' },
  { id: 'metro', name: 'Metro', kimbino: 'metro' },
];
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
    // staré letáky Lidlu a rozpoznané produkty letákov, ktoré už neplatia, preč (k-… sú iné obchody)
    c.db.prepare("DELETE FROM config WHERE key LIKE 'leaflet:%' AND key NOT LIKE 'leaflet:k-%'"),
    c.db
      .prepare(
        `DELETE FROM config WHERE key LIKE 'products:%' AND key NOT LIKE 'products:k-%'
         AND NOT EXISTS (SELECT 1 FROM json_each(?) WHERE config.key LIKE 'products:' || value || ':%')`
      )
      .bind(JSON.stringify(flyers.map((f) => f.slug))),
    upsert(c, LIST_KEY, cached),
    ...flyers.map((f) => upsert(c, FLYER_KEY + f.slug, f)),
  ]);
  return cached;
}

const imageUrl = (path) => (path ? '/api/leaflets/image?p=' + encodeURIComponent(path) : '');

/** Zoznam aktuálnych letákov obchodu (z pamäte, po pár hodinách sa obnoví). */
export async function getLeaflets(c, storeId) {
  const store = findStore(storeId);
  if (store.kimbino) return kimbinoLeaflets(c, store);
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
  if (!flyer && slug.startsWith('k-')) {
    flyer = await loadKimbinoFlyer(c, slug);
  } else if (!flyer) {
    await getLeaflets(c); // zoznam mohol medzičasom zastarať
    flyer = await readConfig(c, FLYER_KEY + slug);
  }
  if (!flyer) throw new AppError('Leták už neplatí.', 404);
  return {
    ...flyer,
    pages: flyer.pages.map((p) => ({ ...p, image: imageUrl(p.image), zoom: imageUrl(p.zoom), thumb: imageUrl(p.thumb) })),
  };
}

/** Obrázok strany: Lidl ukladá cestu na imgproxy, ostatné obchody celú adresu. */
const absImage = (p) => (p.startsWith('/') ? IMAGE_ORIGIN + p : p);

/** GET /api/leaflets/image?p=<cesta alebo adresa> – obrázok letáka (len z povolených serverov). */
export async function leafletImage(c, path) {
  path = String(path ?? '');
  let url;
  try {
    url = new URL(absImage(path));
  } catch {
    url = null;
  }
  const allowed =
    url && url.protocol === 'https:' && IMAGE_HOSTS.includes(url.hostname) && !url.username && !url.port &&
    (path.startsWith('/') ? url.origin === IMAGE_ORIGIN && !/^\/\/|\\/.test(path) : path.startsWith('https://'));
  if (!allowed) throw new AppError('Neplatný obrázok.', 400);
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


// ---- Ostatné obchody cez kimbino.sk ---------------------------------------------------

const KSTORE_KEY = 'kstore:';
const MAX_KIMBINO_FLYERS = 6;
const KIMBINO_IMG = /^https:\/\/eu\.kimbicdn\.com\/thumbor\/[^/]+\/(0x0|full-fit-in\/240x240)\/.*\/sk\/data\/\d+\/(\d+)\/(\d+)\.jpg/;

function findStore(storeId) {
  const store = STORES.find((s) => s.id === String(storeId || 'lidl'));
  if (!store) throw new AppError('Letáky tohto obchodu nepoznám.', 404);
  return store;
}

/** „tesco-hypermarket-letak-od-stredy-07-10-2026“ → „Tesco hypermarket leták od stredy 07.10.2026“ */
function kimbinoTitle(slugPart) {
  const t = slugPart
    .replace(/(\d{2})-(\d{2})-(\d{4})/g, '$1.$2.$3')
    .replace(/-/g, ' ')
    .replace(/\bletak\b/g, 'leták');
  return t.charAt(0).toUpperCase() + t.slice(1);
}

/** Stránka obchodu na Kimbine → [{ slug, store, title, path, thumb }] */
export function parseKimbinoStore(html, store) {
  const re = new RegExp('href="(?:https://www\\.kimbino\\.sk)?/' + store.kimbino + '/([a-z0-9-]+?)-(\\d{5,})/"', 'g');
  const thumbs = [...html.matchAll(/https:\/\/eu\.kimbicdn\.com\/thumbor\/[^"'\s\\]+?\/sk\/data\/\d+\/(\d+)\/0\.jpg[^"'\s\\]*/g)];
  const seen = new Set();
  const list = [];
  for (const m of html.matchAll(re)) {
    const id = m[2];
    if (seen.has(id)) continue;
    seen.add(id);
    const thumb = thumbs.filter((t) => id.endsWith(t[1])).sort((a, b) => Number(/240x240/.test(b[0])) - Number(/240x240/.test(a[0])))[0];
    list.push({
      slug: 'k-' + store.id + '-' + id,
      store: store.id,
      title: kimbinoTitle(m[1]),
      path: '/' + store.kimbino + '/' + m[1] + '-' + id + '/',
      thumb: thumb ? thumb[0].replace(/&amp;/g, '&') : '',
    });
  }
  return list.slice(0, MAX_KIMBINO_FLYERS);
}

/** Reťazce z dát Nuxt (__NUXT_DATA__) na stránke letáka. */
function nuxtStrings(html) {
  const m = html.match(/<script[^>]*id="__NUXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
  if (!m) return [];
  try {
    const data = JSON.parse(m[1]);
    return Array.isArray(data) ? data.filter((v) => typeof v === 'string') : [];
  } catch {
    return [];
  }
}

/** Stránka letáka na Kimbine → { slug, store, title, start, end, pages } */
export function parseKimbinoFlyer(html, entry) {
  const id = entry.slug.split('-').pop();
  const strings = nuxtStrings(html);
  const pages = new Map(); // číslo strany (od 0) -> { image, thumb }
  for (const v of strings) {
    const m = v.match(KIMBINO_IMG);
    if (!m || !id.endsWith(m[2])) continue; // iné letáky (odporúčané) vynechaj
    const n = Number(m[3]);
    const p = pages.get(n) || {};
    if (m[1] === '0x0') p.image = v;
    else p.thumb = v;
    pages.set(n, p);
  }
  const list = [...pages.entries()]
    .filter(([, p]) => p.image)
    .sort((a, b) => a[0] - b[0])
    .map(([n, p]) => ({ n: n + 1, w: 0, h: 0, image: p.image, zoom: p.image, thumb: p.thumb || p.image }));
  if (!list.length) return null;
  const valid = strings.map((v) => v.match(/^(\d{4}-\d{2}-\d{2})T[^/]*\/(\d{4}-\d{2}-\d{2})T/)).find(Boolean);
  const title = (html.match(/<meta[^>]+property="og:title"[^>]+content="([^"]+)"/) || [])[1];
  return {
    slug: entry.slug,
    store: entry.store,
    title: entry.title,
    // og:title je reklamný text („… » Pozrite si zľavy“) – nechaj len začiatok
    name: title ? title.replace(/&amp;/g, '&').replace(/\s*[|»(].*$/, '').trim() : '',
    start: valid ? valid[1] : '',
    end: valid ? valid[2] : '',
    pages: list,
  };
}

async function kimbinoLeaflets(c, store) {
  const key = KSTORE_KEY + store.id;
  let cached = await readConfig(c, key);
  if (!cached || cached.today !== c.today || Date.now() - cached.fetched > REFRESH_MS) {
    try {
      const list = parseKimbinoStore(await getText(c, KIMBINO + '/' + store.kimbino + '/'), store);
      if (!list.length) throw new Error('žiadny leták');
      cached = { fetched: Date.now(), today: c.today, list };
      const slugs = JSON.stringify(list.map((f) => f.slug));
      const prefix = 'k-' + store.id + '-';
      await c.db.batch([
        upsert(c, key, cached),
        // letáky tohto obchodu, ktoré už nie sú v ponuke, preč (aj ich rozpoznané produkty)
        c.db
          .prepare(
            `DELETE FROM config WHERE (key LIKE 'leaflet:' || ? || '%' OR key LIKE 'products:' || ? || '%')
             AND NOT EXISTS (SELECT 1 FROM json_each(?) WHERE config.key = 'leaflet:' || value OR config.key LIKE 'products:' || value || ':%')`
          )
          .bind(prefix, prefix, slugs),
      ]);
    } catch (err) {
      console.error('Letáky ' + store.name + ': ' + err);
      if (!cached) throw new AppError('Letáky ' + store.name + ' sa teraz nedajú načítať. Skús to neskôr.', 502);
    }
  }
  // platnosť a počet strán poznáme, až keď niekto leták otvorí
  const out = [];
  for (const f of cached.list) {
    const flyer = await readConfig(c, FLYER_KEY + f.slug);
    if (flyer && flyer.end && flyer.end < c.today) continue;
    out.push({
      slug: f.slug,
      store: f.store,
      title: f.title,
      name: flyer ? flyer.name : '',
      start: flyer ? flyer.start : '',
      end: flyer ? flyer.end : '',
      pageCount: flyer ? flyer.pages.length : null,
      thumb: imageUrl(f.thumb),
    });
  }
  return out;
}

async function loadKimbinoFlyer(c, slug) {
  const storeId = slug.split('-')[1];
  const store = STORES.find((s) => s.id === storeId && s.kimbino);
  if (!store) return null;
  const cachedList = (await readConfig(c, KSTORE_KEY + store.id)) || (await kimbinoLeaflets(c, store), await readConfig(c, KSTORE_KEY + store.id));
  const entry = cachedList && cachedList.list.find((f) => f.slug === slug);
  if (!entry) return null;
  let html = '';
  try {
    html = await getText(c, KIMBINO + entry.path);
  } catch (err) {
    console.error('Leták ' + slug + ': ' + err);
  }
  const flyer = html && parseKimbinoFlyer(html, entry);
  if (!flyer) throw new AppError('Leták sa nepodarilo načítať. Skús to neskôr.', 502);
  await upsert(c, FLYER_KEY + slug, flyer).run();
  return flyer;
}

// ---- Rozpoznanie produktov na strane (Workers AI) -----------------------------------

export const PRODUCTS_MODEL = '@cf/meta/llama-4-scout-17b-16e-instruct';
const PRODUCTS_KEY = 'products:';
const RETRY_EMPTY_MS = 30 * 60 * 1000;
// Workers AI zadarmo: 10 000 „neurónov“ denne (UTC), strana ~80. Na prípravu vopred
// ide najviac 7 000 – zvyšok ostáva na strany, ktoré si niekto otvorí hneď.
const NEURONS_PER_PAGE = 80;
const BACKGROUND_NEURONS = 7000;
const BUDGET_KEY = 'ai_neurons';
const PRODUCTS_VERSION = 3; // zvýšiť pri zmene čítania odpovede – staré výsledky sa rozpoznajú znova
const PRODUCTS_PROMPT =
  'This is one page of a Slovak supermarket leaflet. Find every advertised product offer on the page ' +
  '(ignore logos, headlines, opening hours and coupons). For each offer return its product name exactly as printed ' +
  '(Slovak, including the pack size if printed, e.g. "Mascarpone 500 g"), the main offer price in EUR as a number, ' +
  'and a bounding box that tightly covers the whole offer - the product photo, its name and its price tag - ' +
  'as [x1, y1, x2, y2] in fractions of the image width and height (0 to 1, 0,0 = top-left). Boxes of different ' +
  'offers must not overlap. Answer with JSON only: [{"name":"...","price":1.99,"box":[x1,y1,x2,y2]}]';

/** Prvý JSON (pole alebo objekt) v texte odpovede modelu. */
function extractJson(text) {
  if (text && typeof text === 'object') return text;
  // Llama občas uzavrie súradnice značkou namiesto zátvorky: [0.1,0.2,0.3,0.4</BBOX>}
  text = String(text ?? '').replace(/<\/?\s*(?:bbox|box)\s*>\s*\]?/gi, ']');
  // najprv tá zátvorka, ktorá je v texte skôr (objekt s poľom „box“ nie je pole)
  const pairs = [['[', ']'], ['{', '}']];
  if (text.indexOf('{') !== -1 && (text.indexOf('[') === -1 || text.indexOf('{') < text.indexOf('['))) pairs.reverse();
  for (const [open, close] of pairs) {
    const a = text.indexOf(open);
    const b = text.lastIndexOf(close);
    if (a !== -1 && b > a) {
      try {
        return JSON.parse(text.slice(a, b + 1));
      } catch {
        // skús druhý tvar
      }
    }
  }
  // Odrezaná alebo pokazená odpoveď: prečítaj aspoň jednotlivé záznamy {…} – najprv ako
  // JSON, inak po kúskoch (názov, cena a štyri čísla ohraničenia).
  const items = [];
  for (const m of text.matchAll(/\{[^{}]*\}?/g)) {
    try {
      items.push(JSON.parse(m[0].replace(/,\s*\}$/, '}')));
      continue;
    } catch {
      // skús po kúskoch
    }
    const name = m[0].match(/"(?:name|title)"\s*:\s*"((?:[^"\\]|\\.)*)"/);
    const price = m[0].match(/"price"\s*:\s*"?(\d+(?:[.,]\d+)?)/);
    const box = m[0].match(/"(?:box|bbox)"\s*:\s*\[?\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)/);
    if (!name || !box) continue;
    let decoded = name[1];
    try {
      decoded = JSON.parse('"' + name[1] + '"');
    } catch {
      // necháme ako je
    }
    items.push({ name: decoded, price: price ? price[1].replace(',', '.') : '', box: box.slice(1, 5).map(Number) });
  }
  return items.length ? items : null;
}

/**
 * Odpoveď modelu → [{ name, price, box: [x1, y1, x2, y2] (0–1) }]. Modely občas
 * vrátia súradnice v tisícinách alebo v pixeloch, prehodené rohy či nezmysly.
 */
export function parseProducts(raw, w, h, maxArea = 0.85) {
  let data = extractJson(raw);
  if (data && !Array.isArray(data)) data = data.products || data.offers || data.items || (data.name ? [data] : null);
  if (!Array.isArray(data)) return [];
  const boxOf = (p) => (Array.isArray(p.box) ? p.box : Array.isArray(p.bbox) ? p.bbox : Array.isArray(p.bounding_box) ? p.bounding_box : null);
  // Mierka súradníc pre celú odpoveď: zlomky (0–1), tisíciny, alebo pixely obrázka (w × h).
  const boxes = data.map((p) => (p && typeof p === 'object' && boxOf(p) ? boxOf(p).map(Number) : [])).filter((b) => b.length === 4 && b.every(Number.isFinite));
  const maxX = Math.max(0, ...boxes.flatMap((b) => [b[0], b[2]]));
  const maxY = Math.max(0, ...boxes.flatMap((b) => [b[1], b[3]]));
  const max = Math.max(maxX, maxY);
  let scale = null;
  if (max > 1.5) {
    const fitsPx = Boolean(w && h) && maxX <= w * 1.05 && maxY <= h * 1.05;
    const fitsK = max <= 1020;
    // Obe sedia (napr. pixely obrázka 707 × 1200 pod 1000): produkty pokrývajú skoro celú stranu,
    // takže vyhráva výklad, pri ktorom siahajú bližšie k jej okraju.
    if (fitsPx && fitsK) scale = Math.abs(1 - Math.max(maxX / w, maxY / h)) <= Math.abs(1 - max / 1000) ? 'px' : 'k';
    else scale = fitsPx ? 'px' : 'k';
  }
  const out = [];
  for (const p of data) {
    if (!p || typeof p !== 'object') continue;
    const name = String(p.name ?? p.title ?? p.product ?? '').replace(/\s+/g, ' ').trim().slice(0, 100);
    let box = boxOf(p) ? boxOf(p).map(Number) : null;
    if (!name || !box || box.length !== 4 || box.some((v) => !Number.isFinite(v))) continue;
    if (scale === 'k') box = box.map((v) => v / 1000);
    if (scale === 'px') box = [box[0] / w, box[1] / h, box[2] / w, box[3] / h];
    let [x1, y1, x2, y2] = box.map((v) => Math.min(1, Math.max(0, v)));
    if (x1 > x2) [x1, x2] = [x2, x1];
    if (y1 > y2) [y1, y2] = [y2, y1];
    // príliš malé (bod, čiara) alebo skoro celá strana – zlé ohraničenie
    if (x2 - x1 < 0.04 || y2 - y1 < 0.025 || (x2 - x1) * (y2 - y1) > maxArea) continue;
    const priceNum = typeof p.price === 'number' ? p.price : parseFloat(String(p.price ?? '').replace(',', '.'));
    const price = Number.isFinite(priceNum) && priceNum > 0 && priceNum < 10000 ? priceNum.toFixed(2) : '';
    const round = (v) => Math.round(v * 1000) / 1000;
    const item = { name, price, box: [x1, y1, x2, y2].map(round) };
    if (!out.some((o) => o.name === item.name && o.box.join() === item.box.join())) out.push(item);
  }
  return out.slice(0, 40);
}

/** Šírka a výška obrázka z hlavičky JPEG / PNG / WebP (bez dekódovania), inak null. */
export function imageSize(b) {
  const u16 = (i) => (b[i] << 8) | b[i + 1];
  const le16 = (i) => b[i] | (b[i + 1] << 8);
  const le24 = (i) => b[i] | (b[i + 1] << 8) | (b[i + 2] << 16);
  if (b.length > 24 && b[0] === 0x89 && b[1] === 0x50) {
    return { w: (b[16] << 24) | (b[17] << 16) | u16(18), h: (b[20] << 24) | (b[21] << 16) | u16(22) };
  }
  if (b.length > 30 && b[0] === 0x52 && b[1] === 0x49 && b[8] === 0x57 && b[9] === 0x45) {
    const chunk = String.fromCharCode(b[12], b[13], b[14], b[15]);
    if (chunk === 'VP8 ') return { w: le16(26) & 0x3fff, h: le16(28) & 0x3fff };
    if (chunk === 'VP8L') {
      const bits = b[21] | (b[22] << 8) | (b[23] << 16) | (b[24] << 24);
      return { w: (bits & 0x3fff) + 1, h: ((bits >> 14) & 0x3fff) + 1 };
    }
    if (chunk === 'VP8X') return { w: le24(24) + 1, h: le24(27) + 1 };
    return null;
  }
  if (b[0] === 0xff && b[1] === 0xd8) {
    let i = 2;
    while (i + 9 < b.length) {
      if (b[i] !== 0xff) return null;
      const marker = b[i + 1];
      if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) return { w: u16(i + 7), h: u16(i + 5) };
      i += 2 + u16(i + 2);
    }
  }
  return null;
}

function toBase64(bytes) {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

/**
 * Produkty na strane letáka (index strany od 0). Rozpozná ich AI pri prvom otvorení
 * strany kýmkoľvek a výsledok sa uloží – ďalší ich dostanú hneď a bez spotreby limitu.
 */
export async function analyzeLeafletPage(c, slug, pageIndex, background) {
  slug = String(slug ?? '');
  const flyer = await readConfig(c, FLYER_KEY + slug);
  const page = flyer && flyer.pages[Number(pageIndex)];
  if (!page) throw new AppError('Leták už neplatí.', 404);
  const key = PRODUCTS_KEY + slug + ':' + page.n;
  const cached = await readConfig(c, key);
  // Prázdny výsledok (model nič nenašiel alebo odpovedal nezmyselne) sa po chvíli skúsi znova.
  if (cached && cached.v === PRODUCTS_VERSION && (cached.products.length || Date.now() - Date.parse(cached.at) < RETRY_EMPTY_MS)) {
    return cached.products;
  }
  if (!c.ai) throw new AppError('Rozpoznávanie produktov nie je dostupné.', 503);
  // Príprava strán vopred (na pozadí) smie minúť len časť denného bezplatného limitu.
  if (background && (await neuronsToday(c)) >= BACKGROUND_NEURONS) return null;

  const res = await fetcher(c)(absImage(page.image), { headers: { ...HEADERS, accept: 'image/jpeg' } });
  if (!res.ok) throw new AppError('Stranu letáka sa nepodarilo načítať.', 502);
  const type = (res.headers.get('content-type') || 'image/jpeg').split(';')[0];
  const bytes = new Uint8Array(await res.arrayBuffer());
  const dataUrl = 'data:' + type + ';base64,' + toBase64(bytes);
  // Skutočná veľkosť obrázka (z hlavičky) – podľa nej sa prepočítajú súradnice v pixeloch.
  const fit = Math.min(1, 1200 / Math.max(page.w || 1, page.h || 1));
  const size = imageSize(bytes) || { w: Math.round((page.w || 0) * fit), h: Math.round((page.h || 0) * fit) };
  let answer;
  const started = Date.now();
  try {
    answer = await c.ai.run(PRODUCTS_MODEL, {
      messages: [{ role: 'user', content: [{ type: 'image_url', image_url: { url: dataUrl } }, { type: 'text', text: PRODUCTS_PROMPT + (size.w ? ' (The image is ' + size.w + ' x ' + size.h + ' pixels.)' : '') }] }],
      max_tokens: 4000,
      temperature: 0,
    });
  } catch (err) {
    console.error('Rozpoznávanie produktov: ' + err);
    if (/4006|neurons|daily|limit/i.test(String(err))) {
      throw new AppError('Dnešný bezplatný limit rozpoznávania je vyčerpaný. Tovar zatiaľ zakrúžkuj prstom.', 429);
    }
    throw new AppError('Produkty sa teraz nepodarilo rozpoznať. Tovar môžeš zakrúžkovať prstom.', 502);
  }
  await addNeurons(c, Number(answer && answer.usage && answer.usage.neurons) || NEURONS_PER_PAGE);
  const response = answer && answer.response;
  const products = parseProducts(response, size.w, size.h);
  const raw = typeof response === 'string' ? response : JSON.stringify(response ?? null);
  await c.db
    .prepare('INSERT INTO config (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value')
    .bind(
      key,
      JSON.stringify({
        products,
        v: PRODUCTS_VERSION,
        model: PRODUCTS_MODEL,
        at: new Date().toISOString(),
        ms: Date.now() - started,
        // pri prázdnom výsledku si necháme odpoveď modelu na rozbor
        // pri prázdnom výsledku si necháme odpoveď modelu na rozbor
        ...(!products.length && { raw: raw.slice(0, 3000) }),
      })
    )
    .run();
  return products;
}

const utcDay = () => new Date().toISOString().slice(0, 10);

// ---- Ťuknutie na produkt: AI rozpozná produkt vo výreze okolo prsta ---------------------

const IDENTIFY_PROMPT =
  'This is a cut-out from a page of a Slovak supermarket leaflet; the user tapped its center. ' +
  'Identify the ONE product offer closest to the center of the image. Return its name exactly as printed ' +
  '(Slovak, including the pack size if printed), the offer price in EUR as a number, and a bounding box ' +
  'tightly covering that offer (photo, name and price tag) as [x1, y1, x2, y2] in fractions (0 to 1) of this image. ' +
  'Answer with JSON only: {"name":"...","price":1.99,"box":[x1,y1,x2,y2]}. If there is no product, answer {"name":""}.';
const DAILY_NEURONS = 9800; // Workers AI zadarmo: 10 000 denne – kúsok rezervy

/**
 * Produkt, na ktorý človek ťukol: prehliadač pošle výrez okolo prsta (data URL), AI vráti
 * { name, price, box } (box v zlomkoch výrezu, alebo null), prípadne null, ak tam nič nie je.
 */
export async function identifyLeafletProduct(c, image) {
  image = String(image ?? '');
  if (image.length > 240_000 || !/^data:image\/(jpeg|webp|png);base64,[A-Za-z0-9+/]+=*$/.test(image)) {
    throw new AppError('Neplatný obrázok.');
  }
  if (!c.ai) throw new AppError('Rozpoznávanie produktov nie je dostupné.', 503);
  if ((await neuronsToday(c)) >= DAILY_NEURONS) {
    throw new AppError('Dnešný bezplatný limit rozpoznávania je vyčerpaný. Tovar zatiaľ zakrúžkuj prstom.', 429);
  }
  let answer;
  try {
    answer = await c.ai.run(PRODUCTS_MODEL, {
      messages: [{ role: 'user', content: [{ type: 'image_url', image_url: { url: image } }, { type: 'text', text: IDENTIFY_PROMPT }] }],
      max_tokens: 200, // krátka odpoveď = rýchlejšie
      temperature: 0,
    });
  } catch (err) {
    console.error('Ťuknutie na produkt: ' + err);
    if (/4006|neurons|daily|limit/i.test(String(err))) {
      throw new AppError('Dnešný bezplatný limit rozpoznávania je vyčerpaný. Tovar zatiaľ zakrúžkuj prstom.', 429);
    }
    throw new AppError('Produkt sa teraz nepodarilo rozpoznať. Skús to znova alebo ho zakrúžkuj.', 502);
  }
  await addNeurons(c, Number(answer && answer.usage && answer.usage.neurons) || NEURONS_PER_PAGE / 2);
  const response = answer && answer.response;
  // veľkosť výrezu stačí prečítať zo začiatku súboru (hlavička)
  const head = image.slice(image.indexOf(',') + 1).slice(0, 4096).replace(/=+$/, '');
  const bytes = Uint8Array.from(atob(head.slice(0, head.length - (head.length % 4))), (ch) => ch.charCodeAt(0));
  const size = imageSize(bytes) || { w: 0, h: 0 };
  const [found] = parseProducts(response, size.w, size.h, 1);
  if (found) return found;
  // bez použiteľného ohraničenia – aspoň názov a cena
  const data = extractJson(response);
  const one = Array.isArray(data) ? data[0] : data && (data.products ? data.products[0] : data);
  const name = one && typeof one === 'object' ? String(one.name ?? '').replace(/\s+/g, ' ').trim().slice(0, 100) : '';
  if (!name) return null;
  const priceNum = typeof one.price === 'number' ? one.price : parseFloat(String(one.price ?? '').replace(',', '.'));
  return { name, price: Number.isFinite(priceNum) && priceNum > 0 && priceNum < 10000 ? priceNum.toFixed(2) : '', box: null };
}

/** Koľko neurónov Workers AI sme dnes (UTC) minuli. */
async function neuronsToday(c) {
  const b = await readConfig(c, BUDGET_KEY);
  return b && b.day === utcDay() ? b.neurons : 0;
}

async function addNeurons(c, neurons) {
  const day = utcDay();
  await c.db
    .prepare(
      `INSERT INTO config (key, value) VALUES (?, json_object('day', ?, 'neurons', ?))
       ON CONFLICT (key) DO UPDATE SET value = CASE WHEN json_extract(config.value, '$.day') = ?
         THEN json_set(config.value, '$.neurons', json_extract(config.value, '$.neurons') + ?)
         ELSE excluded.value END`
    )
    .bind(BUDGET_KEY, day, neurons, day, neurons)
    .run();
}

/**
 * Cron: postupne rozpozná produkty na stranách aktuálnych letákov, ktoré ešte nikto
 * neotvoril (najviac `max` strán naraz, v rámci limitu na prípravu vopred).
 * Vráti počet rozpoznaných strán.
 */
export async function preanalyzeLeaflets(c, max = 4) {
  if (!c.ai) return 0;
  const list = await getLeaflets(c);
  // ostatné obchody len ak si ich už niekto otvoril (zoznam je v pamäti) – bez sťahovania navyše
  for (const store of STORES.filter((s) => s.kimbino)) {
    const cachedList = await readConfig(c, KSTORE_KEY + store.id);
    if (cachedList) list.push(...cachedList.list);
  }
  const { results } = await c.db
    .prepare(
      `SELECT key, json_extract(value, '$.v') AS v, json_array_length(value, '$.products') AS n,
              json_extract(value, '$.at') AS at FROM config WHERE key LIKE 'products:%'`
    )
    .all();
  const done = new Set(
    results
      .filter((r) => r.v === PRODUCTS_VERSION && (r.n > 0 || Date.now() - Date.parse(r.at) < RETRY_EMPTY_MS))
      .map((r) => r.key)
  );
  let count = 0;
  for (const f of list) {
    const flyer = await readConfig(c, FLYER_KEY + f.slug);
    if (!flyer) continue;
    for (let i = 0; i < flyer.pages.length && count < max; i++) {
      if (done.has(PRODUCTS_KEY + f.slug + ':' + flyer.pages[i].n)) continue;
      let result;
      try {
        result = await analyzeLeafletPage(c, f.slug, i, true);
      } catch (err) {
        if (err.status === 429) return count; // denný limit Cloudflare je vyčerpaný
        result = []; // chybná strana nezablokuje ostatné, skúsi sa pri ďalšom behu
      }
      if (result === null) return count; // denný limit na prípravu vopred je minutý
      count++;
    }
    if (count >= max) break;
  }
  return count;
}
