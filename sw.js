const CACHE_NAME = 'gabru-badminton-v1';

self.addEventListener('install', (event) => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

// Network-first for the app shell so updates land quickly;
// this app is mostly live-synced data anyway, so heavy caching would be counterproductive.
self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  event.respondWith(
    fetch(event.request).catch(() => caches.match(event.request))
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
  };

  event.waitUntil(
    Promise.all([
      self.registration.showNotification(title, options),
      bumpBadge(),
    ])
  );
});

async function bumpBadge(){
  if (!('setAppBadge' in self.navigator)) return;
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

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || '/';
  event.waitUntil(
    (async () => {
      await setBadgeCount(0);
      if ('clearAppBadge' in self.navigator){
        try { await self.navigator.clearAppBadge(); } catch (e) {}
      }
      const clientList = await clients.matchAll({ type: 'window', includeUncontrolled: true });
      for (const client of clientList) {
        if (client.url.includes(self.location.origin) && 'focus' in client) {
          return client.focus();
        }
      }
      if (clients.openWindow) return clients.openWindow(url);
    })()
  );
});
