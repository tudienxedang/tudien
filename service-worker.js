// service-worker.js - HOÀN CHỈNH CHO PWA
// Từ điển Xơ Đăng THCS - Version 1.0.0

// ==================== CẤU HÌNH CƠ BẢN ====================
const APP_VERSION = '1.0.0';
const CACHE_NAME = `tudien-xodang-${APP_VERSION}`;
const OFFLINE_PAGE = './offline.html';

// ==================== FILE CẦN CACHE ====================
// CHỈ thêm các file BẠN CÓ THẬT trong thư mục
const FILES_TO_CACHE = [
  // Trang chính
  './',
  './index.html',
  
  // Các trang khác (nếu có)
  './game.html',
  './intro.html',
  
  // Trang offline
  './offline.html',
  
  // Manifest và assets
  './manifest.json',
  './favicon.png',
  './badge-72x72.png',
  
  // Các icon bạn có (thêm tất cả)
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

// ==================== CẤU HÌNH GOOGLE SHEETS ====================
// API của bạn
const GOOGLE_CONFIG = {
  API_KEY: 'AIzaSyD757jS4SLR7-EzrPgrW9WrLQeD2DQExHw',
  SHEET_ID: '1Z59pDBu_tGwlYqUeS1-VJLpcHozp7LbxnC_-qhT3iHs',
  
  // Sheets URL
  get SHEETS_URL() {
    return `https://sheets.googleapis.com/v4/spreadsheets/${this.SHEET_ID}/values/Tu_Dien!A2:F?key=${this.API_KEY}`;
  },
  
  // Chat Data URL (nếu bạn có sheet Data_Chat)
  get CHAT_DATA_URL() {
    return `https://sheets.googleapis.com/v4/spreadsheets/${this.SHEET_ID}/values/Data_Chat!A2:D?key=${this.API_KEY}`;
  },
  
  // Apps Script URL
  APPS_SCRIPT_URL: 'https://script.google.com/macros/s/AKfycbz9XYdorp6vsKFTCrqx2tUSJGecpOmCbrROqKfkHYSFn2WXieQtJXWCQvSJvxCk6yrs/exec'
};

// ==================== CÀI ĐẶT SERVICE WORKER ====================

// Khi cài đặt - cache tất cả file cần thiết
self.addEventListener('install', function(event) {
  console.log('🔄 Service Worker đang cài đặt...');
  
  event.waitUntil(
    caches.open(CACHE_NAME).then(function(cache) {
      console.log('📦 Đang cache các file quan trọng...');
      
      // Cache từng file để tránh lỗi 1 file làm hỏng cả quá trình
      const cachePromises = FILES_TO_CACHE.map(function(url) {
        return cache.add(url).catch(function(error) {
          console.log('⚠️ Không thể cache:', url, error);
          // Tiếp tục với file khác, không dừng lại
        });
      });
      
      return Promise.all(cachePromises);
    })
    .then(function() {
      console.log('✅ Cài đặt thành công!');
      return self.skipWaiting();
    })
  );
});

// Khi kích hoạt - xóa cache cũ
self.addEventListener('activate', function(event) {
  console.log('🔄 Service Worker đang kích hoạt...');
  
  event.waitUntil(
    caches.keys().then(function(cacheNames) {
      return Promise.all(
        cacheNames.map(function(cacheName) {
          if (cacheName !== CACHE_NAME) {
            console.log('🗑️ Xóa cache cũ:', cacheName);
            return caches.delete(cacheName);
          }
        })
      );
    })
    .then(function() {
      console.log('✅ Service Worker đã sẵn sàng!');
      return self.clients.claim();
    })
  );
});

// ==================== XỬ LÝ FETCH REQUEST ====================

self.addEventListener('fetch', function(event) {
  // Chỉ xử lý GET request
  if (event.request.method !== 'GET') return;
  
  const url = new URL(event.request.url);
  
  // 1. Xử lý Google Sheets API
  if (url.href === GOOGLE_CONFIG.SHEETS_URL || url.href === GOOGLE_CONFIG.CHAT_DATA_URL) {
    event.respondWith(handleSheetsRequest(event.request));
    return;
  }
  
  // 2. Xử lý Apps Script
  if (url.hostname.includes('script.google.com')) {
    event.respondWith(handleAppsScriptRequest(event.request));
    return;
  }
  
  // 3. Xử lý trang HTML (navigation)
  if (event.request.mode === 'navigate') {
    event.respondWith(handleNavigationRequest(event.request));
    return;
  }
  
  // 4. Xử lý tất cả request khác
  event.respondWith(handleOtherRequest(event.request));
});

// ==================== CÁC HÀM XỬ LÝ REQUEST ====================

// Xử lý request đến Google Sheets
async function handleSheetsRequest(request) {
  try {
    // Thử lấy từ cache trước
    const cache = await caches.open(CACHE_NAME);
    const cachedResponse = await cache.match(request);
    
    if (cachedResponse) {
      console.log('📊 Trả về dữ liệu từ cache');
      
      // Đồng thời cập nhật cache ở background
      updateSheetsInBackground(request);
      
      return cachedResponse;
    }
    
    // Nếu không có cache, lấy từ mạng
    console.log('🌐 Đang tải dữ liệu từ Google Sheets...');
    const networkResponse = await fetch(request);
    
    // Cache response để dùng sau
    if (networkResponse.ok) {
      await cache.put(request, networkResponse.clone());
    }
    
    return networkResponse;
    
  } catch (error) {
    console.log('❌ Lỗi khi tải dữ liệu:', error);
    
    // Trả về dữ liệu rỗng nếu offline
    return new Response(
      JSON.stringify({
        error: 'offline',
        message: 'Không thể kết nối đến Google Sheets',
        values: []
      }),
      {
        headers: { 'Content-Type': 'application/json' }
      }
    );
  }
}

// Cập nhật Sheets trong background
async function updateSheetsInBackground(request) {
  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(CACHE_NAME);
      await cache.put(request, response.clone());
      console.log('🔄 Đã cập nhật dữ liệu trong background');
    }
  } catch (error) {
    // Không làm gì nếu không thể cập nhật
  }
}

