// Service worker Gazdu: aplikácia sa otvorí aj bez internetu (posledná verzia
// stránky + posledné údaje z pamäte telefónu). Vo fáze 4 pribudnú push notifikácie.
//
// Stratégia: najprv sieť (aby sa nové verzie prejavili hneď), pri výpadku pamäť.
// Volania /api/* sa neukladajú nikdy.

const CACHE = 'gazda-v1';
const SHELL = ['/', '/app.css', '/app.js', '/produkty.js', '/icons/icon.svg'];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== location.origin || url.pathname.startsWith('/api/')) return;
  // Hlavná stránka sa ukladá pod „/“ bez osobného kľúča v adrese.
  const key = req.mode === 'navigate' && url.pathname === '/' ? '/' : req;
  event.respondWith(
    fetch(req)
      .then((res) => {
        if (res.ok && url.pathname !== '/manifest.webmanifest') {
          const copy = res.clone();
          caches.open(CACHE).then((cache) => cache.put(key, copy));
        }
        return res;
      })
      .catch(() => caches.match(key).then((hit) => hit || Response.error()))
  );
});
