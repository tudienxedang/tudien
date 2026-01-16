// service-worker.js - EMERGENCY FIX - Version 2.1
// GIỮ NGUYÊN API KEY - FIX LỖI 408

// ==================== CẤU HÌNH QUAN TRỌNG ====================
const APP_VERSION = '9.1.0';
const CACHE_NAME = `tudien-${APP_VERSION}`;
const OFFLINE_PAGE = './offline.html';

// ==================== FILE CẦN CACHE ====================
const STATIC_FILES = [
  './',
  './index.html',
  './offline.html',
  './game.html',
  './manifest.json',
  './favicon.png',
  './badge-72x72.png',
  './icon-48x48.png',
  './icon-72x72.png',
  './icon-96x96.png',
  './icon-128x128.png',
  './icon-144x144.png',
  './icon-152x152.png',
  './icon-192x192.png',
  './icon-256x256.png',
  './icon-384x384.png',
  './icon-512x512.png'
];

// ==================== GOOGLE SHEETS CONFIG ====================
const GOOGLE_CONFIG = {
  API_KEY: 'AIzaSyD757jS4SLR7-EzrPgrW9WrLQeD2DQExHw',
  SHEET_ID: '1Z59pDBu_tGwlYqUeS1-VJLpcHozp7LbxnC_-qhT3iHs',
  
  get SHEETS_VOCAB_URL() {
    return `https://sheets.googleapis.com/v4/spreadsheets/${this.SHEET_ID}/values/Tu_Dien!A2:F?key=${this.API_KEY}`;
  },
  
  get SHEETS_CHAT_URL() {
    return `https://sheets.googleapis.com/v4/spreadsheets/${this.SHEET_ID}/values/Data_Chat!A2:B?key=${this.API_KEY}`;
  },
  
  get SHEETS_QUIZ_URL() {
    return `https://sheets.googleapis.com/v4/spreadsheets/${this.SHEET_ID}/values/Data_Tracnghiem!A2:H?key=${this.API_KEY}`;
  },
  
  APPS_SCRIPT_URL: 'https://script.google.com/macros/s/AKfycbz9XYdorp6vsKFTCrqx2tUSJGecpOmCbrROqKfkHYSFn2WXieQtJXWCQvSJvxCk6yrs/exec'
};

// ==================== CÀI ĐẶT ====================
self.addEventListener('install', (event) => {
  console.log('🔄 Đang cài đặt Service Worker...');
  
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      console.log('📦 Đang cache file quan trọng...');
      
      const promises = STATIC_FILES.map((url) => {
        return cache.add(url).catch((err) => {
          console.warn(`⚠️ Không cache được: ${url}`, err.message);
          return Promise.resolve();
        });
      });
      
      return Promise.all(promises);
    }).then(() => {
      console.log('✅ Cài đặt thành công!');
      return self.skipWaiting();
    }).catch((err) => {
      console.error('❌ Lỗi cài đặt:', err);
      return self.skipWaiting();
    })
  );
});

// ==================== KÍCH HOẠT ====================
self.addEventListener('activate', (event) => {
  console.log('🚀 Service Worker đang kích hoạt...');
  
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cacheName) => {
          if (cacheName !== CACHE_NAME) {
            console.log(`🗑️ Xóa cache cũ: ${cacheName}`);
            return caches.delete(cacheName);
          }
        })
      );
    }).then(() => {
      console.log('✅ Service Worker sẵn sàng!');
      return self.clients.claim();
    })
  );
});

// ==================== XỬ LÝ FETCH - FIX LỖI 408 ====================
self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  
  const url = new URL(event.request.url);
  
  // 1. GOOGLE SHEETS API - FIX LỖI 408 (Timeout)
  if (url.hostname === 'sheets.googleapis.com') {
    event.respondWith(handleSheetsRequest(event.request));
    return;
  }
  
  // 2. GOOGLE APPS SCRIPT
  if (url.hostname.includes('script.google.com')) {
    event.respondWith(handleAppsScriptRequest(event.request));
    return;
  }
  
  // 3. CDN & FONTS - Không cache
  if (url.hostname.includes('fonts.googleapis.com') || 
      url.hostname.includes('fonts.gstatic.com') ||
      url.hostname.includes('cdnjs.cloudflare.com') ||
      url.hostname.includes('cdn.tailwindcss.com') ||
      url.hostname.includes('cdn.jsdelivr.net')) {
    return;
  }
  
  // 4. TRANG HTML
  if (event.request.mode === 'navigate') {
    event.respondWith(handleNavigationRequest(event.request));
    return;
  }
  
  // 5. FILE TĨNH CỦA BẠN
  if (url.origin === self.location.origin) {
    event.respondWith(handleStaticRequest(event.request));
    return;
  }
});

