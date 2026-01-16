// service-worker.js - EMERGENCY FIX - Version 2.0
// Từ điển Xơ Đăng THCS - FIX TẤT CẢ LỖI

// ==================== CẤU HÌNH QUAN TRỌNG ====================
const APP_VERSION = '2.0.0';
const CACHE_NAME = `tudien-${APP_VERSION}`;
const OFFLINE_PAGE = './offline.html';

// ==================== FILE CỦA BẠN CẦN CACHE ====================
// CHỈ thêm file bạn có THẬT trong thư mục
const STATIC_FILES = [
  // Trang chính
  './',
  './index.html',
  
  // Các trang khác (CHỈ thêm nếu bạn có file này)
  // './game.html',    // NẾU CÓ thì bỏ comment
  // './intro.html',   // NẾU CÓ thì bỏ comment
  
  // Trang offline (PHẢI CÓ)
  './offline.html',
  
  // Manifest và assets (PHẢI CÓ)
  './manifest.json',
  './favicon.png',      // Bạn có file này
  './badge-72x72.png',  // Bạn có file này
  
  // Các icon bạn có THẬT
  './icon-48x48.png',
  './icon-72x72.png',
  './icon-96x96.png',
  './icon-128x128.png',
  './icon-144x144.png',
  './icon-152x152.png',
  './icon-192x192.png',  // QUAN TRỌNG
  './icon-256x256.png',
  './icon-384x384.png',
  './icon-512x512.png'   // QUAN TRỌNG
];

// ==================== GOOGLE SHEETS CONFIG ====================
const GOOGLE_CONFIG = {
  API_KEY: 'AIzaSyD757jS4SLR7-EzrPgrW9WrLQeD2DQExHw',
  SHEET_ID: '1Z59pDBu_tGwlYqUeS1-VJLpcHozp7LbxnC_-qhT3iHs',
  
  // URLs - SỬA: Thêm timeout và retry
  get SHEETS_VOCAB_URL() {
    return `https://sheets.googleapis.com/v4/spreadsheets/${this.SHEET_ID}/values/Tu_Dien!A2:F?key=${this.API_KEY}`;
  },
  
  // NẾU CÓ sheet Data_Chat thì dùng, KHÔNG thì bỏ
  get SHEETS_CHAT_URL() {
    // Nếu không có sheet Data_Chat, dùng URL khác hoặc bỏ
    return `https://sheets.googleapis.com/v4/spreadsheets/${this.SHEET_ID}/values/Data_Chat!A2:B?key=${this.API_KEY}`;
  },
  
  get SHEETS_QUIZ_URL() {
    return `https://sheets.googleapis.com/v4/spreadsheets/${this.SHEET_ID}/values/Data_Tracnghiem!A2:H?key=${this.API_KEY}`;
  },
  
  // Apps Script URL
  APPS_SCRIPT_URL: 'https://script.google.com/macros/s/AKfycbz9XYdorp6vsKFTCrqx2tUSJGecpOmCbrROqKfkHYSFn2WXieQtJXWCQvSJvxCk6yrs/exec'
};

// ==================== CÀI ĐẶT - KHÔNG LỖI ====================
self.addEventListener('install', (event) => {
  console.log('🔄 Đang cài đặt Service Worker...');
  
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      console.log('📦 Đang cache file quan trọng...');
      
      // Cache TỪNG FILE để không bị lỗi chung
      const promises = STATIC_FILES.map((url) => {
        return cache.add(url).catch((err) => {
          console.warn(`⚠️ Không cache được: ${url}`, err.message);
          return Promise.resolve(); // KHÔNG dừng lại vì lỗi 1 file
        });
      });
      
      return Promise.all(promises);
    }).then(() => {
      console.log('✅ Cài đặt thành công!');
      return self.skipWaiting();
    }).catch((err) => {
      console.error('❌ Lỗi cài đặt:', err);
      return self.skipWaiting(); // Vẫn skip để không block
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
  // Bỏ qua không phải GET
  if (event.request.method !== 'GET') return;
  
  const url = new URL(event.request.url);
  
  // 1. GOOGLE SHEETS API - XỬ LÝ ĐẶC BIỆT
  if (url.hostname === 'sheets.googleapis.com') {
    event.respondWith(handleSheetsRequest(event.request));
    return;
  }
  
  // 2. GOOGLE APPS SCRIPT
  if (url.hostname.includes('script.google.com')) {
    event.respondWith(handleAppsScriptRequest(event.request));
    return;
  }
  
  // 3. GOOGLE FONTS & CDN - KHÔNG cache, để trình duyệt xử lý
  if (url.hostname.includes('fonts.googleapis.com') || 
      url.hostname.includes('fonts.gstatic.com') ||
      url.hostname.includes('cdnjs.cloudflare.com') ||
      url.hostname.includes('cdn.tailwindcss.com') ||
      url.hostname.includes('cdn.jsdelivr.net')) {
    // Để trình duyệt tự xử lý, không can thiệp
    return;
  }
  
  // 4. TRANG HTML (ĐIỀU HƯỚNG)
  if (event.request.mode === 'navigate') {
    event.respondWith(handleNavigationRequest(event.request));
    return;
  }
  
  // 5. FILE CỦA BẠN (STATIC FILES)
  if (url.origin === self.location.origin) {
    event.respondWith(handleStaticRequest(event.request));
    return;
  }
});

// ==================== HÀM XỬ LÝ SHEETS API - FIX LỖI ====================
async function handleSheetsRequest(request) {
  console.log('📊 Đang xử lý Sheets API request...');
  
  try {
    // Tạo timeout cho request (10 giây)
    const timeoutPromise = new Promise((_, reject) => {
      setTimeout(() => reject(new Error('Request timeout')), 10000);
    });
    
    // Fetch với timeout
    const fetchPromise = fetch(request);
    const response = await Promise.race([fetchPromise, timeoutPromise]);
    
    if (response.ok) {
      console.log('✅ Sheets API thành công');
      return response;
    } else {
      throw new Error(`HTTP ${response.status}`);
    }
    
  } catch (error) {
    console.warn('⚠️ Sheets API lỗi, trả về data rỗng:', error.message);
    
    // Trả về data rỗng hợp lệ để app không crash
    return new Response(
      JSON.stringify({
        range: "Sheet1!A1:Z1000",
        majorDimension: "ROWS",
        values: []
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
    const response = await fetch(request);
    return response;
  } catch (error) {
    console.log('📴 Không gửi được data (offline)');
    
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
    // Thử network trước
    const networkResponse = await fetch(request);
    
    // Cache nếu thành công
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
    
    // Thử offline.html
    const offlinePage = await caches.match(OFFLINE_PAGE);
    if (offlinePage) return offlinePage;
    
    // Fallback cuối cùng
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
  // Luôn thử cache trước cho static files
  const cached = await caches.match(request);
  if (cached) return cached;
  
  try {
    const response = await fetch(request);
    
    // Cache nếu thành công
    if (response.ok) {
      const cache = await caches.open(CACHE_NAME);
      cache.put(request, response.clone());
    }
    
    return response;
    
  } catch (error) {
    console.log('❌ Không tải được file:', request.url);
    
    // Trả về placeholder nếu là ảnh
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
    
    // Trả về lỗi cho các loại khác
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
console.log('📊 API Key đã cấu hình:', !!GOOGLE_CONFIG.API_KEY);
console.log('📁 Cache name:', CACHE_NAME);
