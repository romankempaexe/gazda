// DOČASNÉ: štruktúra ponúk produktu na Kimbino (len náhľad).
const UA = { 'user-agent': 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/126 Mobile Safari/537.36', 'accept-language': 'sk' };
const WRAP = new Set(['Reactive', 'ShallowReactive', 'Ref', 'ShallowRef', 'EmptyRef', 'EmptyShallowRef', 'Set', 'Map', 'Date', 'NuxtError', 'Island']);

function hydrate(arr) {
  const cache = new Map();
  const h = (i) => {
    if (typeof i !== 'number' || i < 0) return undefined;
    if (cache.has(i)) return cache.get(i);
    const v = arr[i];
    if (v === null || typeof v !== 'object') return cache.set(i, v), v;
    if (Array.isArray(v)) {
      if (typeof v[0] === 'string' && WRAP.has(v[0])) {
        const r = v[0] === 'Date' ? v[1] : h(v[1]);
        return cache.set(i, r), r;
      }
      const out = [];
      cache.set(i, out);
      v.forEach((x) => out.push(h(x)));
      return out;
    }
    const o = {};
    cache.set(i, o);
    for (const k of Object.keys(v)) o[k] = h(v[k]);
    return o;
  };
  return h(0);
}

function shallow(o, depth) {
  if (o === null || typeof o !== 'object') return typeof o === 'string' ? o.slice(0, 90) : o;
  if (depth <= 0) return Array.isArray(o) ? '[' + o.length + ']' : '{' + Object.keys(o).slice(0, 12).join(',') + '}';
  if (Array.isArray(o)) return o.slice(0, 3).map((x) => shallow(x, depth - 1));
  const r = {};
  for (const k of Object.keys(o).slice(0, 30)) r[k] = shallow(o[k], depth - 1);
  return r;
}

export async function probe(url) {
  const q = url.searchParams.get('q') || 'mlieko';
  const res = await fetch('https://www.kimbino.sk/hladat/?q=' + encodeURIComponent(q), { headers: UA, redirect: 'follow' });
  const html = await res.text();
  const raw = (html.match(/<script[^>]*id="__NUXT_DATA__"[^>]*>([\s\S]*?)<\/script>/) || [])[1] || '[]';
  const root = hydrate(JSON.parse(raw));
  const found = [];
  const seen = new Set();
  const walk = (o, path) => {
    if (!o || typeof o !== 'object' || seen.has(o) || found.length >= 5) return;
    seen.add(o);
    if (!Array.isArray(o)) {
      const vals = Object.values(o);
      const hasName = vals.some((v) => typeof v === 'string' && v.toLowerCase().includes(q.slice(0, 4)) && v.length < 120);
      const hasPrice = Object.keys(o).some((k) => /price|cena/i.test(k));
      if (hasName && hasPrice) {
        found.push({ path, obj: shallow(o, 2) });
        return;
      }
    }
    for (const [k, v] of Object.entries(o)) walk(v, path + '.' + k);
  };
  walk(root, '$');
  return new Response(JSON.stringify({ status: res.status, final: res.url, found }, null, 1), { headers: { 'content-type': 'application/json' } });
}
