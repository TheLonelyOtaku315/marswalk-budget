// Generated with AI assistance for NASA Space Apps 2026; reviewed by the team

// Bump on deploy when the field pages, their dependencies or snapshots change.
const VERSION = 'v1';
const SCOPE = self.registration.scope;
const CACHE_PREFIX = `marswalk-field:${SCOPE}:`;
const OFFLINE_CACHE = `${CACHE_PREFIX}offline:${VERSION}`;
// Leaflet is pinned and rover photos have stable URLs. Keep them across releases.
const RUNTIME_CACHE = `${CACHE_PREFIX}runtime`;
const scopedUrl = (path) => new URL(path, SCOPE).href;

const PAGES = new Set(['tablet.html', 'hud.html'].map(scopedUrl));
const PRECACHE = new Set([
  ...PAGES,
  ...[
    'manifest.webmanifest', 'css/views.css',
    'js/views/icon-192.png', 'js/views/icon-512.png',
    'js/views/offline.js', 'js/views/tablet.js', 'js/views/hud.js',
    'js/views/helmet.js', 'js/views/walk.js', 'js/views/geometry.js',
    'js/engine.js', 'js/config.js', 'js/routes.js', 'js/steps.js',
    'js/render.js', 'js/photos.js', 'js/conditions.js',
    'data/gale/area.json', 'data/real/area.json',
    ...['gale', 'real', 'demo'].flatMap((site) => [
      `data/${site}/terrain.json`, `data/${site}/targets.json`,
    ]),
    ...['real-gale', 'real', 'demo-quiet', 'demo-dusty', 'demo-solar'].map(
      (name) => `data/conditions/${name}.json`,
    ),
  ].map(scopedUrl),
]);

function pageUrl(href) {
  const url = new URL(href);
  return url.origin + url.pathname;
}

function externalMode(url) {
  if (url.origin === 'https://unpkg.com' && /^\/leaflet@1\.9\.4\/dist\/leaflet\.(css|js)$/.test(url.pathname)) {
    return 'cors';
  }
  if (url.origin === 'https://mars.nasa.gov' && /^\/(msl|mars2020)-raw-images\//.test(url.pathname)) {
    return 'no-cors';
  }
  return null;
}

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(OFFLINE_CACHE);
    await cache.addAll([...PRECACHE].map((url) => new Request(url, { cache: 'reload' })));
  })());
});

// Let open pages finish on their current release before activating an update.
self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names.filter((name) => name.startsWith(CACHE_PREFIX) &&
      name !== OFFLINE_CACHE && name !== RUNTIME_CACHE).map((name) => caches.delete(name)));
    await self.clients.claim();
  })());
});

async function cachedFile(url, request) {
  const cache = await caches.open(OFFLINE_CACHE);
  return (await cache.match(url)) ?? fetch(request);
}

async function fetchAndSave(request, cache) {
  const response = await fetch(request);
  if (cache && (response.ok || response.type === 'opaque')) {
    // Cache storage can fill up without making the online request itself fail.
    await cache.put(request, response.clone()).catch(() => {});
  }
  return response;
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  if (request.mode === 'navigate') {
    const url = pageUrl(request.url);
    if (PAGES.has(url)) event.respondWith(cachedFile(url, request));
    return;
  }

  const mode = externalMode(new URL(request.url));
  const precached = PRECACHE.has(request.url);
  if (!precached && (!mode || request.mode !== mode)) return;

  // Leave console and fly-through requests on the network even under this scope.
  const fromFieldView = self.clients.get(event.clientId).then((client) =>
    Boolean(client && PAGES.has(pageUrl(client.url))));
  if (precached) {
    event.respondWith(fromFieldView.then((yes) => yes ? cachedFile(request.url, request) : fetch(request)));
    return;
  }

  const cache = fromFieldView.then((yes) => yes ? caches.open(RUNTIME_CACHE) : null);
  const fresh = cache.then((runtime) => fetchAndSave(request, runtime));
  event.waitUntil(fresh.catch(() => {}));
  event.respondWith(cache.then(async (runtime) => (await runtime?.match(request)) ?? fresh));
});

// On the first visit, photos and Leaflet may load before this worker takes control.
self.addEventListener('message', (event) => {
  if (event.data?.type !== 'warm-external' || !Array.isArray(event.data.urls) ||
      !event.source?.url || !PAGES.has(pageUrl(event.source.url))) return;

  event.waitUntil((async () => {
    const cache = await caches.open(RUNTIME_CACHE);
    await Promise.allSettled(event.data.urls.map(async (href) => {
      const url = new URL(href);
      const mode = externalMode(url);
      if (!mode) return;
      const request = new Request(url, { mode, credentials: 'same-origin' });
      if (!(await cache.match(request))) await fetchAndSave(request, cache);
    }));
  })());
});
