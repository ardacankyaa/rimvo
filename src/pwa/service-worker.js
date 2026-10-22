// Offline support for production builds. vite.config.ts replaces the two
// placeholders below with the build's file list and a version derived from it.
const PRECACHE = self.__RIMVO_PRECACHE__;
const VERSION = self.__RIMVO_VERSION__;
const APP_CACHE = 'rimvo-app-' + VERSION;
// Files fetched later, such as the demo tracks, are kept for offline use too.
const RUNTIME_CACHE = 'rimvo-runtime-' + VERSION;
const scope = new URL(self.registration.scope);
const indexUrl = new URL('index.html', scope).href;

self.addEventListener('install', event => {
  // The new version waits until every open RIMVO tab has closed, so a running
  // console never loses the files of the version it started with.
  event.waitUntil(caches.open(APP_CACHE).then(cache => cache.addAll(PRECACHE.map(path => new URL(path, scope).href))));
});

self.addEventListener('activate', event => {
  event.waitUntil(caches.keys()
    .then(names => Promise.all(names.filter(name => name.startsWith('rimvo-') && name !== APP_CACHE && name !== RUNTIME_CACHE).map(name => caches.delete(name))))
    .then(() => self.clients.claim()));
});

function cacheable(response) {
  return response.ok && response.status === 200 && response.type === 'basic';
}

async function navigate(request) {
  try {
    const response = await fetch(request);
    if (cacheable(response)) {
      const copy = response.clone();
      void caches.open(APP_CACHE).then(cache => cache.put(indexUrl, copy)).catch(() => undefined);
    }
    return response;
  } catch (cause) {
    const cached = await caches.match(indexUrl);
    if (cached) return cached;
    throw cause;
  }
}

async function cachedFirst(request) {
  // Built files have hashed names, so a version query never selects different content.
  const cached = await caches.match(request, { ignoreSearch: true });
  if (cached) return cached;
  const response = await fetch(request);
  if (cacheable(response)) {
    const copy = response.clone();
    void caches.open(RUNTIME_CACHE).then(cache => cache.put(request, copy)).catch(() => undefined);
  }
  return response;
}

self.addEventListener('fetch', event => {
  const { request } = event;
  if (request.method !== 'GET' || request.headers.has('range')) return;
  const url = new URL(request.url);
  if (url.origin !== scope.origin || !url.pathname.startsWith(scope.pathname)) return;
  const appPage = url.pathname === scope.pathname || url.href === indexUrl;
  event.respondWith(request.mode === 'navigate' && appPage ? navigate(request) : cachedFirst(request));
});
