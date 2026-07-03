// sw.js — funcționare offline. Strategie:
//  - fișierele aplicației (shell): cache-first, precache la instalare
//  - datele lecțiilor (data/*.json): stale-while-revalidate (merg offline, se împrospătează pe net)
// La versiune nouă: bump VERSION → clientul primește banner "Actualizează".

const VERSION = 'ezr-v1.0.0';
const SHELL = [
  './',
  './index.html',
  './manifest.webmanifest',
  './css/base.css?v=APPV',
  './css/themes.css?v=APPV',
  './js/main.js?v=APPV',
  './js/state.js',
  './js/ui.js',
  './js/engine.js',
  './js/exercises.js',
  './js/course.js',
  './js/gamify.js',
  './js/league.js',
  './js/speech.js',
  './js/sound.js',
  './js/mascot.js',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-180.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(VERSION).then((c) => c.addAll(SHELL)).catch(() => {})
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('message', (e) => {
  if (e.data && e.data.type === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;

  // datele lecțiilor: servim din cache imediat, împrospătăm în fundal
  if (url.pathname.includes('/data/')) {
    e.respondWith(
      caches.open(VERSION).then(async (c) => {
        const cached = await c.match(req, { ignoreSearch: true });
        const fetching = fetch(req).then((res) => {
          if (res && res.ok) c.put(req, res.clone());
          return res;
        }).catch(() => null);
        return cached || fetching.then((r) => r || new Response('{}', { headers: { 'Content-Type': 'application/json' } }));
      })
    );
    return;
  }

  // shell: cache-first cu fallback pe rețea; navigări → index.html offline
  e.respondWith(
    caches.match(req, { ignoreSearch: true }).then((cached) => {
      if (cached) return cached;
      return fetch(req).then((res) => {
        if (res && res.ok && (url.pathname.endsWith('.js') || url.pathname.endsWith('.css') || url.pathname.endsWith('.png'))) {
          const copy = res.clone();
          caches.open(VERSION).then((c) => c.put(req, copy)).catch(() => {});
        }
        return res;
      }).catch(() => {
        if (req.mode === 'navigate') return caches.match('./index.html', { ignoreSearch: true });
        return new Response('', { status: 504 });
      });
    })
  );
});
