// sw.js — funcționare offline. Strategie:
//  - fișierele aplicației (shell): precache la instalare cu ocolirea cache-ului HTTP (cache:'reload'),
//    ca la o versiune nouă să nu re-prindem fișiere vechi din cache-ul browserului
//  - datele lecțiilor (data/*.json): cache SEPARAT și stabil (nu se șterge la actualizări de shell),
//    stale-while-revalidate: merg offline, se împrospătează pe net
// La versiune nouă: deploy.sh schimbă VERSION → clientul primește banner "Actualizează".

const VERSION = 'ezr-202607160923';
const DATA_CACHE = 'ezr-data-v1';
const SHELL = [
  './',
  './index.html',
  './manifest.webmanifest',
  './css/base.css?v=202607160923',
  './css/themes.css?v=202607160923',
  './js/main.js?v=202607160923',
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
  // versiunea nouă intră singură: părinții nu trebuie să apese nimic ca să primească
  // reparațiile, iar o fereastră care nu se închide niciodată nu mai blochează actualizarea
  self.skipWaiting();
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

  // datele lecțiilor: servim din cache imediat, împrospătăm în fundal.
  // Orice defecțiune a magaziei de cache (telefon plin, stocare curățată de Android)
  // NU are voie să omoare cererea: cădem pe rețea, ca lecțiile să se încarce oricum.
  if (url.pathname.includes('/data/')) {
    e.respondWith((async () => {
      let c = null;
      try { c = await caches.open(DATA_CACHE); } catch (_) { c = null; }
      let cached = null;
      if (c) { try { cached = await c.match(req, { ignoreSearch: true }); } catch (_) { cached = null; } }
      const fetching = fetch(req).then((res) => {
        if (res && res.ok && c) { try { c.put(req, res.clone()); } catch (_) {} }
        return res;
      }).catch(() => null);
      if (cached) return cached;
      const fresh = await fetching;
      // fără date și fără net: răspuns de eroare onest, ca aplicația să arate "reîncearcă"
      return fresh || new Response('{"offline":true}', { status: 503, headers: { 'Content-Type': 'application/json' } });
    })());
    return;
  }

  // shell: cache-first cu fallback pe rețea; navigări → index.html offline
  e.respondWith(
    caches.match(req, { ignoreSearch: true }).catch(() => null).then((cached) => {
      if (cached) return cached;
      return fetch(req).then((res) => {
        if (res && res.ok && (url.pathname.endsWith('.js') || url.pathname.endsWith('.css') || url.pathname.endsWith('.png'))) {
          const copy = res.clone();
          caches.open(VERSION).then((c) => c.put(req, copy)).catch(() => {});
        }
        return res;
      }).catch(() => {
        if (req.mode === 'navigate') return caches.match('./index.html', { ignoreSearch: true }).catch(() => new Response('', { status: 504 }));
        return new Response('', { status: 504 });
      });
    })
  );
});
