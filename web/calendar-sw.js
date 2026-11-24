const cacheName = 'anime-dubs-library-v3';
const shell = [
  'library.html', 'library.css', 'library.js', 'library-data.js',
  'calendar-week.css', 'calendar-week.js',
  'manifest.webmanifest', 'calendar-icon.svg', 'calendar-icon-192.png', 'calendar-icon-512.png',
];
const data = ['catalog.json', 'catalog-metadata.json'];
const scope = new URL(self.registration.scope);

self.addEventListener('install', event => {
  event.waitUntil(caches.open(cacheName).then(async cache => {
    await cache.addAll(shell);
    await Promise.allSettled(data.map(path => cache.add(path)));
  }));
});

self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys =>
    Promise.all(keys.filter(key => key.startsWith('anime-dubs-library-') && key !== cacheName)
      .map(key => caches.delete(key)))).then(() => self.clients.claim()));
});

self.addEventListener('fetch', event => {
  const { request } = event;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== scope.origin || url.search ||
      request.headers.has('authorization') || !url.pathname.startsWith(scope.pathname)) return;
  const path = url.pathname.slice(scope.pathname.length) || 'library.html';
  if (![...shell, ...data].includes(path)) return;
  event.respondWith((async () => {
    const cache = await caches.open(cacheName);
    const key = new URL(path, scope).href;
    try {
      const response = await fetch(request);
      if (response.ok) await cache.put(key, response.clone()).catch(() => {});
      if (response.status >= 500) return (await cache.match(key)) ?? response;
      return response;
    } catch {
      return (await cache.match(key)) ?? Response.error();
    }
  })());
});