// ==================== HÀM XỬ LÝ SHEETS API - FIX LỖI 408 ====================
async function handleSheetsRequest(request) {
  console.log('📊 Đang xử lý Sheets API request...');
  
  // Tạo cache key
  const cacheKey = request;
  
  try {
    // THỬ LẤY TỪ CACHE TRƯỚC
    const cached = await caches.match(cacheKey);
    if (cached) {
      const cacheTime = new Date(cached.headers.get('sw-cache-time') || 0);
      const now = new Date();
      const cacheAge = (now - cacheTime) / 1000 / 60; // phút
      
      // Nếu cache còn mới (dưới 30 phút), trả về cache
      if (cacheAge < 30) {
        console.log('✅ Trả về Sheets data từ cache (fresh)');
        return cached;
      }
    }
    
    // Tạo request mới với timeout ngắn hơn
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 8000); // 8 giây
    
    const fetchOptions = {
      signal: controller.signal,
      headers: {
        'Accept': 'application/json',
        'Cache-Control': 'no-cache'
      }
    };
    
    const response = await fetch(request, fetchOptions);
    clearTimeout(timeoutId);
    
    if (response.ok) {
      console.log('✅ Sheets API thành công, lưu vào cache');
      
      // Clone response để cache
      const responseToCache = response.clone();
      
      // Thêm thời gian cache vào headers
      const headers = new Headers(responseToCache.headers);
      headers.append('sw-cache-time', new Date().toISOString());
      
      const cachedResponse = new Response(responseToCache.body, {
        status: responseToCache.status,
        statusText: responseToCache.statusText,
        headers: headers
      });
      
      // Lưu vào cache
      const cache = await caches.open(CACHE_NAME);
      await cache.put(cacheKey, cachedResponse);
      
      return response;
    } else {
      throw new Error(`HTTP ${response.status}`);
    }
    
  } catch (error) {
    console.warn('⚠️ Sheets API lỗi:', error.message);
    
    // Thử lấy từ cache (cũ cũng được)
    const cached = await caches.match(cacheKey);
    if (cached) {
      console.log('✅ Trả về Sheets data từ cache (stale)');
      return cached;
    }
    
    // Fallback cuối cùng
    console.warn('⚠️ Không có cache, trả về data rỗng');
    return new Response(
      JSON.stringify({
        range: "Sheet1!A1:Z1000",
        majorDimension: "ROWS",
        values: [],
        offline: true,
        timestamp: new Date().toISOString()
      }),
      {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
          'Cache-Control': 'no-store',
          'X-Fallback': 'true'
        }
      }
    );
  }
}

// ==================== HÀM XỬ LÝ APPS SCRIPT ====================
async function handleAppsScriptRequest(request) {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000);
    
    const response = await fetch(request, { signal: controller.signal });
    clearTimeout(timeoutId);
    
    return response;
  } catch (error) {
    console.log('📴 Apps Script lỗi (offline)');
    
    return new Response(
      JSON.stringify({
        success: false,
        message: 'Đang offline, sẽ gửi lại sau',
        offline: true
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
    const response = await fetch(request);
    
    if (response.ok) {
      const cache = await caches.open(CACHE_NAME);
      cache.put(request, response.clone());
    }
    
    return response;
  } catch (error) {
    console.log('🌐 Offline - Hiển thị trang từ cache');
    
    const cached = await caches.match(request);
    if (cached) return cached;
    
    const offlinePage = await caches.match(OFFLINE_PAGE);
    if (offlinePage) return offlinePage;
    
    return new Response(
      `<!DOCTYPE html>
      <html>
        <head><meta charset="UTF-8"><title>Offline</title></head>
        <body style="padding:40px;font-family:Arial;">
          <h1>Ứng dụng không khả dụng offline</h1>
          <p>Vui lòng kiểm tra kết nối mạng.</p>
        </body>
      </html>`,
      {
        status: 200,
        headers: { 'Content-Type': 'text/html' }
      }
    );
  }
}

// ==================== HÀM XỬ LÝ FILE TĨNH ====================
async function handleStaticRequest(request) {
  const cached = await caches.match(request);
  if (cached) return cached;
  
  try {
    const response = await fetch(request);
    
    if (response.ok) {
      const cache = await caches.open(CACHE_NAME);
      cache.put(request, response.clone());
    }
    
    return response;
  } catch (error) {
    console.log('❌ Không tải được file:', request.url);
    
    if (request.destination === 'image') {
      return new Response(
        `<svg width="100" height="100" xmlns="http://www.w3.org/2000/svg">
          <rect width="100" height="100" fill="#f0f0f0"/>
          <text x="50" y="50" text-anchor="middle" fill="#999">IMG</text>
        </svg>`,
        {
          headers: { 'Content-Type': 'image/svg+xml' }
        }
      );
    }
    
    return new Response('Not Found', {
      status: 404,
      headers: { 'Content-Type': 'text/plain' }
    });
  }
}

// ==================== XỬ LÝ PUSH NOTIFICATION ====================
self.addEventListener('push', (event) => {
  const options = {
    body: 'Có thông báo mới từ Từ điển Xơ Đăng',
    icon: './icon-192x192.png',
    badge: './badge-72x72.png',
    vibrate: [200, 100, 200]
  };
  
  event.waitUntil(
    self.registration.showNotification('Từ điển Xơ Đăng', options)
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(
    clients.openWindow('./')
  );
});

// ==================== XỬ LÝ MESSAGE TỪ TRANG CHÍNH ====================
self.addEventListener('message', (event) => {
  const { type } = event.data || {};
  
  if (type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
  
  if (type === 'CLEAR_CACHE') {
    clearOldCaches();
  }
});

async function clearOldCaches() {
  const cacheNames = await caches.keys();
  await Promise.all(
    cacheNames.map(cacheName => caches.delete(cacheName))
  );
  console.log('✅ Đã xóa tất cả cache');
}

// ==================== THÔNG BÁO KHỞI ĐỘNG ====================
console.log('✅ Service Worker đã tải!');
console.log('📊 Cache name:', CACHE_NAME);
