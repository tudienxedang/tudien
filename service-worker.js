// service-worker-fixed.js - BẢN FIX LỖI BẢO MẬT
// Phiên bản 3.0 - AN TOÀN HƠN

// ==================== CẤU HÌNH QUAN TRỌNG ====================
const APP_VERSION = '9.0.0';
const CACHE_NAME = `tudien-xodang-${APP_VERSION}`;
const OFFLINE_PAGE = './offline.html';

// ==================== FILE CẦN CACHE ====================
const STATIC_FILES = [
  './',
  './index.html',
  './offline.html',
  './manifest.json',
  
  // Favicon và icons
  './favicon.png',
  './badge-72x72.png',
  
  // Các icon
  './icon-48x48.png',
  './icon-72x72.png',
  './icon-96x96.png',
  './icon-128x128.png',
  './icon-144x144.png',
  './icon-192x192.png',
  './icon-512x512.png'
];

// ==================== CÀI ĐẶT SERVICE WORKER ====================
self.addEventListener('install', (event) => {
  console.log('🔄 Đang cài đặt Service Worker...');
  
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      console.log('📦 Đang cache file quan trọng...');
      
      // Cache từng file một
      const cachePromises = STATIC_FILES.map(url => {
        return cache.add(url).catch(err => {
          console.warn(`⚠️ Không cache được ${url}:`, err);
          return null;
        });
      });
      
      return Promise.all(cachePromises);
    })
    .then(() => self.skipWaiting())
    .catch(err => {
      console.error('❌ Lỗi cài đặt:', err);
      return self.skipWaiting();
    })
  );
});

// ==================== KÍCH HOẠT ====================
self.addEventListener('activate', (event) => {
  console.log('🚀 Service Worker đang kích hoạt...');
  
  event.waitUntil(
    caches.keys().then(cacheNames => {
      return Promise.all(
        cacheNames.map(cacheName => {
          if (cacheName !== CACHE_NAME) {
            console.log(`🗑️ Xóa cache cũ: ${cacheName}`);
            return caches.delete(cacheName);
          }
        })
      );
    })
    .then(() => self.clients.claim())
    .then(() => {
      console.log('✅ Service Worker đã sẵn sàng!');
      
      // Gửi thông báo đến tất cả clients
      self.clients.matchAll().then(clients => {
        clients.forEach(client => {
          client.postMessage({
            type: 'SW_ACTIVATED',
            version: APP_VERSION
          });
        });
      });
    })
  );
});

// ==================== XỬ LÝ FETCH ====================
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  
  // Bỏ qua không phải GET
  if (event.request.method !== 'GET') return;
  
  // Xử lý các loại request khác nhau
  if (url.origin === self.location.origin) {
    // Request từ cùng origin
    if (event.request.mode === 'navigate') {
      event.respondWith(handleNavigationRequest(event.request));
    } else {
      event.respondWith(handleStaticRequest(event.request));
    }
  } else if (url.hostname.includes('sheets.googleapis.com')) {
    // Google Sheets API - SỬ DỤNG PROXY THAY VÌ KEY TRỰC TIẾP
    event.respondWith(handleSheetsRequest(event.request));
  } else if (url.hostname.includes('script.google.com')) {
    // Google Apps Script
    event.respondWith(handleAppsScriptRequest(event.request));
  } else {
    // Các request khác (CDN, fonts) - để trình duyệt xử lý
    return;
  }
});

// ==================== HÀM XỬ LÝ SHEETS API MỚI ====================
async function handleSheetsRequest(request) {
  console.log('📊 Đang xử lý Sheets API request...');
  
  try {
    // TẠO PROXY REQUEST - KHÔNG DÙNG KEY TRỰC TIẾP
    const url = new URL(request.url);
    const path = url.pathname;
    
    // Sử dụng proxy thay vì gọi trực tiếp
    const proxyUrl = `${GOOGLE_CONFIG.APPS_SCRIPT_URL}?action=getSheetsData&sheet=${encodeURIComponent(path)}`;
    
    const response = await fetch(proxyUrl, {
      headers: {
        'Accept': 'application/json',
        'X-Requested-With': 'XMLHttpRequest'
      },
      signal: AbortSignal.timeout(15000) // Timeout 15s
    });
    
    if (!response.ok) {
      throw new Error(`Proxy error: ${response.status}`);
    }
    
    return response;
    
  } catch (error) {
    console.warn('⚠️ Lỗi khi lấy dữ liệu Sheets:', error.message);
    
    // Thử lấy từ cache nếu có
    const cached = await caches.match(request);
    if (cached) {
      console.log('✅ Trả về dữ liệu từ cache');
      return cached;
    }
    
    // Fallback với dữ liệu rỗng
    return new Response(
      JSON.stringify({
        values: [],
        offline: true,
        timestamp: new Date().toISOString()
      }),
      {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
          'Cache-Control': 'no-cache',
          'X-Fallback': 'cache-miss'
        }
      }
    );
  }
}

