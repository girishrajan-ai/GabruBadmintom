const CACHE_NAME = 'gabru-badminton-v2';
const SHELL = [
  '/',
  '/index.html',
  '/manifest.json',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/icons/icon-maskable-192.png',
  '/icons/icon-maskable-512.png',
];

self.addEventListener('install', (event) => {
  // Precache the shell so a cold launch doesn't wait on the network for the
  // HTML and every icon. Previously nothing was ever written to the cache, so
  // the offline fallback below could only ever miss.
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(SHELL))
      .catch(() => {})
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys();
      await Promise.all(
        names
          .filter((n) => n.startsWith('gabru-badminton-') && n !== CACHE_NAME)
          .map((n) => caches.delete(n))
      );
      await self.clients.claim();
    })()
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  // Live data and anything off-origin goes straight to the network - there is
  // no point putting the service worker in front of our own API calls.
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/api/')) return;

  // Static assets never change without a filename change: serve from cache and
  // refresh in the background.
  const isAsset = url.pathname.startsWith('/icons/') || url.pathname === '/manifest.json';
  // The HTML changes with every deploy (new features, bug fixes), so it's
  // network-first: always get the latest unless the network is unreachable.
  // Stale-while-revalidate was tried here before, but it means a fixed bug
  // (e.g. the calendar defaulting to the wrong month) stays visible forever,
  // since the cached copy is served before the fresh one is even fetched.
  const isShell = req.mode === 'navigate' || url.pathname === '/' || url.pathname === '/index.html';

  if (!isAsset && !isShell) return;

  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE_NAME);
      // Notification deep links arrive as /?session=..., so all navigations
      // share one cache entry rather than accumulating one per session.
      const cacheKey = isShell ? '/index.html' : req;

      if (isShell) {
        try {
          const res = await fetch(req);
          if (res && res.ok) cache.put(cacheKey, res.clone()).catch(() => {});
          return res;
        } catch (e) {
          const cached = await cache.match(cacheKey);
          return cached || new Response('Offline', { status: 503, statusText: 'Offline' });
        }
      }

      const cached = await cache.match(cacheKey);
      const network = fetch(req)
        .then((res) => {
          if (res && res.ok) cache.put(cacheKey, res.clone()).catch(() => {});
          return res;
        })
        .catch(() => null);

      if (cached) return cached;
      const res = await network;
      if (res) return res;
      return new Response('Offline', { status: 503, statusText: 'Offline' });
    })()
  );
});

self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch (e) {
    data = { title: 'Gabru Badminton', body: event.data ? event.data.text() : 'New update' };
  }

  const title = data.title || 'Gabru Badminton 🏸';
  const options = {
    body: data.body || '',
    icon: '/icons/icon-192.png',
    badge: '/icons/icon-192.png',
    data: { url: data.url || '/' },
    vibrate: [100, 50, 100],
    // A tag collapses related pushes (same session, same thread) into one
    // notification instead of a growing stack. renotify still alerts the user
    // that the collapsed notification has been updated.
    tag: data.tag || undefined,
    renotify: data.tag ? true : undefined,
  };

  // iOS revokes push permission if a push event ever resolves without showing
  // a notification, so showNotification must always run and must never be
  // blocked by the badge update failing. Promise.all rejects as soon as either
  // side does; the badge is best-effort and is swallowed separately.
  event.waitUntil(
    (async () => {
      await self.registration.showNotification(title, options);
      await bumpBadge();
    })()
  );
});

async function bumpBadge(){
  // Safari exposes setAppBadge on the service worker's navigator only for an
  // installed PWA; elsewhere it may be missing entirely.
  if (!self.navigator || !('setAppBadge' in self.navigator)) return;
  try {
    const count = (await getBadgeCount()) + 1;
    await setBadgeCount(count);
    await self.navigator.setAppBadge(count);
  } catch (e) {
    // Badging API not available/supported on this platform - safe to ignore
  }
}

// Small helper store for badge count, kept in the Cache Storage API so it
// survives service worker restarts (unlike a plain in-memory variable).
async function getBadgeCount(){
  try {
    const cache = await caches.open('gabru-badge-v1');
    const res = await cache.match('badge-count');
    if (!res) return 0;
    const text = await res.text();
    return parseInt(text, 10) || 0;
  } catch (e) {
    return 0;
  }
}
async function setBadgeCount(count){
  try {
    const cache = await caches.open('gabru-badge-v1');
    await cache.put('badge-count', new Response(String(count)));
  } catch (e) {
    // ignore
  }
}

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'CLEAR_BADGE'){
    event.waitUntil(
      (async () => {
        await setBadgeCount(0);
        if ('clearAppBadge' in self.navigator){
          try { await self.navigator.clearAppBadge(); } catch (e) {}
        }
      })()
    );
  }
});

// Push services rotate endpoints periodically. Without this the subscription
// silently dies and the user keeps thinking notifications are on.
self.addEventListener('pushsubscriptionchange', (event) => {
  event.waitUntil(
    (async () => {
      try {
        const keyRes = await fetch('/api/push');
        const { publicKey } = await keyRes.json();
        if (!publicKey) return;
        const subscription = await self.registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(publicKey),
        });
        const oldEndpoint = event.oldSubscription && event.oldSubscription.endpoint;
        if (oldEndpoint) {
          await fetch('/api/push', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'unsubscribe', endpoint: oldEndpoint }),
          });
        }
        await fetch('/api/push', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'subscribe', subscription }),
        });
      } catch (e) {
        // nothing useful we can do from here
      }
    })()
  );
});

function urlBase64ToUint8Array(base64String){
  const padding = '='.repeat((4 - base64String.length % 4) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) outputArray[i] = rawData.charCodeAt(i);
  return outputArray;
}

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || '/';
  event.waitUntil(
    (async () => {
      await setBadgeCount(0);
      if ('clearAppBadge' in self.navigator){
        try { await self.navigator.clearAppBadge(); } catch (e) {}
      }
      const target = new URL(url, self.location.origin);
      const clientList = await clients.matchAll({ type: 'window', includeUncontrolled: true });
      for (const client of clientList) {
        if (client.url.startsWith(self.location.origin) && 'focus' in client) {
          // Navigate the existing tab to the deep link before focusing it,
          // otherwise tapping a session notification just reveals whatever
          // the app happened to be showing.
          if ('navigate' in client && client.url !== target.href) {
            try { await client.navigate(target.href); } catch (e) {}
          }
          return client.focus();
        }
      }
      if (clients.openWindow) return clients.openWindow(target.href);
    })()
  );
});