// Xử lý request đến Apps Script
async function handleAppsScriptRequest(request) {
  try {
    // Thử gửi request thật
    const response = await fetch(request);
    
    if (response.ok) {
      console.log('✅ Gửi dữ liệu thành công');
      return response;
    }
    
    throw new Error('Request không thành công');
    
  } catch (error) {
    console.log('📴 Đang offline - Lưu dữ liệu để gửi sau');
    
    // Lưu request vào IndexedDB để gửi sau
    await saveRequestForLater(request);
    
    return new Response(
      JSON.stringify({
        success: true,
        message: 'Đã lưu dữ liệu, sẽ gửi khi có mạng',
        offline: true
      }),
      {
        headers: { 'Content-Type': 'application/json' }
      }
    );
  }
}

// Xử lý request điều hướng (trang HTML)
async function handleNavigationRequest(request) {
  try {
    // Thử tải trang mới nhất từ mạng
    const response = await fetch(request);
    
    // Cache trang để dùng sau
    const cache = await caches.open(CACHE_NAME);
    await cache.put(request, response.clone());
    
    return response;
    
  } catch (error) {
    console.log('🌐 Không có mạng - Hiển thị trang từ cache');
    
    // Thử lấy trang từ cache
    const cached = await caches.match(request);
    if (cached) return cached;
    
    // Nếu không có, hiển thị trang offline
    const offlinePage = await caches.match(OFFLINE_PAGE);
    if (offlinePage) return offlinePage;
    
    // Fallback cuối cùng
    return new Response(
      '<h1>Không có kết nối mạng</h1><p>Vui lòng kiểm tra kết nối internet của bạn.</p>',
      {
        headers: { 'Content-Type': 'text/html' }
      }
    );
  }
}

