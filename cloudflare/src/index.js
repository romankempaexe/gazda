/**
 * Gazda na Cloudflare Workers.
 *
 * Statické súbory (public/) obsluhuje Cloudflare priamo, sem prichádzajú len
 * požiadavky na /api/*. Údaje sú v databáze D1 (env.DB).
 */

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname.startsWith('/api/')) return handleApi(request, env, url);
    return env.ASSETS.fetch(request);
  },
};

async function handleApi(request, env, url) {
  try {
    if (url.pathname === '/api/health' && request.method === 'GET') {
      return json({ ok: true, ...(await health(env)) });
    }
    return json({ error: 'Neznáma požiadavka.' }, 404);
  } catch (err) {
    console.error(err);
    return json({ error: 'Chyba servera.' }, 500);
  }
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
