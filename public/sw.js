const CACHE = 'english-teacher-vercel-independent-v3';
const SHELL = [
  '/',
  '/stories/',
  '/B1_level3/index.html',
  '/arabic-academy/',
  '/read/',
  '/read/level1-50k.json',
  '/manifest.webmanifest',
  '/pwa.js',
  '/auth-profile.js',
  '/cue-stories-typography-v1.js',
  '/pwa/icon-180.png',
  '/pwa/icon-192.png',
  '/pwa/icon-512.png'
];

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    try {
      const cache = await caches.open(CACHE);
      await cache.addAll(SHELL);
    } catch (_) {}
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    try {
      const keys = await caches.keys();
      await Promise.all(keys.filter(key => key !== CACHE && /^(english-teacher-vercel-independent-|english-teacher-integrated-pwa-|english-teacher-story-audio-)/.test(key)).map(key => caches.delete(key)));
    } catch (_) {}
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', event => {
  const request = event.request;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin || request.method !== 'GET') return;

  if (url.pathname === '/read/level1-50k.json') {
    event.respondWith((async () => {
      const cache = await caches.open(CACHE);
      const cached = await cache.match(request, { ignoreSearch: true });
      if (cached) return cached;
      const response = await fetch(request);
      if (response.ok) await cache.put(request, response.clone());
      return response;
    })());
    return;
  }

  if (request.mode === 'navigate') {
    event.respondWith(fetch(request).then(response => {
      if (response.ok) {
        const copy = response.clone();
        event.waitUntil(caches.open(CACHE).then(cache => cache.put(request, copy)).catch(() => {}));
      }
      return response;
    }).catch(async () => {
      const cache = await caches.open(CACHE);
      return (await cache.match(request, { ignoreSearch: true })) ||
        (await cache.match(url.pathname.startsWith('/stories') ? '/stories/' : '/')) ||
        Response.error();
    }));
  }
});