// Xử lý các request khác (CSS, JS, hình ảnh)
async function handleOtherRequest(request) {
  // Thử lấy từ cache trước
  const cached = await caches.match(request);
  if (cached) return cached;
  
  try {
    // Thử tải từ mạng
    const response = await fetch(request);
    
    // Cache nếu thành công
    if (response.ok) {
      const cache = await caches.open(CACHE_NAME);
      await cache.put(request, response.clone());
    }
    
    return response;
    
  } catch (error) {
    console.log('❌ Không thể tải tài nguyên:', request.url);
    
    // Trả về placeholder cho hình ảnh
    if (request.destination === 'image') {
      return new Response(
        `<svg width="100" height="100" xmlns="http://www.w3.org/2000/svg">
          <rect width="100" height="100" fill="#f0f0f0"/>
          <text x="50" y="50" text-anchor="middle" fill="#999" font-size="10">No Image</text>
        </svg>`,
        {
          headers: { 'Content-Type': 'image/svg+xml' }
        }
      );
    }
    
    // Trả về response lỗi cho các loại khác
    return new Response(
      'Không thể tải tài nguyên',
      {
        status: 408,
        headers: { 'Content-Type': 'text/plain' }
      }
    );
  }
}

// ==================== LƯU REQUEST KHI OFFLINE ====================

// Lưu request để gửi sau khi có mạng
async function saveRequestForLater(request) {
  try {
    // Tạo database nếu chưa có
    const db = await openDatabase();
    
    // Lưu request
    const transaction = db.transaction(['pendingRequests'], 'readwrite');
    const store = transaction.objectStore('pendingRequests');
    
    const requestData = {
      url: request.url,
      method: request.method,
      timestamp: Date.now(),
      headers: Object.fromEntries(request.headers.entries()),
      body: await request.clone().text()
    };
    
    await store.add(requestData);
    
    console.log('💾 Đã lưu request để gửi sau');
    
    // Đăng ký sync
    if ('sync' in self.registration) {
      await self.registration.sync.register('send-pending-requests');
    }
    
  } catch (error) {
    console.log('❌ Không thể lưu request:', error);
  }
}

// Mở IndexedDB
function openDatabase() {
  return new Promise(function(resolve, reject) {
    const request = indexedDB.open('OfflineRequestsDB', 1);
    
    request.onerror = reject;
    
    request.onsuccess = function() {
      resolve(request.result);
    };
    
    request.onupgradeneeded = function(event) {
      const db = event.target.result;
      
      // Tạo store cho các request chờ
      if (!db.objectStoreNames.contains('pendingRequests')) {
        const store = db.createObjectStore('pendingRequests', {
          keyPath: 'id',
          autoIncrement: true
        });
        store.createIndex('timestamp', 'timestamp');
      }
    };
  });
}

// ==================== BACKGROUND SYNC ====================

// Xử lý background sync
self.addEventListener('sync', function(event) {
  if (event.tag === 'send-pending-requests') {
    console.log('🔄 Đang đồng bộ dữ liệu...');
    event.waitUntil(sendPendingRequests());
  }
});

// Gửi các request đang chờ
async function sendPendingRequests() {
  try {
    const db = await openDatabase();
    const transaction = db.transaction(['pendingRequests'], 'readonly');
    const store = transaction.objectStore('pendingRequests');
    const requests = await store.getAll();
    
    console.log(`📤 Đang gửi ${requests.length} request chờ...`);
    
    for (const requestData of requests) {
      try {
        // Gửi request
        await fetch(requestData.url, {
          method: requestData.method,
          headers: new Headers(requestData.headers),
          body: requestData.body
        });
        
        // Xóa request đã gửi thành công
        const deleteTransaction = db.transaction(['pendingRequests'], 'readwrite');
        const deleteStore = deleteTransaction.objectStore('pendingRequests');
        await deleteStore.delete(requestData.id);
        
        console.log('✅ Đã gửi request:', requestData.id);
        
      } catch (error) {
        console.log('❌ Không thể gửi request:', requestData.id, error);
      }
    }
    
  } catch (error) {
    console.log('❌ Lỗi đồng bộ:', error);
  }
}

// ==================== PUSH NOTIFICATION ====================

