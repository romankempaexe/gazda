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
    // staré letáky a rozpoznané produkty letákov, ktoré už neplatia, preč
    c.db.prepare("DELETE FROM config WHERE key LIKE 'leaflet:%'"),
    c.db
      .prepare(
        `DELETE FROM config WHERE key LIKE 'products:%'
         AND NOT EXISTS (SELECT 1 FROM json_each(?) WHERE config.key LIKE 'products:' || value || ':%')`
      )
      .bind(JSON.stringify(flyers.map((f) => f.slug))),
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


// ---- Rozpoznanie produktov na strane (Workers AI) -----------------------------------

export const PRODUCTS_MODEL = '@cf/meta/llama-4-scout-17b-16e-instruct';
const PRODUCTS_KEY = 'products:';
const RETRY_EMPTY_MS = 30 * 60 * 1000;
// Workers AI zadarmo: 10 000 „neurónov“ denne (UTC), strana ~80. Na prípravu vopred
// ide najviac 7 000 – zvyšok ostáva na strany, ktoré si niekto otvorí hneď.
const NEURONS_PER_PAGE = 80;
const BACKGROUND_NEURONS = 7000;
const BUDGET_KEY = 'ai_neurons';
const PRODUCTS_VERSION = 2; // zvýšiť pri zmene čítania odpovede – staré výsledky sa rozpoznajú znova
const PRODUCTS_PROMPT =
  'This is one page of a Slovak Lidl supermarket leaflet. Find every advertised product offer on the page ' +
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
  for (const [open, close] of [['[', ']'], ['{', '}']]) {
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
    const box = m[0].match(/"(?:box|bbox)"\s*:\s*\[\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)/);
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
export function parseProducts(raw, w, h) {
  let data = extractJson(raw);
  if (data && !Array.isArray(data)) data = data.products || data.offers || data.items || null;
  if (!Array.isArray(data)) return [];
  const boxOf = (p) => (Array.isArray(p.box) ? p.box : Array.isArray(p.bbox) ? p.bbox : Array.isArray(p.bounding_box) ? p.bounding_box : null);
  // Mierka súradníc pre celú odpoveď: zlomky (0–1), tisíciny, alebo pixely obrázka, ktorý model videl (w × h).
  const all = data.flatMap((p) => (p && typeof p === 'object' && boxOf(p) ? boxOf(p).map(Number) : [])).filter(Number.isFinite);
  const max = all.length ? Math.max(...all) : 0;
  const scale = max <= 1.5 ? null : max > 1000 && w && h ? 'px' : 'k';
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
    if (x2 - x1 < 0.04 || y2 - y1 < 0.025 || (x2 - x1) * (y2 - y1) > 0.85) continue;
    const priceNum = typeof p.price === 'number' ? p.price : parseFloat(String(p.price ?? '').replace(',', '.'));
    const price = Number.isFinite(priceNum) && priceNum > 0 && priceNum < 10000 ? priceNum.toFixed(2) : '';
    const round = (v) => Math.round(v * 1000) / 1000;
    const item = { name, price, box: [x1, y1, x2, y2].map(round) };
    if (!out.some((o) => o.name === item.name && o.box.join() === item.box.join())) out.push(item);
  }
  return out.slice(0, 40);
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

  const res = await fetcher(c)(IMAGE_ORIGIN + page.image, { headers: { ...HEADERS, accept: 'image/jpeg' } });
  if (!res.ok) throw new AppError('Stranu letáka sa nepodarilo načítať.', 502);
  const type = (res.headers.get('content-type') || 'image/jpeg').split(';')[0];
  const dataUrl = 'data:' + type + ';base64,' + toBase64(new Uint8Array(await res.arrayBuffer()));
  let answer;
  const started = Date.now();
  try {
    answer = await c.ai.run(PRODUCTS_MODEL, {
      messages: [{ role: 'user', content: [{ type: 'image_url', image_url: { url: dataUrl } }, { type: 'text', text: PRODUCTS_PROMPT }] }],
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
  // Obrázok strany je zmenšený na najviac 1200 × 1200 px – v tých pixeloch model súradnice vidí.
  const fit = Math.min(1, 1200 / Math.max(page.w || 1, page.h || 1));
  const products = parseProducts(response, Math.round((page.w || 0) * fit), Math.round((page.h || 0) * fit));
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
        ...(!products.length && { raw: raw.slice(0, 3000) }),
      })
    )
    .run();
  return products;
}

const utcDay = () => new Date().toISOString().slice(0, 10);

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

/** DOČASNÁ diagnostika: obrázky strán letákov na Kimbine a v Bille. */
export async function debugStores() {
  const get = async (url) => {
    const res = await fetch(url, { headers: HEADERS, redirect: 'follow' });
    return { status: res.status, final: res.url, text: await res.text() };
  };
  const uniq = (text, re, n = 40) => [...new Set([...text.matchAll(re)].map((m) => m[1] || m[0]))].slice(0, n);
  const nuxtStrings = (html) => {
    const m = html.match(/<script[^>]*id="__NUXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
    if (!m) return [];
    try {
      return JSON.parse(m[1]).filter((v) => typeof v === 'string');
    } catch {
      return ['parse error'];
    }
  };
  const out = {};
  try {
    const home = await get('https://www.kimbino.sk/');
    out.kimbinoStores = uniq(home.text, /href="\/([a-z0-9-]+)\/"/g, 80);
    const lf = await get('https://www.kimbino.sk/tesco/tesco-hypermarket-letak-od-stredy-07-10-2026-6132237/');
    const strs = nuxtStrings(lf.text);
    out.nuxtCount = strs.length;
    out.images = strs.filter((v) => /\.(jpe?g|webp|png)|leafletscdn|\/page/i.test(v)).slice(0, 25);
    out.dates = strs.filter((v) => /^\d{4}-\d{2}-\d{2}/.test(v)).slice(0, 10);
    out.keys = [...new Set(lf.text.match(/\\?"[a-z_]{3,30}\\?":/g) || [])].slice(0, 120).join(' ');
    out.apis = uniq(lf.text, /((?:https?:)?\/\/[a-z0-9.-]+\/api\/[^"'\s<>\\]+)/gi, 15);
    const page2 = await get('https://www.kimbino.sk/tesco/tesco-hypermarket-letak-od-stredy-07-10-2026-6132237/2/');
    out.page2 = { status: page2.status, images: nuxtStrings(page2.text).filter((v) => /\.(jpe?g|webp|png)|leafletscdn/i.test(v)).slice(0, 8) };
    out.ogImage = uniq(lf.text, /<meta[^>]+property="og:image"[^>]+content="([^"]+)"/g, 3);
  } catch (err) {
    out.kimbinoError = String(err);
  }
  try {
    const billa = await get('https://www.billa.sk/letaky-a-akcie/letaky');
    out.billa = { status: billa.status, length: billa.text.length,
      links: uniq(billa.text, /href="([^"]*(?:letak|publitas|view|pdf)[^"]*)"/gi, 20),
      iframes: uniq(billa.text, /<iframe[^>]+src="([^"]+)"/gi, 10),
      files: uniq(billa.text, /((?:https?:)?\/\/[^"'\s<>]+?\.(?:pdf|jpe?g|png|webp))/gi, 10) };
  } catch (err) {
    out.billaError = String(err);
  }
  return out;
}
