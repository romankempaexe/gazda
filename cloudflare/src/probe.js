// DOČASNÉ: overenie, či Kimbino ponúka vyhľadávanie ponúk produktu naprieč obchodmi (len náhľad).
const UA = { 'user-agent': 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/126 Mobile Safari/537.36', 'accept-language': 'sk' };

export async function probe(url) {
  const q = url.searchParams.get('q') || 'mlieko';
  const candidates = [
    'https://www.kimbino.sk/vyhladavanie/?q=' + encodeURIComponent(q),
    'https://www.kimbino.sk/hladat/?q=' + encodeURIComponent(q),
    'https://www.kimbino.sk/search/?q=' + encodeURIComponent(q),
    'https://www.kimbino.sk/' + encodeURIComponent(q) + '/',
    'https://www.kimbino.sk/akcie/' + encodeURIComponent(q) + '/',
    'https://www.kimbino.sk/api/search?q=' + encodeURIComponent(q),
  ];
  const out = [];
  for (const u of candidates) {
    try {
      const res = await fetch(u, { headers: UA, redirect: 'follow' });
      const text = await res.text();
      const title = (text.match(/<title>([^<]*)/) || [])[1] || '';
      const nuxt = (text.match(/<script[^>]*id="__NUXT_DATA__"[^>]*>([\s\S]*?)<\/script>/) || [])[1] || '';
      let strings = [];
      try {
        strings = JSON.parse(nuxt).filter((x) => typeof x === 'string');
      } catch {}
      const hits = strings.filter((s) => new RegExp(q.slice(0, 4), 'i').test(s)).slice(0, 25);
      const links = [...new Set([...text.matchAll(/href="(\/[^"#?]{3,80})"/g)].map((m) => m[1]))].slice(0, 40);
      out.push({
        u, status: res.status, final: res.url, title: title.slice(0, 120), len: text.length,
        euro: (text.match(/€/g) || []).length, nuxtLen: nuxt.length, hits,
        sample: strings.filter((s) => /\d+[,.]\d{2}/.test(s)).slice(0, 15), links,
      });
    } catch (e) {
      out.push({ u, error: String(e) });
    }
  }
  return new Response(JSON.stringify(out, null, 1), { headers: { 'content-type': 'application/json' } });
}
