// MoonPop Service Worker v19
const CACHE_NAME = 'moonpop-v19';
const STATIC_ASSETS = [
  // Only precache CDN assets (immutable, safe to cache-first)
  // App shell (index.html) is NOT precached — it uses network-first strategy
  // and gets cached dynamically on first successful fetch
  'https://api.fontshare.com/v2/css?f[]=satoshi@400,500,700,900&display=swap',
  'https://cdnjs.cloudflare.com/ajax/libs/suncalc/1.9.0/suncalc.min.js',
  'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2'
];

// Install: cache CDN assets only
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      console.log('[SW] Caching CDN assets');
      return Promise.allSettled(
        STATIC_ASSETS.map(url => cache.add(url).catch(() => {
          console.warn('[SW] Failed to cache:', url);
        }))
      );
    })
  );
  // Activate immediately (don't wait for old SW to finish)
  self.skipWaiting();
});

// Activate: clean up old caches
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.filter(key => key !== CACHE_NAME).map(key => {
          console.log('[SW] Deleting old cache:', key);
          return caches.delete(key);
        })
      );
    })
  );
  // Take control of all open tabs immediately
  self.clients.claim();
});

// Fetch strategy:
// - Supabase API calls: network-only (never cache API responses)
// - CDN assets: cache-first (fast loading, immutable)
// - App shell: network-first with cache fallback (always latest code)
// - Everything else: network-first
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Skip non-GET requests
  if (event.request.method !== 'GET') return;

  // Supabase Storage (moon-photos, avatars) — cache-first (immutable uploads)
  if ((url.hostname.includes('supabase.co') || url.hostname.includes('supabase.in')) &&
      url.pathname.includes('/storage/v1/object/public/')) {
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

  // Supabase API / Edge Functions — network-only (never serve stale API data)
  if (url.hostname.includes('supabase.co') || url.hostname.includes('supabase.in')) {
    event.respondWith(
      fetch(event.request).catch(() => {
        // Offline: return empty response instead of stale data
        return new Response(JSON.stringify({ error: 'offline' }), {
          status: 503,
          headers: { 'Content-Type': 'application/json' }
        });
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

  // Manifest — network-first, cache fallback
  if (url.pathname === '/manifest.json') {
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

  // App shell (index.html, /chat/* deep links) — network-first, cache fallback
  // Deep-link routes like /chat/<id> are handled client-side, so serve index.html
  if (url.pathname === '/' || url.pathname === '/index.html' || url.pathname.startsWith('/chat/')) {
    const appShellRequest = url.pathname.startsWith('/chat/')
      ? new Request(url.origin + '/index.html') // Rewrite /chat/* to /index.html
      : event.request;
    event.respondWith(
      fetch(appShellRequest).then((response) => {
        const clone = response.clone();
        caches.open(CACHE_NAME).then(cache => cache.put(new Request(url.origin + '/index.html'), clone));
        return response;
      }).catch(() => {
        return caches.match(new Request(url.origin + '/index.html'));
      })
    );
    return;
  }

  // Everything else — network-first
  event.respondWith(
    fetch(event.request).catch(() => caches.match(event.request))
  );
});

// Push notification handler
self.addEventListener('push', (event) => {
  if (!event.data) return;

  try {
    const data = event.data.json();
    const options = {
      body: data.body || 'You have a new moon message',
      icon: data.icon || '/manifest.json',
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
