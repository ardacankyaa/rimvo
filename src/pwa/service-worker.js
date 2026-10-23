// Offline support for production builds. vite.config.ts replaces the two
// placeholders below with the build's file list and a version derived from it.
const PRECACHE = self.__RIMVO_PRECACHE__;
const VERSION = self.__RIMVO_VERSION__;
const APP_CACHE = 'rimvo-app-' + VERSION;
// Demo tracks and hashed build files fetched later are kept for offline use
// too. Documentation, license texts and source archives always come from the network.
const RUNTIME_CACHE = 'rimvo-runtime-' + VERSION;
const scope = new URL(self.registration.scope);
const indexUrl = new URL('index.html', scope).href;
const precached = new Set(PRECACHE.map(path => new URL(path, scope).href));
const runtimeCached = [/^assets\/[\w.-]+\.(?:js|css)$/, /^demo-tracks\/[\w.-]+\.(?:wav|flac|mp3|svg)$/];

self.addEventListener('install', event => {
  // The new version waits until every open RIMVO tab has closed, so a running
  // console never loses the files of the version it started with.
  event.waitUntil(caches.open(APP_CACHE).then(cache => cache.addAll([...precached])));
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
  // The network copy may belong to a newer deploy whose files this version
  // never precached, so it is never stored. Offline, the index precached with
  // this worker's own files is served instead.
  try {
    return await fetch(request);
  } catch (cause) {
    const cached = await caches.open(APP_CACHE).then(cache => cache.match(indexUrl));
    if (cached) return cached;
    throw cause;
  }
}

async function cachedFirst(request, url, store) {
  // Built files have hashed names, so a version query never selects different content.
  const key = url.origin + url.pathname;
  const cached = await caches.open(APP_CACHE).then(cache => cache.match(key)) ?? await caches.open(RUNTIME_CACHE).then(cache => cache.match(key));
  if (cached) return cached;
  const response = await fetch(request);
  if (store && cacheable(response)) {
    const copy = response.clone();
    void caches.open(RUNTIME_CACHE).then(cache => cache.put(key, copy)).catch(() => undefined);
  }
  return response;
}

self.addEventListener('fetch', event => {
  const { request } = event;
  if (request.method !== 'GET' || request.headers.has('range')) return;
  const url = new URL(request.url);
  if (url.origin !== scope.origin || !url.pathname.startsWith(scope.pathname)) return;
  const appPage = url.pathname === scope.pathname || url.href === indexUrl;
  if (request.mode === 'navigate' && appPage) {
    event.respondWith(navigate(request));
    return;
  }
  const path = url.pathname.slice(scope.pathname.length);
  const isPrecached = precached.has(url.origin + url.pathname);
  const store = !isPrecached && runtimeCached.some(pattern => pattern.test(path));
  if (isPrecached || store) event.respondWith(cachedFirst(request, url, store));
});