// Xử lý push notification
self.addEventListener('push', function(event) {
  console.log('📢 Đã nhận push notification');
  
  let title = 'Từ điển Xơ Đăng';
  let body = 'Có thông báo mới';
  let icon = './icon-192x192.png';
  
  // Nếu có dữ liệu trong push
  if (event.data) {
    try {
      const data = event.data.json();
      title = data.title || title;
      body = data.body || body;
      icon = data.icon || icon;
    } catch (error) {
      body = event.data.text() || body;
    }
  }
  
  const options = {
    body: body,
    icon: icon,
    badge: './badge-72x72.png',
    vibrate: [100, 50, 100],
    data: {
      url: './'
    }
  };
  
  event.waitUntil(
    self.registration.showNotification(title, options)
  );
});

// Xử lý click vào notification
self.addEventListener('notificationclick', function(event) {
  console.log('👆 Người dùng click vào notification');
  
  event.notification.close();
  
  const urlToOpen = event.notification.data.url || './';
  
  event.waitUntil(
    clients.matchAll({
      type: 'window',
      includeUncontrolled: true
    }).then(function(clientList) {
      // Tìm tab đang mở
      for (const client of clientList) {
        if (client.url.includes(urlToOpen) && 'focus' in client) {
          return client.focus();
        }
      }
      
      // Mở tab mới nếu chưa có
      if (clients.openWindow) {
        return clients.openWindow(urlToOpen);
      }
    })
  );
});

// ==================== XỬ LÝ TIN NHẮN TỪ TRANG CHÍNH ====================

self.addEventListener('message', function(event) {
  const data = event.data;
  
  if (!data || !data.type) return;
  
  console.log('📨 Nhận message từ trang chính:', data.type);
  
  switch (data.type) {
    case 'SKIP_WAITING':
      self.skipWaiting();
      break;
      
    case 'UPDATE_DATA':
      updateDataFromSheets();
      break;
      
    case 'CLEAR_CACHE':
      clearOldCaches();
      break;
  }
});

// Cập nhật dữ liệu từ Google Sheets
async function updateDataFromSheets() {
  console.log('🔄 Đang cập nhật dữ liệu từ Google Sheets...');
  
  try {
    // Cập nhật dữ liệu từ điển
    const sheetsResponse = await fetch(GOOGLE_CONFIG.SHEETS_URL);
    if (sheetsResponse.ok) {
      const cache = await caches.open(CACHE_NAME);
      await cache.put(GOOGLE_CONFIG.SHEETS_URL, sheetsResponse.clone());
      console.log('✅ Đã cập nhật dữ liệu từ điển');
    }
    
    // Cập nhật dữ liệu chat (nếu có)
    const chatResponse = await fetch(GOOGLE_CONFIG.CHAT_DATA_URL);
    if (chatResponse.ok) {
      const cache = await caches.open(CACHE_NAME);
      await cache.put(GOOGLE_CONFIG.CHAT_DATA_URL, chatResponse.clone());
      console.log('✅ Đã cập nhật dữ liệu chat');
    }
    
  } catch (error) {
    console.log('❌ Không thể cập nhật dữ liệu:', error);
  }
}

// Xóa cache cũ
async function clearOldCaches() {
  console.log('🗑️ Đang xóa cache cũ...');
  
  const cacheNames = await caches.keys();
  const promises = cacheNames.map(function(cacheName) {
    if (cacheName !== CACHE_NAME) {
      console.log('Xóa cache:', cacheName);
      return caches.delete(cacheName);
    }
  });
  
  await Promise.all(promises);
  console.log('✅ Đã xóa cache cũ');
}

// ==================== THÔNG BÁO SERVICE WORKER ĐÃ SẴN SÀNG ====================

console.log('✅ Service Worker đã tải thành công!');
console.log('📊 API Key:', GOOGLE_CONFIG.API_KEY ? 'Đã cấu hình' : 'Chưa cấu hình');
console.log('📁 Sheet ID:', GOOGLE_CONFIG.SHEET_ID);
console.log('💾 Cache name:', CACHE_NAME);