// ==================== HÀM XỬ LÝ APPS SCRIPT ====================
async function handleAppsScriptRequest(request) {
  try {
    const response = await fetch(request, {
      signal: AbortSignal.timeout(10000)
    });
    
    if (!response.ok) {
      throw new Error(`Apps Script error: ${response.status}`);
    }
    
    return response;
    
  } catch (error) {
    console.log('📴 Không gửi được data (offline hoặc lỗi)');
    
    return new Response(
      JSON.stringify({
        success: false,
        message: 'Đang offline hoặc có lỗi kết nối',
        offline: true,
        retry: true
      }),
      {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      }
    );
  }
}

// ==================== HÀM XỬ LÝ TRANG HTML ====================
async function handleNavigationRequest(request) {
  try {
    // Thử fetch từ network trước
    const networkResponse = await fetch(request);
    
    // Cache response nếu thành công
    if (networkResponse.ok) {
      const cache = await caches.open(CACHE_NAME);
      cache.put(request, networkResponse.clone());
    }
    
    return networkResponse;
    
  } catch (error) {
    console.log('🌐 Offline - Hiển thị trang từ cache');
    
    // Thử lấy từ cache
    const cached = await caches.match(request);
    if (cached) return cached;
    
    // Fallback: offline page
    const offlinePage = await caches.match(OFFLINE_PAGE);
    if (offlinePage) return offlinePage;
    
    // Final fallback
    return new Response(
      '<h1>Offline</h1><p>Vui lòng kết nối internet</p>',
      {
        status: 200,
        headers: { 'Content-Type': 'text/html' }
      }
    );
  }
}

// ==================== HÀM XỬ LÝ FILE TĨNH ====================
async function handleStaticRequest(request) {
  // Luôn thử cache trước cho performance
  const cached = await caches.match(request);
  if (cached) {
    console.log(`✅ Phục vụ ${request.url} từ cache`);
    return cached;
  }
  
  try {
    // Fetch từ network
    const response = await fetch(request);
    
    // Cache nếu thành công
    if (response.ok) {
      const cache = await caches.open(CACHE_NAME);
      cache.put(request, response.clone());
    }
    
    return response;
    
  } catch (error) {
    console.log(`❌ Không tải được file: ${request.url}`);
    
    // Fallback cho ảnh
    if (request.destination === 'image') {
      return new Response(
        `<svg width="100" height="100" xmlns="http://www.w3.org/2000/svg">
          <rect width="100" height="100" fill="#f0f0f0"/>
          <text x="50" y="50" text-anchor="middle" fill="#ccc">IMG</text>
        </svg>`,
        { headers: { 'Content-Type': 'image/svg+xml' } }
      );
    }
    
    return new Response('Resource not available offline', {
      status: 404,
      headers: { 'Content-Type': 'text/plain' }
    });
  }
}

// ==================== PUSH NOTIFICATIONS ====================
self.addEventListener('push', (event) => {
  const data = event.data ? event.data.json() : {};
  
  const options = {
    body: data.body || 'Có thông báo mới từ Từ điển Xơ Đăng',
    icon: './icon-192x192.png',
    badge: './badge-72x72.png',
    vibrate: [200, 100, 200],
    data: {
      url: data.url || './'
    }
  };
  
  event.waitUntil(
    self.registration.showNotification('Từ điển Xơ Đăng', options)
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true })
    .then(clientList => {
      // Mở hoặc focus window
      for (const client of clientList) {
        if (client.url === event.notification.data.url && 'focus' in client) {
          return client.focus();
        }
      }
      
      if (clients.openWindow) {
        return clients.openWindow(event.notification.data.url || './');
      }
    })
  );
});

// ==================== XỬ LÝ MESSAGE ====================
self.addEventListener('message', (event) => {
  const { type, data } = event.data || {};
  
  switch (type) {
    case 'SKIP_WAITING':
      self.skipWaiting();
      break;
      
    case 'CLEAR_CACHE':
      caches.keys().then(cacheNames => {
        return Promise.all(
          cacheNames.map(name => caches.delete(name))
        );
      }).then(() => {
        event.ports[0].postMessage({ success: true });
      });
      break;
      
    case 'GET_CACHE_INFO':
      caches.keys().then(cacheNames => {
        event.ports[0].postMessage({
          cacheNames,
          currentCache: CACHE_NAME,
          version: APP_VERSION
        });
      });
      break;
  }
});

// ==================== CONFIG (KHÔNG CHỨA API KEY) ====================
const GOOGLE_CONFIG = {
  // KHÔNG CHỨA API KEY Ở ĐÂY
  // Sử dụng Apps Script làm proxy
  APPS_SCRIPT_URL: 'https://script.google.com/macros/s/AKfycbz9XYdorp6vsKFTCrqx2tUSJGecpOmCbrROqKfkHYSFn2WXieQtJXWCQvSJvxCk6yrs/exec'
};

console.log('✅ Service Worker đã tải - Phiên bản ' + APP_VERSION);
