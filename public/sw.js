/* Panorama Viewer service worker. Kept as plain JS so Vite can copy it without a plugin. */
const CACHE_NAME = 'panorama-viewer-shell-v2';
const DATABASE_NAME = 'panorama-viewer';
const DATABASE_VERSION = 1;
const STORE_NAME = 'incoming-shares';

function appRoot() {
  return new URL('./', self.registration.scope).toString();
}

function openDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(STORE_NAME)) {
        database.createObjectStore(STORE_NAME, { keyPath: 'id' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('IndexedDB unavailable'));
  });
}

async function saveSharedFiles(files) {
  if (!files.length) return false;
  const database = await openDatabase();
  try {
    const transaction = database.transaction(STORE_NAME, 'readwrite');
    const store = transaction.objectStore(STORE_NAME);
    for (const file of files) {
      const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
      store.put({
        id,
        blob: file,
        name: file.name || 'shared-image',
        type: file.type || 'image/*',
        lastModified: file.lastModified || Date.now(),
        receivedAt: Date.now(),
      });
    }
    await new Promise((resolve, reject) => {
      transaction.oncomplete = resolve;
      transaction.onerror = () => reject(transaction.error || new Error('IndexedDB write failed'));
      transaction.onabort = () => reject(transaction.error || new Error('IndexedDB write aborted'));
    });
    return true;
  } finally {
    database.close();
  }
}

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    const root = appRoot();
    // Only stable public files are precached. Hashed Vite assets are cached
    // lazily after the first online visit.
    await cache.addAll([
      root,
      new URL('manifest.webmanifest', root).toString(),
      new URL('icons/icon-192.png', root).toString(),
      new URL('icons/icon-512.png', root).toString(),
    ]);
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key)));
    await self.clients.claim();
  })());
});

async function handleShare(request) {
  const formData = await request.formData();
  const values = formData.getAll('files');
  const files = values.filter((value) => value instanceof File);
  await saveSharedFiles(files);
  const redirectUrl = new URL('./?shared=1', request.url);
  return Response.redirect(redirectUrl.toString(), 303);
}

async function cacheFirst(request) {
  const cached = await caches.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (response.ok && response.type === 'basic') {
    const cache = await caches.open(CACHE_NAME);
    cache.put(request, response.clone());
  }
  return response;
}

async function navigationResponse(request) {
  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(CACHE_NAME);
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    const root = appRoot();
    return (await caches.match(request)) || (await caches.match(root));
  }
}

self.addEventListener('fetch', (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // Web Share Target navigation uses POST. Static hosts cannot run a server
  // endpoint, so the service worker stores the multipart file locally first.
  if (request.method === 'POST' && url.searchParams.has('share-target')) {
    event.respondWith(handleShare(request));
    return;
  }
  if (request.method !== 'GET') return;

  if (request.mode === 'navigate') {
    event.respondWith(navigationResponse(request));
    return;
  }
  event.respondWith(cacheFirst(request));
});
