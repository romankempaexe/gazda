// Service worker Family Grid (jeden pre rozcestník aj všetky podaplikácie):
// - aplikácia sa otvorí aj bez internetu (posledná verzia stránky + posledné údaje z pamäte telefónu),
// - push notifikácie – každá podaplikácia s vlastnou ikonou (Gazda, Zdravko, Skládko).
//
// Stratégia: najprv sieť (aby sa nové verzie prejavili hneď), pri výpadku pamäť.
// Volania /api/* sa neukladajú nikdy.

const CACHE = 'family-grid-v1';
const APPS = ['family', 'gazda', 'zdravko', 'skladko'];
const SHELL = [
  '/',
  '/shared/app.css',
  '/shared/fg.js',
  '/shared/fg.css',
  '/grid.js',
  '/gazda/',
  '/gazda/app.js',
  '/gazda/produkty.js',
  '/gazda/letaky.js',
  ...APPS.flatMap((a) => ['/icons/' + a + '/icon.svg', '/icons/' + a + '/icon-192.png', '/icons/' + a + '/badge-96.png']),
];

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
  // Stránky sa ukladajú bez parametrov v adrese (napr. /gazda/?akcia=nakup → /gazda/).
  const key = req.mode === 'navigate' ? url.pathname : req;
  event.respondWith(
    fetch(req)
      .then((res) => {
        // presmerovanie (napr. /?akcia=…) neukladaj – patrí k inej adrese
        if (res.ok && !res.redirected && url.pathname !== '/manifest.webmanifest') {
          const copy = res.clone();
          caches.open(CACHE).then((cache) => cache.put(key, copy));
        }
        return res;
      })
      .catch(() => caches.match(key).then((hit) => hit || Response.error()))
  );
});

// ---- Push notifikácie ----------------------------------------------------------

self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch (e) {
    data = { body: event.data ? event.data.text() : '' };
  }
  // Staré správy bez „app“ sú z Gazdy.
  const app = APPS.includes(data.app) ? data.app : 'gazda';
  const names = { family: 'Family Grid', gazda: 'Gazda', zdravko: 'Zdravko', skladko: 'Skládko' };
  event.waitUntil(
    self.registration.showNotification(data.title || names[app], {
      body: data.body || '',
      tag: data.tag ? app + ':' + data.tag : undefined,
      renotify: Boolean(data.tag),
      icon: '/icons/' + app + '/icon-192.png',
      badge: '/icons/' + app + '/badge-96.png',
      lang: 'sk',
      data: { url: data.url || (app === 'family' ? '/' : '/' + app + '/') },
    })
  );
});

// Ťuknutie na notifikáciu: prepni otvorený Family Grid na správnu podaplikáciu, inak ho otvor.
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = new URL((event.notification.data && event.notification.data.url) || '/', self.location.origin).href;
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(async (list) => {
      const open = list.find((c) => c.url.startsWith(self.location.origin) && 'focus' in c);
      if (!open) return self.clients.openWindow(url);
      const samePage = new URL(open.url).pathname === new URL(url).pathname;
      if (!samePage && 'navigate' in open) {
        try {
          const moved = await open.navigate(url);
          return (moved || open).focus();
        } catch (e) {
          // nekontrolované okno – otvor nové
          return self.clients.openWindow(url);
        }
      }
      return open.focus();
    })
  );
});
