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
    // A tag collapses related pushes (same session, same thread) into one
    // notification instead of a growing stack. renotify still alerts the user
    // that the collapsed notification has been updated.
    tag: data.tag || undefined,
    renotify: data.tag ? true : undefined,
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
