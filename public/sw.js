// Yakyard service worker: installable app + phone notifications.
self.addEventListener('install', () => self.skipWaiting());
// Speed: the app shell and versioned files come from the phone/computer cache, then refresh quietly.
// Bump STATIC when files under /brand, /fonts or /vendor change (their URLs carry no version).
const SHELL = 'yakyard-shell', STATIC = 'yakyard-static-3';
self.addEventListener('activate', (e) => e.waitUntil((async () => {
  for (const k of await caches.keys()) if (![SHELL, STATIC].includes(k)) await caches.delete(k);
  await self.clients.claim();
})()));
self.addEventListener('fetch', (e) => {
  const req = e.request, url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== self.location.origin) return;
  if (req.mode === 'navigate' && url.pathname === '/') {
    e.respondWith((async () => {
      const c = await caches.open(SHELL), hit = await c.match('/');
      const net = fetch(req).then(async (r) => {
        if (r.ok && r.headers.get('content-type')?.includes('text/html')) {
          const t = await r.clone().text();
          if (t.includes('yakyard-version')) await c.put('/', r.clone()); else await c.delete('/');
        }
        return r;
      });
      if (hit) { e.waitUntil(net.catch(() => {})); return hit; }
      return net;
    })());
    return;
  }
  const versioned = url.searchParams.has('v') || /^\/(fonts|brand|vendor)\//.test(url.pathname);
  if (versioned && !url.pathname.startsWith('/files/')) {
    e.respondWith(caches.open(STATIC).then(async (c) => (await c.match(req)) || fetch(req).then(async (r) => {
      if (r.ok) {
        // One copy per file: drop older ?v= versions of the same path.
        for (const k of await c.keys()) if (new URL(k.url).pathname === url.pathname) await c.delete(k);
        await c.put(req, r.clone());
      }
      return r;
    })));
  }
});
self.addEventListener('message', (e) => { if (e.data === 'skip-waiting') self.skipWaiting(); });

self.addEventListener('push', (e) => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch { d = { body: e.data && e.data.text() }; }
  // Red badge on the installed app icon (a dot; the app sets the exact count when opened).
  try { self.navigator.setAppBadge && self.navigator.setAppBadge(); } catch (e) {}
  // iPhone requires every push to show a notification, so we always show one.
  e.waitUntil(self.registration.showNotification(d.title || 'Yakyard', {
    body: d.body || '', icon: d.icon || '/brand/app-icon-192.png', badge: d.badge || '/brand/favicon-64.png',
    tag: d.tag || undefined, renotify: !!d.tag, data: d.data || { url: '/' },
  }));
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const url = new URL((e.notification.data && e.notification.data.url) || '/', self.location.origin).href;
  e.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const w of wins) {
      if (new URL(w.url).origin === self.location.origin) {
        await w.focus();
        w.postMessage({ type: 'open', url });
        return;
      }
    }
    await self.clients.openWindow(url);
  })());
});
