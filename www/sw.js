/* Khata service worker. __BUILD__ is replaced with the commit SHA by CI, so every release gets its own cache.
   A new worker waits until the user taps "Update now"; the old worker and its cache keep serving until then,
   so a release is never half-applied. Only the app's own static files are cached, never exports or data. */
const BUILD = '__BUILD__';
const CACHE = 'khata-' + BUILD;
const ASSETS = ['./', 'index.html', 'app.css', 'core.js', 'app.js', 'manifest.webmanifest', 'icon-192.png', 'icon-512.png'];
self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => Promise.all(ASSETS.map(u => c.add(new Request(u, { cache: 'reload' }))))));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k.startsWith('khata-') && k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('message', e => { if (e.data === 'SKIP_WAITING') self.skipWaiting(); });
self.addEventListener('fetch', e => {
  const r = e.request, u = new URL(r.url);
  if (r.method !== 'GET' || u.origin !== location.origin) return;
  e.respondWith(caches.match(r, { ignoreSearch: true }).then(hit => hit || fetch(r).catch(() =>
    r.mode === 'navigate' ? caches.match('index.html') : Response.error())));
});
