// service-worker.js - VERSION 3.2 (FULLY FIXED)

// 1. IMPORT THƯ VIỆN IDB
importScripts('https://cdn.jsdelivr.net/npm/idb@7/build/umd.js');

const CACHE_NAME = 'tudien-xodang-v5.2';
const FONT_CACHE = 'fonts-v1';
const OFFLINE_URL = './offline.html';

const urlsToPreCache = [
  './',
  './index.html',
  './game.html',
  OFFLINE_URL,
  'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.0.0-beta3/css/all.min.css',
  'https://cdn.tailwindcss.com',
  'https://cdn.jsdelivr.net/npm/lamejs@1.2.1/lame.min.js'
];

const fontsToCache = [
  'https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700&display=swap',
  'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.0.0-beta3/webfonts/fa-solid-900.woff2'
];

// SVG placeholder cho ảnh bị lỗi
const PLACEHOLDER_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="300" viewBox="0 0 400 300">
  <rect width="400" height="300" fill="#f0f0f0"/>
  <text x="200" y="150" text-anchor="middle" font-family="Arial" font-size="20" fill="#999">Image not available offline</text>
</svg>`;

// INSTALL
self.addEventListener('install', event => {
  event.waitUntil(
    Promise.all([
      caches.open(CACHE_NAME).then(cache => {
        return cache.addAll(urlsToPreCache).catch(err => {
          console.error('Lỗi cache assets:', err);
          // Continue even if some files fail
        });
      }),
      caches.open(FONT_CACHE).then(cache => {
        return cache.addAll(fontsToCache).catch(err => {
          console.error('Lỗi cache fonts:', err);
        });
      })
    ])
  );
  self.skipWaiting();
});

// ACTIVATE
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(cacheNames => {
      return Promise.all(
        cacheNames.map(cacheName => {
          if (cacheName !== CACHE_NAME && cacheName !== FONT_CACHE) {
            console.log('Deleting old cache:', cacheName);
            return caches.delete(cacheName);
          }
        })
      );
    }).then(() => {
      // Initialize IndexedDB
      return idb.openDB('tudien-contributions', 1, {
        upgrade(db) {
          if (!db.objectStoreNames.contains('pending')) {
            db.createObjectStore('pending', { keyPath: 'id' });
          }
        }
      });
    })
  );
  self.clients.claim();
});

// FETCH
self.addEventListener('fetch', event => {
  // Skip non-GET requests
  if (event.request.method !== 'GET') {
    return;
  }

  const requestUrl = new URL(event.request.url);

  // 1. Google Sheets API - Stale-While-Revalidate
  if (requestUrl.hostname.includes('sheets.googleapis.com') || 
      requestUrl.hostname.includes('script.google.com')) {
    event.respondWith(
      (async () => {
        const cache = await caches.open(CACHE_NAME);
        const cachedResponse = await cache.match(event.request);
        
        // Return cached response immediately if available
        if (cachedResponse) {
          // Update cache in background
          fetch(event.request)
            .then(networkResponse => {
              cache.put(event.request, networkResponse.clone());
            })
            .catch(() => {
              // Network failed, keep using cached version
            });
          return cachedResponse;
        }
        
        // No cache, try network
        try {
          const networkResponse = await fetch(event.request);
          cache.put(event.request, networkResponse.clone());
          return networkResponse;
        } catch (error) {
          // Network failed, return empty response for API calls
          return new Response('{}', {
            headers: { 'Content-Type': 'application/json' }
          });
        }
      })()
    );
    return;
  }

  // 2. Fonts - Cache First
  if (requestUrl.pathname.includes('webfonts') || 
      requestUrl.hostname.includes('fonts.googleapis.com')) {
    event.respondWith(
      caches.match(event.request, { cacheName: FONT_CACHE })
        .then(response => response || fetch(event.request))
    );
    return;
  }

  // 3. Navigation requests - Network First, Cache fallback
  if (event.request.mode === 'navigate') {
    event.respondWith(
      (async () => {
        try {
          const networkResponse = await fetch(event.request);
          const cache = await caches.open(CACHE_NAME);
          cache.put(event.request, networkResponse.clone());
          return networkResponse;
        } catch (error) {
          const cached = await caches.match(OFFLINE_URL);
          return cached || new Response('Offline - Please check your connection');
        }
      })()
    );
    return;
  }

  // 4. Default Strategy - Cache First with Network fallback
  event.respondWith(
    (async () => {
      // Try cache first
      const cachedResponse = await caches.match(event.request);
      if (cachedResponse) {
        return cachedResponse;
      }

      // Try network
      try {
        const networkResponse = await fetch(event.request);
        
        // Only cache successful, non-opaque responses
        if (networkResponse.status === 200 && 
            networkResponse.type !== 'opaque') {
          const cache = await caches.open(CACHE_NAME);
          cache.put(event.request, networkResponse.clone());
        }
        
        return networkResponse;
      } catch (error) {
        // Network failed - provide fallback based on request type
        console.log('Network failed for:', event.request.url);
        
        if (event.request.destination === 'image') {
          return new Response(PLACEHOLDER_SVG, {
            headers: { 'Content-Type': 'image/svg+xml' }
          });
        }
        
        if (event.request.headers.get('Accept')?.includes('application/json')) {
          return new Response('{"error": "offline"}', {
            headers: { 'Content-Type': 'application/json' }
          });
        }
        
        // For other resources, return a basic offline response
        return new Response('Offline - Resource not available', {
          status: 408,
          headers: { 'Content-Type': 'text/plain' }
        });
      }
    })()
  );
});

// BACKGROUND SYNC
self.addEventListener('sync', event => {
  if (event.tag === 'sync-contributions') {
    console.log('Background sync triggered:', event.tag);
    event.waitUntil(syncContributions());
  }
});

async function syncContributions() {
  try {
    const db = await idb.openDB('tudien-contributions', 1);
    const tx = db.transaction('pending', 'readonly');
    const store = tx.objectStore('pending');
    const pending = await store.getAll();
    await tx.done;
    
    console.log(`Found ${pending.length} pending contributions`);
    
    for (const contribution of pending) {
      try {
        await fetch('https://script.google.com/macros/s/AKfycbz9XYdorp6vsKFTCrqx2tUSJGecpOmCbrROqKfkHYSFn2WXieQtJXWCQvSJvxCk6yrs/exec', {
          method: 'POST',
          body: JSON.stringify(contribution),
          headers: { 'Content-Type': 'text/plain;charset=utf-8' }
        });
        
        // Remove from pending if successful
        const deleteTx = db.transaction('pending', 'readwrite');
        await deleteTx.objectStore('pending').delete(contribution.id);
        await deleteTx.done;
        
        console.log('Successfully synced contribution:', contribution.id);
      } catch (err) {
        console.error('Failed to sync contribution:', contribution.id, err);
        // Keep in pending for next retry
      }
    }
  } catch (error) {
    console.error('Background sync failed:', error);
  }
}

// PUSH NOTIFICATIONS
self.addEventListener('push', event => {
  if (!event.data) return;
  
  let data;
  try {
    data = event.data.json();
  } catch (e) {
    data = {
      title: 'Từ điển Xơ Đăng',
      body: event.data.text() || 'Có thông báo mới',
      icon: '/icon-192x192.png'
    };
  }
  
  const options = {
    body: data.body,
    icon: data.icon || '/icon-192x192.png',
    badge: '/badge-72x72.png',
    tag: data.tag || 'tudien-update',
    data: {
      url: data.url || '/',
      timestamp: Date.now()
    },
    actions: data.actions || [
      {
        action: 'open',
        title: 'Mở ứng dụng'
      }
    ]
  };
  
  event.waitUntil(
    self.registration.showNotification(data.title || 'Từ điển Xơ Đăng', options)
  );
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  
  const urlToOpen = event.notification.data?.url || '/';
  
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true })
      .then(clientList => {
        // Check if there's already a window open
        for (const client of clientList) {
          if (client.url === urlToOpen && 'focus' in client) {
            return client.focus();
          }
        }
        // Open new window
        if (clients.openWindow) {
          return clients.openWindow(urlToOpen);
        }
      })
  );
});

// Periodic Sync (if supported)
if ('periodicSync' in self.registration) {
  self.addEventListener('periodicsync', event => {
    if (event.tag === 'update-dictionary') {
      console.log('Periodic sync for dictionary update');
      event.waitUntil(updateDictionaryData());
    }
  });
}

async function updateDictionaryData() {
  // Update cached dictionary data periodically
  const cache = await caches.open(CACHE_NAME);
  const apiUrl = 'https://sheets.googleapis.com/v4/spreadsheets/1Z59pDBu_tGwlYqUeS1-VJLpcHozp7LbxnC_-qhT3iHs/values/Tu_Dien!A2:F?key=AIzaSyD757jS4SLR7-EzrPgrW9WrLQeD2DQExHw';
  
  try {
    const response = await fetch(apiUrl);
    if (response.ok) {
      await cache.put(apiUrl, response.clone());
      console.log('Dictionary data updated via periodic sync');
    }
  } catch (error) {
    console.error('Periodic sync failed:', error);
  }
}

// Message handling from main thread
self.addEventListener('message', event => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
  
  if (event.data && event.data.type === 'CACHE_URLS') {
    caches.open(CACHE_NAME).then(cache => {
      return cache.addAll(event.data.urls);
    });
  }
});
