// sw.js — funcționare offline. Strategie:
//  - fișierele aplicației (shell): precache la instalare cu ocolirea cache-ului HTTP (cache:'reload'),
//    ca la o versiune nouă să nu re-prindem fișiere vechi din cache-ul browserului
//  - datele lecțiilor (data/*.json): cache SEPARAT și stabil (nu se șterge la actualizări de shell),
//    stale-while-revalidate: merg offline, se împrospătează pe net
// La versiune nouă: deploy.sh schimbă VERSION → clientul primește banner "Actualizează".

const VERSION = 'ezr-202607040316';
const DATA_CACHE = 'ezr-data-v1';
const SHELL = [
  './',
  './index.html',
  './manifest.webmanifest',
  './css/base.css?v=202607040316',
  './css/themes.css?v=202607040316',
  './js/main.js?v=202607040316',
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
  './icons/icon-512-maskable.png',
  './icons/icon-180.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(VERSION)
      .then((c) => c.addAll(SHELL.map((u) => new Request(u, { cache: 'reload' }))))
      .catch(() => {})
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== VERSION && k !== DATA_CACHE).map((k) => caches.delete(k)))
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
      caches.open(DATA_CACHE).then(async (c) => {
        const cached = await c.match(req, { ignoreSearch: true });
        const fetching = fetch(req).then((res) => {
          if (res && res.ok) c.put(req, res.clone());
          return res;
        }).catch(() => null);
        if (cached) return cached;
        const fresh = await fetching;
        // fără date și fără net: răspuns de eroare onest, ca aplicația să arate "reîncearcă"
        return fresh || new Response('{"offline":true}', { status: 503, headers: { 'Content-Type': 'application/json' } });
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
