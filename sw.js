// MoonPop Service Worker v1
const CACHE_NAME = 'moonpop-v1';
const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/manifest.json',
  'https://api.fontshare.com/v2/css?f[]=satoshi@400,500,700,900&display=swap',
  'https://cdnjs.cloudflare.com/ajax/libs/suncalc/1.9.0/suncalc.min.js',
  'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2'
];

// Install: cache static assets
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      console.log('[SW] Caching static assets');
      return cache.addAll(STATIC_ASSETS).catch(err => {
        console.warn('[SW] Some assets failed to cache:', err);
        // Cache what we can
        return Promise.allSettled(
          STATIC_ASSETS.map(url => cache.add(url).catch(() => {}))
        );
      });
    })
  );
  // Activate immediately
  self.skipWaiting();
});

// Activate: clean up old caches
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key))
      );
    })
  );
  // Take control of all open tabs
  self.clients.claim();
});

// Fetch strategy:
// - Supabase API calls: network-first (always try fresh data)
// - Static assets: cache-first (fast loading)
// - Everything else: network-first with cache fallback
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Skip non-GET requests
  if (event.request.method !== 'GET') return;

  // Supabase API / Edge Functions — always network-first
  if (url.hostname.includes('supabase.co') || url.hostname.includes('supabase.in')) {
    event.respondWith(
      fetch(event.request).catch(() => {
        return caches.match(event.request);
      })
    );
    return;
  }

  // Static assets (CDNs, fonts) — cache-first
  if (url.hostname.includes('cdn.jsdelivr.net') ||
      url.hostname.includes('cdnjs.cloudflare.com') ||
      url.hostname.includes('fontshare.com')) {
    event.respondWith(
      caches.match(event.request).then((cached) => {
        return cached || fetch(event.request).then((response) => {
          const clone = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
          return response;
        });
      })
    );
    return;
  }

  // App shell (index.html) — network-first, cache fallback
  if (url.pathname === '/' || url.pathname === '/index.html') {
    event.respondWith(
      fetch(event.request).then((response) => {
        const clone = response.clone();
        caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
        return response;
      }).catch(() => {
        return caches.match(event.request);
      })
    );
    return;
  }

  // Everything else — network-first
  event.respondWith(
    fetch(event.request).catch(() => caches.match(event.request))
  );
});

// Push notification handler (for Phase 3D)
self.addEventListener('push', (event) => {
  if (!event.data) return;

  try {
    const data = event.data.json();
    const options = {
      body: data.body || 'You have a new moon message',
      icon: data.icon || '/manifest.json', // Fallback
      badge: '/manifest.json',
      tag: data.tag || 'moonpop-message',
      data: { url: data.url || '/' },
      vibrate: [200, 100, 200],
      actions: [
        { action: 'open', title: 'Read Message' }
      ]
    };

    event.waitUntil(
      self.registration.showNotification(data.title || 'MoonPop', options)
    );
  } catch (err) {
    console.error('[SW] Push parse error:', err);
  }
});

// Notification click handler
self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  const url = event.notification.data?.url || '/';
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      // Focus existing tab if open
      for (const client of clients) {
        if (client.url.includes(self.location.origin) && 'focus' in client) {
          return client.focus();
        }
      }
      // Otherwise open new tab
      return self.clients.openWindow(url);
    })
  );
});
