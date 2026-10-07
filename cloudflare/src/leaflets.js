// Letáky Lidl (neoficiálne – rovnaké zdroje, aké používa web lidl.sk):
// 1. stránka s letákmi na lidl.sk → identifikátory letákov (slug),
// 2. endpoints.leaflets.schwarz/v4/flyer → stránky letáka s obrázkami a platnosťou.
// Obrázky idú cez náš server (/api/leaflets/image), aby sa z nich v prehliadači
// dali vystrihnúť miniatúry (canvas nesmie byť „zašpinený“ cudzím pôvodom).

const LIDL = 'https://www.lidl.sk';
const FLYER_API = 'https://endpoints.leaflets.schwarz/v4/flyer';
const HEADERS = {
  'user-agent': 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Mobile Safari/537.36',
  'accept-language': 'sk-SK,sk;q=0.9',
};
const LISTING_RE = /href="((?:https:\/\/www\.lidl\.sk)?\/c\/[^"]*let[aá]k[^"]*\/s\d+[^"]*)"/gi;
const SLUG_RE = /\/l\/sk\/[a-z0-9-]+\/([a-z0-9-]{6,})(?=[/"?])/gi;

async function getText(url) {
  const res = await fetch(url, { headers: HEADERS, redirect: 'follow' });
  return { status: res.status, text: res.ok ? await res.text() : '' };
}

/** Diagnostika celého reťazca (len na overenie, že zdroj funguje). */
export async function debugLidl() {
  const out = { steps: [] };
  try {
    const home = await getText(LIDL + '/');
    const listings = [...new Set([...home.text.matchAll(LISTING_RE)].map((m) => m[1]))];
    out.steps.push({ step: 'home', status: home.status, length: home.text.length, listings: listings.slice(0, 5) });
    const listingUrl = listings[0] ? new URL(listings[0], LIDL).href : null;
    if (!listingUrl) return out;
    const listing = await getText(listingUrl);
    const slugs = [...new Set([...listing.text.matchAll(SLUG_RE)].map((m) => m[1]))];
    out.steps.push({ step: 'listing', url: listingUrl, status: listing.status, length: listing.text.length, slugs: slugs.slice(0, 10) });
    for (const slug of slugs.slice(0, 2)) {
      const res = await fetch(`${FLYER_API}?flyer_identifier=${encodeURIComponent(slug)}&region_id=0&region_code=0`, { headers: HEADERS });
      const body = res.ok ? await res.json().catch(() => null) : null;
      const f = body && body.flyer;
      out.steps.push({
        step: 'flyer',
        slug,
        status: res.status,
        keys: f ? Object.keys(f).slice(0, 40) : null,
        title: f && (f.title || f.name),
        valid: f && [f.offerStartDate, f.offerEndDate, f.startDate, f.endDate],
        pages: f && f.pages ? f.pages.length : null,
        page1: f && f.pages && f.pages[0] ? Object.fromEntries(Object.entries(f.pages[0]).map(([k, v]) => [k, typeof v === 'string' ? v.slice(0, 160) : Array.isArray(v) ? 'array(' + v.length + ')' : typeof v])) : null,
      });
    }
  } catch (err) {
    out.error = String(err);
  }
  return out;
}
